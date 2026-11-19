// SafeShot — scan history & stats.
// Firestore (per-user, anonymous auth) when Firebase is configured, otherwise
// localStorage. Records never store raw scanned content — only counts,
// severities, inference source and a timestamp. Privacy is the product.

import { collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp } from 'firebase/firestore';
import { getDb, ensureSignedIn, isConfigured } from './firebase.js';

const LOCAL_KEY = 'safeshot.history.v1';
const MAX_LOCAL = 50;

function localLoad() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
  } catch {
    return [];
  }
}

function localSave(records) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(records.slice(0, MAX_LOCAL)));
  } catch {
    /* storage full / unavailable — history is best-effort */
  }
}

export async function saveScan(record) {
  const entry = {
    ...record,
    createdAt: Date.now(),
  };
  // Always keep a local copy (works offline, works in demo mode).
  localSave([entry, ...localLoad()]);
  if (!isConfigured) return entry;
  try {
    const uid = await ensureSignedIn();
    const db = getDb();
    if (!uid || !db) return entry;
    await addDoc(collection(db, 'users', uid, 'scans'), {
      kind: entry.kind,
      findingCount: entry.findingCount,
      highestSeverity: entry.highestSeverity,
      inferenceSource: entry.inferenceSource,
      latencyMs: entry.latencyMs,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('[SafeShot] Firestore save failed (local copy kept):', err);
  }
  return entry;
}

export async function loadHistory() {
  const local = localLoad();
  if (!isConfigured) return local;
  try {
    const uid = await ensureSignedIn();
    const db = getDb();
    if (!uid || !db) return local;
    const snap = await getDocs(
      query(collection(db, 'users', uid, 'scans'), orderBy('createdAt', 'desc'), limit(50)),
    );
    const remote = snap.docs.map((d) => {
      const data = d.data();
      return {
        ...data,
        id: d.id,
        createdAt: data.createdAt?.toMillis?.() ?? Date.now(),
      };
    });
    return remote.length ? remote : local;
  } catch (err) {
    console.warn('[SafeShot] Firestore load failed (using local history):', err);
    return local;
  }
}

export function computeStats(records) {
  const stats = {
    totalScans: records.length,
    totalFindings: 0,
    onDevice: 0,
    inCloud: 0,
    localOnly: 0,
    highSeverity: 0,
  };
  for (const r of records) {
    stats.totalFindings += r.findingCount || 0;
    if (r.highestSeverity === 'high') stats.highSeverity++;
    if (r.inferenceSource === 'ON_DEVICE') stats.onDevice++;
    else if (r.inferenceSource === 'IN_CLOUD') stats.inCloud++;
    else stats.localOnly++;
  }
  const aiScans = stats.onDevice + stats.inCloud;
  stats.onDeviceShare = aiScans ? Math.round((stats.onDevice / aiScans) * 100) : null;
  return stats;
}
