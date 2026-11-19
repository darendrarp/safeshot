// SafeShot — unit tests for the deterministic detector.
// Run: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLocally, redactText, maskValue, highestSeverity } from '../src/detector.js';

test('detects email and phone', () => {
  const findings = detectLocally('Reach me at jane.doe@example.com or +1 (415) 555-0132.');
  const types = findings.map((f) => f.type);
  assert.ok(types.includes('email'));
  assert.ok(types.includes('phone'));
});

test('detects AWS key, GitHub token and JWT as high severity', () => {
  const text = [
    'aws key AKIAIOSFODNN7EXAMPLE',
    'token ghp_abcdefghij1234567890ABCD',
    'jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  ].join('\n');
  const findings = detectLocally(text);
  assert.equal(findings.filter((f) => f.severity === 'high').length, 3);
  assert.ok(findings.some((f) => f.type === 'api_key'));
  assert.ok(findings.some((f) => f.type === 'jwt'));
});

test('detects password and api_key assignments, capturing only the secret', () => {
  const findings = detectLocally('password: "hunter2-2026!"\napi_key = "AbC123xYz890qWeRtY"');
  const pw = findings.find((f) => f.type === 'password');
  const key = findings.find((f) => f.type === 'api_key');
  assert.equal(pw.value, 'hunter2-2026!');
  assert.equal(key.value, 'AbC123xYz890qWeRtY');
});

test('validates credit cards with Luhn and rejects random digit runs', () => {
  const valid = detectLocally('card 4242 4242 4242 4242');
  assert.ok(valid.some((f) => f.type === 'credit_card'));
  const invalid = detectLocally('card 4242 4242 4242 4243');
  assert.ok(!invalid.some((f) => f.type === 'credit_card'));
});

test('validates IPv4 octets', () => {
  assert.ok(detectLocally('server 203.0.113.42').some((f) => f.type === 'ip_address'));
  assert.ok(!detectLocally('version 999.1.2.3').some((f) => f.type === 'ip_address'));
});

test('detects private key blocks and tokenized URLs', () => {
  const key = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----';
  assert.ok(detectLocally(key).some((f) => f.type === 'private_key'));
  const url = detectLocally('see https://example.com/reset?token=abc123def456');
  assert.ok(url.some((f) => f.type === 'url_token'));
});

test('returns no findings for clean text', () => {
  assert.deepEqual(detectLocally('Hello world, this is a normal message about lunch.'), []);
});

test('redactText replaces spans with labels and keeps the rest', () => {
  const text = 'email jane.doe@example.com end';
  const findings = detectLocally(text);
  assert.equal(redactText(text, findings), 'email [REDACTED: EMAIL ADDRESS] end');
});

test('maskValue hides the middle of secrets', () => {
  assert.equal(maskValue('AKIAIOSFODNN7EXAMPLE'), 'AK••••••••••••LE');
  assert.equal(maskValue('abc'), '•••');
});

test('highestSeverity picks the worst finding', () => {
  const findings = detectLocally('mail a@b.com and key AKIAIOSFODNN7EXAMPLE');
  assert.equal(highestSeverity(findings), 'high');
  assert.equal(highestSeverity([]), null);
});
