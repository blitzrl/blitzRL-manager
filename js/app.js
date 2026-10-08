import { loadDB, getDB, getRawDB, setRawDB, setViewSeasonId } from './services/storage.js';
import { registerRoute, startRouter, navigate } from './router.js';
import { initEmoji } from './services/emoji.js';
import { state, loadActiveDivision, saveActiveDivision } from './state.js';
import { initRealtimeSync, captureCurrentHashes, notifyChange, getSyncState } from './services/sync.js';
import { refreshAuthState, bindTopbarStatusButton, setupSyncChipListener, isAuthenticated } from './views/config.js';
import { downloadAll } from './services/supabase.js';
import { openModal, closeTopModal, toast } from './services/ui.js';
import { applyTheme } from './services/theme.js';

import { dashboardView, bindDashboardEvents } from './views/dashboard.js';
import { teamsView, bindTeamsEvents } from './views/teams.js';
import { matchesView, bindMatchesEvents } from './views/matches.js';
import { statsView, bindStatsEvents } from './views/stats.js';
import { rostersView, bindRostersEvents } from './views/rosters.js';
import { playersView, bindPlayersEvents } from './views/players.js';
import { newsView, bindNewsEvents } from './views/news.js';
import { playoffsView, bindPlayoffsEvents } from './views/playoffs.js';
import { configView, bindConfigEvents } from './views/config.js';
import { ballonDorView, bindBallonDorEvents } from './views/ballonDor.js';
import { marketView, bindMarketEvents } from './views/market.js';

window.addEventListener('error', e => console.error('[ZENITH] error:', e.error || e.message));
window.addEventListener('unhandledrejection', e => console.error('[ZENITH] promise rejected:', e.reason));

// Exponer hooks al window para storage.js
window.__zenithCaptureHashes = captureCurrentHashes;
window.__zenithNotifyChange = notifyChange;

// Flag anti-doble-descarga
window.__zenithHasDownloadedThisSession = false;

// ============================================================
// OVERLAY DE CARGA
// ============================================================
function createLoadOverlay(){
  if (document.getElementById('zenithLoadOverlay')) return;
  const div = document.createElement('div');
  div.id = 'zenithLoadOverlay';
  div.className = 'zenith-load-overlay';
  div.innerHTML = `
    <div class="zenith-load-card">
      <div class="zenith-spinner"></div>
      <div class="zenith-load-title" id="zenithLoadTitle">Cargando datos del servidor...</div>
      <div class="zenith-load-sub">Sincronizando con el servidor</div>
    </div>`;
  document.body.appendChild(div);
}

function showLoadOverlay(text){
  const overlay = document.getElementById('zenithLoadOverlay');
  if (!overlay) return;
  const title = document.getElementById('zenithLoadTitle');
  if (title && text) title.textContent = text;
  void overlay.offsetWidth;
  overlay.classList.add('visible');
}

