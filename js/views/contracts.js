import { getDB } from '../services/storage.js';
import { getContractAlerts, resolveAwaitingReturn } from '../services/contracts.js';
import { toast } from '../services/ui.js';

let activeTab = 'alerts';

export function contractsView(){
  const db = getDB();
  const alerts = getContractAlerts();
  const activeContracts = db.contracts.filter(c => c.status === 'active' || c.status === 'awaiting_return');
  const pastContracts = db.contracts.filter(c => c.status !== 'active' && c.status !== 'awaiting_return').sort((a,b) => (b.terminatedAt || 0) - (a.terminatedAt || 0));

  return `
    <div class="page-head">
      <h1 class="page-title">CONTRATOS</h1>
    </div>

    <div class="stats-tabs">
      <button class="stats-tab ${activeTab === 'alerts' ? 'active' : ''}" data-contract-tab="alerts">
        🔔 Alertas ${alerts.length > 0 ? `<span class="badge badge-live" style="margin-left:6px">${alerts.length}</span>` : ''}
      </button>
      <button class="stats-tab ${activeTab === 'active' ? 'active' : ''}" data-contract-tab="active">✅ Activos (${activeContracts.length})</button>
      <button class="stats-tab ${activeTab === 'history' ? 'active' : ''}" data-contract-tab="history">📜 Histórico</button>
    </div>

    <div id="contractsContent">
      ${renderTab(activeTab, alerts, activeContracts, pastContracts, db)}
    </div>
  `;
}

function renderTab(tab, alerts, active, history, db){
  if (tab === 'alerts') {
    if (alerts.length === 0) return `<div class="card" style="text-align:center;color:var(--muted);padding:40px">No hay alertas pendientes.</div>`;
    return `
      <div class="card">
        <div class="card-header"><div class="card-title">ALERTAS DEL SISTEMA</div></div>
        ${alerts.map(a => `
          <div class="card" style="margin-bottom:10px; border-left:4px solid ${a.severity === 'danger' ? 'var(--danger)' : 'var(--gold)'}">
            <div style="display:flex; justify-content:space-between; align-items:center">
              <div>
                <div style="font-weight:600; color:var(--silver-light); font-size:14px; margin-bottom:4px;">
                  ${a.type === 'awaiting_return' ? '⏸ RETORNO PENDIENTE' : a.type === 'expiring' ? '⚠ POR EXPIRAR' : '🔴 RENDIMIENTO EN RIESGO'}
                </div>
                <div style="font-size:12.5px; color:var(--silver)">
                  <b>${a.playerName}</b> (${a.teamName}) — ${a.message}
                </div>
              </div>
              <div>
                ${a.action === 'resolve' ? `<button class="btn btn-sm btn-primary" data-resolve-return="${a.contractId}">RESOLVER AHORA</button>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  if (tab === 'active') {
    return `
      <div class="card">
        <div class="card-header"><div class="card-title">CONTRATOS ACTIVOS</div></div>
        <div class="table-wrap">
          <table class="ztable">
            <thead>
              <tr>
                <th>JUGADOR</th>
                <th>TIPO</th>
                <th>ORIGEN → DESTINO</th>
                <th>FIN</th>
                <th>ESTADO</th>
                <th>ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              ${active.map(c => {
                const p = db.players.find(x => x.id === c.playerId);
                const origin = db.teams.find(t => t.id === c.ownerTeamId);
                const target = db.teams.find(t => t.id === c.currentTeamId);
                return `
                  <tr>
                    <td><b>${p?.name || '?'}</b></td>
                    <td><span class="badge ${c.type === 'loan' ? 'badge-gold' : ''}">${c.type === 'loan' ? 'PRÉSTAMO' : 'PERMANENTE'}</span></td>
                    <td>${origin?.name || '—'} → ${target?.name || '—'}</td>
                    <td>J${c.endMatchday} (S${db.seasons.find(s => s.id === c.endSeasonId)?.name.slice(-1) || '1'})</td>
                    <td><span class="badge ${c.status === 'active' ? 'badge-win' : 'badge-live'}">${c.status.toUpperCase()}</span></td>
                    <td>
                      ${c.status === 'awaiting_return' ? `<button class="btn btn-sm btn-primary" data-resolve-return="${c.id}">RESOLVER</button>` : ''}
                    </td>
                  </tr>
                `;
              }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--muted)">No hay contratos activos</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  if (tab === 'history') {
    return `
      <div class="card">
        <div class="card-header"><div class="card-title">HISTÓRICO DE CONTRATOS</div></div>
        <div class="table-wrap">
          <table class="ztable">
            <thead>
              <tr>
                <th>JUGADOR</th>
                <th>TIPO</th>
                <th>ORIGEN → DESTINO</th>
                <th>MOTIVO FIN</th>
                <th>FECHA</th>
              </tr>
            </thead>
            <tbody>
              ${history.map(c => {
                const p = db.players.find(x => x.id === c.playerId);
                const origin = db.teams.find(t => t.id === c.ownerTeamId);
                const target = db.teams.find(t => t.id === c.currentTeamId);
                return `
                  <tr>
                    <td><b>${p?.name || '?'}</b></td>
                    <td>${c.type === 'loan' ? 'PRÉSTAMO' : 'PERMANENTE'}</td>
                    <td>${origin?.name || '—'} → ${target?.name || '—'}</td>
                    <td><span class="badge">${c.terminationReason || c.status}</span></td>
                    <td>${new Date(c.terminatedAt || c.createdAt).toLocaleDateString()}</td>
                  </tr>
                `;
              }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted)">No hay historial</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
}

export function bindContractsEvents(){
  document.querySelectorAll('[data-contract-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.contractTab;
      document.querySelectorAll('[data-contract-tab]').forEach(b => b.classList.toggle('active', b === btn));
      const db = getDB();
      const alerts = getContractAlerts();
      const activeContracts = db.contracts.filter(c => c.status === 'active' || c.status === 'awaiting_return');
      const pastContracts = db.contracts.filter(c => c.status !== 'active' && c.status !== 'awaiting_return').sort((a,b) => (b.terminatedAt || 0) - (a.terminatedAt || 0));
      document.getElementById('contractsContent').innerHTML = renderTab(activeTab, alerts, activeContracts, pastContracts, db);
      bindResolveButtons();
    });
  });

  bindResolveButtons();
}

function bindResolveButtons(){
  document.querySelectorAll('[data-resolve-return]').forEach(btn => {
    btn.addEventListener('click', () => {
      try {
        resolveAwaitingReturn(btn.dataset.resolveReturn);
        toast('✅ Retorno resuelto con éxito', 'success');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  });
}
