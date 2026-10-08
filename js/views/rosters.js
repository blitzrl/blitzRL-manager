import { getDB } from '../services/storage.js';
import { state } from '../state.js';
import { aggregatePlayerStats } from '../services/statistics.js';
import { getRankColor } from '../data/nations.js';
import { computeStandings } from '../services/standings.js';
import { renderVitrina } from '../services/trophies.js';

export function rostersView(params = []){
  const db = getDB();
  const teamId = params[0];

  if(teamId){
    const team = db.teams.find(t => t.id === teamId);
    if(!team) return `<div class="card">Equipo no encontrado.</div>`;
    return teamProfileView(team);
  }

  const teams = db.teams.filter(t => !state.divisionId || t.divisionId === state.divisionId);

  return `
    <h1 class="page-title" style="margin-bottom:20px">ROSTERS</h1>
    <div class="grid grid-3">
      ${teams.map(t => teamCardMini(t)).join('') || '<div class="card">Sin equipos registrados.</div>'}
    </div>
  `;
}

function teamCardMini(t){
  const db = getDB();
  return `
    <div class="card team-card" data-team-profile="${t.id}">
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:14px">
        <div class="team-logo-box-lg">
          ${t.logo ? `<img src="${t.logo}" class="team-logo-img">` : '<span class="team-logo-fallback">◆</span>'}
        </div>
        <div>
          <div class="team-name">${t.name}</div>
          <div class="team-coach">Coach: ${t.coach || '—'}</div>
        </div>
      </div>
      <div class="divider"></div>
      ${t.roster.map(r => {
        const p = db.players.find(x => x.id === r.playerId) || {};
        const rankColor = p.rank ? getRankColor(p.rank, p.rankLevel) : 'var(--silver)';
        return `<div class="roster-row" style="border-bottom:1px solid var(--border-soft);padding:7px 0">
          <div class="roster-row-main">
            ${p.profilePicture
              ? `<img class="roster-avatar" src="${p.profilePicture}">`
              : `<div class="roster-avatar roster-avatar-empty">${(p.name||'?').slice(0,2).toUpperCase()}</div>`}
            <div style="min-width:0">
              <div style="font-size:12.5px;color:${rankColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name || '?'}</div>
              <div style="font-size:10.5px;color:var(--muted)">${p.platform || '—'} · ${p.rank || '—'}${p.rankDivision && p.rank!=='SSL' ? ' ' + p.rankDivision : ''}</div>
            </div>
          </div>
          <span class="badge ${r.role==='CAPITÁN'?'badge-gold':''}">${r.role}</span>
        </div>`;
      }).join('')}
      <div style="margin-top:12px;text-align:right;font-size:10.5px;color:var(--accent);letter-spacing:.14em">VER EQUIPO →</div>
    </div>
  `;
}

