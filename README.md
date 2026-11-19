# SafeShot — Scan before you share

> **Your screenshot is one paste away from leaking a secret.**
> SafeShot scans screenshots and text for leaked secrets and personal data
> *before* you share them — with AI that runs **on your device** whenever
> possible, through **Firebase AI Logic hybrid inference**.

Built for **#BuildHybridAI 2026** — a Firebase hackathon about apps that run
AI on-device and in the cloud with one SDK.

**Live demo:** https://safeshot-lyart.vercel.app
**Repository:** https://github.com/darendrarp/safeshot

![Status](https://img.shields.io/badge/status-submission--ready-green)
![License](https://img.shields.io/badge/license-MIT-blue)
![Firebase](https://img.shields.io/badge/Firebase-AI%20Logic-orange)

## The problem

Every day, developers and teams paste screenshots and logs into chats, bug
reports and social posts — and leak API keys, passwords, tokens, emails and
phone numbers with them. Existing scanners either send your sensitive content
to a cloud API (defeating the purpose) or are regex-only toys that miss
semantic leaks like a home address in a photo.

## The solution

SafeShot is a privacy scanner where **hybrid inference is the product**:

1. **On-device first.** On Chrome desktop (v139+) with Gemini Nano
   downloaded, your text or screenshot is scanned locally via Firebase AI
   Logic (`InferenceMode.PREFER_ON_DEVICE`). Free, private, and it works
   offline — the sensitive content often never leaves your machine at all.
2. **Cloud fallback — with consent.** If no local model is available, the
   same prompt runs on the cloud Gemini model. In **Private mode**
   (`ONLY_ON_DEVICE`) the scan fails safe instead of sending your data
   anywhere.
3. **Verified output.** Every AI finding is validated: for text, the flagged
   value must appear verbatim in your input, and findings are merged with a
   deterministic pattern detector (API keys, JWTs, Luhn-checked cards…).
   Hallucinations are dropped, not shown.
4. **You stay in control.** Each result is labeled with its inference source
   (`response.inferenceSource`: `ON_DEVICE` or `IN_CLOUD`), so you always
   know where your data was processed. A guided blur editor lets you hide
   sensitive regions of a screenshot and export a safe PNG.

## Features

| Feature | Details |
|---|---|
| 📝 Text scan | Paste logs, chats, code — get findings with severity, masked values, and a one-click redacted copy |
| 🖼️ Screenshot scan | Drop/paste a PNG/JPEG — AI reports what is sensitive and where (in words, never repeating the secret) |
| 🎨 Blur editor | Drag rectangles to blur regions; blur is baked into the exported PNG (irreversible) |
| 🔒 Private mode | `ONLY_ON_DEVICE` — prompts never leave the device |
| 📊 Privacy ledger | Scan counts, findings caught, on-device share — synced to Firestore (anonymous auth), never the content itself |
| 🧪 Demo mode | Without any Firebase config the app still fully works with the local deterministic detector — try it instantly |

## How Firebase AI Logic is used

The entire AI layer lives in [`src/ai.js`](src/ai.js) — imported and actually
called at runtime, not just named here:

```js
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from "firebase/ai";

const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
const model = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,   // or ONLY_ON_DEVICE in Private mode
  onDeviceParams: { createOptions: { /* system prompt, I/O languages */ } },
});

// After a user gesture, before the first scan:
await model.initializeDeviceModel((progress) => /* download % */);

// Single-turn generation (the only kind on-device inference supports):
const result = await model.generateContent(prompt);
console.log(result.response.inferenceSource); // 'ON_DEVICE' | 'IN_CLOUD'
```

Other Firebase products used:

- **App Check** (required by AI Logic) — reCAPTCHA Enterprise in production,
  debug provider on localhost. Debug tokens are accepted for submissions.
- **Authentication** — anonymous sign-in, so scan history syncs per user
  without any account or personal data.
- **Firestore** — scan metadata only (counts, severities, inference source,
  latency). Scanned content is never stored. Rules in
  [`firestore.rules`](firestore.rules) restrict each user to their own records.
- **Remote Config** — default scan mode, cloud-fallback flag, max text
  length, demo banner. All read with local defaults, so the app works even if
  Remote Config is never set up.

## Try it (no setup — demo mode)

```bash
npm install
npm run dev
```

Open http://localhost:5173, click **Load sample with secrets**, then **Scan**.
The local pattern detector finds the fake API key, password, email, phone,
IP and JWT — no Firebase project needed.

## Setup (full AI mode)

1. **Chrome (for on-device inference):** Chrome on Desktop v139+, enable
   `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, restart.
   (Optional) pre-download the model in DevTools console:
   `await LanguageModel.create()`.
2. **Firebase project:** create one in the Firebase console, run the
   **AI Logic** guided setup (choose the **Gemini Developer API** provider —
   free tier), and register a Web app.
3. **Enable services:** Authentication → Anonymous sign-in; Firestore
   (deploy [`firestore.rules`](firestore.rules)); App Check (register the
   debug token printed in the console for localhost, or add a reCAPTCHA
   Enterprise site key for production).
4. **Configure the app:**
   ```bash
   cp .env.example .env   # fill in your web app config
   npm run dev
   ```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (http://localhost:5173) |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Unit tests for the detector (`node --test`) |

## Project structure

```
safeshot/
├── index.html            # App shell
├── src/
│   ├── main.js           # UI wiring (tabs, scan flow, history)
│   ├── ai.js             # Firebase AI Logic hybrid inference wrapper
│   ├── firebase.js       # App / App Check / Auth / Firestore / Remote Config
│   ├── detector.js       # Deterministic PII & secret patterns (+ redaction)
│   ├── prompts.js        # Single-turn JSON prompts for text & image scans
│   ├── blur.js           # Canvas blur editor (export PNG)
│   ├── store.js          # History & stats (Firestore + localStorage)
│   └── styles.css
├── tests/
│   └── detector.test.js  # 10 unit tests, all passing
├── firestore.rules
├── firebase.json
└── SUBMISSION.md         # Devpost submission package
```

## Known limitations (honest)

- On-device inference needs Chrome on Desktop v139+ with the Prompt API flag;
  other browsers use the cloud fallback (or demo mode without Firebase).
- On-device inference is single-turn text generation only — no chat, no
  tools. SafeShot is designed around that constraint.
- The image scanner describes sensitive regions in words; it does not return
  bounding boxes, so blurring is user-guided (deliberate: no hallucinated
  boxes hiding the wrong thing).
- The local pattern detector is deterministic and cannot catch semantic PII
  (names, addresses in prose) — that is what the AI path is for.

## Built during the hackathon

SafeShot was created from scratch during the #BuildHybridAI 2026 submission
period (Nov 11–30, 2026). No pre-existing code was incorporated except the
Firebase JS SDK and Vite, both standard development tools.

## License

MIT — see [LICENSE](LICENSE).
