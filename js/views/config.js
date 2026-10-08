import { getDB, mutate, exportJSON, exportBackup, importJSON, resetDB } from '../services/storage.js';
import { toast, openModal, closeTopModal } from '../services/ui.js';
import { logChange } from '../services/history.js';
import { AIService, DEFAULT_SYSTEM_PROMPT } from '../services/aiService.js';
import { ZONE_TYPES, getZoneColor } from '../data/nations.js';
import { computeStandings } from '../services/standings.js';
import { createDivision, deleteDivision, updateDivision, setDivisionVisibility, queueTeamMovement, swapTeams } from '../services/divisions.js';
import {
  TROPHY_TYPES, saveTrophyConfig, assignTrophyToTeam, assignTrophyToPlayer,
  listExistingTrophies, removeTrophyFromTeam, removeTrophyFromPlayer
} from '../services/trophies.js';
import { canFinishSeason, finishSeason, resetDivisions } from '../services/seasons.js';
import { uid, getDefaultWidgets, getWidgetType, getDefaultTheme } from '../data/database.js';
import { state } from '../state.js';
import { getSupabase, testConnection, downloadAll } from '../services/supabase.js';
import { login, logout, getCurrentUser } from '../services/auth.js';
import { forcePush, forcePull, getSyncState } from '../services/sync.js';
import { applyTheme, DEFAULT_THEME, exportTheme, importTheme, themePreviewBg } from '../services/theme.js';

let configTab = 'general';
let _authUser = null;

// ============================================================
// AUTH
// ============================================================
export async function refreshAuthState(){
  try { _authUser = await getCurrentUser(); }
  catch(_) { _authUser = null; }
  updateTopbarPublishButton();
  return _authUser;
}

export function isAuthenticated(){ return !!_authUser; }

export function updateTopbarPublishButton(){
  const icon = document.getElementById('publishTopbarIcon');
  const label = document.getElementById('publishTopbarLabel');
  const btn = document.getElementById('btnPublishTopbar');
  if (!btn) return;

  if (_authUser) {
    if (icon) icon.textContent = '☁';
    if (label) label.textContent = 'PUBLICAR';
    btn.classList.add('btn-primary');
    btn.classList.remove('btn-ghost');
    btn.title = `Publicar como ${_authUser.email}`;
  } else {
    if (icon) icon.textContent = '🔒';
    if (label) label.textContent = 'LOGIN';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-ghost');
    btn.title = 'Iniciar sesión para publicar';
  }
}

export function bindTopbarStatusButton(){
  const btn = document.getElementById('btnPublishTopbar');
  if (!btn || btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', async () => {
    if (_authUser) openPublishModal();
    else openLoginModal();
  });
}

export function setupSyncChipListener(){
  window.addEventListener('zenith:sync-chip', (e) => {
    updateSyncChipUI(e.detail);
  });
  window.addEventListener('zenith:realtime-status', (e) => {
    console.log('[CONFIG] Realtime status:', e.detail);
  });
  updateSyncChipUI(navigator.onLine ? 'synced' : 'offline');
}

function updateSyncChipUI(state){
  const chip = document.getElementById('syncChip');
  if (!chip) return;

  chip.classList.remove('sync-online', 'sync-offline', 'sync-syncing', 'sync-error', 'sync-pulling', 'sync-pending');

  const labels = {
    online: '🟢 ONLINE',
    synced: '🟢 SYNC',
    syncing: '📡 SINCRONIZANDO',
    pulling: '⬇ DESCARGANDO',
    pending: '⏳ PENDIENTE',
    offline: '🔴 OFFLINE',
    error: '⚠ ERROR'
  };

  const classMap = {
    online: 'sync-online',
    synced: 'sync-online',
    syncing: 'sync-syncing',
    pulling: 'sync-syncing',
    pending: 'sync-syncing',
    offline: 'sync-offline',
    error: 'sync-error'
  };

  chip.textContent = labels[state] || '⚪';
  chip.classList.add(classMap[state] || '');
}

// ============================================================
// MODAL DE LOGIN
// ============================================================
export function openLoginModal(){
  openModal({
    id: 'supabase-login',
    title: 'INICIAR SESIÓN',
    body: `
      <p style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.6">
        Inicia sesión con tu cuenta de Supabase. Al hacer login se descargarán automáticamente
        los datos más recientes del servidor.
      </p>
      <div class="field">
        <label>Email</label>
        <input class="input" type="email" id="loginEmail" autocomplete="email" placeholder="tu@email.com">
      </div>
      <div class="field">
        <label>Contraseña</label>
        <input class="input" type="password" id="loginPassword" autocomplete="current-password" placeholder="••••••••">
      </div>
      <div id="loginError" style="margin-top:10px"></div>
    `,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="doLogin">INICIAR SESIÓN</button>
    `,
    onMount: root => {
      const btn = root.querySelector('#doLogin');
      const errEl = root.querySelector('#loginError');
      const emailEl = root.querySelector('#loginEmail');
      const passEl = root.querySelector('#loginPassword');

      const doLogin = async () => {
        const email = emailEl.value.trim();
        const pass = passEl.value;
        if (!email || !pass) {
          errEl.innerHTML = '<div style="color:var(--danger);font-size:12px">Introduce email y contraseña.</div>';
          return;
        }
        btn.disabled = true;
        btn.textContent = 'ENTRANDO...';
        try {
          const user = await login(email, pass);
          _authUser = user;
          errEl.innerHTML = '';
          toast(`Bienvenido, ${user.email}`, 'success');
          closeTopModal();
          updateTopbarPublishButton();

          window.__zenithHasDownloadedThisSession = false;

          if (typeof window.__zenithPerformInitialDownload === 'function') {
            await window.__zenithPerformInitialDownload({ reason: 'login' });
          } else {
            try {
              const remoteDB = await downloadAll();
              const { getRawDB, setRawDB } = await import('../services/storage.js');
              const localRaw = getRawDB();
              setRawDB({
                ...remoteDB,
                viewSeasonId: localRaw?.viewSeasonId || null
              });
              window.__zenithHasDownloadedThisSession = true;
              try {
                const themeActive = getDB().config?.theme?.active;
                applyTheme(themeActive);
              } catch(themeErr) {
                console.warn('[CONFIG] No se pudo aplicar tema tras login:', themeErr);
              }
              window.dispatchEvent(new HashChangeEvent('hashchange'));
            } catch(dlErr) {
              console.warn('[CONFIG] Descarga tras login falló:', dlErr);
              toast('Login OK. Descarga inicial falló: ' + dlErr.message, 'error');
            }
          }

          if (configTab === 'data' || configTab === 'theme') {
            const dbCurr = getDB();
            const ai = dbCurr.config.ai || {};
            document.getElementById('configContent').innerHTML = renderConfigTab(configTab, dbCurr, ai);
            bindConfigEvents();
          }
        } catch(e) {
          errEl.innerHTML = `<div style="color:var(--danger);font-size:12px">${e.message}</div>`;
          btn.disabled = false;
          btn.textContent = 'INICIAR SESIÓN';
        }
      };

      btn.addEventListener('click', doLogin);
      passEl.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
      emailEl.focus();
    }
  });
}

// ============================================================
// MODAL DE PUBLICAR (FORZAR PUSH MANUAL)
// ============================================================
export function openPublishModal(){
  const db = getDB();
  const sync = getSyncState();

  openModal({
    id: 'publish-confirm',
    title: '☁ FORZAR PUBLICACIÓN',
    wide: true,
    body: `
      <p style="font-size:13px;color:var(--silver);line-height:1.7;margin-bottom:16px">
        Se subirán <b>todos los datos actuales</b> al servidor.
      </p>
      <p style="font-size:12px;color:var(--gold);background:rgba(230,196,118,.08);
                border:1px solid rgba(230,196,118,.3);border-radius:6px;padding:10px;line-height:1.6;margin-bottom:16px">
        ⚠ <b>Nota:</b> En modo tiempo real, los cambios ya se publican automáticamente (2s debounce).
        Este botón solo fuerza un push inmediato de TODAS las tablas.
      </p>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px">
        <div class="kpi"><div class="kpi-val">${db.seasons?.length || 0}</div><div class="kpi-lab">TEMPORADAS</div></div>
        <div class="kpi"><div class="kpi-val">${db.divisions?.length || 0}</div><div class="kpi-lab">DIVISIONES</div></div>
        <div class="kpi"><div class="kpi-val">${db.teams?.length || 0}</div><div class="kpi-lab">EQUIPOS</div></div>
        <div class="kpi"><div class="kpi-val">${db.players?.length || 0}</div><div class="kpi-lab">JUGADORES</div></div>
        <div class="kpi"><div class="kpi-val">${db.matches?.length || 0}</div><div class="kpi-lab">PARTIDOS</div></div>
        <div class="kpi"><div class="kpi-val">${db.news?.length || 0}</div><div class="kpi-lab">NOTICIAS</div></div>
      </div>

      <div style="background:var(--bg-graphite);border:1px solid var(--border-soft);border-radius:8px;padding:12px;font-size:12px;color:var(--muted);line-height:1.7">
        <div style="margin-bottom:6px"><b style="color:var(--silver-light)">Cuenta:</b> ${_authUser?.email || '—'}</div>
        <div style="margin-bottom:6px"><b style="color:var(--silver-light)">Cambios pendientes:</b> ${sync.dirtyCount}</div>
        <div><b style="color:var(--silver-light)">Último push:</b> ${sync.lastPushAt ? new Date(sync.lastPushAt).toLocaleString() : 'Nunca'}</div>
      </div>

      <div id="publishProgress" style="margin-top:16px"></div>
    `,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="doPublish">☁ FORZAR PUBLICACIÓN</button>
    `,
    onMount: root => {
      const btn = root.querySelector('#doPublish');
      const prog = root.querySelector('#publishProgress');

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'PUBLICANDO...';
        prog.innerHTML = '<div style="font-size:12px;color:var(--accent);padding:8px 0">Enviando datos…</div>';

        try {
          const startedAt = Date.now();
          await forcePush();
          const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);

          prog.innerHTML = `
            <div style="background:rgba(99,194,138,.08);border:1px solid rgba(99,194,138,.3);border-radius:8px;padding:14px;margin-top:8px">
              <div style="color:var(--success);font-size:13px;font-weight:600">
                ✅ Publicación exitosa en ${elapsed}s
              </div>
            </div>`;
          btn.textContent = '✓ PUBLICADO';
          toast('Datos publicados', 'success');
        } catch(e) {
          prog.innerHTML = `
            <div style="background:rgba(226,92,92,.08);border:1px solid rgba(226,92,92,.3);border-radius:8px;padding:14px;margin-top:8px">
              <div style="color:var(--danger);font-size:13px;font-weight:600;margin-bottom:4px">❌ Error</div>
              <div style="font-size:12px;color:var(--silver);word-break:break-word">${e.message}</div>
            </div>`;
          btn.disabled = false;
          btn.textContent = 'REINTENTAR';
        }
      });
    }
  });
}