function hideLoadOverlay(){
  const overlay = document.getElementById('zenithLoadOverlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
}

// ============================================================
// CONFIRM DISCARDS CHANGES
// ============================================================
function confirmDiscardChanges(count){
  return new Promise((resolve) => {
    let resolved = false;
    const safeResolve = (v) => { if (!resolved) { resolved = true; resolve(v); } };

    openModal({
      id: 'confirm-discard-changes',
      title: '⚠ CAMBIOS SIN SINCRONIZAR',
      body: `
        <div style="text-align:center;padding:8px 0 16px">
          <div style="font-size:48px;margin-bottom:12px">⚠</div>
          <p style="color:var(--silver);font-size:13px;line-height:1.7;margin-bottom:14px">
            Tienes <strong style="color:var(--gold)">${count} cambio${count !== 1 ? 's' : ''}</strong> sin sincronizar con el servidor.
          </p>
          <p style="color:var(--muted);font-size:12px;line-height:1.7">
            Si descargas los datos del servidor, <strong style="color:var(--danger)">perderás esos cambios locales</strong>.
            ¿Qué prefieres hacer?
          </p>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="cancelDiscard">CANCELAR LOGIN</button>
        <button class="btn btn-danger" id="confirmDiscard">DESCARTAR Y DESCARGAR</button>
      `,
      onMount: root => {
        root.querySelector('#cancelDiscard').addEventListener('click', () => {
          closeTopModal();
          safeResolve(false);
        });
        root.querySelector('#confirmDiscard').addEventListener('click', () => {
          closeTopModal();
          safeResolve(true);
        });
      },
      onClose: () => safeResolve(false)
    });
  });
}

// ============================================================
// DESCARGA INICIAL (llamada desde boot y desde login)
// ============================================================
export async function performInitialDownload(opts = {}){
  const { skipConfirm = false, reason = 'boot' } = opts;

  if (window.__zenithHasDownloadedThisSession) {
    console.log('[APP] Ya se descargó en esta sesión, skip');
    return { skipped: true };
  }

  if (!isAuthenticated()) {
    return { skipped: true, error: 'no-auth' };
  }

  const syncState = getSyncState();
  if (syncState.dirtyCount > 0 && !skipConfirm) {
    const confirmed = await confirmDiscardChanges(syncState.dirtyCount);
    if (!confirmed) {
      return { cancelled: true };
    }
  }

  showLoadOverlay(reason === 'login' ? 'Cargando datos del servidor...' : 'Sincronizando al entrar...');

  try {
    const remoteDB = await downloadAll();
    const localRaw = getRawDB();

    const merged = {
      ...remoteDB,
      viewSeasonId: localRaw?.viewSeasonId || null
    };

    setRawDB(merged);

    // ✅ Aplicar tema tras descarga
    try {
      const themeActive = getDB().config?.theme?.active;
      applyTheme(themeActive);
    } catch(themeErr) {
      console.warn('[APP] No se pudo aplicar el tema tras descarga:', themeErr);
    }

    const dbAfter = getDB();
    const visible = dbAfter.divisions.filter(d => d.visible !== false);
    if (!dbAfter.divisions.find(d => d.id === state.divisionId)) {
      state.divisionId = visible[0]?.id || dbAfter.divisions[0]?.id || null;
      if (state.divisionId) saveActiveDivision(state.divisionId);
    }

    window.__zenithHasDownloadedThisSession = true;

    if (window.__zenithCaptureHashes) {
      window.__zenithCaptureHashes();
    }

    refreshView();
    console.log('[APP] Descarga inicial OK');
    return { ok: true };

  } catch(err) {
    console.error('[APP] Descarga inicial falló:', err);
    toast('Error al cargar datos: ' + err.message, 'error');
    return { error: err.message };
  } finally {
    hideLoadOverlay();
  }
}

window.__zenithPerformInitialDownload = performInitialDownload;

// ============================================================
// BOOT
// ============================================================
async function boot(){
  try {
    createLoadOverlay();

    loadDB();
    loadActiveDivision();

    // ✅ Aplicar tema al arrancar
    try {
      const themeActive = getDB().config?.theme?.active;
      applyTheme(themeActive);
    } catch(themeErr) {
      console.warn('[APP] No se pudo aplicar el tema al arrancar:', themeErr);
    }

    const db = getDB();
    const visible = db.divisions.filter(d => d.visible !== false);
    if (!state.divisionId || !db.divisions.find(d => d.id === state.divisionId)) {
      state.divisionId = visible[0]?.id || db.divisions[0]?.id || null;
      if (state.divisionId) saveActiveDivision(state.divisionId);
    }

    try {
      await refreshAuthState();
      bindTopbarStatusButton();
      setupSyncChipListener();
    } catch(authErr) {
      console.warn('[ZENITH] Auth init falló:', authErr);
    }

    await initRealtimeSync();

    if (isAuthenticated()) {
      await new Promise(r => setTimeout(r, 100));
      await performInitialDownload({ reason: 'boot' });
    }

    console.log('[APP] Boot completo');

  } catch(err) {
    console.error('[ZENITH] Boot error:', err);
    hideLoadOverlay();
  }
}
boot();

// ============================================================
// RUTAS
// ============================================================
registerRoute('dashboard', dashboardView);
registerRoute('teams',     teamsView);
registerRoute('players',   playersView);
registerRoute('matches',   matchesView);
registerRoute('stats',     statsView);
registerRoute('rosters',   rostersView);
registerRoute('news',      newsView);
registerRoute('playoffs',  playoffsView);
registerRoute('config',    configView);
registerRoute('ballonDor', ballonDorView);
registerRoute('market',    marketView);

// ============================================================
// RENDER
// ============================================================
let _currentViewFn = null;
let _currentParams = [];

function renderView(viewFn, params){
  const view = document.getElementById('view');
  try {
    view.innerHTML = viewFn(params);

    safeBind(bindDashboardEvents);
    safeBind(bindTeamsEvents);
    safeBind(bindMatchesEvents);
    safeBind(bindStatsEvents);
    safeBind(bindNewsEvents);
    safeBind(bindConfigEvents);
    safeBind(bindPlayoffsEvents);
    safeBind(bindRostersEvents);
    safeBind(bindPlayersEvents);
    safeBind(bindBallonDorEvents);
    safeBind(bindMarketEvents);

    updateActiveNav();
    updateDivisionHeader();
    window.scrollTo(0, 0);
  } catch(err) {
    console.error('[ZENITH] Render error:', err);
    view.innerHTML = `
      <div class="card" style="border-left:3px solid var(--danger)">
        <div class="card-title" style="color:var(--danger)">◆ ERROR AL RENDERIZAR</div>
        <div style="margin-top:12px;font-size:13px;color:var(--silver)">${err.message}</div>
        <pre style="margin-top:12px;font-size:11px;color:var(--muted);white-space:pre-wrap;overflow:auto;max-height:400px">${(err.stack||'').replace(/</g,'&lt;')}</pre>
      </div>`;
  }
}

function safeBind(fn){
  try { fn?.(); }
  catch(e) { console.error('[ZENITH] bind error en', fn?.name, e); }
}

export function refreshView(){
  if (_currentViewFn) renderView(_currentViewFn, _currentParams);
}

startRouter((viewFn, params) => {
  _currentViewFn = viewFn;
  _currentParams = params;
  renderView(viewFn, params);
});

// Listener para re-render cuando llega sync remoto
window.addEventListener('zenith:sync-pulled', () => {
  console.log('[APP] Datos actualizados desde Supabase (realtime)');
  // ✅ Re-aplicar tema tras un pull remoto
  try {
    const themeActive = getDB().config?.theme?.active;
    applyTheme(themeActive);
  } catch(themeErr) {
    console.warn('[APP] No se pudo aplicar el tema tras pull remoto:', themeErr);
  }
  refreshView();
});

// ============================================================
// NAV
// ============================================================
function updateActiveNav(){
  const current = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/')[0];
  document.querySelectorAll('.nav-item').forEach(a => {
    a.classList.toggle('active', a.dataset.route === current);
  });
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-route]');
  if (!el) return;
  const route = el.dataset.route;
  if (!route) return;
  e.preventDefault();
  navigate(route);
  document.getElementById('sidebar')?.classList.remove('open');
});

