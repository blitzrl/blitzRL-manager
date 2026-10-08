import { aggregatePlayerStats } from '../services/statistics.js';
import { getDB } from '../services/storage.js';
import { state } from '../state.js';
import { getNationFlag, getRankColor } from '../data/nations.js';

export function ballonDorView(){
  const db = getDB();
  const activeDivisionId = state.divisionId;
  const stats = aggregatePlayerStats({ divisionId: activeDivisionId })
    .filter(p => p.games > 0)
    .sort((a,b) => b.pig - a.pig);

  const top3 = stats.slice(0,3);
  const rest = stats.slice(3);
  const trendColor = { '▲':'var(--success)', '▼':'var(--danger)', '—':'var(--muted)' };

  return `
    <div class="page-head">
      <h1 class="page-title" style="color:var(--gold);letter-spacing:.24em">ZENITH BALLON D'OR</h1>
    </div>

    <div class="bdor-podium-3">
      ${top3.map((p,i)=>{
        const playerData = db.players.find(x => x.id === p.id) || {};
        const medal = i===0?'🥇':i===1?'🥈':'🥉';
        const medalColor = i===0?'var(--gold)':i===1?'#C0C0C0':'#CD7F32';
        const flag = playerData.nationalityCode ? getNationFlag(playerData.nationalityCode) : '';
        const rankColor = getRankColor(playerData.rank, playerData.rankLevel);
        return `
          <div class="bdor-podium-card ${i===0?'gold':i===1?'silver':'bronze'}" data-player-profile="${p.id}">
            <div class="bdor-podium-medal">${medal}</div>
            <div class="bdor-podium-avatar">
              ${playerData.profilePicture
                ? `<img src="${playerData.profilePicture}">`
                : `<div class="bdor-podium-avatar-fallback">${(p.name||'?').slice(0,2).toUpperCase()}</div>`}
            </div>
            <div class="bdor-podium-name" style="color:${rankColor}">${p.name} ${flag}</div>
            <div class="bdor-podium-team">${p.teamName}</div>
            <div class="bdor-podium-pig" style="color:${medalColor}">
              ${p.pig.toFixed(1)}
              <span style="color:${trendColor[p.pigTrend||'—']};font-size:18px;vertical-align:super">${p.pigTrend||'—'}</span>
            </div>
            <div class="bdor-podium-label">PIG</div>
          </div>`;
      }).join('') || '<div class="card" style="grid-column:1/-1;text-align:center">Sin datos todavía</div>'}
    </div>

    <div class="card" style="margin-top:22px">
      <div class="card-header">
        <div class="card-title" style="color:var(--gold)"><span class="dot" style="color:var(--gold)">◆</span>RANKING COMPLETO</div>
        <span class="card-sub">${stats.length} jugadores ordenados por PIG</span>
      </div>
      <div class="table-wrap">
        <table class="ztable">
          <thead>
            <tr><th>#</th><th>JUGADOR</th><th>EQUIPO</th><th class="num">PJ</th><th class="num">PIG</th><th class="num">Trend</th></tr>
          </thead>
          <tbody>
            ${rest.map((p,i)=>{
              const playerData = db.players.find(x => x.id === p.id) || {};
              const rankColor = getRankColor(playerData.rank, playerData.rankLevel);
              const flag = playerData.nationalityCode ? getNationFlag(playerData.nationalityCode) : '';
              return `
                <tr data-player-profile="${p.id}" style="cursor:pointer">
                  <td><span class="pos-num">${i+4}</span></td>
                  <td>
                    <div class="player-cell">
                      ${playerData.profilePicture
                        ? `<img src="${playerData.profilePicture}" class="player-cell-avatar">`
                        : `<div class="player-cell-avatar player-cell-avatar-empty">${(p.name||'?').slice(0,2).toUpperCase()}</div>`}
                      <span class="player-cell-name" style="color:${rankColor}">${p.name}</span>
                      ${flag ? `<span class="player-cell-flag">${flag}</span>` : ''}
                    </div>
                  </td>
                  <td style="color:var(--muted)">${p.teamName}</td>
                  <td class="num">${p.games}</td>
                  <td class="num" style="color:var(--gold);font-weight:600">${p.pig.toFixed(1)}</td>
                  <td class="num" style="color:${trendColor[p.pigTrend||'—']};font-weight:700">${p.pigTrend||'—'}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export function bindBallonDorEvents(){
  document.querySelectorAll('[data-player-profile]').forEach(el => {
    el.addEventListener('click', () => {
      const pid = el.dataset.playerProfile;
      if(pid) location.hash = '#/players/' + pid;
    });
  });
}