// ============================================================
// VISTA PRINCIPAL DE CONFIGURACIÓN
// ============================================================
export function configView(){
  const db = getDB();

  if (db.viewSeasonId) {
    const arch = (db.archivedSeasons || []).find(s => s.id === db.viewSeasonId);
    return `
      <h1 class="page-title" style="margin-bottom:20px">CONFIGURACIÓN</h1>
      <div class="card" style="border-left:4px solid var(--gold)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
          <div>
            <div style="color:var(--gold);font-family:var(--font-display);letter-spacing:.14em;font-size:15px;margin-bottom:6px">
              📖 MODO LECTURA · ${esc(arch?.name || 'Temporada archivada')}
            </div>
            <div style="font-size:12px;color:var(--muted);line-height:1.6">
              La configuración no está disponible mientras ves una temporada archivada.
            </div>
          </div>
          <button class="btn btn-primary" id="btnExitViewFromConfig">← VOLVER A TEMPORADA ACTIVA</button>
        </div>
      </div>
    `;
  }

  const ai = db.config.ai || {};
  return `
    <h1 class="page-title" style="margin-bottom:20px">CONFIGURACIÓN</h1>

    <div class="config-tabs">
      <button class="config-tab ${configTab==='general'?'active':''}" data-config-tab="general">⚙ General</button>
      <button class="config-tab ${configTab==='theme'?'active':''}" data-config-tab="theme">🎨 Estética</button>
      <button class="config-tab ${configTab==='zones'?'active':''}" data-config-tab="zones">🎨 Clasificaciones</button>
      <button class="config-tab ${configTab==='divisions'?'active':''}" data-config-tab="divisions">🏆 Divisiones</button>
      <button class="config-tab ${configTab==='movements'?'active':''}" data-config-tab="movements">🔀 Movimientos</button>
      <button class="config-tab ${configTab==='trophies'?'active':''}" data-config-tab="trophies">🏆 Trofeos</button>
      <button class="config-tab ${configTab==='ai'?'active':''}" data-config-tab="ai">🤖 IA</button>
      <button class="config-tab ${configTab==='data'?'active':''}" data-config-tab="data">💾 Datos</button>
    </div>

    <div id="configContent">${renderConfigTab(configTab, db, ai)}</div>
  `;
}

function renderConfigTab(tab, db, ai){
  switch(tab){
    case 'general': return renderGeneral(db);
    case 'theme': return renderThemeTab(db);
    case 'zones': return renderZones(db);
    case 'divisions': return renderDivisions(db);
    case 'movements': return renderMovements(db);
    case 'trophies': return renderTrophiesConfig(db);
    case 'ai': return renderAI(ai);
    case 'data': return renderData();
    default: return '';
  }
}