document.getElementById('menuToggle')?.addEventListener('click', () => {
  document.getElementById('sidebar')?.classList.toggle('open');
});

// ============================================================
// HEADER
// ============================================================
function updateDivisionHeader(){
  const db = getDB();
  const active = db.divisions.find(d => d.id === state.divisionId) || db.divisions[0];
  const nameEl = document.getElementById('currentDivisionName');
  if (nameEl && active) nameEl.textContent = active.name;

  const viewingId = db.viewSeasonId;
  let season;
  if (viewingId) {
    season = (db.archivedSeasons || []).find(s => s.id === viewingId) || null;
  } else {
    season = db.seasons.find(s => s.active) || db.seasons[0] || null;
  }
  const chipSeason = document.getElementById('currentSeasonName');
  if (chipSeason && season) chipSeason.textContent = season.name;

  const roChip = document.getElementById('readOnlyChip');
  if (roChip) roChip.style.display = viewingId ? '' : 'none';
}

function buildDivisionDropdown(){
  const db = getDB();
  const dropdown = document.getElementById('divisionDropdown');
  if (!dropdown) return;
  const visible = db.divisions.filter(d => d.visible !== false);
  if (visible.length === 0) {
    dropdown.innerHTML = `<div class="division-dropdown-empty">Sin divisiones</div>`;
    return;
  }
  const activeId = visible.find(d => d.id === state.divisionId)?.id || visible[0].id;
  dropdown.innerHTML = visible.map(d => `
    <button class="division-dropdown-item ${d.id===activeId?'active':''}" data-division-id="${d.id}">
      <span class="division-dropdown-tier">${d.tier}ª</span>
      <span class="division-dropdown-name">${esc(d.name)}</span>
    </button>
  `).join('') + `<div class="division-dropdown-sep"></div>
    <button class="division-dropdown-manage" data-route="config">⚙ Gestionar divisiones</button>`;

  dropdown.querySelectorAll('[data-division-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      saveActiveDivision(btn.dataset.divisionId);
      dropdown.classList.add('hidden');
      refreshView();
    });
  });
  dropdown.querySelector('.division-dropdown-manage')?.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    navigate('config');
  });
}

