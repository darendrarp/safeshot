// SafeShot — UI wiring.
// Flow: pick a tab (Text / Image) -> provide input -> Scan (user gesture:
// this is where initializeDeviceModel() is allowed to run) -> findings +
// redacted output / blur editor -> history & stats update.

import { initFirebase, isConfigured, rcGet } from './firebase.js';
import {
  aiAvailable, ensureDeviceModel, scanTextWithAI, scanImageWithAI, MODES,
} from './ai.js';
import { detectLocally, redactText, maskValue, highestSeverity } from './detector.js';
import { saveScan, loadHistory, computeStats } from './store.js';
import { BlurEditor } from './blur.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  tab: 'text',
  mode: MODES.HYBRID, // or MODES.PRIVATE
  imageFile: null,
  imageFindings: [],
  textFindings: [],
  textInput: '',
  scanning: false,
  deviceModelState: 'unknown', // unknown | downloading | ready | unavailable
};

let blurEditor = null;

// ---------- helpers ----------

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function severityBadge(sev) {
  return `<span class="sev sev-${sev}">${sev}</span>`;
}

function sourceBadge(source) {
  if (source === 'ON_DEVICE') return '<span class="badge badge-device">🔒 On-device · Gemini Nano</span>';
  if (source === 'IN_CLOUD') return '<span class="badge badge-cloud">☁️ Cloud · Gemini</span>';
  return '<span class="badge badge-local">⌨️ Local pattern scan</span>';
}

function setStatus(msg, kind = '') {
  const s = $('#status');
  s.textContent = msg;
  s.className = `status ${kind}`;
}

// ---------- tabs ----------

function switchTab(tab) {
  state.tab = tab;
  $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#panel-text').hidden = tab !== 'text';
  $('#panel-image').hidden = tab !== 'image';
  $('#results').hidden = true;
  setStatus('');
}

// ---------- text scan ----------

