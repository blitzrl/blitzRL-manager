// ============================================================
// SYNC SERVICE — Sincronización en tiempo real con Supabase
// ============================================================
import { downloadAll, pushTables, subscribeRealtime, unsubscribeRealtime } from './supabase.js';

const TABLE_TO_KEY = {
  seasons: 'seasons',
  divisions: 'divisions',
  teams: 'teams',
  players: 'players',
  matches: 'matches',
  playoffs: 'playoffs',
  news: 'news',
  archived_seasons: 'archivedSeasons',
  config: 'config'
};

const PUSH_DEBOUNCE_MS = 2000;
const REALTIME_COOLDOWN_MS = 3000;

let _dirtyTables = new Set();
let _pushTimer = null;
let _isPushing = false;
let _lastPushAt = 0;
let _realtimeCooldownUntil = 0;
let _initialized = false;

// ============================================================
// HASH
// ============================================================
function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i);
    h = h & h;
  }
  return (h >>> 0).toString(36);
}

function hashTable(data) {
  try { return hashString(JSON.stringify(data ?? null)); }
  catch(_) { return 'err'; }
}

export function captureCurrentHashes() {
  const db = window.__zenithGetRawDB ? window.__zenithGetRawDB() : null;
  if (!db) return {};
  const hashes = {};
  Object.entries(TABLE_TO_KEY).forEach(([table, key]) => {
    if (key === 'config') {
      hashes[table] = hashTable({
        config: db.config, widgets: db.widgets, trophies: db.trophies,
        transferLog: db.transferLog, transferBannerBg: db.transferBannerBg
      });
    } else {
      hashes[table] = hashTable(db[key]);
    }
  });
  return hashes;
}

function detectDirty(oldHashes, newHashes) {
  const dirty = [];
  for (const table of Object.keys(newHashes)) {
    if (oldHashes[table] !== newHashes[table]) dirty.push(table);
  }
  return dirty;
}

// ============================================================
// HOOK: llamado por storage.mutate()
// ============================================================
export function notifyChange(oldHashes, newHashes) {
  const dirty = detectDirty(oldHashes, newHashes);
  if (dirty.length === 0) return;

  dirty.forEach(t => _dirtyTables.add(t));
  updateSyncChip('pending');
  schedulePush();
}

function schedulePush() {
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => {
    doPush().catch(err => console.error('[SYNC] push error:', err));
  }, PUSH_DEBOUNCE_MS);
}

async function doPush() {
  if (_isPushing || _dirtyTables.size === 0) return;
  if (Date.now() < _realtimeCooldownUntil) { schedulePush(); return; }

  _isPushing = true;
  updateSyncChip('syncing');

  const tablesToPush = [..._dirtyTables];
  _dirtyTables.clear();

  try {
    const result = await pushTables(tablesToPush);
    if (!result.ok) throw new Error(result.error || 'Push failed');

    _lastPushAt = Date.now();
    _realtimeCooldownUntil = Date.now() + REALTIME_COOLDOWN_MS;
    updateSyncChip('synced');
    console.log('[SYNC] Push OK:', result.stats);
    window.dispatchEvent(new CustomEvent('zenith:sync-pushed', { detail: result }));

  } catch(err) {
    console.error('[SYNC] Push failed:', err);
    tablesToPush.forEach(t => _dirtyTables.add(t));
    updateSyncChip('error');
    setTimeout(() => schedulePush(), 5000);
  } finally {
    _isPushing = false;
  }
}

// ============================================================
// REALTIME
// ============================================================
let _realtimeDebounce = null;

function onRemoteChange(table) {
  if (Date.now() < _realtimeCooldownUntil) return;
  if (_isPushing) return;

  console.log('[SYNC] Cambio remoto en:', table);
  if (_realtimeDebounce) clearTimeout(_realtimeDebounce);
  _realtimeDebounce = setTimeout(() => {
    pullFromRemote().catch(err => console.error('[SYNC] pull error:', err));
  }, 800);
}

async function pullFromRemote() {
  try {
    updateSyncChip('pulling');
    const remoteDB = await downloadAll();
    const localRaw = window.__zenithGetRawDB ? window.__zenithGetRawDB() : null;

    // ✅ FIX: Servidor es fuente de verdad. Solo preservamos viewSeasonId (local).
    const merged = {
      ...remoteDB,
      viewSeasonId: localRaw?.viewSeasonId || null
    };

    if (window.__zenithSetRawDB) window.__zenithSetRawDB(merged);

    // Resetear hashes para no marcar como dirty por cambios remotos
    if (window.__zenithCaptureHashes) {
      const newHashes = window.__zenithCaptureHashes();
      console.log('[SYNC] Hashes reseteados tras pull remoto');
    }

    updateSyncChip('synced');
    window.dispatchEvent(new CustomEvent('zenith:sync-pulled'));
  } catch(err) {
    console.error('[SYNC] Pull failed:', err);
    updateSyncChip('error');
  }
}

// ============================================================
// CHIP
// ============================================================
function updateSyncChip(state) {
  window.dispatchEvent(new CustomEvent('zenith:sync-chip', { detail: state }));
}

// ============================================================
// INIT
// ============================================================
export async function initRealtimeSync() {
  if (_initialized) return;
  _initialized = true;
  subscribeRealtime(onRemoteChange);
  _realtimeCooldownUntil = Date.now() + 1000;
  updateSyncChip(navigator.onLine ? 'synced' : 'offline');

  window.addEventListener('online', () => updateSyncChip('synced'));
  window.addEventListener('offline', () => updateSyncChip('offline'));
}

export function destroySync() {
  unsubscribeRealtime();
  _initialized = false;
}

// ============================================================
// MANUAL
// ============================================================
export async function forcePull() {
  // Forzar pull: resetear flag de descarga inicial
  window.__zenithHasDownloadedThisSession = false;
  await pullFromRemote();
  window.__zenithHasDownloadedThisSession = true;
}

export async function forcePush() {
  Object.keys(TABLE_TO_KEY).forEach(t => _dirtyTables.add(t));
  await doPush();
}

export function getSyncState() {
  return {
    dirtyCount: _dirtyTables.size,
    lastPushAt: _lastPushAt,
    isPushing: _isPushing,
    isOnline: navigator.onLine
  };
}