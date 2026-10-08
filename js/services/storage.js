import { defaultDatabase, SCHEMA_VERSION, DEFAULT_ZONES, getDefaultWidgets, getDefaultTheme } from '../data/database.js';

const KEY = 'BLITZ_DB_V3';
const OLD_KEYS = ['BLITZ_DB_V2', 'BLITZ_DB_V1'];
let _db = null;
let _viewCache = null;
let _viewCacheForId = null;

// ============================================================
// CARGA
// ============================================================
export function loadDB(){
  if(_db) return _db;

  try{
    const raw = localStorage.getItem(KEY);
    if(raw){
      _db = migrate(JSON.parse(raw));
      try { persist(); }
      catch(e){ console.warn('[ZENITH] No se pudo re-persistir V3 migrada:', e); }
      return _db;
    }
  }catch(e){
    console.warn('[ZENITH] V3 corrupta, descartando:', e);
    _db = null;
  }

  for(const oldKey of OLD_KEYS){
    try{
      const rawOld = localStorage.getItem(oldKey);
      if(rawOld){
        _db = migrate(JSON.parse(rawOld));
        try { persist(); }
        catch(e){ console.warn(`[ZENITH] No se pudo persistir migración desde ${oldKey}:`, e); }
        localStorage.removeItem(oldKey);
        return _db;
      }
    }catch(e){
      console.warn(`[ZENITH] ${oldKey} corrupta, descartando:`, e);
      _db = null;
    }
  }

  _db = defaultDatabase();
  try { persist(); }
  catch(e){ console.error('[ZENITH] No se pudo persistir DB nueva:', e); }
  return _db;
}

// ============================================================
// SANITIZACIÓN
// ============================================================
function normalizePlayer(p){
  if(!p || typeof p !== 'object') return;
  if(p.rankLevel === undefined)        p.rankLevel = 2;
  if(p.rankDivision === undefined)     p.rankDivision = 'II';
  if(p.platform === undefined)         p.platform = 'Steam';
  if(p.rlTracker === undefined)        p.rlTracker = '';
  if(p.profilePicture === undefined)   p.profilePicture = '';
  if(p.nationalityCode === undefined)  p.nationalityCode = '';
  if(!Array.isArray(p.history))        p.history = [];
  if(!Array.isArray(p.pigHistory))     p.pigHistory = [];
  if(!Array.isArray(p.sanctions))      p.sanctions = [];
  if(!Array.isArray(p.careerSnapshots)) p.careerSnapshots = [];
  if(!Array.isArray(p.trophies))       p.trophies = [];
  if(p.status === undefined)           p.status = 'owned';
  if(p.pendingTeamId === undefined)    p.pendingTeamId = null;
  if(p.divisionId === undefined)       p.divisionId = null;
  if(p.pigTrend === undefined)         p.pigTrend = '—';
  if(!p.seasonStats || typeof p.seasonStats !== 'object'){
    p.seasonStats = { goals:0, assists:0, saves:0, shots:0, pig:0, matchesPlayed:0, mvps:0, pigHistory:[], avgLast5PIG:0, avgPIGPerMatch:0 };
  }
}

function normalizeTeam(t){
  if(!t || typeof t !== 'object') return;
  if(!Array.isArray(t.roster)) t.roster = [];
  if(!Array.isArray(t.trophies)) t.trophies = [];
  if(t.tag === undefined)  t.tag = '';
  if(t.logo === undefined) t.logo = '';
  if(t.coach === undefined) t.coach = '';
  if(t.divisionId === undefined) t.divisionId = null;
  if(t.seasonId === undefined)   t.seasonId = null;
}

