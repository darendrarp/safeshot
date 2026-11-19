// SafeShot — prompts for Firebase AI Logic hybrid inference.
//
// On-device inference (Gemini Nano via Chrome's Prompt API) supports
// single-turn text generation only — no chat, no tools. Both prompts below
// are single-turn and ask for JSON-only output so the result can be parsed
// and validated deterministically. The same prompts run unchanged on the
// cloud fallback model, which is exactly the point of hybrid inference:
// one prompt, two runtimes.

export const FINDING_TAXONOMY = [
  'api_key', 'password', 'private_key', 'jwt', 'bearer_token', 'url_token',
  'email', 'phone', 'credit_card', 'ip_address',
  'person_name', 'home_address', 'id_number', 'location', 'organization_secret',
  'financial', 'medical', 'other_pii',
];

export const TEXT_SCAN_PROMPT = `You are a privacy scanner. Analyze the text below and find sensitive information that should NOT be shared publicly: secrets (API keys, tokens, passwords, private keys), personal data (names, emails, phone numbers, home addresses, ID numbers), financial or medical details, and internal/organization secrets.

Rules:
- Reply with ONLY a JSON object, no markdown, no explanation.
- Shape: {"findings": [{"type": "<one of: ${FINDING_TAXONOMY.join(', ')}>", "severity": "high|medium|low", "value": "<the EXACT substring from the text, copied verbatim>", "why": "<one short sentence>"}]}
- "value" MUST be an exact substring of the input text. Never invent, paraphrase or normalize values.
- Do not flag generic words, public company names, or placeholder values like "example.com" or "xxx".
- Severity: high = secrets/credentials/financial; medium = direct contact info; low = indirect identifiers.
- At most 30 findings. If nothing sensitive is found, reply {"findings": []}.

TEXT TO SCAN:
"""`;

export const IMAGE_SCAN_PROMPT = `You are a privacy scanner. Look at this screenshot or photo and find sensitive information visible in it that should NOT be shared publicly: secrets (API keys, tokens, passwords), personal data (names, emails, phone numbers, addresses, faces of private individuals), financial or medical details, and internal/organization information.

Rules:
- Reply with ONLY a JSON object, no markdown, no explanation.
- Shape: {"risk": "high|medium|low|none", "summary": "<one sentence>", "findings": [{"type": "<one of: ${FINDING_TAXONOMY.join(', ')}>", "severity": "high|medium|low", "description": "<what is visible, without repeating the secret itself>", "location": "<where in the image, e.g. 'top-right corner', 'center of the screen'>"}]}
- NEVER repeat a full secret, password, key or token in your answer. Describe it instead (e.g. "an API key starting with sk-").
- If nothing sensitive is visible, reply {"risk": "none", "summary": "No sensitive information detected.", "findings": []}.
- At most 20 findings.`;
