import { getDB, mutate } from '../services/storage.js';
import { uid } from '../data/database.js';
import { openModal, closeTopModal, toast } from '../services/ui.js';
import { generateTransferBanner } from '../services/banner.js';

let _mktDiv  = 'all';
let _mktType = 'all';

export function marketView(){
  const db = getDB();
  const log = [...(db.transferLog || [])].sort((a, b) => b.date - a.date);

  const filtered = log.filter(m => {
    if (_mktDiv !== 'all' && m.toDivisionId !== _mktDiv && m.fromDivisionId !== _mktDiv) return false;
    if (_mktType !== 'all' && m.type !== _mktType) return false;
    return true;
  });

  return `
    <div class="page-head">
      <h1 class="page-title">TRANSFER MARKET</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select class="select" id="mkt-fdiv" style="width:auto">
          <option value="all">Todas las divisiones</option>
          ${db.divisions.map(d => `<option value="${d.id}" ${_mktDiv === d.id ? 'selected' : ''}>${d.tier || '?'}ª · ${esc(d.name)}</option>`).join('')}
        </select>
        <select class="select" id="mkt-ftype" style="width:auto">
          <option value="all">Todos los tipos</option>
          <option value="transfer" ${_mktType === 'transfer' ? 'selected' : ''}>Fichajes</option>
          <option value="free" ${_mktType === 'free' ? 'selected' : ''}>Agentes Libres</option>
          <option value="pending" ${_mktType === 'pending' ? 'selected' : ''}>Pendientes</option>
        </select>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title"><span class="dot">◆</span>HISTORIAL DE MOVIMIENTOS</div>
        <span class="card-sub">${filtered.length} movimientos</span>
      </div>
      <div class="table-wrap scrollable-table">
        <table class="ztable market-table">
          <thead>
            <tr>
              <th>FECHA</th><th>JUGADOR</th><th>ORIGEN → DESTINO</th>
              <th class="num">TIPO</th><th class="num">ACCIÓN</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length === 0
              ? '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">Sin movimientos registrados</td></tr>'
              : filtered.map(m => {
                  const player = db.players.find(p => p.id === m.playerId) || {};
                  const fromTeam = db.teams.find(t => t.id === m.fromTeamId);
                  const toTeam = db.teams.find(t => t.id === m.toTeamId);
                  const typeLabel = m.type === 'transfer' ? 'FICHAJE' : m.type === 'free' ? 'AGENTE LIBRE' : 'PENDIENTE';
                  return `
                    <tr>
                      <td style="font-size:11px;color:var(--muted)">${new Date(m.date).toLocaleDateString()}</td>
                      <td>
                        <div class="player-cell">
                          ${player.profilePicture
                            ? `<img src="${player.profilePicture}" class="player-cell-avatar" alt="">`
                            : `<div class="player-cell-avatar player-cell-avatar-empty">${esc((player.name || '?').slice(0,2).toUpperCase())}</div>`}
                          <span class="player-cell-name">${esc(player.name || '?')}</span>
                        </div>
                      </td>
                      <td>
                        <div style="display:flex;align-items:center;flex-wrap:wrap">
                          <span class="market-team-pill">${fromTeam?.logo ? `<img src="${fromTeam.logo}" alt="">` : ''}${esc(m.fromTeamName || 'Sin equipo')}</span>
                          <span class="market-arrow">→</span>
                          <span class="market-team-pill">${toTeam?.logo ? `<img src="${toTeam.logo}" alt="">` : ''}${esc(m.toTeamName || 'Agente libre')}</span>
                        </div>
                      </td>
                      <td class="num"><span class="market-type-chip ${m.type}">${typeLabel}</span></td>
                      <td class="num"><button class="btn btn-sm btn-primary" data-mkt-news="${m.id}">📰 NOTICIA</button></td>
                    </tr>`;
                }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export function bindMarketEvents(){
  const fd = document.getElementById('mkt-fdiv');
  if (fd) fd.addEventListener('change', () => {
    _mktDiv = fd.value;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  const ft = document.getElementById('mkt-ftype');
  if (ft) ft.addEventListener('change', () => {
    _mktType = ft.value;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  document.querySelectorAll('[data-mkt-news]').forEach(btn => {
    btn.addEventListener('click', () => createNewsFromTransfer(btn.dataset.mktNews));
  });
}

async function createNewsFromTransfer(movId){
  const db = getDB();
  const mov = db.transferLog.find(m => m.id === movId);
  if (!mov) return toast('Movimiento no encontrado', 'error');
  const player = db.players.find(p => p.id === mov.playerId);
  if (!player) return toast('Jugador no encontrado', 'error');
  const fromTeam = db.teams.find(t => t.id === mov.fromTeamId);
  const toTeam = db.teams.find(t => t.id === mov.toTeamId);

  let banner = '';
  try { banner = await generateTransferBanner(player, fromTeam, toTeam); }
  catch(e){ console.warn('[ZENITH] banner error', e); }

  openModal({
    id: 'mkt-news-' + movId,
    title: 'NUEVA NOTICIA · FICHAJE',
    wide: true,
    body: `
      <div class="field">
        <label>Banner auto-generado</label>
        ${banner ? `<img src="${banner}" class="transfer-banner-preview" alt="">` : '<div style="color:var(--muted);font-size:12px">No se pudo generar</div>'}
        <input type="hidden" id="mkt-news-banner" value="${banner}">
      </div>
      <div class="field">
        <label>Título</label>
        <input class="input" id="mkt-news-title" value="BREAKING: ${esc(player.name)} fue transferido de ${esc(mov.fromTeamName || 'Agente Libre')} a ${esc(mov.toTeamName || 'Agente Libre')}">
      </div>
      <div class="row">
        <div class="field">
          <label>Categoría</label>
          <select class="select" id="mkt-news-cat">
            <option selected>TRANSFERENCIAS</option>
            <option>GENERAL</option><option>COMPETICIÓN</option><option>STATS</option>
          </select>
        </div>
        <div class="field">
          <label>Fecha</label>
          <input class="input" type="date" id="mkt-news-date" value="${new Date().toISOString().slice(0,10)}">
        </div>
      </div>
      <div class="field">
        <label>Contenido</label>
        <textarea class="textarea" id="mkt-news-body" rows="8"></textarea>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="mkt-save-news">PUBLICAR</button>
    `,
    onMount: root => {
      root.querySelector('#mkt-save-news').addEventListener('click', () => {
        try {
          const title = root.querySelector('#mkt-news-title').value.trim();
          if (!title) return toast('Falta el título', 'error');
          const id = uid('news');
          mutate(d => {
            d.news.push({
              id, title,
              body: root.querySelector('#mkt-news-body').value,
              category: root.querySelector('#mkt-news-cat').value,
              featured: false,
              banner: root.querySelector('#mkt-news-banner').value,
              date: root.querySelector('#mkt-news-date').value,
              published: true
            });
          });
          toast('Noticia publicada', 'success');
          closeTopModal();
        } catch(e){
          console.error(e);
          toast('Error: ' + e.message, 'error');
        }
      });
    }
  });
}

function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}