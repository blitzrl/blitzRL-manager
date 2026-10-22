import { getDB, mutate } from '../services/storage.js';
import { toast, confirmDialog } from '../services/ui.js';

export function contractsView() {
  const db = getDB();
  const contracts = (db.contracts || []).filter(c => c.status === 'active');

  return `
    <div class="page-head">
      <h1 class="page-title">CENTRO DE CONTRATOS</h1>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">CONTRATOS ACTIVOS</div>
        <span class="card-sub">${contracts.length} jugadores</span>
      </div>
      <div class="table-wrap">
        <table class="ztable">
          <thead>
            <tr>
              <th>JUGADOR</th>
              <th>EQUIPO</th>
              <th>TIPO</th>
              <th>VIGENCIA</th>
              <th>CLÁUSULAS CLAVE</th>
              <th class="num">ACCIONES</th>
            </tr>
          </thead>
          <tbody>
            ${contracts.map(c => {
              const player = db.players.find(p => p.id === c.playerId);
              const team = db.teams.find(t => t.id === c.teamId);
              
              let clausesText = [];
              if (c.clauses?.sellOnClauses?.length > 0) clausesText.push(`Futura Venta (${c.clauses.sellOnClauses[0].percentage}%)`);
              if (c.clauses?.performance?.enabled) clausesText.push('Rendimiento');
              if (c.clauses?.renewalOption?.enabled) clausesText.push(`Renovación ($${c.clauses.renewalOption.price})`);

              return `
                <tr>
                  <td>
                    <div style="display:flex; align-items:center; gap:10px">
                      ${player?.profilePicture ? `<img src="${player.profilePicture}" class="player-cell-avatar">` : `<div class="player-cell-avatar player-cell-avatar-empty">${(player?.name||'?').slice(0,2).toUpperCase()}</div>`}
                      <span style="font-weight:600; color:var(--silver-light)">${player?.name || '?'}</span>
                    </div>
                  </td>
                  <td>${team?.name || '?'}</td>
                  <td><span class="badge ${c.type === 'loan' ? 'badge-gold' : ''}">${c.type === 'loan' ? 'PRÉSTAMO' : 'FICHAJE'}</span></td>
                  <td>${c.durationSeasons} Temporada(s) ${c.durationMatchdays > 0 ? `+ ${c.durationMatchdays}J` : ''}</td>
                  <td style="font-size:11px; color:var(--muted)">${clausesText.join(' · ') || '—'}</td>
                  <td class="num" style="display:flex; gap:6px; justify-content:flex-end;">
                    <button class="btn btn-sm btn-danger" data-terminate="${c.id}">TERMINAR</button>
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

export function bindContractsEvents() {
  document.querySelectorAll('[data-terminate]').forEach(btn => {
    btn.addEventListener('click', () => {
      const contractId = btn.dataset.terminate;
      confirmDialog('¿Estás seguro de terminar este contrato? El jugador quedará como Agente Libre.', () => {
        try {
          mutate(d => {
            const c = d.contracts.find(x => x.id === contractId);
            if (!c) return;
            const p = d.players.find(x => x.id === c.playerId);
            const t = d.teams.find(x => x.id === c.teamId);
            
            if (t) t.roster = t.roster.filter(r => r.playerId !== c.playerId);
            if (p) { p.status = 'free_agent'; p.contractId = null; p.ownerTeamId = null; }
            
            c.status = 'terminated';
            c.terminationReason = 'admin_action';
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