function teamProfileView(team){
  const db = getDB();
  const stats = aggregatePlayerStats({ teamId: team.id });
  const teamAgg = stats.reduce((a,s)=>({
    games: a.games + s.games, goals: a.goals + s.goals, assists: a.assists + s.assists,
    saves: a.saves + s.saves, shots: a.shots + s.shots, wins: a.wins + s.wins, losses: a.losses + s.losses
  }), { games:0, goals:0, assists:0, saves:0, shots:0, wins:0, losses:0 });

  // Ranking y fase
  const season = db.seasons.find(s => s.active) || db.seasons[0];
  const standings = computeStandings(team.divisionId, season.id);
  const rank = standings.find(s => s.teamId === team.id)?.pos;
  const phase = computeTeamPhase(team.id);
  const trophies = team.trophies || [];

  return `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:18px">
      <button class="btn btn-sm" onclick="location.hash='#/rosters'">← VOLVER</button>
    </div>

    <div class="card team-hero">
      <div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">
        <div class="team-logo-box-xl">
          ${team.logo ? `<img src="${team.logo}" class="team-logo-img">` : '<span class="team-logo-fallback" style="font-size:34px">◆</span>'}
        </div>
        <div style="flex:1;min-width:200px">
          <div class="team-name" style="font-family:var(--font-display);letter-spacing:.22em;font-size:26px;display:flex;align-items:center;gap:10px">
            ${rank ? `<span class="team-rank-inline">#${rank}</span>` : ''}
            ${team.name}
            ${phase ? `<span class="phase-badge ${phase.state}"><span class="dot"></span>${phase.label}</span>` : ''}
          </div>
          <div class="team-coach" style="letter-spacing:.12em;margin-top:4px">COACH · ${team.coach || '—'}</div>
        </div>
        <div class="kpi-strip" style="grid-template-columns:repeat(3,1fr);min-width:340px">
          <div class="kpi"><div class="kpi-val">${teamAgg.games}</div><div class="kpi-lab">PARTIDAS</div></div>
          <div class="kpi"><div class="kpi-val">${teamAgg.wins}</div><div class="kpi-lab">VICTORIAS</div></div>
          <div class="kpi"><div class="kpi-val">${teamAgg.goals}</div><div class="kpi-lab">GOLES</div></div>
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:18px">
      <div class="card">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>ROSTER</div></div>
        ${team.roster.map(r => {
          const p = db.players.find(x=>x.id===r.playerId) || {};
          const s = stats.find(x=>x.id===p.id) || {};
          const rankColor = p.rank ? getRankColor(p.rank, p.rankLevel) : 'var(--silver)';
          return `
            <div class="roster-row" style="padding:12px 0;border-bottom:1px solid var(--border-soft)">
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px">
                  ${p.profilePicture
                    ? `<img class="roster-avatar" src="${p.profilePicture}">`
                    : `<div class="roster-avatar roster-avatar-empty">${(p.name||'?').slice(0,2).toUpperCase()}</div>`}
                  <span style="color:${rankColor};font-size:14px">${p.name||'?'}</span>
                  <span class="badge ${r.role==='CAPITÁN'?'badge-gold':''}">${r.role}</span>
                </div>
                <div style="font-size:11px;color:var(--muted);margin-top:3px;padding-left:34px">
                  ${p.platform||'—'} · ${p.rank||'—'}${p.rankDivision && p.rank!=='SSL' ? ' ' + p.rankDivision : ''}
                  ${p.rlTracker ? `· <a href="${p.rlTracker}" target="_blank" style="color:var(--accent)">RL Tracker ↗</a>` : ''}
                </div>
              </div>
              <div style="text-align:right;font-size:11px;color:var(--muted)">
                ${s.games||0} PJ · ${s.goals||0} G · PIG ${(s.pig||0).toFixed(1)}
              </div>
            </div>`;
        }).join('')}
      </div>

      <div class="card">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>RESUMEN DE EQUIPO</div></div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
          <div class="kpi"><div class="kpi-val">${teamAgg.goals}</div><div class="kpi-lab">GOLES</div></div>
          <div class="kpi"><div class="kpi-val">${teamAgg.assists}</div><div class="kpi-lab">ASISTENCIAS</div></div>
          <div class="kpi"><div class="kpi-val">${teamAgg.saves}</div><div class="kpi-lab">SALVADAS</div></div>
          <div class="kpi"><div class="kpi-val">${teamAgg.shots}</div><div class="kpi-lab">TIROS</div></div>
        </div>
        ${trophies.length > 0 ? `
          <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border-soft)">
            ${renderVitrina(trophies)}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function computeTeamPhase(teamId){
  const db = getDB();
  const team = db.teams.find(x => x.id === teamId);
  if (!team) return null;
  const pl = (db.playoffs || []).find(p => p.divisionId === team.divisionId);
  if (!pl || !pl.bracket) return null;
  const b = pl.bracket;
  if (pl.championId === teamId) return { label:'Campeón', state:'champion' };
  const inMatch = m => m && (m.teamA?.teamId === teamId || m.teamB?.teamId === teamId);
  const pi = (b.playIn || []).find(inMatch);
  if (pi) return { label:'Play-In', state: pi.winnerId ? (pi.winnerId === teamId ? 'alive' : 'eliminated') : 'alive' };
  const sf = (b.semis || []).find(inMatch);
  if (sf) return { label:'Semis', state: sf.winnerId ? (sf.winnerId === teamId ? 'alive' : 'eliminated') : 'alive' };
  const fin = b.final;
  if (inMatch(fin)) return { label:'Final', state: fin.winnerId ? (fin.winnerId === teamId ? 'champion' : 'eliminated') : 'alive' };
  return null;
}

export function bindRostersEvents(){
  document.querySelectorAll('[data-team-profile]').forEach(card =>
    card.addEventListener('click', ()=>{ location.hash = '#/rosters/' + card.dataset.teamProfile; }));
}