function normalizeNews(n){
  if(!n || typeof n !== 'object') return;
  if(n.title === undefined) n.title = '';
  if(n.body === undefined) n.body = '';
  if(n.category === undefined) n.category = 'GENERAL';
  if(n.banner === undefined) n.banner = '';
  if(n.date === undefined) n.date = '';
  if(n.featured === undefined) n.featured = false;
  if(n.published === undefined) n.published = true;
  if(!Array.isArray(n.blocks)) n.blocks = [];
  if(n.pinned === undefined) n.pinned = false;
  if(n.goldenFrame === undefined) n.goldenFrame = false;
  if(n.customCategory === undefined) n.customCategory = '';
}

// ============================================================
// MIGRACIÓN DE WIDGETS
// ============================================================
function migrateWidgets(db){
  const defaults = getDefaultWidgets();
  const existingRaw = Array.isArray(db.widgets) ? db.widgets : [];

  const existing = existingRaw.map(w => ({
    ...w,
    instanceId: w.instanceId || (w.id + '_default'),
    config: w.config || {}
  }));

  const byInstance = new Map(existing.map(w => [w.instanceId, w]));

  const merged = defaults.map(dw => {
    const ex = byInstance.get(dw.instanceId);
    if(ex){
      byInstance.delete(dw.instanceId);
      return {
        ...dw,
        enabled:  ex.enabled  ?? dw.enabled,
        order:    ex.order    ?? dw.order,
        span:     ex.span     ?? dw.span,
        rowSpan:  ex.rowSpan  ?? dw.rowSpan,
        config:   ex.config   || {}
      };
    }
    return dw;
  });

  const extras = [...byInstance.values()];
  db.widgets = [...merged, ...extras];
}

// ============================================================
// MIGRACIÓN DEL TEMA
// ============================================================
function migrateTheme(db){
  const defaults = getDefaultTheme();
  if (!db.config.theme || typeof db.config.theme !== 'object') {
    db.config.theme = { active: defaults, presets: [] };
    return;
  }
  if (!db.config.theme.active || typeof db.config.theme.active !== 'object') {
    db.config.theme.active = defaults;
  }
  // Rellenar campos faltantes en active
  db.config.theme.active = deepMerge(defaults, db.config.theme.active);
  // Asegurar array de presets
  if (!Array.isArray(db.config.theme.presets)) {
    db.config.theme.presets = [];
  }
}

function deepMerge(defaults, overrides){
  if (!overrides) return JSON.parse(JSON.stringify(defaults));
  const result = JSON.parse(JSON.stringify(defaults));
  Object.keys(overrides).forEach(key => {
    const val = overrides[key];
    if (val === null || val === undefined) return;
    if (Array.isArray(val)) {
      result[key] = val.slice();
    } else if (typeof val === 'object') {
      result[key] = deepMerge(result[key] || {}, val);
    } else {
      result[key] = val;
    }
  });
  return result;
}