document.getElementById('divisionBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const dropdown = document.getElementById('divisionDropdown');
  if (!dropdown) return;
  if (dropdown.classList.contains('hidden')) {
    buildDivisionDropdown();
    dropdown.classList.remove('hidden');
  } else {
    dropdown.classList.add('hidden');
  }
});

function buildSeasonDropdown(){
  const db = getDB();
  const dropdown = document.getElementById('seasonDropdown');
  if (!dropdown) return;

  const viewingId = db.viewSeasonId;
  const activeSeason = db.seasons.find(s => s.active);
  const archived = [...(db.archivedSeasons || [])].sort((a, b) =>
    (b.archivedAt || '').localeCompare(a.archivedAt || '')
  );

  const activeHTML = activeSeason ? `
    <button class="season-dropdown-item ${!viewingId ? 'active' : ''}" data-season-id="">
      <span class="season-dropdown-name">
        <span>🟢 ${esc(activeSeason.name)}</span>
        <span class="season-dropdown-meta">TEMPORADA ACTIVA</span>
      </span>
    </button>
  ` : '';

  const archivedHTML = archived.map(arch => {
    const isCurrent = viewingId === arch.id;
    const champs = arch.championByDivision || {};
    const firstChamp = Object.values(champs)[0];
    return `
      <button class="season-dropdown-item ${isCurrent ? 'active' : ''}" data-season-id="${arch.id}">
        <span class="season-dropdown-name">
          <span>📦 ${esc(arch.name)}</span>
          <span class="season-dropdown-meta">${arch.year || ''}${firstChamp ? ' · 🏆 ' + esc(firstChamp.teamName) : ''}</span>
        </span>
        <span class="season-export-btn" data-export-season="${arch.id}" title="Exportar JSON">⬇</span>
      </button>
    `;
  }).join('');

  dropdown.innerHTML = `
    ${activeHTML}
    ${archived.length > 0 ? '<div class="season-dropdown-sep"></div>' : ''}
    ${archivedHTML || (activeSeason ? '' : '<div class="season-dropdown-empty">Sin temporadas</div>')}
  `;

  dropdown.querySelectorAll('[data-season-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (e.target.closest('[data-export-season]')) return;
      const id = btn.dataset.seasonId || null;
      switchToSeason(id);
      dropdown.classList.add('hidden');
      refreshView();
    });
  });

  dropdown.querySelectorAll('[data-export-season]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      import('./services/seasons.js').then(({ exportSeason }) => exportSeason(btn.dataset.exportSeason));
    });
  });
}

function switchToSeason(seasonId){
  setViewSeasonId(seasonId || null);
  state.viewSeasonId = seasonId || null;

  const db = getDB();
  const visible = db.divisions.filter(d => d.visible !== false);
  if (!db.divisions.find(d => d.id === state.divisionId)) {
    state.divisionId = visible[0]?.id || db.divisions[0]?.id || null;
    if (state.divisionId) saveActiveDivision(state.divisionId);
  }
}

document.getElementById('seasonBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const dropdown = document.getElementById('seasonDropdown');
  if (!dropdown) return;
  if (dropdown.classList.contains('hidden')) {
    buildSeasonDropdown();
    dropdown.classList.remove('hidden');
  } else {
    dropdown.classList.add('hidden');
  }
});

document.addEventListener('click', (e) => {
  const dd = document.getElementById('divisionDropdown');
  if (dd && !dd.classList.contains('hidden')) {
    if (!e.target.closest('#divisionSelector')) dd.classList.add('hidden');
  }
  const sd = document.getElementById('seasonDropdown');
  if (sd && !sd.classList.contains('hidden')) {
    if (!e.target.closest('#seasonSelector')) sd.classList.add('hidden');
  }
});

initEmoji();

function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}