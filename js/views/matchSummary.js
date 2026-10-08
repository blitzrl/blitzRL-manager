// ============================================================
// MATCH SUMMARY — Modal con tabs por partida (regular + playoffs)
// ============================================================
import { getDB } from '../services/storage.js';
import { openModal } from '../services/ui.js';

export function openMatchSummary(match, options = {}){
  const db = getDB();
  const A = db.teams.find(t => t.id === match.teamAId) || { name: '?', logo: '' };
  const B = db.teams.find(t => t.id === match.teamBId) || { name: '?', logo: '' };
  const games = match.games || [];

  if(games.length === 0){
    return openModal({
      id: 'match-summary-' + match.id,
      title: 'SIN PARTIDAS',
      body: '<div style="padding:20px;text-align:center;color:var(--muted)">Este partido no tiene partidas reportadas.</div>',
      footer: '<button class="btn btn-ghost" data-close>CERRAR</button>'
    });
  }

  let totalA = 0, totalB = 0;
  games.forEach(g => {
    if(g.scoreA > g.scoreB) totalA++;
    else if(g.scoreB > g.scoreA) totalB++;
  });

  const format = match.format || (options.defaultFormat) || 'BO3';
  const title = options.title || 'RESUMEN DEL PARTIDO';

  // Render del modal
  openModal({
    id: 'match-summary-' + match.id,
    title: escapeHtml(title),
    wide: true,
    body: `
      <div class="match-summary">
        <!-- Hero -->
        <div class="ms-hero">
          <div class="ms-team ms-team-a">
            ${A.logo ? `<img src="${A.logo}" class="ms-team-logo">` : `<div class="ms-team-logo ms-team-logo-empty">◆</div>`}
            <div class="ms-team-name">${escapeHtml(A.name)}</div>
          </div>
          <div class="ms-score">
            <div class="ms-score-line">
              <span class="ms-score-value">${totalA}</span>
              <span class="ms-score-sep">–</span>
              <span class="ms-score-value">${totalB}</span>
            </div>
            <div class="ms-score-meta">SERIE ${escapeHtml(format)} · ${games.length} PARTIDA${games.length !== 1 ? 'S' : ''}</div>
          </div>
          <div class="ms-team ms-team-b">
            ${B.logo ? `<img src="${B.logo}" class="ms-team-logo">` : `<div class="ms-team-logo ms-team-logo-empty">◆</div>`}
            <div class="ms-team-name">${escapeHtml(B.name)}</div>
          </div>
        </div>

        <!-- Tabs -->
        <div class="ms-tabs" id="msTabs">
          ${games.map((g, i) => `
            <button class="ms-tab ${i === 0 ? 'active' : ''}" data-ms-tab="${i}">
              PARTIDO ${i + 1} · ${g.scoreA}-${g.scoreB}
            </button>
          `).join('')}
          <button class="ms-tab ms-tab-total" data-ms-tab="total">Σ SUMA TOTAL</button>
        </div>

        <!-- Body -->
        <div class="ms-body" id="msBody"></div>
      </div>
    `,
    footer: `<button class="btn btn-ghost" data-close>CERRAR</button>`,
    onMount: root => {
      const tabsEl = root.querySelector('#msTabs');
      const bodyEl = root.querySelector('#msBody');
      const rendered = new Set();

      function renderTab(tabId){
        if(tabId === 'total'){
          bodyEl.innerHTML = renderTotal(games, A, B, db);
        } else {
          const idx = +tabId;
          const g = games[idx];
          if(!g) return;
          bodyEl.innerHTML = renderGame(g, idx, A, B, db);
        }
      }

      tabsEl.addEventListener('click', e => {
        const t = e.target.closest('[data-ms-tab]');
        if(!t) return;
        tabsEl.querySelectorAll('.ms-tab').forEach(x => x.classList.toggle('active', x === t));
        renderTab(t.dataset.msTab);
      });

      renderTab('0');
    }
  });
}

