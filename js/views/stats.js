import { aggregatePlayerStats, computeRankings } from '../services/statistics.js';
import { getDB } from '../services/storage.js';
import { state } from '../state.js';
import { getNationFlag, getRankColor } from '../data/nations.js';

let activeTab = 'goals';

export function statsView(){
  const db = getDB();
  const activeDivisionId = state.divisionId;
  const allStats = aggregatePlayerStats({ divisionId: activeDivisionId }).filter(p => p.games > 0);
  const rankings = computeRankings(allStats);

  const tabs = [
    { id:'goals',     label:'⚽ Goleadores' },
    { id:'assists',   label:'🎯 Asistencias' },
    { id:'saves',     label:'🧤 Porteros' },
    { id:'efficiency',label:'🎯 Eficiencia' },
    { id:'killers',   label:'💀 Top Killers' },
    { id:'defenders', label:'🛡️ Top Defenders' },
    { id:'pig',       label:'📊 PIG' }
  ];

  return `
    <div class="page-head"><h1 class="page-title">STATS</h1></div>
    <div class="stats-tabs">
      ${tabs.map(t => `<button class="stats-tab ${t.id===activeTab?'active':''}" data-stats-tab="${t.id}">${t.label}</button>`).join('')}
    </div>
    <div id="statsContent">
      ${renderStatsTab(activeTab, allStats, rankings, db)}
    </div>
  `;
}

function renderStatsTab(tab, allStats, rankings, db){
  let sorted = [...allStats];
  let headerLabel = '', headerKey = '';
  switch(tab){
    case 'goals':       sorted.sort((a,b)=>b.goals-a.goals);     headerLabel='Goles';         headerKey='goals'; break;
    case 'assists':     sorted.sort((a,b)=>b.assists-a.assists); headerLabel='Asistencias';   headerKey='assists'; break;
    case 'saves':       sorted.sort((a,b)=>b.saves-a.saves);     headerLabel='Salvadas';      headerKey='saves'; break;
    case 'efficiency':  sorted = sorted.filter(p=>p.games>=3).sort((a,b)=>b.efficiency-a.efficiency); headerLabel='Eficiencia'; headerKey='efficiency'; break;
    case 'killers':
      sorted = sorted.filter(p=>p.games>=3)
        .map(p => ({ ...p, killerScore: +(p.efficiencyOffense * Math.log(1+p.games)).toFixed(1) }))
        .sort((a,b)=>b.killerScore-a.killerScore);
      headerLabel='Killer Score'; headerKey='killerScore'; break;
    case 'defenders':
      sorted = sorted.filter(p=>p.games>=3)
        .map(p => ({ ...p, defenderScore: +(p.efficiencyDefense * Math.log(1+p.games)).toFixed(1) }))
        .sort((a,b)=>b.defenderScore-a.defenderScore);
      headerLabel='Defender Score'; headerKey='defenderScore'; break;
    case 'pig':         sorted.sort((a,b)=>b.pig-a.pig);         headerLabel='PIG';           headerKey='pig'; break;
  }

  const trendColor = { '▲':'var(--success)', '▼':'var(--danger)', '—':'var(--muted)' };

  return `
    <div class="card">
      <div class="card-header">
        <div class="card-title"><span class="dot">◆</span>RANKING · ${headerLabel.toUpperCase()}</div>
        <span class="card-sub">${sorted.length} jugadores</span>
      </div>
      <div class="table-wrap scrollable-table">
        <table class="ztable">
          <thead>
            <tr>
              <th>#</th><th>JUGADOR</th><th>EQUIPO</th>
              <th class="num">PJ</th>
              <th class="num">${headerLabel}</th>
              <th class="num">G/PJ</th>
              <th class="num">EF%</th>
              <th class="num">PIG</th>
              <th class="num">Rank</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map((p,i)=>{
              const playerData = db.players.find(x=>x.id===p.id) || {};
              const rankColor = playerData.rank ? getRankColor(playerData.rank, playerData.rankLevel) : 'var(--silver)';
              const flag = playerData.nationalityCode ? getNationFlag(playerData.nationalityCode) : '';
              const mainVal = tab==='pig' ? p.pig.toFixed(1) : (p[headerKey]||0);
              return `
                <tr data-player-profile="${p.id}" style="cursor:pointer">
                  <td><span class="pos-num ${i<3?'top':''}">${i+1}</span></td>
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
                  <td class="num" style="color:var(--accent);font-weight:600">${mainVal}</td>
                  <td class="num">${p.goalsPerMatch.toFixed(2)}</td>
                  <td class="num">${p.efficiency}%</td>
                  <td class="num">
                    ${p.pig.toFixed(1)}
                    <span style="color:${trendColor[p.pigTrend||'—']};font-weight:700;margin-left:4px">${p.pigTrend||'—'}</span>
                  </td>
                  <td class="num" style="color:var(--muted);font-size:11px">#${i+1}</td>
                </tr>`;
            }).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--muted)">Sin datos todavía</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export function bindStatsEvents(){
  document.querySelectorAll('[data-stats-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.statsTab;
      document.querySelectorAll('[data-stats-tab]').forEach(b => b.classList.toggle('active', b===btn));
      const db = getDB();
      const allStats = aggregatePlayerStats({ divisionId: state.divisionId }).filter(p => p.games > 0);
      const rankings = computeRankings(allStats);
      document.getElementById('statsContent').innerHTML = renderStatsTab(activeTab, allStats, rankings, db);
      bindRowClicks();
    });
  });
  bindRowClicks();
}

function bindRowClicks(){
  document.querySelectorAll('#statsContent [data-player-profile]').forEach(row => {
    row.addEventListener('click', () => {
      const pid = row.dataset.playerProfile;
      if(pid) location.hash = '#/players/' + pid;
    });
  });
}