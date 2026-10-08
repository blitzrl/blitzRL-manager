import { getDB } from '../services/storage.js';
import { aggregatePlayerStats, computeRankings } from '../services/statistics.js';
import { streakLabel } from '../services/pig.js';
import { getNationFlag, getNationName, platformIcon, getRankColor, getRankLabel } from '../data/nations.js';
import { openPlayerForm } from './teams.js';
import { openModal } from '../services/ui.js';
import { renderVitrina } from '../services/trophies.js';
import { state } from '../state.js';

export function playersView(params = []){
  const db = getDB();
  const playerId = params[0];
  if(playerId){
    const p = db.players.find(x => x.id === playerId);
    if(!p) return `<div class="card">Jugador no encontrado.</div>`;
    return playerProfileView(p);
  }

  const divisionId = state.divisionId;
  const division = db.divisions.find(d => d.id === divisionId);
  if(!division) return `<div class="card">Sin división activa.</div>`;

  // Equipos de la división activa
  const teamsInDiv = db.teams.filter(t => t.divisionId === divisionId);
  const teamByPlayerId = new Map();
  teamsInDiv.forEach(t => {
    (t.roster || []).forEach(r => {
      teamByPlayerId.set(r.playerId, t);
    });
  });

  // Agrupar jugadores por equipo (solo los que están en rosters de esta división)
  const groups = teamsInDiv.map(team => {
    const players = db.players.filter(p =>
      (team.roster || []).some(r => r.playerId === p.id)
    );
    return { team, players };
  }).filter(g => g.players.length > 0);

  // Jugadores huérfanos: tienen divisionId === division activa pero no están en ningún roster
  const orphans = db.players.filter(p =>
    p.divisionId === divisionId && !teamByPlayerId.has(p.id)
  );

  const totalPlayers = groups.reduce((sum, g) => sum + g.players.length, 0) + orphans.length;

  const allStats = aggregatePlayerStats({ divisionId });

  return `
    <div class="page-head">
      <h1 class="page-title">JUGADORES</h1>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="chip chip-accent">📍 ${division.tier || '?'}ª · ${esc(division.name)}</span>
        <span class="chip">${totalPlayers} jugadores</span>
      </div>
    </div>

    ${groups.length === 0 && orphans.length === 0 ? `
      <div class="card" style="text-align:center;padding:40px;color:var(--muted)">
        No hay jugadores en esta división.<br>
        <span style="font-size:11.5px">Añade jugadores a los equipos de ${esc(division.name)} para verlos aquí.</span>
      </div>
    ` : ''}

    ${groups.map(g => renderTeamGroup(g.team, g.players, allStats)).join('')}

    ${orphans.length > 0 ? renderOrphanGroup(orphans, allStats) : ''}
  `;
}

