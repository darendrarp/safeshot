# SafeShot — Devpost Submission Package

> Copy-paste ready for https://firebasehybridaihackathon.devpost.com/
> Platform: **Web (Chrome)** — Best Web/Chrome App category.
> Deadline: **Nov 30, 2026, 2:00 PM PT** (Dec 1, 2026, 05:00 WIB).

---

## Project title

**SafeShot — Scan before you share**

## Tagline

Privacy scanner that catches leaked secrets in screenshots and text — with AI
that runs on your device first, through Firebase AI Logic hybrid inference.

## What it does (description)

Your screenshot is one paste away from leaking a secret. API keys in error
logs, passwords in chat screenshots, emails in bug reports — SafeShot finds
them before you hit send.

Paste text or drop a screenshot, and SafeShot scans it for secrets (API keys,
tokens, passwords, private keys), personal data (emails, phone numbers, home
addresses, ID numbers), and financial or medical details. Text scans return a
one-click redacted copy; screenshot scans come with a guided blur editor that
bakes the blur into an exported PNG.

What makes SafeShot different is where the AI runs. Using Firebase AI Logic
hybrid inference, scans run on-device with Gemini Nano in Chrome whenever a
local model is available — free, private, and offline-capable — and fall back
to the cloud Gemini model only when needed. A Private mode (ONLY_ON_DEVICE)
guarantees prompts never leave the device, and every result is labeled with
its inference source, so users always know whether their data stayed local or
went to the cloud.

Every AI finding is verified before it is shown: for text, the flagged value
must appear verbatim in the input, and findings are merged with a
deterministic pattern detector (API keys, JWTs, Luhn-checked credit cards).
Hallucinations are dropped, not displayed.

## How we used Firebase AI Logic

Firebase AI Logic hybrid inference is the core of the app — not an add-on.
The implementation lives in `src/ai.js` and is called on every scan:

- `getAI(firebaseApp, { backend: new GoogleAIBackend() })` initializes the
  Gemini Developer API backend.
- `getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE })` creates
  the hybrid model; Private mode switches to `InferenceMode.ONLY_ON_DEVICE`.
- `model.initializeDeviceModel(progressCallback)` is called on the Scan click
  (a user gesture, as required) and shows the Gemini Nano download progress.
- `model.generateContent(prompt)` runs single-turn generation for text scans,
  and `generateContent([prompt, imagePart])` for JPEG/PNG screenshot scans —
  the two input types on-device inference supports.
- `result.response.inferenceSource` (`ON_DEVICE` / `IN_CLOUD`) is read after
  every call and shown as a badge on the result and in the stats ledger.

Supporting Firebase products: **App Check** (reCAPTCHA Enterprise in
production, debug provider on localhost), **Authentication** (anonymous
sign-in), **Firestore** (scan metadata only — counts, severities, inference
source; scanned content is never stored), and **Remote Config** (default scan
mode, cloud-fallback flag, max text length).

## Value proposition

- **For developers & teams:** stop credential leaks at the source — the #1
  cause of cloud breaches is still leaked secrets, and screenshots are a
  daily vector.
- **For privacy:** the sensitive content often never leaves the device. A
  cloud-only scanner asks you to upload the very secret you are afraid of
  leaking; SafeShot's on-device path removes that contradiction.
- **For cost & access:** on-device inference is free and works offline, so
  the product scales to users who can't or won't pay per-token.

## Features & functionality (summary)

- Text scan with severity-ranked findings, masked values, redacted copy
- Screenshot scan (PNG/JPEG) with risk summary and region descriptions
- Guided blur editor with irreversible PNG export
- Private mode (on-device only) + visible inference-source badges
- Privacy ledger: scans, findings caught, on-device share (Firestore-synced)
- Demo mode: full UI works without any Firebase config via the local
  deterministic detector (10 unit tests, all passing)

## Links

- **Repository:** https://github.com/darendrarp/safeshot (public, MIT)
- **Live demo:** https://safeshot-[TBD].vercel.app <!-- fill after deploy -->
- **Demo video:** https://www.youtube.com/watch?v=[TBD] (≤ 3 min, see VIDEO_SCRIPT.md)

## Testing instructions (for judges)

No account or setup needed to try the core experience:

1. Open the live demo link (or run locally: `npm install && npm run dev`).
2. Click **Load sample with secrets**, then **Scan text**. You will see 6
   findings (API key, password, email, phone, IP, JWT) and a redacted copy.
   Without Firebase config this runs the local pattern detector — labeled
   "Demo mode" in the UI.
3. Switch to **Scan screenshot**, drop any PNG/JPEG, and use the blur editor
   (drag rectangles, download the safe image). Image AI scanning needs
   Firebase config (see README Setup).
4. To test real hybrid AI: add your Firebase web config to `.env`
   (AI Logic guided setup, Gemini Developer API provider — free tier), open
   the app in Chrome Desktop v139+ with
   `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled, and
   scan. Results show a 🔒 On-device or ☁️ Cloud badge per scan.

## What was built during the submission period

SafeShot was created from scratch during the #BuildHybridAI 2026 submission
period (Nov 11–30, 2026). No pre-existing app code was used. Standard tools
only: Firebase JS SDK v13, Vite, Node's built-in test runner.

## License

MIT (see LICENSE in the repository).
