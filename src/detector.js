// SafeShot — deterministic local detector for secrets & PII.
// Framework-free on purpose: the same module runs in the browser (demo mode
// + validation layer) and in Node unit tests.
//
// Every finding carries exact character offsets so the UI can redact the
// original text with zero guesswork. AI findings are validated against this
// module's spans (see ai.js) — a finding whose value does not appear verbatim
// in the input is dropped as a hallucination.

export const SEVERITY = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

const FINDING_TYPES = {
  private_key: { label: 'Private key', severity: 'high', why: 'A private key gives full access to whatever it protects. Never share it.' },
  api_key: { label: 'API key / secret', severity: 'high', why: 'API keys authenticate as you. Leaked keys get revoked — or abused first.' },
  jwt: { label: 'JWT token', severity: 'high', why: 'A JWT can carry a live session. Anyone with it may act as you until it expires.' },
  bearer_token: { label: 'Bearer token', severity: 'high', why: 'Bearer tokens grant access to whoever holds them, no password needed.' },
  password: { label: 'Password', severity: 'high', why: 'A visible password should be treated as compromised and rotated.' },
  url_token: { label: 'Token in URL', severity: 'high', why: 'Secrets in URLs leak through browser history, logs and referrers.' },
  credit_card: { label: 'Credit card number', severity: 'high', why: 'A valid card number is enough to start fraudulent transactions.' },
  email: { label: 'Email address', severity: 'medium', why: 'Emails enable spam, phishing and account-enumeration attacks.' },
  phone: { label: 'Phone number', severity: 'medium', why: 'Phone numbers enable spam, SIM-swap attempts and doxxing.' },
  ip_address: { label: 'IP address', severity: 'low', why: 'Internal IPs reveal network layout; public IPs reveal rough location.' },
};

function luhnValid(digits) {
  let sum = 0;
  let doubleIt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (doubleIt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    doubleIt = !doubleIt;
  }
  return digits.length >= 13 && digits.length <= 19 && sum % 10 === 0;
}

function validIpv4(value) {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/**
 * Pattern rules. Each rule yields { type, value, start, end }.
 * `group` picks the capture group that holds the secret itself (so labels
 * like `api_key=` are not swallowed into the redacted span).
 */
const RULES = [
  {
    type: 'private_key',
    re: /-----BEGIN (?:[A-Z0-9 ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----[\s\S]{0,400}?-----END (?:[A-Z0-9 ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----/g,
  },
  { type: 'api_key', re: /\bAKIA[0-9A-Z]{16}\b/g }, // AWS access key id
  { type: 'api_key', re: /\bAIza[0-9A-Za-z\-_]{35}\b/g }, // Google API key
  { type: 'api_key', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g }, // GitHub tokens
  { type: 'api_key', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { type: 'api_key', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g }, // Slack tokens
  { type: 'api_key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g }, // Stripe-style secret keys
  { type: 'api_key', re: /\bsk-[A-Za-z0-9]{20,}\b/g }, // OpenAI-style keys
  { type: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { type: 'bearer_token', re: /Bearer\s+([A-Za-z0-9\-._~+/=]{16,})/g, group: 1 },
  { type: 'url_token', re: /https?:\/\/[^\s"'<>]*[?&](?:token|key|auth|secret|api_key)=[^\s&"'<>]+/g },
  {
    type: 'api_key',
    re: /(?:api[_-]?key|apikey|client[_-]?secret|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"]([A-Za-z0-9\-_~+/=]{16,})['"]/gi,
    group: 1,
  },
  {
    type: 'password',
    re: /(?:password|passwd|pwd)\s*[:=]\s*['"]([^'"\s;,]{6,})['"]/gi,
    group: 1,
  },
  { type: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  {
    type: 'credit_card',
    re: /\b(?:\d[ -]?){13,19}\b/g,
    validate: (v) => luhnValid(v.replace(/[ -]/g, '')),
  },
  { type: 'ip_address', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, validate: validIpv4 },
  {
    type: 'phone',
    // International / local numbers with separators; digit-count guard kills
    // dates, versions and other numeric noise.
    re: /\+?[\d(][\d\s().-]{7,}\d/g,
    validate: (v) => {
      // Looks like an IPv4 address (handled by its own rule) — not a phone.
      if (/\d{1,3}(\.\d{1,3}){3}/.test(v)) return false;
      const digits = v.replace(/\D/g, '');
      return digits.length >= 9 && digits.length <= 15 && !/^\d{4}-\d{2}-\d{2}/.test(v);
    },
  },
];

function collectMatches(text) {
  const raw = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const value = rule.group ? m[rule.group] : m[0];
      if (!value) continue;
      // Locate the captured group inside the full match.
      const start = rule.group ? m.index + m[0].indexOf(value) : m.index;
      const end = start + value.length;
      if (rule.validate && !rule.validate(value)) continue;
      if (value.length > 4096) continue; // safety cap (private-key blocks)
      raw.push({ type: rule.type, value, start, end });
      if (m[0].length === 0) rule.re.lastIndex++;
    }
  }
  return raw;
}

// Drop overlapping spans: keep the higher-severity, then longer, match.
function dedupeOverlaps(findings) {
  const rank = { high: 3, medium: 2, low: 1 };
  const sorted = [...findings].sort(
    (a, b) => a.start - b.start || rank[b.severity] - rank[a.severity] || b.value.length - a.value.length,
  );
  const kept = [];
  for (const f of sorted) {
    const clash = kept.find((k) => f.start < k.end && k.start < f.end);
    if (!clash) {
      kept.push(f);
      continue;
    }
    if (rank[f.severity] > rank[clash.severity] ||
        (rank[f.severity] === rank[clash.severity] && f.value.length > clash.value.length)) {
      kept.splice(kept.indexOf(clash), 1, f);
    }
  }
  return kept.sort((a, b) => a.start - b.start);
}

/**
 * Scan text with deterministic patterns.
 * @returns {Array<{type,label,severity,value,start,end,why,source}>}
 */
export function detectLocally(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const found = collectMatches(text).map((f) => ({
    ...f,
    label: FINDING_TYPES[f.type].label,
    severity: FINDING_TYPES[f.type].severity,
    why: FINDING_TYPES[f.type].why,
    source: 'pattern',
  }));
  return dedupeOverlaps(found);
}

/** Mask a secret for display: keep 2 chars at each end. */
export function maskValue(value, maxLen = 32) {
  if (!value) return '';
  const shown = value.length > maxLen ? value.slice(0, maxLen) + '…' : value;
  if (shown.length <= 6) return '•'.repeat(shown.length);
  return shown.slice(0, 2) + '•'.repeat(Math.min(shown.length - 4, 12)) + shown.slice(-2);
}

/**
 * Redact findings from text, replacing each span with [REDACTED: LABEL].
 * Spans must be non-overlapping and sorted (detectLocally guarantees this).
 */
export function redactText(text, findings) {
  if (!findings.length) return text;
  let out = '';
  let cursor = 0;
  for (const f of findings) {
    if (f.start < cursor || f.start == null) continue;
    out += text.slice(cursor, f.start);
    out += `[REDACTED: ${f.label.toUpperCase()}]`;
    cursor = f.end;
  }
  return out + text.slice(cursor);
}

export function severityRank(severity) {
  return { high: 3, medium: 2, low: 1 }[severity] ?? 0;
}

export function highestSeverity(findings) {
  if (!findings.length) return null;
  return findings.reduce((a, b) => (severityRank(b.severity) > severityRank(a.severity) ? b : a)).severity;
}