// ============================================================
// MIGRACIÓN GENERAL
// ============================================================
function migrate(db){
  if(!db || typeof db !== 'object') return defaultDatabase();
  db.meta ||= {};
  db.meta.version = SCHEMA_VERSION;

  db.seasons    ||= [];
  db.divisions  ||= [];
  db.teams      ||= [];
  db.players    ||= [];
  db.matches    ||= [];
  db.playoffs   ||= [];
  db.news       ||= [];
  db.awards     ||= [];
  db.history    ||= [];
  db.transferQueue ||= [];
  db.transferLog   ||= [];
  db.trophyHistory ||= [];
  db.trophies      ||= {};
  if(db.transferBannerBg === undefined) db.transferBannerBg = '';

  if(!Array.isArray(db.archivedSeasons)) db.archivedSeasons = [];
  if(db.viewSeasonId === undefined) db.viewSeasonId = null;

  db.config ||= {};
  db.config.rosterRules ||= { starters:3, substitutes:1, max:4 };
  db.config.pigWeights  ||= { goal:2.0, assist:1.5, save:1.0, missDivisor:5 };
  db.config.badStreak   ||= { enabled:true, minGames:5, consecutiveLosses:3, penalty:0.10 };
  db.config.seasonEnd   ||= { autoAssignTrophies:true, requireAllDivisions:true };
  db.config.ai          ||= defaultDatabase().config.ai;
  if(db.config.ai.model === 'gemini-1.5-flash'){
    db.config.ai.model = 'gemini-2.0-flash';
  }

  migrateTheme(db);
  migrateWidgets(db);

  db.divisions.forEach(d => {
    if(d.visible === undefined) d.visible = true;
    if(!d.config) d.config = {};
    if(!d.config.zones) d.config.zones = JSON.parse(JSON.stringify(DEFAULT_ZONES));
    if(d.config.playoffSpots === undefined) d.config.playoffSpots = 4;
    if(d.config.playInSpots === undefined) d.config.playInSpots = 2;
  });

  db.players.forEach(normalizePlayer);
  db.teams.forEach(normalizeTeam);
  db.news.forEach(normalizeNews);

  db.matches.forEach(m => {
    if(!m.format) m.format = 'BO3';
    if(!m.date)   m.date = '';
    if(!m.time)   m.time = '';
    if(!Array.isArray(m.games)) m.games = [];
  });

  db.teams.forEach(t => {
    if(!t.divisionId) return;
    const div = db.divisions.find(d => d.id === t.divisionId);
    if(div && div.seasonId && t.seasonId !== div.seasonId){
      t.seasonId = div.seasonId;
    }
  });

  const activeSeason = db.seasons.find(s => s.active) || db.seasons[0];
  if(activeSeason){
    const knownIds = new Set([
      ...db.seasons.map(s => s.id),
      ...(db.archivedSeasons || []).map(s => s.id)
    ]);
    db.teams.forEach(t => {
      if(!t.seasonId || !knownIds.has(t.seasonId)){
        if(t.divisionId){
          const div = db.divisions.find(d => d.id === t.divisionId);
          if(div && div.seasonId){
            t.seasonId = div.seasonId;
          } else {
            t.seasonId = activeSeason.id;
          }
        }
      }
    });
  }

  return db;
}

// ============================================================
// SNAPSHOT MIGRATION
// ============================================================
function migrateSnapshot(snapshot, liveDB){
  const s = JSON.parse(JSON.stringify(snapshot));
  s.meta ||= {};
  s.meta.version = SCHEMA_VERSION;
  s.seasons ||= [];
  s.divisions ||= [];
  s.teams ||= [];
  s.players ||= [];
  s.matches ||= [];
  s.playoffs ||= [];
  s.news ||= [];
  s.awards ||= [];
  s.history ||= [];
  s.transferLog ||= [];
  s.trophyHistory ||= [];
  s.trophies ||= {};
  s.transferBannerBg ||= '';

  s.config ||= JSON.parse(JSON.stringify(liveDB.config));
  if(!s.config.seasonEnd) s.config.seasonEnd = { autoAssignTrophies:true, requireAllDivisions:true };
  if(!s.config.ai) s.config.ai = JSON.parse(JSON.stringify(liveDB.config.ai));
  // El tema siempre viene del liveDB (no se archiva con el snapshot)
  s.config.theme = JSON.parse(JSON.stringify(liveDB.config.theme || { active: getDefaultTheme(), presets: [] }));

  s.widgets = liveDB.widgets;
  s.archivedSeasons = liveDB.archivedSeasons;
  s.transferQueue = liveDB.transferQueue;
  s.viewSeasonId = liveDB.viewSeasonId;

  s.players.forEach(normalizePlayer);
  s.teams.forEach(normalizeTeam);
  s.news.forEach(normalizeNews);
  s.matches.forEach(m => {
    if(!m.format) m.format = 'BO3';
    if(!m.date)   m.date = '';
    if(!m.time)   m.time = '';
    if(!Array.isArray(m.games)) m.games = [];
  });

  return s;
}