// ============================================================
// RENDER DE UNA PARTIDA
// ============================================================
function renderGame(g, idx, A, B, db){
  const playersA = (g.players || []).filter(p => p.teamId === A.id);
  const playersB = (g.players || []).filter(p => p.teamId === B.id);
  const winnerIsA = g.scoreA > g.scoreB;

  return `
    <div class="ms-body-title">
      PARTIDO ${idx + 1} · <span style="color:${winnerIsA ? 'var(--success)' : 'var(--danger)'}">${g.scoreA}-${g.scoreB}</span>
    </div>
    <div class="ms-grid">
      ${renderTeamBlock(A, playersA, g.scoreA, winnerIsA, db)}
      ${renderTeamBlock(B, playersB, g.scoreB, !winnerIsA, db)}
    </div>
  `;
}

function renderTeamBlock(team, players, score, isWinner, db){
  return `
    <div class="ms-team-block ${isWinner ? 'winner' : 'loser'}">
      <div class="ms-team-block-head">
        <span class="ms-team-block-score">${score}</span>
        <span class="ms-team-block-name">${escapeHtml(team.name)}</span>
        ${isWinner ? '<span class="ms-team-block-check">✓</span>' : ''}
      </div>
      <table class="ms-table">
        <thead>
          <tr>
            <th>JUGADOR</th>
            <th class="num">G</th>
            <th class="num">A</th>
            <th class="num">S</th>
            <th class="num">T</th>
          </tr>
        </thead>
        <tbody>
          ${players.map(p => {
            const player = db.players.find(x => x.id === p.playerId);
            const name = player?.name || '?';
            return `<tr>
              <td class="ms-td-name">${escapeHtml(name)}</td>
              <td class="num">${p.goals || 0}</td>
              <td class="num">${p.assists || 0}</td>
              <td class="num">${p.saves || 0}</td>
              <td class="num">${p.shots || 0}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted);font-size:11px">Sin datos</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

// ============================================================
// RENDER DEL TOTAL
// ============================================================
function renderTotal(games, A, B, db){
  // Agregar stats por jugador
  const aggA = new Map(); // playerId -> { goals, assists, saves, shots }
  const aggB = new Map();
  let totalA = 0, totalB = 0;

  games.forEach(g => {
    if(g.scoreA > g.scoreB) totalA++;
    else if(g.scoreB > g.scoreA) totalB++;

    (g.players || []).forEach(p => {
      const isA = p.teamId === A.id;
      const map = isA ? aggA : aggB;
      const cur = map.get(p.playerId) || { goals: 0, assists: 0, saves: 0, shots: 0 };
      cur.goals   += p.goals   || 0;
      cur.assists += p.assists || 0;
      cur.saves   += p.saves   || 0;
      cur.shots   += p.shots   || 0;
      map.set(p.playerId, cur);
    });
  });

  function rowsFromMap(map){
    if(map.size === 0) return [];
    return [...map.entries()].map(([pid, s]) => {
      const player = db.players.find(x => x.id === pid);
      return { playerId: pid, name: player?.name || '?', ...s };
    });
  }

  const rowsA = rowsFromMap(aggA);
  const rowsB = rowsFromMap(aggB);

  return `
    <div class="ms-body-title">
      Σ SUMA TOTAL · ${games.length} PARTIDA${games.length !== 1 ? 'S' : ''}
    </div>
    <div class="ms-grid">
      ${renderTotalTeamBlock(A, rowsA, totalA, totalA > totalB)}
      ${renderTotalTeamBlock(B, rowsB, totalB, totalB > totalA)}
    </div>
  `;
}

function renderTotalTeamBlock(team, rows, score, isWinner){
  return `
    <div class="ms-team-block ${isWinner ? 'winner' : 'loser'}">
      <div class="ms-team-block-head">
        <span class="ms-team-block-score">${score}</span>
        <span class="ms-team-block-name">${escapeHtml(team.name)}</span>
        ${isWinner ? '<span class="ms-team-block-check">✓</span>' : ''}
      </div>
      <table class="ms-table">
        <thead>
          <tr>
            <th>JUGADOR</th>
            <th class="num">G</th>
            <th class="num">A</th>
            <th class="num">S</th>
            <th class="num">T</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td class="ms-td-name">${escapeHtml(r.name)}</td>
              <td class="num">${r.goals}</td>
              <td class="num">${r.assists}</td>
              <td class="num">${r.saves}</td>
              <td class="num">${r.shots}</td>
            </tr>
          `).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted);font-size:11px">Sin datos</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}