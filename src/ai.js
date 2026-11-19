// SafeShot — Firebase AI Logic hybrid inference wrapper.
//
// This is the heart of the app. One GenerativeModel, two runtimes:
//   - PREFER_ON_DEVICE: Gemini Nano 4 runs locally in Chrome (desktop v139+)
//     when available; otherwise the SDK falls back to the cloud-hosted model.
//   - ONLY_ON_DEVICE ("Private mode"): on-device or nothing — the prompt
//     never leaves the device. Used when the user toggles Private mode on.
// After every call we read `response.inferenceSource` ('ON_DEVICE' /
// 'IN_CLOUD', JS SDK v12.5.0+) and surface it in the UI, so the user always
// knows where their data was processed.
//
// On-device constraints respected here (per Firebase docs):
//   - single-turn text generation only (no chat, no tools)
//   - images must be JPEG/PNG inline data
//   - initializeDeviceModel() only after a user gesture, before generateContent
// Docs: https://firebase.google.com/docs/ai-logic/hybrid-on-device-inference

import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from 'firebase/ai';
import { initFirebase, isConfigured } from './firebase.js';
import { TEXT_SCAN_PROMPT, IMAGE_SCAN_PROMPT, FINDING_TAXONOMY } from './prompts.js';
import { detectLocally, maskValue } from './detector.js';

const ON_DEVICE_SYSTEM_PROMPT =
  'You are SafeShot, a precise privacy scanner. Answer in JSON only, exactly as instructed. Never repeat full secrets.';

let ai = null;
let modelCache = new Map(); // mode -> GenerativeModel
let deviceModelReady = false;
let deviceModelPromise = null;

function getBackend() {
  if (!ai) {
    const app = initFirebase();
    ai = getAI(app, { backend: new GoogleAIBackend() });
  }
  return ai;
}

function getModel(mode) {
  if (modelCache.has(mode)) return modelCache.get(mode);
  const model = getGenerativeModel(getBackend(), {
    mode,
    // Cloud fallback uses the SDK default (gemini-3.5-flash-lite from v13).
    // No override: the default is free-tier friendly and supports JSON output.
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        initialPrompts: [
          { role: 'system', content: [{ type: 'text', value: ON_DEVICE_SYSTEM_PROMPT }] },
        ],
      },
    },
  });
  modelCache.set(mode, model);
  return model;
}

export const MODES = {
  HYBRID: InferenceMode.PREFER_ON_DEVICE,
  PRIVATE: InferenceMode.ONLY_ON_DEVICE,
};

export function aiAvailable() {
  return isConfigured;
}

/**
 * Must be called from a user gesture (button click) before the first scan.
 * Downloads the on-device model if needed; reports 0..1 progress.
 * Safe to call repeatedly — the underlying promise is shared.
 */
export function ensureDeviceModel(onProgress) {
  if (deviceModelReady) return Promise.resolve(true);
  if (deviceModelPromise) return deviceModelPromise;
  deviceModelPromise = (async () => {
    try {
      const model = getModel(MODES.HYBRID);
      await model.initializeDeviceModel((fraction) => {
        if (typeof onProgress === 'function') onProgress(fraction);
      });
      deviceModelReady = true;
      return true;
    } catch (err) {
      console.warn('[SafeShot] On-device model init failed, cloud fallback remains:', err);
      return false;
    }
  })();
  return deviceModelPromise;
}

