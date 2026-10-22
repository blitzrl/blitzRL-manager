import { getDB, mutate } from '../services/storage.js';
import { getContractAlerts, resolveAwaitingReturn } from '../services/contracts.js';
import { toast, confirmDialog } from '../services/ui.js';

let activeTab = 'alerts';

export function contractsView(){
  const db = getDB();
  const alerts = getContractAlerts();
  
  // Contratos de la nueva tabla (Fichajes y Préstamos con cláusulas)
  const activeContracts = (db.contracts || []).filter(c => c.status === 'active' || c.status === 'awaiting_return');
  const pastContracts = (db.contracts || []).filter(c => c.status !== 'active' && c.status !== 'awaiting_return').sort((a,b) => (b.terminatedAt || 0) - (a.terminatedAt || 0));

  return `
    <div class="page-head">
      <h1 class="page-title">CONTRATOS</h1>
    </div>

    <div class="stats-tabs">
      <button class="stats-tab ${activeTab === 'alerts' ? 'active' : ''}" data-contract-tab="alerts">
        🔔 Alertas ${alerts.length > 0 ? `<span class="badge badge-live" style="margin-left:6px">${alerts.length}</span>` : ''}
      </button>
      <button class="stats-tab ${activeTab === 'active' ? 'active' : ''}" data-contract-tab="active">✅ Contratos Activos (${activeContracts.length})</button>
      <button class="stats-tab ${activeTab === 'history' ? 'active' : ''}" data-contract-tab="history">📜 Histórico (${pastContracts.length})</button>
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
                <th>EQUIPO</th>
                <th>VIGENCIA</th>
                <th>ESTADO</th>
                <th class="num">ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              ${active.map(c => {
                const p = db.players.find(x => x.id === c.playerId);
                const team = db.teams.find(t => t.id === c.teamId);
                const origin = db.teams.find(t => t.id === c.ownerTeamId);
                
                let clausesText = [];
                if (c.clauses?.sellOnClauses?.length > 0) clausesText.push(`Futura Venta (${c.clauses.sellOnClauses[0].percentage}%)`);
                if (c.clauses?.performance?.enabled) clausesText.push('Rendimiento');
                if (c.clauses?.renewalOption?.enabled) clausesText.push(`Renovación ($${c.clauses.renewalOption.price})`);

                return `
                  <tr>
                    <td>
                      <div style="display:flex; align-items:center; gap:10px">
                        ${p?.profilePicture ? `<img src="${p.profilePicture}" class="player-cell-avatar">` : `<div class="player-cell-avatar player-cell-avatar-empty">${(p?.name||'?').slice(0,2).toUpperCase()}</div>`}
                        <span style="font-weight:600; color:var(--silver-light)">${p?.name || '?'}</span>
                      </div>
                    </td>
                    <td><span class="badge ${c.type === 'loan' ? 'badge-gold' : ''}">${c.type === 'loan' ? 'PRÉSTAMO' : 'FICHAJE'}</span></td>
                    <td>${team?.name || '—'} ${c.type === 'loan' && origin ? `(De ${origin.name})` : ''}</td>
                    <td>${c.durationSeasons} Temp. ${c.durationMatchdays > 0 ? `+ ${c.durationMatchdays}J` : ''}</td>
                    <td><span class="badge ${c.status === 'active' ? 'badge-win' : 'badge-live'}">${c.status.toUpperCase()}</span></td>
                    <td class="num" style="display:flex; gap:6px; justify-content:flex-end;">
                      ${c.status === 'awaiting_return' ? `<button class="btn btn-sm btn-primary" data-resolve-return="${c.id}">RESOLVER</button>` : ''}
                      <button class="btn btn-sm btn-danger" data-terminate="${c.id}" title="Romper contrato">TERMINAR</button>
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
                <th>EQUIPO</th>
                <th>MOTIVO FIN</th>
                <th>FECHA</th>
              </tr>
            </thead>
            <tbody>
              ${history.map(c => {
                const p = db.players.find(x => x.id === c.playerId);
                const team = db.teams.find(t => t.id === c.teamId);
                return `
                  <tr>
                    <td><b>${p?.name || '?'}</b></td>
                    <td>${c.type === 'loan' ? 'PRÉSTAMO' : 'FICHAJE'}</td>
                    <td>${team?.name || '—'}</td>
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
      const activeContracts = (db.contracts || []).filter(c => c.status === 'active' || c.status === 'awaiting_return');
      const pastContracts = (db.contracts || []).filter(c => c.status !== 'active' && c.status !== 'awaiting_return').sort((a,b) => (b.terminatedAt || 0) - (a.terminatedAt || 0));
      
      document.getElementById('contractsContent').innerHTML = renderTab(activeTab, alerts, activeContracts, pastContracts, db);
      bindContractActionButtons();
    });
  });

  bindContractActionButtons();
}

function bindContractActionButtons() {
  // Botón para resolver retornos pendientes
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

  // Botón para terminar un contrato a la fuerza
  document.querySelectorAll('[data-terminate]').forEach(btn => {
    btn.addEventListener('click', () => {
      confirmDialog('¿Estás seguro de terminar este contrato forzosamente? El jugador pasará a Agentes Libres.', () => {
        try {
          mutate(d => {
            const c = d.contracts.find(x => x.id === btn.dataset.terminate);
            if (!c) return;
            const p = d.players.find(x => x.id === c.playerId);
            const t = d.teams.find(x => x.id === c.teamId);
            
            if (t) t.roster = t.roster.filter(r => r.playerId !== c.playerId);
            if (p) { p.status = 'free_agent'; p.contractId = null; p.ownerTeamId = null; }
            
            c.status = 'terminated';
            c.terminationReason = 'admin_action';
            c.terminatedAt = Date.now();
          });
          toast('Contrato terminado', 'success');
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        } catch (e) {
          toast('Error: ' + e.message, 'error');
        }
      });
    });
  });
}