// ============================================================
// GENERAL
// ============================================================
function renderGeneral(db){
  const widgets = [...db.widgets].sort((a, b) => a.order - b.order);
  const activeSeason = db.seasons.find(s => s.active);
  const totalMatches = db.matches.length;
  const totalFinished = db.matches.filter(m => m.status === 'finished').length;

  return `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>REGLAS DE ROSTER</div></div>
        <div class="row-3">
          <div class="field"><label>Titulares</label><input class="input" type="number" id="cfgStarters" value="${db.config.rosterRules.starters}"></div>
          <div class="field"><label>Suplentes</label><input class="input" type="number" id="cfgSubs" value="${db.config.rosterRules.substitutes}"></div>
          <div class="field"><label>Máx.</label><input class="input" type="number" id="cfgMax" value="${db.config.rosterRules.max}"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>MALAS RACHAS</div></div>
        <div class="field"><label><input type="checkbox" id="bsEnabled" ${db.config.badStreak.enabled?'checked':''}> Activado</label></div>
        <div class="row-3">
          <div class="field"><label>Partidos mín.</label><input class="input" type="number" id="bsMin" value="${db.config.badStreak.minGames}"></div>
          <div class="field"><label>Derrotas cons.</label><input class="input" type="number" id="bsLosses" value="${db.config.badStreak.consecutiveLosses}"></div>
          <div class="field"><label>Penalización</label><input class="input" type="number" step="0.01" id="bsPen" value="${db.config.badStreak.penalty}"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>FÓRMULA PIG</div></div>
        <div class="row-3">
          <div class="field"><label>Gol ×</label><input class="input" type="number" step="0.1" id="pwGoal" value="${db.config.pigWeights.goal}"></div>
          <div class="field"><label>Asist ×</label><input class="input" type="number" step="0.1" id="pwAssist" value="${db.config.pigWeights.assist}"></div>
          <div class="field"><label>Salv ×</label><input class="input" type="number" step="0.1" id="pwSave" value="${db.config.pigWeights.save}"></div>
        </div>
        <div class="field"><label>Divisor tiros fallados</label><input class="input" type="number" id="pwMiss" value="${db.config.pigWeights.missDivisor}"></div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="dot">◆</span>WIDGETS DEL HOME</div>
          <button class="btn btn-sm" id="resetWidgetsBtn" type="button">↺ RESTAURAR</button>
        </div>
        <p class="field-hint" style="margin-bottom:10px">Los widgets con 📋 pueden duplicarse en la Home (Modo Edición). Los ⚙ tienen configuración propia.</p>
        ${widgets.map(w => {
          const t = getWidgetType(w.id);
          const canConfig = t?.configurable;
          const isCustom = !w.instanceId.endsWith('_default');
          return `
            <div class="widget-toggle-row" data-instance-row="${w.instanceId}">
              <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
                <span style="color:var(--silver-light);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(w.name)}</span>
                ${isCustom ? `<span class="chip" style="font-size:9px;padding:2px 6px">COPIA</span>` : ''}
                ${canConfig ? `<span class="chip chip-accent" style="font-size:9px;padding:2px 6px">⚙ CONFIG</span>` : ''}
              </div>
              <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
                <label style="font-size:11px;color:var(--muted);display:flex;gap:4px;align-items:center">
                  <input type="checkbox" data-widget-toggle="${w.instanceId}" ${w.enabled?'checked':''}> Activo
                </label>
                ${isCustom ? `<button class="btn btn-sm btn-danger" data-widget-remove="${w.instanceId}" type="button" title="Eliminar">✕</button>` : ''}
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>
    <div style="margin-top:20px">
      <button class="btn btn-primary" id="saveCfgGeneral">GUARDAR CAMBIOS GENERALES</button>
    </div>

    <div class="card" style="margin-top:26px;border-left:4px solid var(--gold)">
      <div class="card-header">
        <div class="card-title" style="color:var(--gold)"><span class="dot" style="color:var(--gold)">◆</span>FIN DE TEMPORADA</div>
        <span class="card-sub">${esc(activeSeason?.name || '—')}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
        <div class="kpi"><div class="kpi-val">${db.divisions.length}</div><div class="kpi-lab">DIVISIONES</div></div>
        <div class="kpi"><div class="kpi-val">${totalMatches}</div><div class="kpi-lab">PARTIDOS</div></div>
        <div class="kpi"><div class="kpi-val">${totalFinished}</div><div class="kpi-lab">FINALIZADOS</div></div>
      </div>
      <ul style="font-size:12px;color:var(--muted);line-height:1.8;padding-left:20px;margin:0 0 16px">
        <li>Se detecta el <strong style="color:var(--silver-light)">campeón de cada división</strong>.</li>
        <li>Se archiva un <strong style="color:var(--silver-light)">snapshot completo</strong>.</li>
        <li>Se crea una <strong style="color:var(--silver-light)">nueva temporada</strong>.</li>
        <li>Se aplican <strong style="color:var(--silver-light)">ascensos y descensos</strong>.</li>
        <li>Se asignan <strong style="color:var(--silver-light)">trofeos</strong> (equipos + jugadores).</li>
      </ul>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--silver-light);cursor:pointer;margin-bottom:14px">
        <input type="checkbox" id="seasonEndAutoTrophiesToggle" ${db.config.seasonEnd?.autoAssignTrophies !== false ? 'checked' : ''}>
        Asignar trofeos automáticamente
      </label>
      <button class="btn btn-primary" id="btnFinishSeason" style="background:var(--gold);color:#04101F;border-color:var(--gold);font-weight:700">
        🏆 TERMINAR TEMPORADA
      </button>
    </div>

    <div class="card" style="margin-top:18px;border-left:4px solid var(--danger)">
      <div class="card-header"><div class="card-title" style="color:var(--danger)"><span class="dot" style="color:var(--danger)">◆</span>RESETEAR DIVISIONES</div></div>
      <p style="font-size:12px;color:var(--muted);line-height:1.7;margin-bottom:14px">
        Quita todos los equipos de sus divisiones. Los equipos y jugadores <strong style="color:var(--silver-light)">se mantienen intactos</strong>.
      </p>
      <button class="btn btn-danger" id="btnResetDivisions">🔀 RESETEAR DIVISIONES</button>
    </div>
  `;
}

// ============================================================
// THEME / ESTÉTICA
// ============================================================
function renderThemeTab(db){
  const theme = db.config.theme?.active || getDefaultTheme();
  const presets = db.config.theme?.presets || [];
  const bg = theme.background || DEFAULT_THEME.background;
  const colors = theme.colors || DEFAULT_THEME.colors;
  const isSolid = bg.type === 'solid';
  const gradientColors = (bg.gradientColors && bg.gradientColors.length >= 2)
    ? bg.gradientColors
    : DEFAULT_THEME.background.gradientColors;
  const angle = (typeof bg.gradientAngle === 'number') ? bg.gradientAngle : 135;

  return `
    <div class="card" style="margin-bottom:18px">
      <div class="card-header"><div class="card-title"><span class="dot">◆</span>IDENTIDAD DE MARCA</div></div>

      <div class="row">
        <div class="field">
          <label>Nombre de la liga</label>
          <input class="input" id="themeBrandName" value="${esc(theme.brandName || 'ZENITH')}" placeholder="ZENITH">
        </div>
        <div class="field">
          <label>Motto / Tagline</label>
          <input class="input" id="themeBrandMotto" value="${esc(theme.brandMotto || '')}" placeholder="YOUR LEVEL IS NOT YOUR LIMIT">
        </div>
      </div>

      <div class="field">
        <label>Logo de la liga</label>
        <div class="dropzone" id="themeLogoDrop" style="display:flex;align-items:center;gap:16px;justify-content:flex-start;padding:16px">
          <div id="themeLogoPreview" style="width:72px;height:72px;flex-shrink:0;border-radius:10px;background:var(--bg-elev);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden">
            ${theme.logo
              ? `<img src="${theme.logo}" style="width:100%;height:100%;object-fit:contain;padding:6px">`
              : `<span style="color:var(--muted);font-size:11px;text-align:center;line-height:1.3">SIN<br>LOGO</span>`}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;color:var(--silver-light);margin-bottom:4px">Sube un logo personalizado</div>
            <div class="field-hint" style="margin:0">PNG cuadrado recomendado (256×256 o mayor). Reemplaza el logo por defecto en el sidebar y topbar.</div>
          </div>
        </div>
        <input type="file" id="themeLogoInput" accept="image/*" hidden>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button type="button" class="btn btn-sm" id="themeLogoUpload">📤 SUBIR LOGO</button>
          <button type="button" class="btn btn-sm btn-danger" id="themeLogoRemove">🗑 QUITAR LOGO</button>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="card-header"><div class="card-title"><span class="dot">◆</span>FONDO DE LA APP</div></div>

      <div class="field">
        <label>Tipo de fondo</label>
        <div style="display:flex;gap:16px;flex-wrap:wrap;padding-top:4px">
          <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--silver-light);cursor:pointer">
            <input type="radio" name="themeBgType" value="solid" ${isSolid ? 'checked' : ''}> Color sólido
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--silver-light);cursor:pointer">
            <input type="radio" name="themeBgType" value="gradient" ${!isSolid ? 'checked' : ''}> Degradado lineal
          </label>
        </div>
      </div>

      <div id="themeSolidWrap" style="display:${isSolid ? '' : 'none'}">
        <div class="field">
          <label>Color de fondo</label>
          <div style="display:flex;gap:10px;align-items:center">
            <input type="color" id="themeSolidColor" value="${bg.solidColor || '#050505'}" style="width:60px;height:38px;padding:2px;border-radius:6px;background:var(--bg-elev);border:1px solid var(--border);cursor:pointer">
            <input class="input" id="themeSolidColorHex" value="${bg.solidColor || '#050505'}" style="flex:1;font-family:monospace">
          </div>
        </div>
      </div>

      <div id="themeGradientWrap" style="display:${isSolid ? 'none' : ''}">
        <div class="field">
          <label>Colores del degradado <span style="color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0">(mín. 2, máx. 5)</span></label>
          <div id="themeGradientStops" style="display:flex;flex-direction:column;gap:8px">
            ${gradientColors.map((c, i) => renderGradientStopRow(c, i, gradientColors.length)).join('')}
          </div>
          <button type="button" class="btn btn-sm" id="themeAddStop" style="margin-top:10px" ${gradientColors.length >= 5 ? 'disabled' : ''}>
            + AÑADIR COLOR
          </button>
        </div>

        <div class="field">
          <label>Ángulo del degradado: <span id="themeAngleVal" style="color:var(--accent);font-family:monospace">${angle}°</span></label>
          <input type="range" id="themeAngle" min="0" max="360" value="${angle}" style="width:100%">
        </div>
      </div>

      <div class="field" style="margin-top:8px">
        <label>Preview en vivo</label>
        <div id="themePreviewBg" style="height:90px;border-radius:10px;border:1px solid var(--border-soft);background:${themePreviewBg(theme)}"></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="card-header"><div class="card-title"><span class="dot">◆</span>COLORES DE ACENTO</div></div>
      <div class="row">
        <div class="field">
          <label>Acento principal</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="color" id="themeAccent" value="${colors.accent}" style="width:56px;height:38px;padding:2px;border-radius:6px;background:var(--bg-elev);border:1px solid var(--border);cursor:pointer">
            <input class="input" id="themeAccentHex" value="${colors.accent}" style="flex:1;font-family:monospace">
          </div>
        </div>
        <div class="field">
          <label>Dorado (trofeos/campeón)</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="color" id="themeGold" value="${colors.gold}" style="width:56px;height:38px;padding:2px;border-radius:6px;background:var(--bg-elev);border:1px solid var(--border);cursor:pointer">
            <input class="input" id="themeGoldHex" value="${colors.gold}" style="flex:1;font-family:monospace">
          </div>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label>Peligro / Rojo</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="color" id="themeDanger" value="${colors.danger}" style="width:56px;height:38px;padding:2px;border-radius:6px;background:var(--bg-elev);border:1px solid var(--border);cursor:pointer">
            <input class="input" id="themeDangerHex" value="${colors.danger}" style="flex:1;font-family:monospace">
          </div>
        </div>
        <div class="field">
          <label>Éxito / Verde</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="color" id="themeSuccess" value="${colors.success}" style="width:56px;height:38px;padding:2px;border-radius:6px;background:var(--bg-elev);border:1px solid var(--border);cursor:pointer">
            <input class="input" id="themeSuccessHex" value="${colors.success}" style="flex:1;font-family:monospace">
          </div>
        </div>
      </div>
      <div id="themeContrastWarn" style="display:none;margin-top:12px;padding:10px 12px;background:rgba(230,196,118,.08);border:1px solid rgba(230,196,118,.35);border-radius:6px;font-size:12px;color:var(--gold);line-height:1.5">
        ⚠ <b>Contraste bajo detectado.</b> El fondo elegido puede hacer ilegible el texto claro del sistema. Considera usar un fondo más oscuro.
      </div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="card-header"><div class="card-title"><span class="dot">◆</span>ACCIONES</div></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" id="themeReset" type="button">↺ RESTAURAR DEFAULT</button>
        <button class="btn btn-primary" id="themeSave" type="button">💾 GUARDAR Y APLICAR</button>
        <button class="btn" id="themeSaveAsPreset" type="button">📌 GUARDAR COMO PRESET</button>
        <button class="btn" id="themeExport" type="button">⬇ EXPORTAR TEMA</button>
        <label class="btn" style="cursor:pointer;position:relative">
          ⬆ IMPORTAR TEMA
          <input type="file" id="themeImport" accept="application/json" hidden style="position:absolute;inset:0;opacity:0;cursor:pointer">
        </label>
      </div>
      <p class="field-hint" style="margin-top:10px">
        Los cambios se aplican en vivo mientras editas (preview local). Pulsa <b style="color:var(--silver-light)">GUARDAR Y APLICAR</b> para persistir y publicar a Supabase.
      </p>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title"><span class="dot">◆</span>PRESETS GUARDADOS</div>
        <span class="card-sub">${presets.length} / 10</span>
      </div>
      ${presets.length === 0
        ? `<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px;border:1px dashed var(--border);border-radius:8px">No hay presets guardados. Usa "GUARDAR COMO PRESET" para crear uno.</div>`
        : `<div style="display:flex;flex-direction:column;gap:10px">
            ${presets.map(p => renderPresetRow(p)).join('')}
          </div>`}
    </div>
  `;
}

function renderGradientStopRow(color, index, total){
  return `
    <div class="theme-stop-row" data-stop-index="${index}" style="display:flex;gap:8px;align-items:center">
      <span style="font-size:11px;color:var(--muted);min-width:22px;text-align:center;font-family:monospace">${index + 1}</span>
      <input type="color" class="theme-stop-color" data-stop-color="${index}" value="${color}" style="width:52px;height:36px;padding:2px;border-radius:6px;background:var(--bg-elev);border:1px solid var(--border);cursor:pointer">
      <input class="input theme-stop-hex" data-stop-hex="${index}" value="${color}" style="flex:1;font-family:monospace">
      ${total > 2 ? `<button type="button" class="btn btn-sm btn-danger" data-stop-remove="${index}" title="Quitar color">✕</button>` : ''}
    </div>
  `;
}

function renderPresetRow(preset){
  return `
    <div style="display:flex;gap:12px;align-items:center;padding:10px 12px;background:var(--bg-elev);border:1px solid var(--border-soft);border-radius:8px">
      <div style="width:44px;height:44px;border-radius:8px;flex-shrink:0;border:1px solid var(--border-soft);background:${themePreviewBg(preset.data)}"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:var(--silver-light);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(preset.name)}</div>
        <div style="font-size:10.5px;color:var(--muted);margin-top:2px">${preset.createdAt ? new Date(preset.createdAt).toLocaleDateString() : '—'}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn btn-sm" data-preset-apply="${preset.id}" type="button">APLICAR</button>
        <button class="btn btn-sm" data-preset-export="${preset.id}" type="button" title="Exportar">⬇</button>
        <button class="btn btn-sm btn-danger" data-preset-delete="${preset.id}" type="button" title="Eliminar">✕</button>
      </div>
    </div>
  `;
}

// Lee el estado actual del formulario de tema (sin guardar)
function readThemeForm(){
  const val = id => document.getElementById(id)?.value || '';

  const bgType = document.querySelector('input[name="themeBgType"]:checked')?.value || 'gradient';

  const gradientColors = [...document.querySelectorAll('.theme-stop-hex')]
    .map(inp => (inp.value || '').trim().toLowerCase())
    .filter(Boolean);

  const theme = {
    name: 'Custom',
    brandName: val('themeBrandName').trim() || 'ZENITH',
    brandMotto: val('themeBrandMotto').trim(),
    logo: window.__themeEditingLogo !== undefined
      ? window.__themeEditingLogo
      : (document.getElementById('themeLogoPreview')?.querySelector('img')?.src || ''),
    background: {
      type: bgType,
      solidColor: val('themeSolidColorHex').trim().toLowerCase() || '#050505',
      gradientColors: gradientColors.length >= 2 ? gradientColors : DEFAULT_THEME.background.gradientColors.slice(),
      gradientAngle: parseInt(val('themeAngle'), 10) || 135
    },
    colors: {
      accent:  val('themeAccentHex').trim().toLowerCase()  || DEFAULT_THEME.colors.accent,
      gold:    val('themeGoldHex').trim().toLowerCase()    || DEFAULT_THEME.colors.gold,
      danger:  val('themeDangerHex').trim().toLowerCase()  || DEFAULT_THEME.colors.danger,
      success: val('themeSuccessHex').trim().toLowerCase() || DEFAULT_THEME.colors.success
    }
  };
  return theme;
}

// Aplica el tema al DOM en vivo (preview)
function applyThemePreview(){
  try {
    const t = readThemeForm();
    applyTheme(t);
    updateThemeContrastWarn(t);
    // Actualizar el preview del degradado
    const preview = document.getElementById('themePreviewBg');
    if (preview) preview.style.background = themePreviewBg(t);
  } catch(e) {
    console.warn('[THEME] Preview error:', e);
  }
}

function updateThemeContrastWarn(theme){
  const warn = document.getElementById('themeContrastWarn');
  if (!warn) return;
  const bg = theme.background;
  let luminance = 0;
  if (bg.type === 'solid') {
    luminance = hexLuminance(bg.solidColor);
  } else {
    const colors = bg.gradientColors || [];
    if (colors.length) {
      luminance = colors.reduce((a, c) => a + hexLuminance(c), 0) / colors.length;
    }
  }
  // Si luminancia promedio > 0.5, avisar
  warn.style.display = luminance > 0.5 ? '' : 'none';
}

function hexLuminance(hex){
  if (!hex || typeof hex !== 'string') return 0;
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  if (full.length !== 6) return 0;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Vincula todos los eventos de la pestaña Estética
function bindThemeTab(){
  // Inicializar logo temporal desde el theme actual
  const db = getDB();
  const currentTheme = db.config.theme?.active || getDefaultTheme();
  window.__themeEditingLogo = currentTheme.logo || '';

  // ─── Radio: tipo de fondo ───
  document.querySelectorAll('input[name="themeBgType"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const type = document.querySelector('input[name="themeBgType"]:checked')?.value;
      const solidWrap = document.getElementById('themeSolidWrap');
      const gradWrap = document.getElementById('themeGradientWrap');
      if (solidWrap) solidWrap.style.display = type === 'solid' ? '' : 'none';
      if (gradWrap) gradWrap.style.display = type === 'gradient' ? '' : 'none';
      applyThemePreview();
    });
  });

  // ─── Color sólido: input ↔ hex bidireccional ───
  const solidColor = document.getElementById('themeSolidColor');
  const solidHex = document.getElementById('themeSolidColorHex');
  if (solidColor && solidHex) {
    solidColor.addEventListener('input', () => { solidHex.value = solidColor.value; applyThemePreview(); });
    solidHex.addEventListener('input', () => {
      const v = solidHex.value.trim();
      if (/^#[0-9a-f]{6}$/i.test(v)) { solidColor.value = v; applyThemePreview(); }
    });
  }

  // ─── Colores de acento: input ↔ hex ───
  bindColorPair('themeAccent', 'themeAccentHex');
  bindColorPair('themeGold', 'themeGoldHex');
  bindColorPair('themeDanger', 'themeDangerHex');
  bindColorPair('themeSuccess', 'themeSuccessHex');

  // ─── Ángulo ───
  const angleInp = document.getElementById('themeAngle');
  const angleVal = document.getElementById('themeAngleVal');
  if (angleInp && angleVal) {
    angleInp.addEventListener('input', () => {
      angleVal.textContent = angleInp.value + '°';
      applyThemePreview();
    });
  }

  // ─── Stops de gradiente ───
  bindGradientStops();

  // ─── Añadir stop ───
  document.getElementById('themeAddStop')?.addEventListener('click', () => {
    const list = document.getElementById('themeGradientStops');
    if (!list) return;
    const count = list.querySelectorAll('.theme-stop-row').length;
    if (count >= 5) return;

    const lastColor = list.querySelector('.theme-stop-hex:last-of-type')?.value || '#121316';
    const newIndex = count;
    const div = document.createElement('div');
    div.innerHTML = renderGradientStopRow(lastColor, newIndex, count + 1);
    const row = div.firstElementChild;

    // Actualizar el botón de eliminar de las filas anteriores
    list.querySelectorAll('.theme-stop-row').forEach((r, i) => {
      if (!r.querySelector('[data-stop-remove]')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm btn-danger';
        btn.dataset.stopRemove = i;
        btn.title = 'Quitar color';
        btn.textContent = '✕';
        r.appendChild(btn);
      }
    });

    list.appendChild(row);
    bindGradientStops();

    // Desactivar botón si llegamos a 5
    const btn = document.getElementById('themeAddStop');
    if (list.querySelectorAll('.theme-stop-row').length >= 5 && btn) btn.disabled = true;

    applyThemePreview();
  });

  // ─── Subir logo ───
  const logoInput = document.getElementById('themeLogoInput');
  document.getElementById('themeLogoUpload')?.addEventListener('click', () => logoInput?.click());
  document.getElementById('themeLogoDrop')?.addEventListener('click', (e) => {
    if (e.target.closest('#themeLogoUpload') || e.target.closest('#themeLogoRemove')) return;
    logoInput?.click();
  });
  logoInput?.addEventListener('change', async () => {
    const f = logoInput.files[0];
    if (!f) return;
    try {
      const dataUrl = await compressImage(f, 256, 256);
      window.__themeEditingLogo = dataUrl;
      const preview = document.getElementById('themeLogoPreview');
      if (preview) preview.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:contain;padding:6px">`;
      applyThemePreview();
      toast('Logo cargado. No olvides guardar.', 'success');
    } catch(e) {
      toast('Error procesando imagen', 'error');
    }
  });

  // ─── Quitar logo ───
  document.getElementById('themeLogoRemove')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.__themeEditingLogo = '';
    const preview = document.getElementById('themeLogoPreview');
    if (preview) preview.innerHTML = `<span style="color:var(--muted);font-size:11px;text-align:center;line-height:1.3">SIN<br>LOGO</span>`;
    applyThemePreview();
    toast('Logo quitado. No olvides guardar.', 'info');
  });

  // ─── Reset a default ───
  document.getElementById('themeReset')?.addEventListener('click', () => {
    if (!confirm('¿Restaurar todos los valores por defecto del tema?')) return;
    const def = getDefaultTheme();
    window.__themeEditingLogo = def.logo || '';
    // Repintar el tab con el default
    const db2 = getDB();
    const fake = { ...db2, config: { ...db2.config, theme: { active: def, presets: db2.config.theme?.presets || [] } } };
    document.getElementById('configContent').innerHTML = renderThemeTab(fake);
    bindThemeTab();
    applyTheme(def);
    toast('Tema restaurado (sin guardar)', 'info');
  });

  // ─── Guardar y aplicar ───
  document.getElementById('themeSave')?.addEventListener('click', () => {
    try {
      const t = readThemeForm();
      t.name = 'Custom';

      mutate(d => {
        d.config.theme ||= { active: getDefaultTheme(), presets: [] };
        // Preservar el nombre si el tema era un preset aplicado
        const prevName = d.config.theme.active?.name;
        d.config.theme.active = t;
        if (prevName && prevName !== 'Zenith Default') t.name = prevName;
        else t.name = 'Custom';
        d.config.theme.active = t;
      });

      applyTheme(t);
      toast('✅ Tema guardado y aplicado. Se publicará automáticamente.', 'success');
      logChange('update', 'theme', null, 'Tema actualizado');

      // Repintar la lista de presets (por si acaso)
      const db2 = getDB();
      document.getElementById('configContent').innerHTML = renderThemeTab(db2);
      bindThemeTab();
    } catch(e) {
      console.error(e);
      toast('Error: ' + e.message, 'error');
    }
  });

  // ─── Guardar como preset ───
  document.getElementById('themeSaveAsPreset')?.addEventListener('click', () => {
    const presets = getDB().config.theme?.presets || [];
    if (presets.length >= 10) {
      return toast('Máximo 10 presets. Elimina alguno primero.', 'error');
    }

    openModal({
      id: 'save-preset-modal',
      title: '💾 GUARDAR COMO PRESET',
      body: `
        <p style="font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:14px">
          Guarda el tema actual como un preset reutilizable. Podrás aplicarlo, exportarlo o eliminarlo cuando quieras.
        </p>
        <div class="field">
          <label>Nombre del preset</label>
          <input class="input" id="presetNameInput" placeholder="Ej: Zenith Halloween" autofocus>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" data-close>CANCELAR</button>
        <button class="btn btn-primary" id="confirmPresetSave">GUARDAR</button>
      `,
      onMount: root => {
        const input = root.querySelector('#presetNameInput');
        input.focus();
        const save = () => {
          const name = input.value.trim();
          if (!name) return toast('Falta el nombre', 'error');
          try {
            const t = readThemeForm();
            t.name = name;
            mutate(d => {
              d.config.theme ||= { active: getDefaultTheme(), presets: [] };
              d.config.theme.presets.push({
                id: uid('theme'),
                name,
                data: JSON.parse(JSON.stringify(t)),
                createdAt: Date.now()
              });
            });
            closeTopModal();
            toast(`Preset "${name}" guardado`, 'success');
            const db2 = getDB();
            document.getElementById('configContent').innerHTML = renderThemeTab(db2);
            bindThemeTab();
          } catch(e) {
            console.error(e);
            toast('Error: ' + e.message, 'error');
          }
        };
        root.querySelector('#confirmPresetSave').addEventListener('click', save);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
      }
    });
  });

  // ─── Exportar tema ───
  document.getElementById('themeExport')?.addEventListener('click', () => {
    try {
      const t = readThemeForm();
      t.name = getDB().config.theme?.active?.name || 'Custom';
      exportTheme(t);
      toast('Tema exportado', 'success');
    } catch(e) {
      toast('Error al exportar: ' + e.message, 'error');
    }
  });

  // ─── Importar tema ───
  document.getElementById('themeImport')?.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const imported = await importTheme(f);
      // Aplicar como preview
      window.__themeEditingLogo = imported.logo || '';
      // Repintar el tab con el tema importado
      const db2 = getDB();
      const fake = { ...db2, config: { ...db2.config, theme: { active: imported, presets: db2.config.theme?.presets || [] } } };
      document.getElementById('configContent').innerHTML = renderThemeTab(fake);
      bindThemeTab();
      applyTheme(imported);
      toast('Tema importado. Pulsa GUARDAR Y APLICAR para persistirlo.', 'success');
    } catch(err) {
      console.error(err);
      toast('Error al importar: ' + err.message, 'error');
    }
    e.target.value = ''; // reset input
  });

  // ─── Presets: aplicar / eliminar / exportar ───
  document.querySelectorAll('[data-preset-apply]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.presetApply;
      const preset = (getDB().config.theme?.presets || []).find(p => p.id === id);
      if (!preset) return;
      window.__themeEditingLogo = preset.data.logo || '';
      const db2 = getDB();
      const fake = { ...db2, config: { ...db2.config, theme: { active: { ...preset.data, name: preset.name }, presets: db2.config.theme?.presets || [] } } };
      document.getElementById('configContent').innerHTML = renderThemeTab(fake);
      bindThemeTab();
      applyTheme(preset.data);
      toast(`Preset "${preset.name}" cargado. Pulsa GUARDAR Y APLICAR para persistirlo.`, 'info');
    });
  });

  document.querySelectorAll('[data-preset-export]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.presetExport;
      const preset = (getDB().config.theme?.presets || []).find(p => p.id === id);
      if (!preset) return;
      exportTheme({ ...preset.data, name: preset.name });
      toast(`Preset "${preset.name}" exportado`, 'success');
    });
  });

  document.querySelectorAll('[data-preset-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.presetDelete;
      const preset = (getDB().config.theme?.presets || []).find(p => p.id === id);
      if (!preset) return;
      if (!confirm(`¿Eliminar el preset "${preset.name}"?`)) return;
      try {
        mutate(d => {
          if (!d.config.theme?.presets) return;
          d.config.theme.presets = d.config.theme.presets.filter(p => p.id !== id);
        });
        toast('Preset eliminado', 'success');
        const db2 = getDB();
        document.getElementById('configContent').innerHTML = renderThemeTab(db2);
        bindThemeTab();
      } catch(e) {
        toast('Error: ' + e.message, 'error');
      }
    });
  });
}

