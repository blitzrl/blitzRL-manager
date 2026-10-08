// ============================================================
// TRANSFERS — Lógica de mercado de jugadores
// ============================================================
import { getDB, mutate } from './storage.js';
import { uid } from '../data/database.js';
import { openModal, closeTopModal, closeAllModals, toast } from './ui.js';

// ---------- HELPERS ----------
export function getPlayerCurrentTeam(playerId){
  const db = getDB();
  return db.teams.find(t => (t.roster || []).some(r => r.playerId === playerId)) || null;
}

export function getMaxRoster(){
  return getDB().config?.rosterRules?.max || 4;
}

export function getTeamRosterCount(teamId){
  const t = getDB().teams.find(x => x.id === teamId);
  return t ? (t.roster || []).length : 0;
}

export function canTeamReceive(teamId){
  return getTeamRosterCount(teamId) < getMaxRoster();
}

// ---------- ACCIONES ----------
export function doDeletePlayer(playerId){
  try {
    const db = getDB();
    const player = db.players.find(p => p.id === playerId);
    if(!player) return toast('Jugador no encontrado', 'error');

    mutate(d => {
      d.players = (d.players || []).filter(p => p.id !== playerId);
      (d.teams || []).forEach(t => {
        t.roster = (t.roster || []).filter(r => r.playerId !== playerId);
      });
    });
    toast('Jugador eliminado', 'success');
    closeAllModals();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch(e){
    console.error('[ZENITH] Error eliminando jugador:', e);
    toast('Error al eliminar: ' + e.message, 'error');
  }
}

export function doFreeAgent(playerId){
  try {
    const db = getDB();
    const player = db.players.find(p => p.id === playerId);
    if(!player) return toast('Jugador no encontrado', 'error');
    const fromTeam = getPlayerCurrentTeam(playerId);

    mutate(d => {
      const pl = d.players.find(p => p.id === playerId);
      if(!pl) return;
      const ft = fromTeam ? d.teams.find(t => t.id === fromTeam.id) : null;

      // Snapshot si tiene stats
      const s = pl.seasonStats || {};
      const hasStats = (s.goals || 0) + (s.assists || 0) + (s.saves || 0) + (s.shots || 0) > 0;
      if (hasStats && ft){
        pl.careerSnapshots.push({
          teamId: ft.id,
          teamName: ft.name,
          divisionId: ft.divisionId || null,
          divisionName: d.divisions.find(x => x.id === ft.divisionId)?.name || '—',
          stats: JSON.parse(JSON.stringify(s)),
          date: Date.now(),
          reason: 'free'
        });
      }

      if (ft) ft.roster = (ft.roster || []).filter(r => r.playerId !== playerId);
      pl.status = 'free_agent';
      pl.divisionId = null;
      pl.pendingTeamId = null;

      d.transferLog.push({
        id: uid('mov'),
        playerId,
        playerName: pl.name,
        fromTeamId: ft?.id || null,
        fromTeamName: ft?.name || '—',
        toTeamId: null,
        toTeamName: 'Agente Libre',
        fromDivisionId: ft?.divisionId || null,
        toDivisionId: null,
        date: Date.now(),
        type: 'free'
      });
    });

    toast(`✅ ${player.name} ahora es agente libre`, 'success');
    closeAllModals();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch(e){
    console.error('[ZENITH] Error al liberar jugador:', e);
    toast('Error: ' + e.message, 'error');
  }
}

export function doTransferPlayer(playerId, targetTeamId, forceReset){
  try {
    const db = getDB();
    const player = db.players.find(p => p.id === playerId);
    const targetTeam = db.teams.find(t => t.id === targetTeamId);
    if (!player || !targetTeam) return toast('Datos inválidos', 'error');

    const fromTeam = getPlayerCurrentTeam(playerId);
    const fromDivId = fromTeam?.divisionId || null;
    const shouldReset = forceReset || (fromDivId !== targetTeam.divisionId);

    const max = getMaxRoster();
    const count = getTeamRosterCount(targetTeamId);
    const goesPending = count >= max;

    mutate(d => {
      const pl = d.players.find(p => p.id === playerId);
      const tt = d.teams.find(t => t.id === targetTeamId);
      const ft = fromTeam ? d.teams.find(t => t.id === fromTeam.id) : null;
      if (!pl || !tt) return;

      if (shouldReset){
        const s = pl.seasonStats || {};
        pl.careerSnapshots.push({
          teamId: ft?.id || null,
          teamName: ft?.name || 'Agente Libre',
          divisionId: fromDivId,
          divisionName: d.divisions.find(x => x.id === fromDivId)?.name || '—',
          stats: JSON.parse(JSON.stringify(s)),
          date: Date.now(),
          reason: 'transfer'
        });
        pl.seasonStats = { goals:0, assists:0, saves:0, shots:0, pig:0, matchesPlayed:0, mvps:0, pigHistory:[], avgLast5PIG:0, avgPIGPerMatch:0 };
        pl.pigHistory = [];
        pl.pigTrend = '—';
      }

      if (ft) ft.roster = (ft.roster || []).filter(r => r.playerId !== playerId);

      if (goesPending){
        pl.status = 'pending';
        pl.divisionId = targetTeam.divisionId;
        pl.pendingTeamId = targetTeamId;
      } else {
        pl.status = 'owned';
        pl.divisionId = targetTeam.divisionId;
        pl.pendingTeamId = null;
        tt.roster.push({ playerId, role: 'SUPLENTE' });
      }

      d.transferLog.push({
        id: uid('mov'),
        playerId,
        playerName: pl.name,
        fromTeamId: ft?.id || null,
        fromTeamName: ft?.name || 'Agente Libre',
        toTeamId: targetTeamId,
        toTeamName: tt.name,
        fromDivisionId: fromDivId,
        toDivisionId: targetTeam.divisionId,
        date: Date.now(),
        type: goesPending ? 'pending' : 'transfer'
      });
    });

    toast(`✅ ${player.name} → ${targetTeam.name}${goesPending ? ' (PENDIENTE)' : ''}`, 'success');
    closeAllModals();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch(e){
    console.error('[ZENITH] Error al transferir:', e);
    toast('Error: ' + e.message, 'error');
  }
}

// ---------- MODALES ----------
export function openTransferModal(playerId){
  const db = getDB();
  const player = db.players.find(p => p.id === playerId);
  if (!player) return toast('Jugador no encontrado', 'error');
  const currentTeam = getPlayerCurrentTeam(playerId);

  const divisionsSorted = [...db.divisions].sort((a, b) => (a.tier || 0) - (b.tier || 0));
  const groupsHTML = divisionsSorted.map(div => {
    const teams = db.teams.filter(t => t.divisionId === div.id && t.id !== currentTeam?.id);
    if (teams.length === 0) return '';
    const max = getMaxRoster();
    return `
      <div class="transfer-group-head">${div.tier || '?'}ª · ${esc(div.name)}</div>
      ${teams.map(t => {
        const count = getTeamRosterCount(t.id);
        const full = count >= max;
        return `
          <div class="transfer-team-option ${full ? 'disabled' : ''}"
               data-target="${t.id}" data-division="${div.id}" data-full="${full ? '1' : '0'}">
            <div class="info">
              ${t.logo ? `<img src="${t.logo}" alt="">` : ''}
              <span class="name">${esc(t.name)}</span>
            </div>
            <span class="slots">${count}/${max}${full ? ' · LLENO' : ''}</span>
          </div>`;
      }).join('')}
    `;
  }).join('');

  openModal({
    id: 'transfer-player-' + playerId,
    title: `TRANSFERIR · ${esc(player.name)}`,
    wide: true,
    body: `
      <div style="margin-bottom:14px;color:var(--muted);font-size:12px">
        Equipo actual: <strong style="color:var(--silver-light)">${esc(currentTeam?.name || 'Agente Libre')}</strong>
      </div>
      <div class="field">
        <label>Destino</label>
        <div id="transfer-list" style="max-height:320px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:8px;padding:6px;background:var(--bg-graphite)">
          ${groupsHTML || '<div style="padding:20px;text-align:center;color:var(--muted)">No hay otros equipos disponibles</div>'}
        </div>
      </div>
      <div class="field">
        <label><input type="checkbox" id="transfer-reset-stats"> Resetear stats al cambiar de división</label>
        <small class="field-hint">Se guardará un snapshot en el historial de carrera del jugador.</small>
      </div>
      <input type="hidden" id="transfer-target-team" value="">
      <input type="hidden" id="transfer-target-div" value="">
    `,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="do-transfer" disabled>CONFIRMAR</button>
    `,
    onMount: root => {
      const list = root.querySelector('#transfer-list');
      const tt = root.querySelector('#transfer-target-team');
      const btn = root.querySelector('#do-transfer');

      list.querySelectorAll('[data-target]').forEach(opt => {
        opt.addEventListener('click', () => {
          if (opt.dataset.full === '1') return;
          list.querySelectorAll('[data-target]').forEach(o => o.classList.remove('selected'));
          opt.classList.add('selected');
          tt.value = opt.dataset.target;
          btn.disabled = false;
        });
      });

      btn.addEventListener('click', () => {
        doTransferPlayer(playerId, tt.value, root.querySelector('#transfer-reset-stats').checked);
      });
    }
  });
}

export function openRowActions(playerId){
  const db = getDB();
  const player = db.players.find(p => p.id === playerId);
  if (!player) return;
  const currentTeam = getPlayerCurrentTeam(playerId);

  openModal({
    id: 'row-actions-' + playerId,
    title: `ACCIONES · ${esc(player.name)}`,
    body: `
      <div style="margin-bottom:14px;color:var(--muted);font-size:12px">
        Equipo actual: <strong style="color:var(--silver-light)">${esc(currentTeam?.name || 'Agente Libre')}</strong>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button type="button" class="btn" data-act="transfer">🔄 Transferir a otro club</button>
        <button type="button" class="btn" data-act="free">🆓 Convertir en agente libre</button>
        <button type="button" class="btn btn-danger" data-act="delete">🗑 Eliminar del programa</button>
      </div>
    `,
    footer: `<button class="btn btn-ghost" data-close>CANCELAR</button>`,
    onMount: root => {
      root.querySelector('[data-act="transfer"]').addEventListener('click', () => {
        closeTopModal();
        setTimeout(() => openTransferModal(playerId), 100);
      });
      root.querySelector('[data-act="free"]').addEventListener('click', () => {
        if (!confirm(`¿Convertir a ${player.name} en agente libre?`)) return;
        doFreeAgent(playerId);
      });
      root.querySelector('[data-act="delete"]').addEventListener('click', () => {
        if (!confirm(`⚠️ ¿Eliminar a ${player.name}?`)) return;
        doDeletePlayer(playerId);
      });
    }
  });
}

// ---------- UTIL ----------
function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}