// ============================================================
// ACCESO
// ============================================================
export function getDB(){
  if(!_db) loadDB();

  if(_db.viewSeasonId){
    if(_viewCacheForId === _db.viewSeasonId && _viewCache){
      return _viewCache;
    }
    const archived = _db.archivedSeasons.find(s => s.id === _db.viewSeasonId);
    if(archived && archived.snapshot){
      _viewCache = migrateSnapshot(archived.snapshot, _db);
      _viewCacheForId = _db.viewSeasonId;
      return _viewCache;
    }
    _db.viewSeasonId = null;
    _viewCache = null;
    _viewCacheForId = null;
  }
  return _db;
}

export function getRawDB(){ return _db || loadDB(); }

export function setRawDB(newDB){
  _db = migrate(newDB);
  _viewCache = null;
  _viewCacheForId = null;
  persist();
}

export function setViewSeasonId(id){
  if(!_db) loadDB();
  _db.viewSeasonId = id || null;
  _viewCache = null;
  _viewCacheForId = null;
  persist();
}

export function isViewMode(){
  return !!( _db || loadDB() ).viewSeasonId;
}

// ============================================================
// PERSISTENCIA
// ============================================================
export function persist(){
  if(!_db) return;
  _db.meta.updatedAt = new Date().toISOString();
  try{
    const json = JSON.stringify(_db);
    localStorage.setItem(KEY, json);
  }
  catch(e){
    console.error('[ZENITH] Error persistiendo DB:', e);
    const msg = e.name === 'QuotaExceededError'
      ? 'El almacenamiento local está lleno.'
      : 'La base de datos contiene datos no serializables.';
    if(confirm(`${msg} ¿Exportar backup ahora?`)) exportBackup();
    throw e;
  }
}

// ============================================================
// MUTATE — con hooks de sync
// ============================================================
export function mutate(fn){
  if(!_db) loadDB();

  if(_db.viewSeasonId){
    throw new Error('📖 Estás en modo lectura. Vuelve a la temporada activa para editar.');
  }

  const db = _db;
  let snapshot = null;
  try { snapshot = JSON.stringify(db); }
  catch(e){ console.error('[ZENITH] DB corrupta, no se puede snapshot:', e); }

  // Capturar hashes ANTES
  const oldHashes = window.__zenithCaptureHashes ? window.__zenithCaptureHashes() : null;

  try {
    fn(db);
    persist();

    // Detectar cambios y notificar al sync
    try {
      if (oldHashes && window.__zenithNotifyChange) {
        const newHashes = window.__zenithCaptureHashes ? window.__zenithCaptureHashes() : null;
        if (newHashes) {
          window.__zenithNotifyChange(oldHashes, newHashes);
        }
      }
    } catch(hookErr){
      console.warn('[ZENITH] Hook de sync falló:', hookErr);
    }

  } catch(e) {
    console.error('[ZENITH] Error en mutate, restaurando:', e);
    if (snapshot) {
      try {
        const restored = JSON.parse(snapshot);
        Object.keys(db).forEach(k => delete db[k]);
        Object.assign(db, restored);
      } catch(re){ console.error('[ZENITH] No se pudo restaurar:', re); }
    }
    throw e;
  }
}

export function exportJSON(){
  const raw = _db || loadDB();
  const blob = new Blob([JSON.stringify(raw, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ZENITH_DATABASE_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportBackup(){
  const raw = _db || loadDB();
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const blob = new Blob([JSON.stringify(raw, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ZENITH_BACKUP_${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importJSON(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const data = JSON.parse(reader.result);
        if(!data.meta || !Array.isArray(data.teams)) throw new Error('Formato inválido');
        _db = migrate(data);
        _viewCache = null;
        _viewCacheForId = null;
        persist();
        resolve(_db);
      }catch(e){ reject(e); }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export function resetDB(){
  _db = defaultDatabase();
  _viewCache = null;
  _viewCacheForId = null;
  persist();
}

// Exponer al window para sync
window.__zenithGetRawDB = getRawDB;
window.__zenithSetRawDB = setRawDB;