// Auxiliar: bindea un par color-input ↔ text-hex
function bindColorPair(colorId, hexId){
  const colorInp = document.getElementById(colorId);
  const hexInp = document.getElementById(hexId);
  if (!colorInp || !hexInp) return;
  colorInp.addEventListener('input', () => {
    hexInp.value = colorInp.value;
    applyThemePreview();
  });
  hexInp.addEventListener('input', () => {
    const v = hexInp.value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(v)) {
      colorInp.value = v;
      applyThemePreview();
    }
  });
}

// Auxiliar: bindea los stops del gradiente (color ↔ hex, eliminar)
function bindGradientStops(){
  // Los listeners se añaden una sola vez por fila usando un flag
  document.querySelectorAll('.theme-stop-color').forEach(inp => {
    if (inp.dataset.bound === '1') return;
    inp.dataset.bound = '1';
    inp.addEventListener('input', () => {
      const idx = inp.dataset.stopColor;
      const hex = document.querySelector(`.theme-stop-hex[data-stop-hex="${idx}"]`);
      if (hex) hex.value = inp.value;
      applyThemePreview();
    });
  });
  document.querySelectorAll('.theme-stop-hex').forEach(inp => {
    if (inp.dataset.bound === '1') return;
    inp.dataset.bound = '1';
    inp.addEventListener('input', () => {
      const v = inp.value.trim().toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(v)) {
        const idx = inp.dataset.stopHex;
        const c = document.querySelector(`.theme-stop-color[data-stop-color="${idx}"]`);
        if (c) c.value = v;
      }
      applyThemePreview();
    });
  });
  document.querySelectorAll('[data-stop-remove]').forEach(btn => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const list = document.getElementById('themeGradientStops');
      const rows = list.querySelectorAll('.theme-stop-row');
      if (rows.length <= 2) return;
      const idx = +btn.dataset.stopRemove;
      rows[idx]?.remove();
      // Reindexar
      list.querySelectorAll('.theme-stop-row').forEach((row, i) => {
        row.dataset.stopIndex = i;
        const c = row.querySelector('.theme-stop-color');
        const h = row.querySelector('.theme-stop-hex');
        if (c) c.dataset.stopColor = i;
        if (h) h.dataset.stopHex = i;
        const rm = row.querySelector('[data-stop-remove]');
        if (rm) rm.dataset.stopRemove = i;
      });
      // Reactivar botón de añadir
      const addBtn = document.getElementById('themeAddStop');
      if (addBtn) addBtn.disabled = list.querySelectorAll('.theme-stop-row').length >= 5;
      applyThemePreview();
    });
  });
}

// ============================================================
// ZONES
// ============================================================
function renderZones(db){
  const activeDivisionId = state.divisionId || db.divisions[0]?.id;
  const division = db.divisions.find(d => d.id === activeDivisionId);
  if (!division) return `<div class="card">Sin divisiones activas.</div>`;
  const seasonId = db.seasons.find(s => s.active)?.id || db.seasons[0]?.id;
  const standings = computeStandings(activeDivisionId, seasonId);
  const zones = division.config.zones || { zones:[] };

  return `
    <div class="card">
      <div class="card-header"><div class="card-title"><span class="dot">◆</span>EDITOR DE CLASIFICACIONES · ${esc(division.name)}</div></div>
      <div class="field"><label><input type="checkbox" id="zoneShowTop1" ${zones.hasTop1Highlight ? 'checked' : ''}> Resaltar 1º con dorado</label></div>
      <div class="zones-editor">
        <div class="zones-editor-head"><div>#</div><div>EQUIPO</div><div class="num">PTS</div><div>ZONA</div></div>
        ${standings.map(row => {
          const currentZone = zones.zones.find(z => row.pos >= z.from && row.pos <= z.to);
          const currentType = currentZone?.type || 'none';
          const color = currentZone?.color || getZoneColor(currentType);
          return `
            <div class="zones-editor-row" style="border-left:4px solid ${color}">
              <div class="zones-pos">${row.pos}</div>
              <div class="zones-team">${row.logo ? `<img src="${row.logo}" class="zones-team-logo">` : ''}<span>${esc(row.name)}</span></div>
              <div class="num">${row.PTS}</div>
              <div>
                <select class="select zone-select" data-zone-pos="${row.pos}">
                  ${ZONE_TYPES.map(z => `<option value="${z.id}" ${currentType===z.id?'selected':''}>${z.label}</option>`).join('')}
                </select>
              </div>
            </div>`;
        }).join('')}
      </div>
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary" id="saveZones">GUARDAR CLASIFICACIONES</button>
        <button class="btn" id="resetZones">RESTAURAR DEFAULT</button>
      </div>
    </div>
  `;
}