function renderTextResults({ findings, inferenceSource, latencyMs, usedAI }) {
  const results = $('#results');
  results.hidden = false;
  results.innerHTML = '';
  const head = el('div', 'results-head');
  head.innerHTML = `<h2>${findings.length ? `⚠️ ${findings.length} sensitive item${findings.length > 1 ? 's' : ''} found` : '✅ Nothing sensitive found'}</h2>
    <div class="meta">${sourceBadge(inferenceSource)}<span>${latencyMs} ms</span><span>${usedAI ? 'AI + pattern validation' : 'Pattern scan (demo mode)'}</span></div>`;
  results.appendChild(head);

  if (findings.length) {
    const list = el('div', 'findings');
    for (const f of findings) {
      const item = el('div', 'finding');
      item.innerHTML = `<div class="finding-top">${severityBadge(f.severity)}<strong>${escapeHtml(f.label)}</strong>
        <code>${escapeHtml(maskValue(f.value))}</code><span class="src">${f.source === 'ai' ? 'AI' : 'pattern'}</span></div>
        <p>${escapeHtml(f.why || '')}</p>`;
      list.appendChild(item);
    }
    results.appendChild(list);

    const redacted = redactText(state.textInput, findings);
    const out = el('div', 'redacted-box');
    out.innerHTML = `<div class="box-head"><h3>Safe copy — redacted text</h3>
      <button id="copy-redacted" class="btn btn-secondary">Copy redacted text</button></div>
      <pre id="redacted-text">${escapeHtml(redacted)}</pre>`;
    results.appendChild(out);
    $('#copy-redacted').addEventListener('click', async () => {
      await navigator.clipboard.writeText(redacted);
      $('#copy-redacted').textContent = 'Copied ✓';
      setTimeout(() => { $('#copy-redacted').textContent = 'Copy redacted text'; }, 2000);
    });
  } else {
    results.appendChild(el('p', 'clean-note', 'No secrets or personal data detected. Safe to share — but always give it one last human glance.'));
  }
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function runTextScan() {
  if (state.scanning) return;
  const text = $('#text-input').value;
  const maxChars = Number(rcGet('safeshot_max_text_chars')) || 20000;
  if (!text.trim()) {
    setStatus('Paste some text first.', 'error');
    return;
  }
  if (text.length > maxChars) {
    setStatus(`Text is too long (${text.length.toLocaleString()} chars, max ${maxChars.toLocaleString()}).`, 'error');
    return;
  }
  state.textInput = text;
  state.scanning = true;
  $('#scan-text-btn').disabled = true;
  setStatus('Scanning…');

  try {
    if (aiAvailable()) {
      await ensureDeviceModel((p) => {
        state.deviceModelState = 'downloading';
        setStatus(`Downloading on-device model… ${Math.round(p * 100)}%`);
        updateDeviceBadge();
      });
      const res = await scanTextWithAI(text, state.mode);
      renderTextResults({ ...res, usedAI: true });
      setStatus(`Done in ${res.latencyMs} ms — ${res.inferenceSource === 'ON_DEVICE' ? 'processed fully on your device.' : 'processed in the cloud.'}`);
      await recordScan({ kind: 'text', findingCount: res.findings.length, highestSeverity: highestSeverity(res.findings), inferenceSource: res.inferenceSource, latencyMs: res.latencyMs });
    } else {
      // Demo mode: deterministic local scan, no network, no Firebase.
      const t0 = performance.now();
      const findings = detectLocally(text);
      const latencyMs = Math.max(1, Math.round(performance.now() - t0));
      renderTextResults({ findings, inferenceSource: 'LOCAL', latencyMs, usedAI: false });
      setStatus('Demo mode — local pattern scan. Add Firebase config to enable Gemini Nano AI.');
      await recordScan({ kind: 'text', findingCount: findings.length, highestSeverity: highestSeverity(findings), inferenceSource: 'LOCAL', latencyMs });
    }
  } catch (err) {
    setStatus(err.message || String(err), 'error');
  } finally {
    state.scanning = false;
    $('#scan-text-btn').disabled = false;
  }
}

// ---------- image scan ----------

function renderImageResults({ risk, summary, findings, inferenceSource, latencyMs }) {
  const results = $('#results');
  results.hidden = false;
  results.innerHTML = '';
  const head = el('div', 'results-head');
  head.innerHTML = `<h2>${findings.length ? `⚠️ ${findings.length} sensitive item${findings.length > 1 ? 's' : ''} visible (risk: ${risk})` : '✅ Nothing sensitive visible'}</h2>
    <div class="meta">${sourceBadge(inferenceSource)}<span>${latencyMs} ms</span></div>
    ${summary ? `<p class="summary">${escapeHtml(summary)}</p>` : ''}`;
  results.appendChild(head);

  if (findings.length) {
    const list = el('div', 'findings');
    for (const f of findings) {
      const item = el('div', 'finding');
      item.innerHTML = `<div class="finding-top">${severityBadge(f.severity)}<strong>${escapeHtml(f.label)}</strong>
        ${f.location ? `<span class="loc">📍 ${escapeHtml(f.location)}</span>` : ''}</div>
        <p>${escapeHtml(f.description)}</p>`;
      list.appendChild(item);
    }
    results.appendChild(list);
    const hint = el('p', 'blur-hint', '👇 Drag rectangles on the image below to blur each sensitive area, then download the safe version.');
    results.appendChild(hint);
    $('#blur-section').hidden = false;
  } else {
    $('#blur-section').hidden = false;
  }
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function runImageScan() {
  if (state.scanning) return;
  if (!state.imageFile) {
    setStatus('Choose or drop an image first.', 'error');
    return;
  }
  if (!aiAvailable()) {
    setStatus('Image scanning needs the AI model — add Firebase config (see README). The blur editor below still works without AI.', 'error');
    $('#blur-section').hidden = false;
    return;
  }
  state.scanning = true;
  $('#scan-image-btn').disabled = true;
  setStatus('Scanning image…');
  try {
    await ensureDeviceModel((p) => setStatus(`Downloading on-device model… ${Math.round(p * 100)}%`));
    const res = await scanImageWithAI(state.imageFile, state.mode);
    renderImageResults(res);
    setStatus(`Done in ${res.latencyMs} ms — ${res.inferenceSource === 'ON_DEVICE' ? 'processed fully on your device.' : 'processed in the cloud.'}`);
    await recordScan({ kind: 'image', findingCount: res.findings.length, highestSeverity: highestSeverity(res.findings), inferenceSource: res.inferenceSource, latencyMs: res.latencyMs });
  } catch (err) {
    setStatus(err.message || String(err), 'error');
  } finally {
    state.scanning = false;
    $('#scan-image-btn').disabled = false;
  }
}

async function handleImageFile(file) {
  if (!file || !/^image\/(png|jpe?g)$/i.test(file.type)) {
    setStatus('Please use a PNG or JPEG image (the on-device model only supports those).', 'error');
    return;
  }
  state.imageFile = file;
  $('#drop-label').textContent = `📷 ${file.name} (${Math.round(file.size / 1024)} KB)`;
  $('#scan-image-btn').disabled = false;
  if (!blurEditor) blurEditor = new BlurEditor($('#blur-canvas'), { onChange: updateBlurButtons });
  await blurEditor.loadImage(file);
  $('#blur-section').hidden = false;
  updateBlurButtons(0);
  setStatus('Image loaded. Press "Scan image" to check it with AI, or blur areas manually.');
}

function updateBlurButtons(count = blurEditor?.rects.length ?? 0) {
  $('#blur-count').textContent = count ? `${count} blurred area${count > 1 ? 's' : ''}` : 'No blurred areas yet — drag on the image';
  $('#blur-undo').disabled = count === 0;
  $('#blur-clear').disabled = count === 0;
  $('#blur-download').disabled = !blurEditor?.image;
}

// ---------- history & stats ----------

async function recordScan(record) {
  await saveScan(record);
  await refreshHistory();
}

async function refreshHistory() {
  const records = await loadHistory();
  const stats = computeStats(records);
  $('#stat-scans').textContent = stats.totalScans;
  $('#stat-findings').textContent = stats.totalFindings;
  $('#stat-ondevice').textContent = stats.onDeviceShare == null ? '—' : `${stats.onDeviceShare}%`;
  $('#stat-high').textContent = stats.highSeverity;

  const list = $('#history-list');
  list.innerHTML = '';
  if (!records.length) {
    list.innerHTML = '<li class="empty">No scans yet. Your first scan will appear here.</li>';
    return;
  }
  for (const r of records.slice(0, 10)) {
    const li = el('li', 'history-item');
    const date = new Date(r.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    li.innerHTML = `<span>${r.kind === 'image' ? '🖼️' : '📝'} ${r.kind}</span>
      <span>${r.findingCount ?? 0} finding${r.findingCount === 1 ? '' : 's'}${r.highestSeverity ? ` · <b class="sev-${r.highestSeverity}">${r.highestSeverity}</b>` : ''}</span>
      <span>${r.inferenceSource === 'ON_DEVICE' ? '🔒 on-device' : r.inferenceSource === 'IN_CLOUD' ? '☁️ cloud' : '⌨️ local'}</span>
      <span class="muted">${date}</span>`;
    list.appendChild(li);
  }
}

// ---------- device badge / mode ----------

function updateDeviceBadge() {
  const badge = $('#device-badge');
  if (!isConfigured) {
    badge.textContent = 'Demo mode — no Firebase config';
    badge.className = 'device-badge demo';
    return;
  }
  if (state.mode === MODES.PRIVATE) {
    badge.textContent = '🔒 Private mode — on-device only';
    badge.className = 'device-badge private';
  } else {
    badge.textContent = '⚡ Hybrid — on-device first, cloud fallback';
    badge.className = 'device-badge hybrid';
  }
}

function initModeToggle() {
  const toggle = $('#private-toggle');
  const defaultMode = String(rcGet('safeshot_default_mode'));
  if (defaultMode === 'only_on_device') {
    toggle.checked = true;
    state.mode = MODES.PRIVATE;
  }
  toggle.addEventListener('change', () => {
    state.mode = toggle.checked ? MODES.PRIVATE : MODES.HYBRID;
    updateDeviceBadge();
    setStatus(toggle.checked
      ? 'Private mode: prompts never leave your device. If Gemini Nano is unavailable, scans will fail instead of using the cloud.'
      : 'Hybrid mode: Gemini Nano on-device when available, cloud Gemini as fallback.');
  });
}

// ---------- sample data ----------

const SAMPLE_TEXT = `Hey, can you check the deploy? The staging API key is sk-live-9f2Kd8xQw4Lm7ZpRtYvBnC1a and the DB password is "hunter2-2026!" — don't share that.
My email is jane.doe@example.com, phone +1 (415) 555-0132. The server is at 203.0.113.42.
Also here's the token from the logs: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U`;

function loadSample() {
  $('#text-input').value = SAMPLE_TEXT;
  setStatus('Sample loaded — it contains a fake API key, password, email, phone, IP and JWT. Press Scan.');
}

// ---------- boot ----------

function init() {
  initFirebase();
  updateDeviceBadge();
  initModeToggle();

  if (!isConfigured) {
    $('#demo-banner').hidden = false;
  } else if (String(rcGet('safeshot_show_demo_banner')) === 'true') {
    // Configured: hide the demo banner, show the AI-ready note instead.
    $('#demo-banner').hidden = true;
  }

  $$('.tab-btn').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#scan-text-btn').addEventListener('click', runTextScan);
  $('#scan-image-btn').addEventListener('click', runImageScan);
  $('#sample-btn').addEventListener('click', loadSample);
  $('#clear-text-btn').addEventListener('click', () => { $('#text-input').value = ''; setStatus(''); });

  const drop = $('#drop-zone');
  const fileInput = $('#file-input');
  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => handleImageFile(fileInput.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', (e) => handleImageFile(e.dataTransfer.files[0]));
  document.addEventListener('paste', (e) => {
    if (state.tab !== 'image') return;
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) handleImageFile(file);
  });

  $('#blur-undo').addEventListener('click', () => blurEditor?.undo());
  $('#blur-clear').addEventListener('click', () => blurEditor?.clear());
  $('#blur-download').addEventListener('click', async () => {
    const blob = await blurEditor?.exportPng();
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'safeshot-redacted.png';
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus('Downloaded the redacted image. The blur is baked in — it cannot be reversed.');
  });

  refreshHistory();
}

document.addEventListener('DOMContentLoaded', init);
