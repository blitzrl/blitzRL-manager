import { getDB, mutate } from '../services/storage.js';
import { uid } from '../data/database.js';
import { openModal, closeTopModal, toast } from '../services/ui.js';
import { generateTransferBanner } from '../services/banner.js';
import { openTeamForm } from './teams.js';

let _mktDiv  = 'all';
let _mktType = 'all';
let _activeTab = 'players';

export function marketView(){
  const db = getDB();

  return `
    <div class="page-head">
      <h1 class="page-title">TRANSFER MARKET</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select class="select" id="mkt-fdiv" style="width:auto">
          <option value="all">Todas las divisiones</option>
          ${db.divisions.map(d => `<option value="${d.id}" ${_mktDiv === d.id ? 'selected' : ''}>${d.tier || '?'}ª · ${esc(d.name)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="stats-tabs" style="margin-bottom:18px">
      <button class="stats-tab ${_activeTab === 'players' ? 'active' : ''}" data-mkt-tab="players">👤 Jugadores</button>
      <button class="stats-tab ${_activeTab === 'staff' ? 'active' : ''}" data-mkt-tab="staff">🧑‍💼 Staff Técnico</button>
    </div>

    <div id="marketContent">
      ${_activeTab === 'players' ? renderPlayersMarket(db) : renderStaffMarket(db)}
    </div>
  `;
}

function renderPlayersMarket(db){
  const log = [...(db.transferLog || [])].sort((a, b) => b.date - a.date);
  const filtered = log.filter(m => {
    if (_mktDiv !== 'all' && m.toDivisionId !== _mktDiv && m.fromDivisionId !== _mktDiv) return false;
    if (_mktType !== 'all' && m.type !== _mktType) return false;
    return true;
  });

  return `
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
              <th class="num">TIPO</th><th class="num">PRECIO</th><th class="num">ACCIÓN</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length === 0
              ? '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">Sin movimientos registrados</td></tr>'
              : filtered.map(m => {
                  const player = db.players.find(p => p.id === m.playerId) || {};
                  const fromTeam = db.teams.find(t => t.id === m.fromTeamId);
                  const toTeam = db.teams.find(t => t.id === m.toTeamId);
                  
                  let typeLabel = 'FICHAJE';
                  let chipClass = m.type;
                  if (m.type === 'free') typeLabel = 'AGENTE LIBRE';
                  if (m.type === 'loan') typeLabel = 'PRÉSTAMO';
                  if (m.type === 'pending') typeLabel = 'PENDIENTE';
                  if (m.type === 'portal_transfer') { typeLabel = 'FICHAJE (PORTAL)'; chipClass = 'transfer'; } // <-- NUEVO

                  const priceVal = m.price;
                  const priceStr = priceVal !== undefined ? `$${priceVal.toLocaleString()}` : '—';

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
                      <td class="num"><span class="market-type-chip ${chipClass}">${typeLabel}</span></td>
                      <td class="num" style="color:var(--gold);font-weight:600">${priceStr}</td>
                      <td class="num"><button class="btn btn-sm btn-primary" data-mkt-news="${m.id}">📰 NOTICIA</button></td>
                    </tr>`;
                }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderStaffMarket(db){
  const coaches = db.coaches || [];
  
  return `
    <div class="grid grid-3">
      ${coaches.map(c => {
        const team = db.teams.find(t => t.id === c.teamId);
        return `
          <div class="card">
            <div style="display:flex; gap:14px; align-items:center; margin-bottom:14px">
              <div class="team-logo-box-lg" style="border-radius:50%">
                ${c.profilePicture ? `<img src="${c.profilePicture}" class="team-logo-img" style="border-radius:50%">` : '<span class="team-logo-fallback">👤</span>'}
              </div>
              <div>
                <div style="font-size:16px; font-weight:600; color:var(--silver-light)">${esc(c.name)}</div>
                <div style="font-size:12px; color:var(--muted); margin-top:2px">${c.roleType === 'coach' ? 'Head Coach' : 'Asistente'}</div>
                ${team ? `<div class="chip chip-accent" style="margin-top:6px;font-size:10px">${esc(team.name)}</div>` : `<div class="chip" style="margin-top:6px;font-size:10px;color:var(--gold)">AGENTE LIBRE</div>`}
              </div>
            </div>
            <div class="divider"></div>
            <div class="card-actions" style="justify-content:flex-end">
              <button class="btn btn-sm btn-primary" data-transfer-staff="${c.id}">TRANSFERIR</button>
            </div>
          </div>
        `;
      }).join('') || '<div class="card" style="grid-column:1/-1;text-align:center;padding:40px;color:var(--muted)">No hay staff registrado.</div>'}
    </div>
  `;
}

export function bindMarketEvents(){
  document.querySelectorAll('[data-mkt-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTab = btn.dataset.mktTab;
      document.querySelectorAll('[data-mkt-tab]').forEach(b => b.classList.toggle('active', b === btn));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  });

  const fd = document.getElementById('mkt-fdiv');
  if (fd) fd.addEventListener('change', () => {
    _mktDiv = fd.value;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

  document.querySelectorAll('[data-mkt-news]').forEach(btn => {
    btn.addEventListener('click', () => createNewsFromTransfer(btn.dataset.mktNews));
  });

  document.querySelectorAll('[data-transfer-staff]').forEach(btn => {
    btn.addEventListener('click', () => openStaffTransferModal(btn.dataset.transferStaff));
  });
}

function openStaffTransferModal(coachId) {
  const db = getDB();
  const coach = db.coaches.find(c => c.id === coachId);
  if (!coach) return;

  const currentTeam = db.teams.find(t => t.id === coach.teamId);

  openModal({
    id: 'transfer-staff-' + coachId,
    title: 'TRANSFERIR STAFF',
    body: `
      <div style="margin-bottom:14px;color:var(--muted);font-size:12px">
        Coach actual: <strong style="color:var(--silver-light)">${esc(coach.name)}</strong>
      </div>
      <div class="field">
        <label>Equipo Destino</label>
        <select class="select" id="staff-target">
          <option value="">— Agente Libre —</option>
          ${db.teams.filter(t => t.id !== currentTeam?.id).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
        </select>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="confirmStaffTransfer">CONFIRMAR</button>
    `,
    onMount: root => {
      root.querySelector('#confirmStaffTransfer').addEventListener('click', () => {
        const targetId = root.querySelector('#staff-target').value;
        
        mutate(d => {
          const c = d.coaches.find(x => x.id === coachId);
          if (!c) return;
          
          if (c.teamId) {
            const oldTeam = d.teams.find(t => t.id === c.teamId);
            if (oldTeam) {
              if (oldTeam.coach === c.name) oldTeam.coach = '';
              if (oldTeam.assistant === c.name) oldTeam.assistant = '';
            }
          }
          
          c.teamId = targetId || null;
          
          if (targetId) {
            const newTeam = d.teams.find(t => t.id === targetId);
            if (newTeam) {
              if (c.roleType === 'coach') newTeam.coach = c.name;
              if (c.roleType === 'assistant') newTeam.assistant = c.name;
            }
          }
        });
        
        toast('Staff transferido', 'success');
        closeTopModal();
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    }
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
  
  const price = mov.price !== undefined ? mov.price : 0;
  const priceStr = price > 0 ? `$${price.toLocaleString()}` : 'Agente Libre';

  let banner = '';
  try { banner = await generateTransferBanner(player, fromTeam, toTeam, price); }
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
        <input class="input" id="mkt-news-title" value="BREAKING: ${esc(player.name)} ficha por ${esc(mov.toTeamName || 'Agente Libre')}">
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
        <textarea class="textarea" id="mkt-news-body" rows="8">El jugador ${esc(player.name)} ha sido transferido de ${esc(mov.fromTeamName || 'Agente Libre')} a ${esc(mov.toTeamName || 'Agente Libre')}.\n\nEl traspaso se ha cerrado por un valor de ${priceStr}.</textarea>
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