// ============================================================
// DIVISIONS
// ============================================================
function renderDivisions(db){
  return `
    <div class="card">
      <div class="card-header">
        <div class="card-title"><span class="dot">◆</span>DIVISIONES</div>
        <button class="btn btn-sm btn-primary" id="btnNewDivision">+ CREAR DIVISIÓN</button>
      </div>
      <div class="divisions-list">
        ${db.divisions.map(d => {
          const teams = db.teams.filter(t => t.divisionId === d.id);
          return `
            <div class="division-row">
              <div class="division-row-tier">${d.tier}ª</div>
              <div class="division-row-info">
                <div class="division-row-name">${esc(d.name)}</div>
                <div class="division-row-meta">${teams.length} equipos · ${d.visible ? 'Visible' : 'Oculta'}</div>
              </div>
              <label class="division-row-toggle"><input type="checkbox" ${d.visible !== false ? 'checked' : ''} data-div-visibility="${d.id}"><span>Visible</span></label>
              <button class="btn btn-sm" data-div-edit="${d.id}">EDITAR</button>
              <button class="btn btn-sm btn-danger" data-div-del="${d.id}">✕</button>
            </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

// ============================================================
// MOVEMENTS
// ============================================================
function renderMovements(db){
  const teams = db.teams;
  const divisions = db.divisions;
  const queue = (db.transferQueue || []).filter(m => m.status === 'pending');
  return `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>NUEVO MOVIMIENTO</div></div>
        <div class="field"><label>Tipo</label>
          <select class="select" id="movType">
            <option value="promote">⬆ Ascenso</option>
            <option value="relegate">⬇ Descenso</option>
            <option value="swap">🔀 Intercambio</option>
          </select>
        </div>
        <div class="field"><label>Equipo A</label>
          <select class="select" id="movTeamA">${teams.map(t => `<option value="${t.id}">${esc(t.name)} — ${esc(divisions.find(d=>d.id===t.divisionId)?.name || 'Sin división')}</option>`).join('')}</select>
        </div>
        <div class="field" id="movSwapWrap" style="display:none"><label>Equipo B</label>
          <select class="select" id="movTeamB">${teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>División destino</label>
          <select class="select" id="movTargetDiv">${divisions.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Aplicar</label>
          <select class="select" id="movApplyAt">
            <option value="immediate">🔴 Inmediato</option>
            <option value="endRegular">⏸ Fin fase regular</option>
            <option value="endSeason">🏁 Fin temporada</option>
            <option value="roundN">📅 Jornada específica</option>
          </select>
        </div>
        <div class="field" id="movRoundWrap" style="display:none"><label>Jornada</label><input class="input" type="number" min="1" id="movRound" value="1"></div>
        <div class="field"><label>Motivo</label><input class="input" id="movReason" placeholder="Sanción, compra de plaza..."></div>
        <button class="btn btn-primary" id="btnQueueMovement" style="width:100%">APLICAR MOVIMIENTO</button>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>COLA PENDIENTE</div><span class="card-sub">${queue.length}</span></div>
        ${queue.length === 0 ? '<div style="color:var(--muted);font-size:12px">Sin movimientos pendientes</div>' : queue.map(m => `
          <div class="movement-row">
            <div><strong>${esc(m.teamName || '?')}</strong><span style="color:var(--muted);font-size:11px"> · ${m.type} → ${esc(divisions.find(d=>d.id===m.targetDivisionId)?.name || '?')}</span></div>
            <div style="font-size:11px;color:var(--muted)">${m.applyAt === 'immediate' ? 'inmediato' : m.applyAt === 'endSeason' ? 'fin temporada' : m.applyAt === 'endRegular' ? 'fin fase regular' : `Jornada ${m.roundNumber}`}</div>
          </div>`).join('')}
      </div>
    </div>
  `;
}

// ============================================================
// TROPHIES
// ============================================================
function renderTrophiesConfig(db){
  const existing = listExistingTrophies();
  return `
    <div class="card">
      <div class="card-header"><div class="card-title"><span class="dot">◆</span>CONFIGURACIÓN DE TROFEOS</div></div>
      <p class="field-hint">Define un trofeo (imagen + nombre) por indicador de cada división.</p>

      <div class="trophy-config-grid">
        ${db.divisions.map(div => {
          const cfg = (db.trophies || {})[div.id] || {};
          return `
            <div class="trophy-config-card">
              <h5>${div.tier || '?'}ª · ${esc(div.name)}</h5>
              ${TROPHY_TYPES.map(tt => {
                const t = cfg[tt.id] || {};
                const key = div.id + '::' + tt.id;
                return `
                  <div class="trophy-row" data-key="${key}">
                    <div class="trophy-preview" data-preview="${key}">${t.image ? `<img src="${t.image}" style="width:100%;height:100%;object-fit:contain">` : '🏆'}</div>
                    <div class="trophy-info">
                      <div style="font-size:10px;color:var(--muted)">${tt.label}</div>
                      <input class="input" data-trophy-name="${key}" value="${esc(t.name || '')}" placeholder="${tt.label}">
                      <input type="file" accept="image/*" hidden data-trophy-file="${key}">
                      <input type="hidden" data-trophy-image="${key}" value="${t.image || ''}">
                      <button type="button" class="btn" data-trophy-upload="${key}">📤 Imagen</button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>`;
        }).join('')}
      </div>

      <div style="margin-top:24px;padding-top:18px;border-top:1px solid var(--border-soft)">
        <h4 style="font-size:11px;letter-spacing:.16em;color:var(--accent);text-transform:uppercase;margin-bottom:10px">🎨 Banner por defecto de traspasos</h4>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          ${db.transferBannerBg ? `<img src="${db.transferBannerBg}" style="width:200px;border-radius:8px;border:1px solid var(--border-soft)">` : '<div style="color:var(--muted);font-size:12px">Sin imagen</div>'}
          <input type="file" id="banner-upload" accept="image/*" hidden>
          <input type="hidden" id="banner-data" value="${db.transferBannerBg || ''}">
          <button type="button" class="btn" id="banner-btn">📤 SUBIR BANNER</button>
        </div>
      </div>

      <div style="margin-top:24px;padding-top:18px;border-top:1px solid var(--border-soft)">
        <h4 style="font-size:11px;letter-spacing:.16em;color:var(--accent);text-transform:uppercase;margin-bottom:10px">🎁 Asignar trofeo manual</h4>
        <div style="display:flex;flex-direction:column;gap:10px;padding:14px;background:var(--bg-graphite);border:1px solid var(--border-soft);border-radius:8px">
          <div class="field" style="margin:0"><label>Destino</label>
            <select class="select" id="manual-target">
              <option value="">— Seleccionar equipo o jugador —</option>
              <optgroup label="EQUIPOS">${db.teams.map(t => `<option value="team:${t.id}">${esc(t.name)}</option>`).join('')}</optgroup>
              <optgroup label="JUGADORES">${db.players.map(p => `<option value="player:${p.id}">${esc(p.name)}</option>`).join('')}</optgroup>
            </select>
          </div>
          <div class="field" style="margin:0"><label>Trofeo</label>
            <select class="select" id="manual-trophy">
              <option value="__custom">✨ Personalizado</option>
              ${existing.length > 0 ? existing.map(t => `<option value="existing:${t.key}">${esc(t.label)}</option>`).join('') : ''}
            </select>
          </div>
          <div id="manualCustomFields" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
            <div class="field" style="flex:1;min-width:180px;margin:0"><label>Nombre</label><input class="input" id="manual-trophy-name" placeholder="Nombre del trofeo"></div>
            <div class="field" style="margin:0"><label>Imagen</label>
              <input type="file" id="manual-trophy-file" accept="image/*" hidden>
              <input type="hidden" id="manual-trophy-image" value="">
              <button type="button" class="btn" id="manual-trophy-upload">📤 Subir</button>
            </div>
          </div>
          <div id="manualTrophyPreview" style="display:none;align-items:center;gap:10px;padding:8px 12px;background:var(--bg-elev);border:1px solid var(--border-soft);border-radius:6px">
            <div style="width:36px;height:36px;background:var(--bg-graphite);border-radius:6px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0" id="manualTrophyPreviewImg">🏆</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;color:var(--silver-light)" id="manualTrophyPreviewName">—</div>
              <div style="font-size:10px;color:var(--muted)">Trofeo seleccionado</div>
            </div>
          </div>
          <button type="button" class="btn btn-primary" id="manual-give" style="align-self:flex-start">🎁 ASIGNAR TROFEO</button>
        </div>
      </div>

      <div style="margin-top:24px;padding-top:18px;border-top:1px solid var(--border-soft)">
        <h4 style="font-size:11px;letter-spacing:.16em;color:var(--danger);text-transform:uppercase;margin-bottom:10px">🗑 QUITAR TROFEO</h4>
        <p class="field-hint" style="margin-bottom:12px">Selecciona un equipo o jugador y quita un trofeo específico de su vitrina.</p>
        <div style="display:flex;flex-direction:column;gap:10px;padding:14px;background:var(--bg-graphite);border:1px solid var(--border-soft);border-radius:8px">
          <div class="field" style="margin:0"><label>Destino</label>
            <select class="select" id="remove-target">
              <option value="">— Seleccionar equipo o jugador —</option>
              <optgroup label="EQUIPOS">${db.teams.map(t => `<option value="team:${t.id}">${esc(t.name)} (${(t.trophies||[]).length} trofeos)</option>`).join('')}</optgroup>
              <optgroup label="JUGADORES">${db.players.map(p => `<option value="player:${p.id}">${esc(p.name)} (${(p.trophies||[]).length} trofeos)</option>`).join('')}</optgroup>
            </select>
          </div>
          <div class="field" style="margin:0"><label>Trofeo a quitar</label>
            <select class="select" id="remove-trophy"><option value="">— Sin trofeos —</option></select>
          </div>
          <button type="button" class="btn btn-danger" id="remove-trophy-btn" style="align-self:flex-start" disabled>🗑 QUITAR TROFEO</button>
        </div>
      </div>

      <div style="margin-top:18px">
        <button type="button" class="btn btn-primary" id="save-trophies">GUARDAR CONFIGURACIÓN</button>
      </div>
    </div>
  `;
}

function bindTrophiesConfig(){
  document.querySelectorAll('[data-trophy-upload]').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => document.querySelector(`[data-trophy-file="${btn.dataset.trophyUpload}"]`)?.click());
  });
  document.querySelectorAll('[data-trophy-file]').forEach(input => {
    if (input.dataset.bound) return;
    input.dataset.bound = '1';
    input.addEventListener('change', async () => {
      const f = input.files[0]; if (!f) return;
      const key = input.dataset.trophyFile;
      try {
        const dataUrl = await compressImage(f, 128, 128);
        document.querySelector(`[data-trophy-image="${key}"]`).value = dataUrl;
        document.querySelector(`[data-preview="${key}"]`).innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:contain">`;
        toast('Imagen cargada (guarda para confirmar)', 'success');
      } catch(e) { toast('Error procesando imagen', 'error'); }
    });
  });

  const bannerUpload = document.getElementById('banner-upload');
  const bannerBtn = document.getElementById('banner-btn');
  if (bannerBtn && !bannerBtn.dataset.bound) {
    bannerBtn.dataset.bound = '1';
    bannerBtn.addEventListener('click', () => bannerUpload?.click());
  }
  if (bannerUpload && !bannerUpload.dataset.bound) {
    bannerUpload.dataset.bound = '1';
    bannerUpload.addEventListener('change', async () => {
      const f = bannerUpload.files[0]; if (!f) return;
      try {
        const dataUrl = await compressImage(f, 1200, 500);
        document.getElementById('banner-data').value = dataUrl;
        toast('Banner cargado (guarda para confirmar)', 'success');
      } catch(e) { toast('Error procesando banner', 'error'); }
    });
  }

  const targetSel = document.getElementById('manual-target');
  const trophySel = document.getElementById('manual-trophy');
  const customFields = document.getElementById('manualCustomFields');
  const customName = document.getElementById('manual-trophy-name');
  const customImgInput = document.getElementById('manual-trophy-image');
  const customFile = document.getElementById('manual-trophy-file');
  const customUpload = document.getElementById('manual-trophy-upload');
  const previewBox = document.getElementById('manualTrophyPreview');
  const previewImg = document.getElementById('manualTrophyPreviewImg');
  const previewName = document.getElementById('manualTrophyPreviewName');

  let currentCustomImage = '';

  function updatePreview(){
    const val = trophySel?.value;
    if (val === '__custom') {
      if (customFields) customFields.style.display = 'flex';
      if (previewBox) previewBox.style.display = customName.value.trim() ? 'flex' : 'none';
      if (previewName) previewName.textContent = customName.value.trim() || '—';
      if (previewImg) previewImg.innerHTML = currentCustomImage ? `<img src="${currentCustomImage}" style="width:100%;height:100%;object-fit:contain">` : '🏆';
    } else {
      if (customFields) customFields.style.display = 'none';
      const opt = trophySel?.selectedOptions[0];
      if (opt && opt.value) {
        if (previewBox) previewBox.style.display = 'flex';
        if (previewName) previewName.textContent = opt.textContent;
        const existing = listExistingTrophies().find(t => `existing:${t.key}` === val);
        if (previewImg) previewImg.innerHTML = existing?.image ? `<img src="${existing.image}" style="width:100%;height:100%;object-fit:contain">` : '🏆';
      } else {
        if (previewBox) previewBox.style.display = 'none';
      }
    }
  }

  trophySel?.addEventListener('change', updatePreview);
  customName?.addEventListener('input', updatePreview);
  updatePreview();

  customUpload?.addEventListener('click', () => customFile?.click());
  customFile?.addEventListener('change', async () => {
    const f = customFile.files[0]; if (!f) return;
    try {
      const res = await compressImage(f, 128, 128);
      currentCustomImage = res;
      customImgInput.value = res;
      updatePreview();
    } catch(e) { toast('Error procesando imagen', 'error'); }
  });

  const giveBtn = document.getElementById('manual-give');
  if (giveBtn && !giveBtn.dataset.bound) {
    giveBtn.dataset.bound = '1';
    giveBtn.addEventListener('click', () => {
      try {
        const target = targetSel.value;
        if (!target) return toast('Selecciona un destino', 'error');

        const trophyVal = trophySel.value;
        let trophyData;

        if (trophyVal === '__custom') {
          const name = customName.value.trim();
          if (!name) return toast('Falta el nombre del trofeo', 'error');
          trophyData = { name, image: currentCustomImage || '', manual: true };
        } else {
          const existing = listExistingTrophies().find(t => `existing:${t.key}` === trophyVal);
          if (!existing) return toast('Trofeo no encontrado', 'error');
          trophyData = {
            name: existing.name, image: existing.image, manual: true,
            divisionId: existing.divisionId, divisionName: existing.divisionName, type: existing.type
          };
        }
        trophyData.date = Date.now();

        const [kind, id] = target.split(':');
        if (kind === 'team') {
          assignTrophyToTeam(id, trophyData);
          toast(`Trofeo "${trophyData.name}" asignado al equipo`, 'success');
        } else {
          assignTrophyToPlayer(id, trophyData);
          toast(`Trofeo "${trophyData.name}" asignado al jugador`, 'success');
        }
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch(e) {
        console.error(e);
        toast('Error: ' + e.message, 'error');
      }
    });
  }

  const remTarget = document.getElementById('remove-target');
  const remSelect = document.getElementById('remove-trophy');
  const remBtn = document.getElementById('remove-trophy-btn');

  function refreshRemoveList(){
    if (!remTarget || !remSelect || !remBtn) return;
    const val = remTarget.value;
    if (!val) {
      remSelect.innerHTML = '<option value="">— Selecciona un destino —</option>';
      remBtn.disabled = true;
      return;
    }
    const [kind, id] = val.split(':');
    const db = getDB();
    let list = [];
    if (kind === 'team') {
      const t = db.teams.find(x => x.id === id);
      list = t?.trophies || [];
    } else {
      const p = db.players.find(x => x.id === id);
      list = p?.trophies || [];
    }
    if (list.length === 0) {
      remSelect.innerHTML = '<option value="">— Sin trofeos —</option>';
      remBtn.disabled = true;
      return;
    }
    remSelect.innerHTML = '<option value="">— Selecciona un trofeo —</option>' +
      list.map(tr => `<option value="${tr.id}">${esc(tr.name)}${tr.wonWith ? ' · ' + esc(tr.wonWith) : ''}</option>`).join('');
    remBtn.disabled = true;
  }
  remTarget?.addEventListener('change', refreshRemoveList);
  remSelect?.addEventListener('change', () => { remBtn.disabled = !remSelect.value; });
  remBtn?.addEventListener('click', () => {
    const val = remTarget.value;
    const trophyId = remSelect.value;
    if (!val || !trophyId) return;
    if (!confirm('¿Quitar este trofeo?')) return;
    try {
      const [kind, id] = val.split(':');
      if (kind === 'team') removeTrophyFromTeam(id, trophyId);
      else removeTrophyFromPlayer(id, trophyId);
      toast('Trofeo eliminado', 'success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch(e) { toast('Error: ' + e.message, 'error'); }
  });
  refreshRemoveList();

  const saveBtn = document.getElementById('save-trophies');
  if (saveBtn && !saveBtn.dataset.bound) {
    saveBtn.dataset.bound = '1';
    saveBtn.addEventListener('click', () => {
      try {
        const names = {}; const images = {};
        document.querySelectorAll('[data-trophy-name]').forEach(inp => { names[inp.dataset.trophyName] = inp.value.trim(); });
        document.querySelectorAll('[data-trophy-image]').forEach(inp => { images[inp.dataset.trophyImage] = inp.value; });
        const banner = document.getElementById('banner-data')?.value || '';

        mutate(d => {
          d.trophies ||= {};
          Object.keys(names).forEach(key => {
            const [divId, type] = key.split('::');
            if (!divId || !type) return;
            d.trophies[divId] ||= {};
            d.trophies[divId][type] ||= {};
            d.trophies[divId][type].name = names[key] || '';
            d.trophies[divId][type].image = images[key] || '';
          });
          d.transferBannerBg = banner;
        });
        toast('Configuración de trofeos guardada', 'success');
      } catch(e) {
        console.error(e);
        toast('Error: ' + e.message, 'error');
      }
    });
  }
}

// ============================================================
// AI
// ============================================================
function renderAI(ai){
  const thresholds = ai.matchThresholds || { high: 0.9, low: 0.5 };
  return `
    <div class="card">
      <div class="card-header"><div class="card-title"><span class="dot">◆</span>INTELIGENCIA ARTIFICIAL</div></div>
      <div class="row">
        <div class="field"><label>Proveedor</label>
          <select class="select" id="aiProvider"><option value="gemini" ${ai.provider==='gemini'?'selected':''}>Google Gemini</option></select>
        </div>
        <div class="field"><label>Modelo</label>
          <div style="display:flex;gap:8px">
            <select class="select" id="aiModel" style="flex:1">
              ${ai.model ? `<option value="${ai.model}" selected>${ai.model}</option>` : '<option value="gemini-2.0-flash" selected>gemini-2.0-flash</option>'}
            </select>
            <button class="btn" id="aiListModels" type="button">LISTAR</button>
          </div>
        </div>
      </div>
      <div class="field"><label>API Key</label>
        <div style="display:flex;gap:8px">
          <input class="input" id="aiKey" type="password" value="${ai.apiKey||''}" placeholder="Tu clave de Gemini">
          <button class="btn" id="aiToggleKey" type="button">👁</button>
        </div>
      </div>
      <div class="divider"></div>
      <div class="row">
        <div class="field"><label>Umbral alto (%)</label><input class="input" type="number" id="aiThresholdHigh" min="50" max="100" step="1" value="${Math.round((thresholds.high || 0.9) * 100)}"></div>
        <div class="field"><label>Umbral bajo (%)</label><input class="input" type="number" id="aiThresholdLow" min="0" max="100" step="1" value="${Math.round((thresholds.low || 0.5) * 100)}"></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;margin-bottom:6px">
        <label style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600">Prompt del sistema</label>
        <button type="button" class="btn btn-sm" id="aiResetPrompt">↩ Restaurar prompt por defecto</button>
      </div>
      <div class="field"><textarea class="textarea" id="aiPrompt" rows="14">${ai.systemPrompt||''}</textarea></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn" id="aiTest">PROBAR CONEXIÓN</button>
        <button class="btn btn-primary" id="aiSave">GUARDAR IA</button>
      </div>
      <div id="aiStatus" style="margin-top:12px"></div>
    </div>
  `;
}

// ============================================================
// DATA
// ============================================================
function renderData(){
  const sync = getSyncState();
  const loggedIn = !!_authUser;
  const hasDownloaded = window.__zenithHasDownloadedThisSession;

  return `
    <div class="card" style="border-left:4px solid var(--accent);margin-bottom:20px">
      <div class="card-header">
        <div class="card-title"><span class="dot">◆</span>SINCRONIZACIÓN EN TIEMPO REAL</div>
        <span class="chip ${loggedIn ? 'chip-accent' : ''}" style="font-size:10px">
          ${loggedIn ? '● CONECTADO' : '○ DESCONECTADO'}
        </span>
      </div>

      <p style="font-size:12px;color:var(--muted);line-height:1.7;margin-bottom:16px">
        Los cambios en <b style="color:var(--silver-light)">equipos, jugadores, partidos, noticias</b>,
        <b style="color:var(--silver-light)">widgets</b>, <b style="color:var(--silver-light)">trofeos</b>,
        <b style="color:var(--silver-light)">tema</b> y
        <b style="color:var(--silver-light)">configuración</b> se sincronizan automáticamente (2s debounce).
      </p>

      <div style="background:var(--bg-graphite);border:1px solid var(--border-soft);border-radius:8px;padding:12px;margin-bottom:16px">
        <div style="font-size:11px;color:var(--muted);letter-spacing:.14em;margin-bottom:6px">CUENTA</div>
        ${loggedIn
          ? `<div style="font-size:13px;color:var(--silver-light);margin-bottom:10px">${esc(_authUser.email)}</div>
             <div style="font-size:11px;color:var(--muted);margin-bottom:10px">
               ${hasDownloaded ? '✅ Datos descargados en esta sesión' : '⏳ Pendiente de descarga inicial'}
             </div>
             <div style="display:flex;gap:8px;flex-wrap:wrap">
               <button class="btn btn-sm" id="btnForcePull">⬇ DESCARGAR DEL SERVIDOR</button>
               <button class="btn btn-sm" id="btnForcePush">☁ FORZAR PUBLICACIÓN</button>
               <button class="btn btn-sm" id="btnLogout">CERRAR SESIÓN</button>
               <button class="btn btn-sm" id="btnTestConn">PROBAR CONEXIÓN</button>
             </div>`
          : `<div style="font-size:13px;color:var(--silver-light);margin-bottom:10px">No has iniciado sesión.</div>
             <button class="btn btn-sm btn-primary" id="btnLoginFromConfig">🔒 INICIAR SESIÓN</button>`}
      </div>

      <div style="background:var(--bg-graphite);border:1px solid var(--border-soft);border-radius:8px;padding:12px">
        <div style="font-size:11px;color:var(--muted);letter-spacing:.14em;margin-bottom:10px">ESTADO</div>
        <div style="font-size:11.5px;color:var(--muted);line-height:1.7">
          <div>Cambios pendientes: <b style="color:${sync.dirtyCount > 0 ? 'var(--gold)' : 'var(--silver-light)'}">${sync.dirtyCount}</b></div>
          <div>Último push: <b style="color:var(--silver-light)">${sync.lastPushAt ? new Date(sync.lastPushAt).toLocaleString() : 'Nunca'}</b></div>
          <div>Conexión: <b style="color:${navigator.onLine ? 'var(--success)' : 'var(--danger)'}">${navigator.onLine ? 'Online' : 'Offline'}</b></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-title"><span class="dot">◆</span>GESTIÓN DE DATOS LOCALES</div></div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn" id="btnExport">EXPORTAR ZENITH_DATABASE.json</button>
        <button class="btn" id="btnBackup">EXPORTAR BACKUP CON TIMESTAMP</button>
        <label class="btn" style="cursor:pointer">IMPORTAR DATOS<input type="file" id="btnImport" accept="application/json" hidden></label>
        <button class="btn btn-danger" id="btnReset">RESTAURAR BASE DE DATOS</button>
      </div>
    </div>
  `;
}

// ============================================================
// BIND
// ============================================================
export function bindConfigEvents(){
  const exitBtn = document.getElementById('btnExitViewFromConfig');
  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      import('../services/seasons.js').then(({ switchToSeason }) => {
        switchToSeason(null);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    });
    return;
  }

  document.querySelectorAll('[data-config-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      configTab = btn.dataset.configTab;
      document.querySelectorAll('[data-config-tab]').forEach(b => b.classList.toggle('active', b === btn));
      const db = getDB();
      const ai = db.config.ai || {};
      document.getElementById('configContent').innerHTML = renderConfigTab(configTab, db, ai);
      bindConfigEvents();
    });
  });

  const db = getDB();

  // AUTH + SYNC
  document.getElementById('btnLoginFromConfig')?.addEventListener('click', async () => {
    await refreshAuthState();
    if (!_authUser) openLoginModal();
  });

  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    if (!confirm('¿Cerrar sesión?')) return;
    try {
      await logout();
      _authUser = null;
      updateTopbarPublishButton();
      toast('Sesión cerrada', 'success');
      const dbCurr = getDB();
      const ai = dbCurr.config.ai || {};
      document.getElementById('configContent').innerHTML = renderConfigTab(configTab, dbCurr, ai);
      bindConfigEvents();
    } catch(e) { toast('Error: ' + e.message, 'error'); }
  });

  document.getElementById('btnForcePull')?.addEventListener('click', async () => {
    try {
      toast('Descargando del servidor...', 'info');
      await forcePull();
      try {
        const themeActive = getDB().config?.theme?.active;
        applyTheme(themeActive);
      } catch(themeErr) {
        console.warn('[CONFIG] No se pudo aplicar tema tras pull:', themeErr);
      }
      toast('Datos descargados', 'success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      const dbCurr = getDB();
      const ai = dbCurr.config.ai || {};
      document.getElementById('configContent').innerHTML = renderConfigTab(configTab, dbCurr, ai);
      bindConfigEvents();
    } catch(e) { toast('Error: ' + e.message, 'error'); }
  });

  document.getElementById('btnForcePush')?.addEventListener('click', () => openPublishModal());

  document.getElementById('btnTestConn')?.addEventListener('click', async () => {
    try {
      await testConnection();
      toast('✅ Conexión correcta', 'success');
    } catch(e) { toast('❌ ' + e.message, 'error'); }
  });

  // GENERAL
  document.getElementById('saveCfgGeneral')?.addEventListener('click', () => {
    const q = id => document.getElementById(id);
    mutate(d => {
      d.config.rosterRules = { starters: +q('cfgStarters').value, substitutes: +q('cfgSubs').value, max: +q('cfgMax').value };
      d.config.badStreak = { enabled: q('bsEnabled').checked, minGames: +q('bsMin').value, consecutiveLosses: +q('bsLosses').value, penalty: +q('bsPen').value };
      d.config.pigWeights = { goal: +q('pwGoal').value, assist: +q('pwAssist').value, save: +q('pwSave').value, missDivisor: +q('pwMiss').value };
    });
    logChange('update','config', null, 'Configuración general actualizada');
    toast('Configuración guardada','success');
  });

  document.querySelectorAll('[data-widget-toggle]').forEach(cb =>
    cb.addEventListener('change', () => {
      mutate(d => {
        const w = d.widgets.find(x => x.instanceId === cb.dataset.widgetToggle);
        if (w) w.enabled = cb.checked;
      });
      toast('Widget actualizado','success');
    }));

  document.querySelectorAll('[data-widget-remove]').forEach(btn =>
    btn.addEventListener('click', () => {
      if (!confirm('¿Eliminar esta instancia del widget?')) return;
      mutate(d => { d.widgets = d.widgets.filter(w => w.instanceId !== btn.dataset.widgetRemove); });
      toast('Widget eliminado','success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }));

  document.getElementById('resetWidgetsBtn')?.addEventListener('click', () => {
    if (!confirm('¿Restaurar widgets por defecto?')) return;
    mutate(d => { d.widgets = getDefaultWidgets(); });
    toast('Widgets restaurados','success');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

  document.getElementById('btnFinishSeason')?.addEventListener('click', () => {
    const currentDB = getDB();
    if (currentDB.viewSeasonId) return toast('📖 Estás en modo lectura.', 'error');
    openSeasonEndWarning();
  });

  document.getElementById('btnResetDivisions')?.addEventListener('click', () => {
    const currentDB = getDB();
    if (currentDB.viewSeasonId) return toast('📖 Estás en modo lectura.', 'error');
    if (!confirm('⚠️ ¿Resetear todas las divisiones?')) return;
    try {
      resetDivisions();
      toast('Divisiones reseteadas', 'success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch(e) { toast('Error: ' + e.message, 'error'); }
  });

  document.getElementById('saveZones')?.addEventListener('click', () => {
    saveZonesConfig(db);
    logChange('update','zones', null, 'Clasificaciones actualizadas');
    toast('Clasificaciones guardadas','success');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  document.getElementById('resetZones')?.addEventListener('click', () => {
    if (!confirm('¿Restaurar clasificaciones por defecto?')) return;
    import('../data/database.js').then(({DEFAULT_ZONES}) => {
      mutate(d => {
        const div = d.divisions.find(x => x.id === (state.divisionId || d.divisions[0].id));
        if (div) div.config.zones = JSON.parse(JSON.stringify(DEFAULT_ZONES));
      });
      toast('Zonas restauradas','success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  });

  document.getElementById('btnNewDivision')?.addEventListener('click', () => {
    openModal({
      id: 'new-division', title: 'CREAR DIVISIÓN',
      body: `
        <div class="field"><label>Nombre</label><input class="input" id="newDivName" placeholder="Ej: ZENITH II"></div>
        <div class="field"><label>Tier</label><input class="input" type="number" id="newDivTier" value="${db.divisions.length + 1}"></div>
      `,
      footer: `<button class="btn btn-ghost" data-close>CANCELAR</button><button class="btn btn-primary" id="confirmNewDiv">CREAR</button>`,
      onMount: root => {
        root.querySelector('#confirmNewDiv').addEventListener('click', () => {
          try {
            const name = root.querySelector('#newDivName').value.trim();
            const tier = +root.querySelector('#newDivTier').value || 2;
            createDivision({ name, tier, visible: true });
            toast('División creada','success');
            closeTopModal();
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          } catch(e) { toast(e.message,'error'); }
        });
      }
    });
  });

  document.querySelectorAll('[data-div-visibility]').forEach(cb => {
    cb.addEventListener('change', () => {
      setDivisionVisibility(cb.dataset.divVisibility, cb.checked);
      toast('Visibilidad actualizada','success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  });
  document.querySelectorAll('[data-div-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('¿Eliminar esta división?')) return;
      try {
        deleteDivision(btn.dataset.divDel);
        toast('División eliminada','success');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch(e) { toast(e.message,'error'); }
    });
  });
  document.querySelectorAll('[data-div-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const div = db.divisions.find(d => d.id === btn.dataset.divEdit);
      if (!div) return;
      openModal({
        id: 'edit-division-' + div.id, title: 'EDITAR DIVISIÓN',
        body: `
          <div class="field"><label>Nombre</label><input class="input" id="editDivName" value="${esc(div.name)}"></div>
          <div class="field"><label>Tier</label><input class="input" type="number" id="editDivTier" value="${div.tier}"></div>
        `,
        footer: `<button class="btn btn-ghost" data-close>CANCELAR</button><button class="btn btn-primary" id="confirmEditDiv">GUARDAR</button>`,
        onMount: root => {
          root.querySelector('#confirmEditDiv').addEventListener('click', () => {
            updateDivision(div.id, {
              name: root.querySelector('#editDivName').value.trim(),
              tier: +root.querySelector('#editDivTier').value
            });
            toast('División actualizada','success');
            closeTopModal();
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          });
        }
      });
    });
  });

  document.getElementById('movType')?.addEventListener('change', e => {
    const wrap = document.getElementById('movSwapWrap');
    if (wrap) wrap.style.display = e.target.value === 'swap' ? '' : 'none';
  });
  document.getElementById('movApplyAt')?.addEventListener('change', e => {
    const wrap = document.getElementById('movRoundWrap');
    if (wrap) wrap.style.display = e.target.value === 'roundN' ? '' : 'none';
  });
  document.getElementById('btnQueueMovement')?.addEventListener('click', () => {
    const type = document.getElementById('movType').value;
    const teamA = document.getElementById('movTeamA').value;
    const teamB = document.getElementById('movTeamB')?.value;
    const targetDiv = document.getElementById('movTargetDiv').value;
    const applyAt = document.getElementById('movApplyAt').value;
    const round = applyAt === 'roundN' ? +document.getElementById('movRound').value : null;
    const reason = document.getElementById('movReason').value.trim();
    try {
      if (type === 'swap') {
        if (!teamB) throw new Error('Selecciona ambos equipos');
        swapTeams(teamA, teamB, applyAt, round);
      } else {
        queueTeamMovement({ teamId: teamA, targetDivisionId: targetDiv, type, applyAt, roundNumber: round, reason });
      }
      toast('Movimiento aplicado','success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch(e) { toast(e.message,'error'); }
  });

  if (configTab === 'trophies') bindTrophiesConfig();
  if (configTab === 'theme') bindThemeTab();

  document.getElementById('aiToggleKey')?.addEventListener('click', () => {
    const el = document.getElementById('aiKey');
    el.type = el.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('aiListModels')?.addEventListener('click', async () => {
    const key = document.getElementById('aiKey').value.trim();
    if (!key) return toast('Introduce la API key primero','error');
    const status = document.getElementById('aiStatus');
    status.innerHTML = '<div class="card" style="padding:12px;font-size:12px">Consultando modelos…</div>';
    try {
      mutate(d => { d.config.ai.apiKey = key; });
      const models = await AIService.listModels();
      const select = document.getElementById('aiModel');
      const current = select.value;
      select.innerHTML = models.map(m => `<option value="${m}" ${m===current?'selected':''}>${m}</option>`).join('');
      status.innerHTML = `<div class="card" style="padding:12px;font-size:12px;color:var(--success)">✅ ${models.length} modelos</div>`;
    } catch(e) {
      status.innerHTML = `<div class="card" style="padding:12px;font-size:12px;color:var(--danger)">❌ ${e.message}</div>`;
    }
  });
  document.getElementById('aiResetPrompt')?.addEventListener('click', () => {
    if (!confirm('¿Restaurar el prompt por defecto?')) return;
    const ta = document.getElementById('aiPrompt');
    if (ta) ta.value = DEFAULT_SYSTEM_PROMPT;
    toast('Prompt restaurado','success');
  });
  document.getElementById('aiSave')?.addEventListener('click', () => {
    try {
      const high = (+document.getElementById('aiThresholdHigh').value || 90) / 100;
      const low = (+document.getElementById('aiThresholdLow').value || 50) / 100;
      const safeHigh = Math.max(0, Math.min(1, high));
      const safeLow = Math.max(0, Math.min(safeHigh, low));
      mutate(d => {
        d.config.ai = {
          provider: document.getElementById('aiProvider').value,
          model: document.getElementById('aiModel').value,
          apiKey: document.getElementById('aiKey').value.trim(),
          systemPrompt: document.getElementById('aiPrompt').value,
          matchThresholds: { high: safeHigh, low: safeLow }
        };
      });
      toast('Configuración IA guardada','success');
    } catch(e) { toast('Error: ' + e.message, 'error'); }
  });
  document.getElementById('aiTest')?.addEventListener('click', async () => {
    document.getElementById('aiSave').click();
    const status = document.getElementById('aiStatus');
    const btn = document.getElementById('aiTest');
    btn.disabled = true; btn.textContent = 'PROBANDO...';
    try {
      const res = await AIService.testConnection();
      status.innerHTML = `<div class="card" style="padding:12px;font-size:12px;color:var(--success)">✅ OK · ${res.models.length} modelos</div>`;
    } catch(e) {
      status.innerHTML = `<div class="card" style="padding:12px;font-size:12px;color:var(--danger)">❌ ${e.message}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = 'PROBAR CONEXIÓN';
    }
  });

  document.getElementById('btnExport')?.addEventListener('click', () => { exportJSON(); toast('Exportado','success'); });
  document.getElementById('btnBackup')?.addEventListener('click', () => { exportBackup(); toast('Backup exportado','success'); });
  document.getElementById('btnImport')?.addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      await importJSON(f);
      try {
        const themeActive = getDB().config?.theme?.active;
        applyTheme(themeActive);
      } catch(themeErr) {
        console.warn('[CONFIG] No se pudo aplicar tema tras import:', themeErr);
      }
      toast('Datos importados','success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch(err) { toast('Error: '+err.message,'error'); }
  });
  document.getElementById('btnReset')?.addEventListener('click', () => {
    if (!confirm('¿Restaurar base de datos por defecto?')) return;
    resetDB();
    try {
      const themeActive = getDB().config?.theme?.active;
      applyTheme(themeActive);
    } catch(themeErr) {
      console.warn('[CONFIG] No se pudo aplicar tema tras reset:', themeErr);
    }
    toast('Base restaurada','success');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

// ============================================================
// FIN DE TEMPORADA
// ============================================================
function openSeasonEndWarning(){
  let countdown = 5;
  let intervalId = null;
  openModal({
    id: 'season-end-warning',
    title: '⚠ TERMINAR TEMPORADA',
    body: `
      <div style="text-align:center;padding:8px 0 16px">
        <div style="font-size:52px;margin-bottom:12px">🏆</div>
        <h3 style="font-family:var(--font-display);letter-spacing:.14em;color:var(--silver-light);font-size:18px;margin-bottom:12px">¿TERMINAR LA TEMPORADA ACTUAL?</h3>
        <p style="color:var(--silver);font-size:13px;line-height:1.7">
          Se archivará la temporada actual y se creará una nueva.<br>
          <strong style="color:var(--gold)">No se puede deshacer.</strong>
        </p>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="seasonEndConfirm" disabled style="background:var(--gold);color:#04101F;border-color:var(--gold);font-weight:700;min-width:160px">ESPERA (5s)</button>
    `,
    onMount: root => {
      const btn = root.querySelector('#seasonEndConfirm');
      intervalId = setInterval(() => {
        countdown--;
        if (countdown <= 0) { clearInterval(intervalId); intervalId = null; btn.disabled = false; btn.textContent = 'CONFIRMAR'; }
        else btn.textContent = `ESPERA (${countdown}s)`;
      }, 1000);
      btn.addEventListener('click', () => {
        if (intervalId) { clearInterval(intervalId); intervalId = null; }
        closeTopModal();
        setTimeout(() => openSeasonEndCheck(), 180);
      });
    },
    onClose: () => { if (intervalId) { clearInterval(intervalId); intervalId = null; } }
  });
}

function openSeasonEndCheck(){
  let check;
  try { check = canFinishSeason(); }
  catch(e) { toast('Error: ' + e.message, 'error'); return; }

  if (!check.ok) {
    openModal({
      id: 'season-end-errors',
      title: '❌ NO SE PUEDE TERMINAR',
      body: `
        <div style="text-align:center;padding:8px 0 16px">
          <div style="font-size:48px;margin-bottom:12px">⚠</div>
          <p style="color:var(--silver);font-size:13px;line-height:1.7;margin-bottom:14px">
            <strong style="color:var(--danger)">Faltan divisiones por terminar.</strong>
          </p>
          <div style="background:var(--bg-graphite);border:1px solid var(--border-soft);border-radius:8px;padding:14px;text-align:left;font-size:12.5px;color:var(--silver)">
            ${check.errors.map(e => `<div style="margin-bottom:4px">• ${esc(e)}</div>`).join('')}
          </div>
        </div>
      `,
      footer: `<button class="btn btn-primary" data-close>ENTENDIDO</button>`
    });
    return;
  }

  const db = getDB();
  const movementsPreview = [];
  check.divisionStatus.forEach(status => {
    const div = db.divisions.find(d => d.id === status.divisionId);
    if (!div) return;
    const cfg = div.config || {};
    if (cfg.promotion?.enabled && cfg.promotion.spots > 0) {
      const superior = db.divisions.find(d => d.tier === div.tier - 1);
      if (superior) {
        const st = computeStandings(div.id, check.seasonId);
        st.slice(0, cfg.promotion.spots).forEach(t => movementsPreview.push({ team: t.name, from: div.name, to: superior.name, type: 'ASCENSO' }));
      }
    }
    if (cfg.relegation?.enabled && cfg.relegation.spots > 0) {
      const inferior = db.divisions.find(d => d.tier === div.tier + 1);
      if (inferior) {
        const st = computeStandings(div.id, check.seasonId);
        st.slice(-cfg.relegation.spots).forEach(t => movementsPreview.push({ team: t.name, from: div.name, to: inferior.name, type: 'DESCENSO' }));
      }
    }
  });

  const autoTrophies = db.config.seasonEnd?.autoAssignTrophies !== false;

  openModal({
    id: 'season-end-final',
    title: '🏆 CONFIRMACIÓN FINAL',
    wide: true,
    body: `
      <h3 style="font-family:var(--font-display);letter-spacing:.12em;color:var(--silver-light);font-size:14px;margin-bottom:10px">CAMPEONES POR DIVISIÓN</h3>
      <div class="table-wrap" style="margin-bottom:20px">
        <table class="ztable">
          <thead><tr><th>DIVISIÓN</th><th>CAMPEÓN</th><th>FUENTE</th></tr></thead>
          <tbody>${check.divisionStatus.map(d => `<tr><td>${esc(d.divisionName)}</td><td>${d.champion ? `<strong style="color:var(--gold)">${esc(d.champion.teamName)}</strong>` : '—'}</td><td><span class="chip" style="font-size:9.5px">${d.championType === 'playoffs' ? 'Playoffs' : 'Tabla'}</span></td></tr>`).join('')}</tbody>
        </table>
      </div>
      ${movementsPreview.length > 0 ? `
        <h3 style="font-family:var(--font-display);letter-spacing:.12em;color:var(--silver-light);font-size:14px;margin-bottom:10px">MOVIMIENTOS A APLICAR</h3>
        <div class="table-wrap" style="margin-bottom:20px">
          <table class="ztable">
            <thead><tr><th>EQUIPO</th><th>DESDE</th><th>HASTA</th><th>TIPO</th></tr></thead>
            <tbody>${movementsPreview.map(mv => `<tr><td>${esc(mv.team)}</td><td style="color:var(--muted)">${esc(mv.from)}</td><td style="color:var(--accent)">${esc(mv.to)}</td><td><span class="chip" style="font-size:9.5px;${mv.type === 'ASCENSO' ? 'color:var(--success)' : 'color:var(--danger)'}">${mv.type}</span></td></tr>`).join('')}</tbody>
          </table>
        </div>
      ` : ''}
      <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--silver-light);cursor:pointer;padding:12px;background:var(--bg-graphite);border:1px solid var(--border-soft);border-radius:8px">
        <input type="checkbox" id="seasonEndAutoTrophies" ${autoTrophies ? 'checked' : ''}>
        🏆 Asignar trofeos automáticamente
      </label>
    `,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="seasonEndExecute" style="background:var(--gold);color:#04101F;border-color:var(--gold);font-weight:700">✅ CONFIRMAR</button>
    `,
    onMount: root => {
      root.querySelector('#seasonEndExecute').addEventListener('click', () => {
        try {
          const autoT = root.querySelector('#seasonEndAutoTrophies').checked;
          const result = finishSeason({ autoAssignTrophies: autoT });
          closeTopModal();
          toast(`✅ ${result.archivedSeasonName} archivada. Ahora ${result.newSeasonName}.`, 'success');
          setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 300);
        } catch(e) { toast('Error: ' + e.message, 'error'); }
      });
    }
  });
}

// ============================================================
// HELPERS
// ============================================================
function saveZonesConfig(db){
  const activeDivisionId = state.divisionId || db.divisions[0].id;
  const selects = document.querySelectorAll('[data-zone-pos]');
  const assignments = [];
  selects.forEach(sel => assignments.push({ pos: +sel.dataset.zonePos, type: sel.value }));

  const ranges = [];
  let current = null;
  const defaultColors = Object.fromEntries(ZONE_TYPES.map(z => [z.id, z.color]));
  assignments.forEach(a => {
    if (!current || current.type !== a.type) {
      if (current) ranges.push(current);
      current = { from: a.pos, to: a.pos, type: a.type, color: defaultColors[a.type] || 'transparent' };
    } else current.to = a.pos;
  });
  if (current) ranges.push(current);

  const hasTop1Highlight = document.getElementById('zoneShowTop1').checked;

  mutate(d => {
    const div = d.divisions.find(x => x.id === activeDivisionId);
    if (!div) return;
    div.config.zones = { hasTop1Highlight, zones: ranges };

    const playoffZone    = ranges.find(z => z.type === 'playoff');
    const playInZone     = ranges.find(z => z.type === 'playin');
    const promotionZone  = ranges.find(z => z.type === 'promotion');
    const relegationZone = ranges.find(z => z.type === 'relegation');

    div.config.playoffSpots = playoffZone ? (playoffZone.to - playoffZone.from + 1) : 0;
    div.config.playInSpots  = playInZone  ? (playInZone.to  - playInZone.from  + 1) : 0;

    div.config.promotion = {
      ...(div.config.promotion || {}),
      enabled: !!promotionZone,
      spots: promotionZone ? (promotionZone.to - promotionZone.from + 1) : 0
    };
    div.config.relegation = {
      ...(div.config.relegation || {}),
      enabled: !!relegationZone,
      spots: relegationZone ? (relegationZone.to - relegationZone.from + 1) : 0
    };
  });
}

function compressImage(file, maxW, maxH){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const ratio = Math.min(maxW / width, maxH / height, 1);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/webp', 0.85));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}