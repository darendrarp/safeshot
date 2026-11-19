// SafeShot — Firebase bootstrap: App, App Check, Auth, Firestore, Remote Config.
//
// Firebase config comes from Vite env vars (see .env.example). When no config
// is present the app runs in DEMO MODE: the full UI works with the local
// deterministic detector (src/detector.js) and localStorage history, and a
// banner says so. No Firebase project, key or account is ever needed to try
// the app — but AI features light up the moment a config is supplied.

import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getRemoteConfig, fetchAndActivate, getValue } from 'firebase/remote-config';

const env = import.meta.env;

export const REMOTE_CONFIG_DEFAULTS = {
  safeshot_default_mode: 'prefer_on_device', // or 'only_on_device'
  safeshot_cloud_fallback: true, // allow cloud fallback when on-device is unavailable
  safeshot_max_text_chars: 20000,
  safeshot_show_demo_banner: true,
};

function readConfig() {
  const apiKey = env.VITE_FIREBASE_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
}

export const firebaseConfig = readConfig();
export const isConfigured = Boolean(firebaseConfig);

let app = null;
let auth = null;
let db = null;
let remoteConfig = null;
let authReadyPromise = null;

function initAppCheck() {
  const isLocalhost =
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const siteKey = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;

  if (!siteKey) {
    // App Check needs a provider. Without a reCAPTCHA Enterprise site key we
    // skip it; AI calls still work if App Check enforcement is off, and the
    // README explains how to add the key + register a debug token.
    console.warn(
      '[SafeShot] No VITE_RECAPTCHA_ENTERPRISE_SITE_KEY — App Check skipped. ' +
        'Add the key from Firebase console > App Check to enable it.',
    );
    return null;
  }

  // Local development: App Check debug provider (accepted by the hackathon
  // rules for submissions). The debug token printed in the console must be
  // registered in Firebase console > App Check > Manage debug tokens.
  if (isLocalhost || env.DEV) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  try {
    return initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.warn('[SafeShot] App Check init failed (continuing without it):', err);
    return null;
  }
}

export function initFirebase() {
  if (!isConfigured || app) return app;
  app = initializeApp(firebaseConfig);
  initAppCheck();
  auth = getAuth(app);
  db = getFirestore(app);
  remoteConfig = getRemoteConfig(app);
  remoteConfig.settings.minimumFetchIntervalMillis = 3600000;
  remoteConfig.defaultConfig = REMOTE_CONFIG_DEFAULTS;
  fetchAndActivate(remoteConfig).catch((err) =>
    console.warn('[SafeShot] Remote Config fetch failed, using defaults:', err),
  );
  return app;
}

export function getDb() {
  return db;
}

export function getAuthInstance() {
  return auth;
}

/** Anonymous sign-in, resolved once. Returns the uid or null on failure. */
export function ensureSignedIn() {
  if (!auth) return Promise.resolve(null);
  if (authReadyPromise) return authReadyPromise;
  authReadyPromise = new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      if (user) {
        resolve(user.uid);
      } else {
        signInAnonymously(auth)
          .then((cred) => resolve(cred.user.uid))
          .catch((err) => {
            console.warn('[SafeShot] Anonymous sign-in failed:', err);
            resolve(null);
          });
      }
    });
  });
  return authReadyPromise;
}

/** Remote Config value with local default fallback. */
export function rcGet(key) {
  const fallback = REMOTE_CONFIG_DEFAULTS[key];
  if (!remoteConfig) return fallback;
  try {
    const value = getValue(remoteConfig, key);
    if (typeof fallback === 'boolean') return value.asBoolean();
    if (typeof fallback === 'number') return value.asNumber();
    return value.asString() || fallback;
  } catch {
    return fallback;
  }
}