/** Extract the first {...} JSON object from model output. */
export function extractJson(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const TYPE_LABELS = {
  person_name: 'Person name',
  home_address: 'Home address',
  id_number: 'ID number',
  location: 'Location',
  organization_secret: 'Internal secret',
  financial: 'Financial info',
  medical: 'Medical info',
  other_pii: 'Personal info',
  api_key: 'API key / secret',
  password: 'Password',
  private_key: 'Private key',
  jwt: 'JWT token',
  bearer_token: 'Bearer token',
  url_token: 'Token in URL',
  email: 'Email address',
  phone: 'Phone number',
  credit_card: 'Credit card number',
  ip_address: 'IP address',
};

/**
 * Validate AI text findings: the claimed value must appear verbatim in the
 * input (guards against hallucination), then merge with deterministic
 * pattern findings and dedupe by span overlap.
 */
export function mergeTextFindings(input, aiFindings) {
  const fromAi = [];
  for (const f of Array.isArray(aiFindings) ? aiFindings : []) {
    if (!f || typeof f.value !== 'string' || !f.value) continue;
    if (!FINDING_TAXONOMY.includes(f.type)) continue;
    const start = input.indexOf(f.value);
    if (start === -1) continue; // hallucinated value — drop it
    fromAi.push({
      type: f.type,
      label: TYPE_LABELS[f.type] || f.type,
      severity: ['high', 'medium', 'low'].includes(f.severity) ? f.severity : 'medium',
      value: f.value,
      start,
      end: start + f.value.length,
      why: typeof f.why === 'string' ? f.why : '',
      source: 'ai',
    });
  }
  const local = detectLocally(input);
  // Merge: prefer AI spans on overlap (they carry the semantic label), keep
  // local ones otherwise. Both lists are span-sorted already.
  const all = [...fromAi, ...local].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const f of all) {
    const clash = merged.find((k) => f.start < k.end && k.start < f.end);
    if (!clash) {
      merged.push(f);
    } else if (f.source === 'ai' && clash.source === 'pattern') {
      merged.splice(merged.indexOf(clash), 1, f);
    }
  }
  return merged.sort((a, b) => a.start - b.start);
}

function normalizeImageFindings(parsed) {
  const findings = [];
  for (const f of Array.isArray(parsed?.findings) ? parsed.findings : []) {
    if (!f || typeof f.description !== 'string') continue;
    findings.push({
      type: FINDING_TAXONOMY.includes(f.type) ? f.type : 'other_pii',
      label: TYPE_LABELS[f.type] || 'Personal info',
      severity: ['high', 'medium', 'low'].includes(f.severity) ? f.severity : 'medium',
      description: f.description,
      location: typeof f.location === 'string' ? f.location : '',
      source: 'ai',
    });
  }
  return {
    risk: ['high', 'medium', 'low', 'none'].includes(parsed?.risk) ? parsed.risk : (findings.length ? 'medium' : 'none'),
    summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
    findings,
  };
}

async function fileToPart(file) {
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return { type: 'inlineData', inlineData: { data: base64, mimeType: file.type } };
}

function describeError(err, mode) {
  const msg = String(err?.message || err);
  if (mode === MODES.PRIVATE && /not available|unavailable|on-device/i.test(msg)) {
    return {
      code: 'ON_DEVICE_UNAVAILABLE',
      message:
        'On-device AI is not available in this browser (needs Chrome on Desktop v139+ with the Prompt API flag enabled and the Gemini Nano model downloaded). Switch off Private mode to allow the cloud fallback, or use the local pattern scan.',
    };
  }
  return { code: 'AI_ERROR', message: msg };
}

/**
 * Scan pasted text. Returns { findings, inferenceSource, latencyMs, modelNote }.
 * `mode` is InferenceMode.PREFER_ON_DEVICE (hybrid) or ONLY_ON_DEVICE (private).
 */
export async function scanTextWithAI(text, mode = MODES.HYBRID) {
  const started = performance.now();
  const model = getModel(mode);
  let result;
  try {
    result = await model.generateContent(`${TEXT_SCAN_PROMPT}\n${text}\n"""`);
  } catch (err) {
    throw describeError(err, mode);
  }
  const latencyMs = Math.round(performance.now() - started);
  const parsed = extractJson(result.response.text());
  return {
    findings: mergeTextFindings(text, parsed?.findings),
    inferenceSource: result.response.inferenceSource || 'UNKNOWN',
    latencyMs,
    rawJson: parsed,
  };
}

/**
 * Scan an image (JPEG/PNG). Returns { risk, summary, findings, inferenceSource, latencyMs }.
 */
export async function scanImageWithAI(file, mode = MODES.HYBRID) {
  const started = performance.now();
  const model = getModel(mode);
  const imagePart = await fileToPart(file);
  let result;
  try {
    result = await model.generateContent([IMAGE_SCAN_PROMPT, imagePart]);
  } catch (err) {
    throw describeError(err, mode);
  }
  const latencyMs = Math.round(performance.now() - started);
  const parsed = extractJson(result.response.text());
  return {
    ...normalizeImageFindings(parsed),
    inferenceSource: result.response.inferenceSource || 'UNKNOWN',
    latencyMs,
  };
}

export { maskValue };
