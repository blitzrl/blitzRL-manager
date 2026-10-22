import { getDB, mutate } from './storage.js';
import { uid } from '../data/database.js';
import { openModal, closeTopModal, closeAllModals, toast } from './ui.js';
import { calculatePlayerPrice, recordTransaction } from './economy.js';
import { aggregatePlayerStats } from './statistics.js';
import { openSigningWizard } from '../views/signingWizard.js';

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
      d.contracts = (d.contracts || []).filter(c => c.playerId !== playerId);
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

      if (ft) {
        pl.history = pl.history || [];
        pl.history.unshift({
          seasonName: d.seasons.find(s=>s.active)?.name || 'Actual',
          divisionName: d.divisions.find(x => x.id === ft.divisionId)?.name || '—',
          teamName: ft.name,
          role: 'LIBERADO',
          fromTeamName: ft.name,
          toTeamName: 'Agente Libre',
          price: 0,
          date: Date.now()
        });
      }

      if (ft) ft.roster = (ft.roster || []).filter(r => r.playerId !== playerId);
      
      pl.status = 'free_agent';
      pl.divisionId = null;
      pl.pendingTeamId = null;

      d.transferLog.push({
        id: uid('mov'), playerId, playerName: pl.name,
        fromTeamId: ft?.id || null, fromTeamName: ft?.name || '—',
        toTeamId: null, toTeamName: 'Agente Libre',
        fromDivisionId: ft?.divisionId || null, toDivisionId: null,
        date: Date.now(), type: 'free', price: 0
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

// Función de Transferencia Directa (Usada para auto-aprobaciones o traspasos sin cláusulas)
export function doTransferPlayer(playerId, targetTeamId, forceReset, customPrice = null){
  try {
    const db = getDB();
    const player = db.players.find(p => p.id === playerId);
    const targetTeam = db.teams.find(t => t.id === targetTeamId);
    if (!player || !targetTeam) return toast('Datos inválidos', 'error');

    const stats = aggregatePlayerStats().find(s => s.id === playerId);
    const priceData = calculatePlayerPrice(player, stats, db.config.economy);
    const price = customPrice !== null ? customPrice : priceData.price;

    if (!db.config.economy.allowDebt && (targetTeam.money || 0) < price) {
      return toast(`Fondos insuficientes. Requiere $${price.toLocaleString()}, tiene $${(targetTeam.money||0).toLocaleString()}`, 'error');
    }

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

      pl.history = pl.history || [];
      pl.history.unshift({
        seasonName: d.seasons.find(s=>s.active)?.name || 'Actual',
        divisionName: d.divisions.find(x => x.id === tt.divisionId)?.name || '—',
        teamName: tt.name,
        role: goesPending ? 'PENDIENTE' : 'TRANSFERENCIA',
        fromTeamName: ft?.name || 'Agente Libre',
        toTeamName: tt.name,
        price: price,
        date: Date.now()
      });

      if (shouldReset){
        const s = pl.seasonStats || {};
        pl.careerSnapshots.push({
          teamId: ft?.id || null, teamName: ft?.name || 'Agente Libre',
          divisionId: fromDivId, divisionName: d.divisions.find(x => x.id === fromDivId)?.name || '—',
          stats: JSON.parse(JSON.stringify(s)), date: Date.now(), reason: 'transfer'
        });
        pl.seasonStats = { goals:0, assists:0, saves:0, shots:0, pig:0, matchesPlayed:0, mvps:0, pigHistory:[], avgLast5PIG:0, avgPIGPerMatch:0 };
        pl.pigHistory = [];
        pl.pigTrend = '—';
      }

      if (ft) ft.roster = (ft.roster || []).filter(r => r.playerId !== playerId);

      pl.divisionId = targetTeam.divisionId;
      pl.marketValue = price;

      if (goesPending){
        pl.status = 'pending';
        pl.pendingTeamId = targetTeamId;
      } else {
        pl.status = 'owned';
        pl.pendingTeamId = null;
        tt.roster.push({ playerId, role: 'SUPLENTE' });
      }

      tt.money = (tt.money || 0) - price;
      if (ft) ft.money = (ft.money || 0) + price;

      d.economyLedger ||= [];
      d.economyLedger.unshift({
        id: uid('led'), ts: Date.now(), type: 'transfer', teamId: tt.id, teamName: tt.name,
        amount: -price, reason: `Fichaje: ${pl.name}`, meta: { playerId, fromTeamId: ft?.id || null }
      });
      if (ft) {
        d.economyLedger.unshift({
          id: uid('led'), ts: Date.now(), type: 'transfer', teamId: ft.id, teamName: ft.name,
          amount: price, reason: `Venta: ${pl.name}`, meta: { playerId, toTeamId: tt.id }
        });
      }

      d.transferLog.push({
        id: uid('mov'), playerId, playerName: pl.name,
        fromTeamId: ft?.id || null, fromTeamName: ft?.name || 'Agente Libre',
        toTeamId: targetTeamId, toTeamName: tt.name,
        fromDivisionId: fromDivId, toDivisionId: targetTeam.divisionId,
        date: Date.now(), type: goesPending ? 'pending' : 'transfer', price: price
      });
    });

    toast(`✅ ${player.name} → ${targetTeam.name} por $${price.toLocaleString()}${goesPending ? ' (PENDIENTE)' : ''}`, 'success');
    closeAllModals();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch(e){
    console.error('[ZENITH] Error al transferir:', e);
    toast('Error: ' + e.message, 'error');
  }
}

export function openTransferModal(playerId){
  const db = getDB();
  const player = db.players.find(p => p.id === playerId);
  if (!player) return toast('Jugador no encontrado', 'error');
  
  openSigningWizard(playerId, false);
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
        <button type="button" class="btn" data-act="loan">📤 PRÉSTAMO</button> 
        <button type="button" class="btn" data-act="transfer">🔄 FICHAJE / NEGOCIAR</button>
        <button type="button" class="btn" data-act="free">🆓 Convertir en agente libre</button>
        <button type="button" class="btn btn-danger" data-act="delete">🗑 Eliminar del programa</button>
      </div>
    `,
    footer: `<button class="btn btn-ghost" data-close>CANCELAR</button>`,
    onMount: root => {
      root.querySelector('[data-act="loan"]').addEventListener('click', async () => {
        closeTopModal();
        const { openLoanWizard } = await import('../views/loanWizard.js');
        setTimeout(() => openLoanWizard(playerId), 100);
      });
      root.querySelector('[data-act="transfer"]').addEventListener('click', () => {
        closeTopModal();
        setTimeout(() => openSigningWizard(playerId, false), 100);
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

function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}
