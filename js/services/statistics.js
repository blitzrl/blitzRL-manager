import { getDB } from './storage.js';
import { calculatePIG, efficiency } from './pig.js';

export function efficiencyOffense(goals, shots){
  if(!shots) return 0;
  return +((goals / shots) * 100).toFixed(1);
}

export function efficiencyDefense(saves, goalsAgainst){
  const total = saves + (goalsAgainst || 0);
  if(!total) return 0;
  return +((saves / total) * 100).toFixed(1);
}

export function aggregatePlayerStats({ divisionId=null, seasonId=null, teamId=null } = {}){
  const db = getDB();
  const map = new Map();

  db.players.forEach(p => {
    map.set(p.id, {
      id: p.id, name: p.name,
      teamId: null, teamName: '—',
      games: 0, series: 0, wins: 0, losses: 0,
      goals: 0, assists: 0, saves: 0, shots: 0,
      goalsAgainst: 0,
      winStreak: 0, lossStreak: 0,
      divisionId: null, seasonId: null,
      pigHistory: []
    });
  });

  const teamById = new Map(db.teams.map(t => [t.id, t]));

  // ✅ FIX Bug 1: vincular jugadores con sus equipos desde el roster
  // (independientemente de si tienen partidos o no)
  db.teams.forEach(team => {
    if(teamId && team.id !== teamId) return;
    if(divisionId && team.divisionId !== divisionId) return;
    if(seasonId && team.seasonId !== seasonId) return;
    (team.roster || []).forEach(r => {
      const s = map.get(r.playerId);
      if(!s) return;
      s.teamId = team.id;
      s.teamName = team.name;
      s.divisionId = team.divisionId;
      s.seasonId = team.seasonId;
    });
  });

  const matches = db.matches.filter(m => {
    if(divisionId && m.divisionId !== divisionId) return false;
    if(seasonId   && m.seasonId   !== seasonId)   return false;
    return true;
  });

  matches.forEach(m => {
    (m.games || []).forEach(g => {
      const winnerId = g.winnerTeamId;
      (g.players || []).forEach(pp => {
        const s = map.get(pp.playerId);
        if(!s) return;
        const team = teamById.get(pp.teamId);
        if(teamId && pp.teamId !== teamId) return;

        s.teamId = pp.teamId;
        s.teamName = team?.name || '—';
        s.divisionId = m.divisionId;
        s.seasonId = m.seasonId;

        s.games++;
        s.goals   += pp.goals   || 0;
        s.assists += pp.assists || 0;
        s.saves   += pp.saves   || 0;
        s.shots   += pp.shots   || 0;

        const rivalGoals = pp.teamId === m.teamAId ? g.scoreB : g.scoreA;
        s.goalsAgainst += rivalGoals || 0;

        if(winnerId === pp.teamId){ s.wins++; s.winStreak++; s.lossStreak = 0; }
        else                       { s.losses++; s.lossStreak++; s.winStreak = 0; }
      });
    });

    if(m.status === 'finished'){
      [m.teamAId, m.teamBId].forEach(tid => {
        const team = teamById.get(tid);
        if(!team) return;
        team.roster.forEach(r => {
          const s = map.get(r.playerId);
          if(s && (!teamId || tid === teamId)) s.series++;
        });
      });
    }
  });

  const result = [...map.values()].map(s => {
    const pig = calculatePIG(s);
    const eff = efficiency(s.goals, s.shots);
    const effOff = efficiencyOffense(s.goals, s.shots);
    const effDef = efficiencyDefense(s.saves, s.goalsAgainst);
    const games = Math.max(1, s.games);

    return {
      ...s,
      efficiency: eff,
      efficiencyOffense: effOff,
      efficiencyDefense: effDef,
      goalsPerMatch: +(s.goals / games).toFixed(2),
      assistsPerMatch: +(s.assists / games).toFixed(2),
      savesPerMatch: +(s.saves / games).toFixed(2),
      shotsPerMatch: +(s.shots / games).toFixed(2),
      pig
    };
  });

  return result;
}

export function computeRankings(allStats){
  const minGames = 1;
  const eligible = allStats.filter(s => s.games >= minGames);

  const rankBy = (key, dir='desc') => {
    const sorted = [...eligible].sort((a,b) => dir==='desc' ? (b[key]-a[key]) : (a[key]-b[key]));
    const map = new Map();
    sorted.forEach((s,i) => map.set(s.id, i+1));
    return map;
  };

  return {
    goals:      rankBy('goals'),
    assists:    rankBy('assists'),
    saves:      rankBy('saves'),
    shots:      rankBy('shots'),
    efficiency: rankBy('efficiency'),
    effOffense: rankBy('efficiencyOffense'),
    effDefense: rankBy('efficiencyDefense'),
    pig:        rankBy('pig'),
    total:      eligible.length
  };
}