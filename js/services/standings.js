import { getDB } from './storage.js';
import { DEFAULT_ZONES } from '../data/database.js';
import { getZoneColor } from '../data/nations.js';

export function computeStandings(divisionId, seasonId){
  const db = getDB();
  const division = db.divisions.find(d => d.id === divisionId);
  const teams = db.teams.filter(t => t.divisionId === divisionId && t.seasonId === seasonId);

  const rows = new Map();
  teams.forEach(t => rows.set(t.id, {
    teamId: t.id, name: t.name, logo: t.logo,
    PTS: 0, SJ: 0, SG: 0, SP: 0,
    PG: 0, PP: 0, DP: 0,
    GF: 0, GC: 0, DG: 0,
    h2h: new Map()
  }));

  const matches = db.matches.filter(m =>
    m.divisionId === divisionId && m.seasonId === seasonId && m.status === 'finished'
  );

  matches.forEach(m => {
    const A = rows.get(m.teamAId), B = rows.get(m.teamBId);
    if(!A || !B) return;
    let aGamesWon = 0, bGamesWon = 0, aGoals = 0, bGoals = 0;
    m.games.forEach(g => {
      aGamesWon += g.scoreA > g.scoreB ? 1 : 0;
      bGamesWon += g.scoreB > g.scoreA ? 1 : 0;
      aGoals += g.scoreA; bGoals += g.scoreB;
    });
    A.SJ++; B.SJ++;
    A.PG += aGamesWon; A.PP += bGamesWon;
    B.PG += bGamesWon; B.PP += aGamesWon;
    A.GF += aGoals; A.GC += bGoals;
    B.GF += bGoals; B.GC += aGoals;
    const pts = division?.config?.pointsPerGameWin ?? 1;
    A.PTS += aGamesWon * pts;
    B.PTS += bGamesWon * pts;
    if(aGamesWon > bGamesWon){ A.SG++; B.SP++; }
    else if(bGamesWon > aGamesWon){ B.SG++; A.SP++; }
    A.h2h.set(B.teamId, (A.h2h.get(B.teamId) || 0) + (aGamesWon - bGamesWon));
    B.h2h.set(A.teamId, (B.h2h.get(A.teamId) || 0) + (bGamesWon - aGamesWon));
  });

  const list = [...rows.values()].map(r => ({
    ...r,
    DP: r.PG - r.PP,
    DG: r.GF - r.GC
  }));

  const order = division?.config?.tiebreakers || ['PTS','SG','DP','H2H'];
  list.sort((a,b) => compareTeams(a, b, order));

  // Zonas
  const zones = division?.config?.zones || DEFAULT_ZONES;
  list.forEach((r, i) => {
    r.pos = i + 1;
    r.zone = getZoneForPos(r.pos, zones);
    r.zoneColor = getZoneColorFromConfig(r.pos, zones, r.zone);
  });

  return list;
}

function getZoneForPos(pos, zonesConfig){
  if(!zonesConfig || !Array.isArray(zonesConfig.zones)) return 'none';
  for(const z of zonesConfig.zones){
    if(pos >= z.from && pos <= z.to) return z.type;
  }
  return 'none';
}

function getZoneColorFromConfig(pos, zonesConfig, type){
  if(type === 'none') return 'transparent';
  const z = zonesConfig.zones.find(x => pos >= x.from && pos <= x.to);
  if(z && z.color) return z.color;
  return getZoneColor(type);
}

function compareTeams(a, b, order){
  for(const rule of order){
    if(rule === 'H2H'){
      const diff = (a.h2h.get(b.teamId) || 0) - (b.h2h.get(a.teamId) || 0);
      if(diff !== 0) return -diff;
    } else if(rule === 'BO1'){ /* manual */ }
    else{
      if(b[rule] !== a[rule]) return b[rule] - a[rule];
    }
  }
  return 0;
}