function renderTeamGroup(team, players, allStats){
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <div style="display:flex;align-items:center;gap:12px">
          ${team.logo
            ? `<img src="${team.logo}" style="width:32px;height:32px;object-fit:contain;background:var(--bg-elev);border-radius:8px;padding:3px;border:1px solid var(--border-soft)">`
            : `<div style="width:32px;height:32px;background:var(--bg-elev);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--accent);border:1px solid var(--border-soft)">◆</div>`}
          <div class="card-title" style="margin:0">${esc(team.name)}</div>
        </div>
        <span class="card-sub">${players.length} jugador${players.length !== 1 ? 'es' : ''}</span>
      </div>
      <div class="table-wrap">
        <table class="ztable">
          <thead>
            <tr>
              <th>#</th><th>JUGADOR</th><th>PLATAFORMA</th><th>RANGO</th>
              <th class="num">PJ</th><th class="num">G</th><th class="num">PIG</th><th class="num">🏆</th>
            </tr>
          </thead>
          <tbody>
            ${players.map((p, i) => playerRow(p, i, allStats)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderOrphanGroup(players, allStats){
  return `
    <div class="card" style="margin-bottom:16px;border-left:3px solid var(--muted)">
      <div class="card-header">
        <div class="card-title" style="color:var(--muted)"><span class="dot" style="color:var(--muted)">◆</span>AGENTES LIBRES (Sin equipo en esta división)</div>
        <span class="card-sub">${players.length}</span>
      </div>
      <div class="table-wrap">
        <table class="ztable">
          <thead><tr><th>#</th><th>JUGADOR</th><th>PLATAFORMA</th><th>RANGO</th><th class="num">PJ</th><th class="num">G</th><th class="num">PIG</th><th class="num">🏆</th></tr></thead>
          <tbody>
            ${players.map((p, i) => playerRow(p, i, allStats)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function playerRow(p, i, allStats){
  const s = allStats.find(x => x.id === p.id) || {};
  const flag = p.nationalityCode ? getNationFlag(p.nationalityCode) : '';
  const rankColor = getRankColor(p.rank, p.rankLevel);
  const rankLine = getRankLabel(p.rank, p.rankLevel, p.rankDivision);
  const trophies = p.trophies || [];
  return `<tr style="cursor:pointer" data-player-profile="${p.id}">
    <td>${i + 1}</td>
    <td>
      <div class="player-cell">
        ${p.profilePicture
          ? `<img src="${p.profilePicture}" class="player-cell-avatar">`
          : `<div class="player-cell-avatar player-cell-avatar-empty">${(p.name||'?').slice(0,2).toUpperCase()}</div>`}
        <span class="player-cell-name" style="color:${rankColor}">${esc(p.name)}</span>
        ${flag ? `<span class="player-cell-flag">${flag}</span>` : ''}
      </div>
    </td>
    <td style="color:var(--muted)"><i class="${platformIcon(p.platform)}"></i> ${esc(p.platform||'—')}</td>
    <td><span class="chip" style="color:${rankColor}">${esc(rankLine)}</span></td>
    <td class="num">${s.games||0}</td>
    <td class="num">${s.goals||0}</td>
    <td class="num" style="color:var(--accent);font-weight:600">${(s.pig||0).toFixed(1)}</td>
    <td class="num">${trophies.length > 0 ? `<span class="trophy-count" title="${trophies.length} trofeos">🏆 ${trophies.length}</span>` : '—'}</td>
  </tr>`;
}

// ============================================================
// PERFIL
// ============================================================
function playerProfileView(p){
  const db = getDB();
  const allStats = aggregatePlayerStats();
  const stats = allStats.find(s => s.id === p.id) || { games:0, goals:0, assists:0, saves:0, shots:0, pig:0, efficiency:0, efficiencyOffense:0, efficiencyDefense:0, goalsPerMatch:0, assistsPerMatch:0, savesPerMatch:0, shotsPerMatch:0, pigTrend:'—' };
  const rankings = computeRankings(allStats);
  const streak = streakLabel(stats);
  const flag = p.nationalityCode ? getNationFlag(p.nationalityCode) : '';
  const nationName = p.nationalityCode ? getNationName(p.nationalityCode) : '';
  const rankColor = getRankColor(p.rank, p.rankLevel);
  const rankLine = getRankLabel(p.rank, p.rankLevel, p.rankDivision);
  const trendColor = { '▲':'var(--success)', '▼':'var(--danger)', '—':'var(--muted)' };
  const trophies = p.trophies || [];

  let divId = p.divisionId;
  if(!divId){
    const t = db.teams.find(t => (t.roster || []).some(r => r.playerId === p.id));
    if(t) divId = t.divisionId;
  }
  const div = divId ? db.divisions.find(d => d.id === divId) : null;

  const rankOf = (map) => map?.get(p.id) || '—';
  const totalRanked = rankings.total || 1;

  return `
    <div class="back-row">
      <button class="btn btn-sm" onclick="location.hash='#/players'">← VOLVER</button>
      <button class="btn btn-sm btn-primary" id="btnEditPlayer">EDITAR</button>
    </div>

    <div class="card player-hero">
      <div class="player-hero-main">
        <div class="player-hero-avatar">
          ${p.profilePicture
            ? `<img src="${p.profilePicture}" class="player-hero-img">`
            : `<div class="player-hero-fallback">${(p.name||'?').slice(0,2).toUpperCase()}</div>`}
        </div>
        <div class="player-hero-info">
          <div class="player-hero-name" style="color:${rankColor}">${esc(p.name)} ${flag}</div>
          <div class="player-hero-chips">
            <span class="chip">${esc(stats.teamName || 'Agente libre')}</span>
            ${div ? `<span class="chip division-indicator">📍 ${div.tier || '?'}ª · ${esc(div.name)}</span>` : ''}
            ${p.nationalityCode ? `<span class="chip">${flag} ${esc(nationName)}</span>` : ''}
            <span class="chip"><i class="${platformIcon(p.platform)}"></i> ${esc(p.platform||'—')}</span>
            <span class="chip" style="color:${rankColor};border-color:${rankColor}44">${esc(rankLine)}</span>
            ${streak.label !== 'NEUTRA' ? `<span class="badge ${streak.cls}">${streak.label}</span>` : ''}
          </div>
          ${p.rlTracker
            ? `<a href="${p.rlTracker}" target="_blank" class="player-tracker-link"><i class="fa-solid fa-arrow-up-right-from-square"></i> RL TRACKER ↗</a>`
            : ''}
        </div>
        <div class="player-hero-pig">
          <div class="pig-label">ZENITH PIG</div>
          <div class="pig-value">
            ${(stats.pig||0).toFixed(1)}
            <span style="color:${trendColor[stats.pigTrend||'—']};font-size:22px;vertical-align:super">${stats.pigTrend||'—'}</span>
          </div>
          <div style="font-size:10px;color:var(--muted)">Rank #${rankOf(rankings.pig)} de ${totalRanked}</div>
        </div>
      </div>
    </div>

    <div class="grid grid-3" style="margin-top:18px">
      <div class="card">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>ATAQUE</div></div>
        <div class="kpi-strip">
          <div class="kpi"><div class="kpi-val">${stats.goals||0}</div><div class="kpi-lab">GOLES</div><div class="kpi-rank">Rank #${rankOf(rankings.goals)}</div></div>
          <div class="kpi"><div class="kpi-val">${stats.assists||0}</div><div class="kpi-lab">ASISTENCIAS</div><div class="kpi-rank">Rank #${rankOf(rankings.assists)}</div></div>
          <div class="kpi"><div class="kpi-val">${stats.shots||0}</div><div class="kpi-lab">TIROS</div><div class="kpi-rank">Rank #${rankOf(rankings.shots)}</div></div>
        </div>
        <div class="kpi-strip" style="grid-template-columns:repeat(2,1fr);margin-top:10px">
          <div class="kpi"><div class="kpi-val">${stats.goalsPerMatch.toFixed(2)}</div><div class="kpi-lab">G / PJ</div></div>
          <div class="kpi"><div class="kpi-val">${stats.efficiency}%</div><div class="kpi-lab">EFICIENCIA</div></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>DEFENSA</div></div>
        <div class="kpi-strip">
          <div class="kpi"><div class="kpi-val">${stats.saves||0}</div><div class="kpi-lab">SALVADAS</div><div class="kpi-rank">Rank #${rankOf(rankings.saves)}</div></div>
          <div class="kpi"><div class="kpi-val">${stats.savesPerMatch.toFixed(2)}</div><div class="kpi-lab">S / PJ</div></div>
          <div class="kpi"><div class="kpi-val">${stats.efficiencyDefense}%</div><div class="kpi-lab">EF. DEF</div></div>
        </div>
        <div class="kpi-strip" style="grid-template-columns:repeat(2,1fr);margin-top:10px">
          <div class="kpi"><div class="kpi-val">${stats.assistsPerMatch.toFixed(2)}</div><div class="kpi-lab">A / PJ</div></div>
          <div class="kpi"><div class="kpi-val">${stats.shotsPerMatch.toFixed(2)}</div><div class="kpi-lab">T / PJ</div></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>RESULTADOS</div></div>
        <div class="kpi-strip">
          <div class="kpi"><div class="kpi-val" style="color:var(--success)">${stats.wins||0}</div><div class="kpi-lab">VICTORIAS</div></div>
          <div class="kpi"><div class="kpi-val" style="color:var(--danger)">${stats.losses||0}</div><div class="kpi-lab">DERROTAS</div></div>
          <div class="kpi"><div class="kpi-val">${stats.series||0}</div><div class="kpi-lab">SERIES</div></div>
        </div>
      </div>
    </div>

    ${trophies.length > 0 ? `<div class="card" style="margin-top:18px">${renderVitrina(trophies)}</div>` : ''}

    <div class="card" style="margin-top:18px">
      <div class="card-header"><div class="card-title"><span class="dot">◆</span>HISTORIAL DE CARRERA</div></div>
      ${(p.history && p.history.length) ? p.history.map(h=>`
        <div class="history-row">
          <span style="color:var(--silver-light)">${esc(h.seasonName||'—')} · ${esc(h.divisionName||'—')}</span>
          <span style="color:var(--muted);font-size:12px">${esc(h.teamName||'—')} · ${esc(h.role||'—')}</span>
        </div>`).join('')
      : '<div style="color:var(--muted);font-size:12px">Sin historial registrado todavía.</div>'}
    </div>

    ${(p.careerSnapshots && p.careerSnapshots.length) ? `
      <div class="card" style="margin-top:18px">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>SNAPSHOTS DE CARRERA</div></div>
        ${[...p.careerSnapshots].reverse().map((snap, i)=>`
          <div class="history-row history-row-clickable" data-snapshot-idx="${p.careerSnapshots.length - 1 - i}">
            <span style="color:var(--silver-light)">${esc(snap.teamName || '—')} · ${esc(snap.divisionName || '—')}</span>
            <span style="color:var(--muted);font-size:12px">
              ${snap.stats?.goals || 0}G · ${snap.stats?.assists || 0}A · ${snap.stats?.saves || 0}S · PIG ${(snap.stats?.pig || 0).toFixed(1)}
              ${snap.date ? ' · ' + new Date(snap.date).toLocaleDateString() : ''}
            </span>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
}

export function bindPlayersEvents(){
  document.querySelectorAll('[data-player-profile]').forEach(row =>
    row.addEventListener('click', ()=>{ location.hash = '#/players/' + row.dataset.playerProfile; }));

  document.getElementById('btnEditPlayer')?.addEventListener('click', ()=>{
    const hash = location.hash.replace(/^#\/?/, '').split('/');
    const pid = hash[1];
    if(pid) openPlayerForm(pid, () => window.dispatchEvent(new HashChangeEvent('hashchange')));
  });

  document.querySelectorAll('[data-snapshot-idx]').forEach(row => {
    row.addEventListener('click', () => {
      const hash = location.hash.replace(/^#\/?/, '').split('/');
      const pid = hash[1];
      const db = getDB();
      const player = db.players.find(x => x.id === pid);
      if(!player) return;
      const idx = +row.dataset.snapshotIdx;
      const snap = player.careerSnapshots[idx];
      if(!snap) return;
      const s = snap.stats || {};
      openModal({
        id: 'snapshot-' + player.id + '-' + idx,
        title: `Historial · ${esc(snap.teamName || 'Equipo anterior')}`,
        body: `
          <div style="text-align:center;margin-bottom:16px;color:var(--muted);font-size:12px">
            ${esc(snap.divisionName || '')} · ${new Date(snap.date || Date.now()).toLocaleDateString()}
          </div>
          <div class="kpi-strip">
            <div class="kpi"><div class="kpi-val">${s.matchesPlayed || 0}</div><div class="kpi-lab">PJ</div></div>
            <div class="kpi"><div class="kpi-val">${s.goals || 0}</div><div class="kpi-lab">GOLES</div></div>
            <div class="kpi"><div class="kpi-val">${s.assists || 0}</div><div class="kpi-lab">ASIST.</div></div>
            <div class="kpi"><div class="kpi-val">${s.saves || 0}</div><div class="kpi-lab">SALV.</div></div>
            <div class="kpi"><div class="kpi-val">${(s.pig || 0).toFixed(1)}</div><div class="kpi-lab">PIG</div></div>
          </div>
        `,
        footer: `<button class="btn btn-ghost" data-close>CERRAR</button>`
      });
    });
  });
}

function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}