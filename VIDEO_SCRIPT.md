# SafeShot — Demo Video Script (≤ 3 minutes)

> Record in Chrome on Desktop (v139+) with the Gemini Nano model already
> downloaded, Firebase config in `.env`, and the app running locally or on the
> deployed URL. Capture at 1080p, show the whole browser window, narrate in
> clear English. Total runtime target: **2:30–2:50**.

## Shot list & narration

### 0:00–0:20 — The problem (show, don't tell)
**Visual:** A chat window / bug report with a pasted error log containing a
visible API key. Zoom in on the key.
**Narration:**
> "Every day, developers paste screenshots and logs into chats and bug
> reports — and leak API keys, passwords, and personal data with them.
> This is SafeShot. It catches the leak before you hit send."

### 0:20–0:55 — Text scan, on-device
**Visual:** Open SafeShot. Click **Load sample with secrets**, then **Scan
text**. Point at the "🔒 On-device · Gemini Nano" badge and the latency.
Scroll the findings list (API key, password, email, phone, IP, JWT), then
click **Copy redacted text**.
**Narration:**
> "Paste any text — a log, a chat, a code snippet — and scan. The AI runs
> right here, on your device, with Gemini Nano through Firebase AI Logic.
> Nothing leaves the machine. Six findings, ranked by severity — and a
> one-click redacted copy that's safe to share."

### 0:55–1:30 — Screenshot scan + blur editor
**Visual:** Switch to the **Scan screenshot** tab. Drop a prepared
screenshot (a fake settings page showing an email and an API key). Scan it.
Show the findings with locations ("top-right corner"). Drag two blur
rectangles, click **Download safe image**, open the exported PNG.
**Narration:**
> "Same for screenshots. SafeShot tells you what's sensitive and where —
> without ever repeating the secret itself. Then you blur exactly what you
> want, and export a safe image. The blur is baked in. It can't be reversed."

### 1:30–2:05 — Hybrid routing + Private mode
**Visual:** Toggle **Private mode** on; show the header badge change to
"on-device only". Open DevTools Network tab briefly (or the stats section)
and show the privacy ledger: scans, findings caught, on-device share.
**Narration:**
> "Here's the hybrid part. SafeShot prefers on-device inference and falls
> back to the cloud only when no local model is available — and every result
> is labeled with where it ran. Turn on Private mode, and prompts never leave
> your device at all: the scan fails safe instead of sending your data
> anywhere. Your ledger tracks it all — counts only. Your content is never
> stored."

### 2:05–2:35 — How it's built (quick code tour)
**Visual:** Quick cuts of `src/ai.js`: the `getGenerativeModel` call with
`InferenceMode.PREFER_ON_DEVICE`, `initializeDeviceModel`, and
`response.inferenceSource`. Then the README's Firebase section.
**Narration:**
> "Under the hood it's Firebase AI Logic hybrid inference, with App Check,
> anonymous Auth, Firestore and Remote Config. The AI layer is one file,
> one prompt, two runtimes — on-device when possible, cloud when needed."

### 2:35–2:50 — Close
**Visual:** Back on the app's hero. Show repo URL + live demo URL on screen.
**Narration:**
> "SafeShot — scan before you share. Free, open source, and private by
> design. Links in the description."

## Recording notes

- Prepare the fake screenshot in advance (a simple HTML page or slide with a
  fake email + fake API key — never real secrets, even in a demo).
- Pre-download Gemini Nano (`await LanguageModel.create()` in DevTools) so
  the first scan doesn't wait on a model download on camera.
- If on-device inference is unavailable on the recording machine, the badge
  will show "Cloud" — still a valid demo of hybrid fallback; narrate it as
  the fallback path instead.
- Keep the Devpost rules in mind: video must be public on YouTube, ≤ 3 min,
  English narration or subtitles.
