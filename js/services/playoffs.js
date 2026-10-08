// ============================================================
// PLAYOFFS SERVICE — Bracket con series por partida (BO3/BO5/BO7)
// ============================================================
import { getDB, mutate } from './storage.js';
import { computeStandings } from './standings.js';
import { uid } from '../data/database.js';

// ============================================================
// NOMBRES DE RONDA
// ============================================================
const ROUND_NAMES = {
  64: '32° AVOS',
  32: '16° AVOS',
  16: 'OCTAVOS',
  8:  'CUARTOS',
  4:  'SEMIFINALES',
  2:  'FINAL'
};

function getRoundsForBracketSize(bs){
  const rounds = [];
  let teams = bs;
  let idx = 0;
  while(teams >= 2){
    rounds.push({
      teams,
      name: ROUND_NAMES[teams] || `${teams}°`,
      matchesCount: teams / 2,
      id: 'r' + idx
    });
    teams /= 2;
    idx++;
  }
  return rounds;
}

function nextPowerOfTwo(n){
  let p = 2;
  while(p < n) p *= 2;
  return p;
}

function node(row){
  if(!row) return null;
  return { teamId: row.teamId, name: row.name, logo: row.logo, pos: row.pos };
}

function winsNeeded(format){
  const f = format || 'BO5';
  const n = parseInt(f.replace('BO', ''), 10);
  if(isNaN(n) || n < 1) return 2;
  return Math.ceil(n / 2);
}

// ============================================================
// GENERAR BRACKET
// ============================================================
export function generateBracket(divisionId){
  const db = getDB();
  const division = db.divisions.find(d => d.id === divisionId);
  if(!division) throw new Error('División no encontrada');

  const cfg = division.config || {};
  const seasonId = division.seasonId;
  const standings = computeStandings(divisionId, seasonId);
  if(standings.length < 2) throw new Error('Se necesitan al menos 2 equipos en la tabla');

  let playoffSpots = Math.max(0, cfg.playoffSpots || 0);
  let playInSpots   = Math.max(0, cfg.playInSpots || 0);

  if(playoffSpots < 2 && playInSpots < 2){
    throw new Error('Configura al menos 2 equipos en Play-Offs o Play-In');
  }

  const totalRequested = playoffSpots + playInSpots;
  let adjustmentMsg = '';
  if(totalRequested > standings.length){
    const adjPlayoff = Math.min(playoffSpots, standings.length);
    const remaining = standings.length - adjPlayoff;
    const adjPlayIn = Math.min(playInSpots, remaining);

    adjustmentMsg = `Config ajustada: se pidieron ${totalRequested} equipos, hay ${standings.length}. Play-Offs=${adjPlayoff}, Play-In=${adjPlayIn}`;
    console.warn('[ZENITH] ' + adjustmentMsg);

    playoffSpots = adjPlayoff;
    playInSpots = adjPlayIn;
  }

  const directTeams = standings.slice(0, playoffSpots);
  const playInTeams = standings.slice(playoffSpots, playoffSpots + playInSpots);

  const playInWinnersCount = Math.floor(playInTeams.length / 2);
  const totalFirstRound = directTeams.length + playInWinnersCount;

  if(totalFirstRound < 1){
    throw new Error('No hay suficientes equipos para generar un bracket');
  }

  const bracketsize = nextPowerOfTwo(Math.max(2, totalFirstRound));
  const roundDefs = getRoundsForBracketSize(bracketsize);

  const rounds = [];

  // ---- Play-In ----
  let playInRound = null;
  if(playInTeams.length >= 2){
    const matches = [];
    const n = playInTeams.length;
    for(let i = 0; i < Math.floor(n / 2); i++){
      matches.push({
        id: uid('pi'),
        teamA: node(playInTeams[i]),
        teamB: node(playInTeams[n - 1 - i]),
        winnerId: null,
        games: [],
        winnerTargets: [],
        format: cfg.playInFormat || 'BO5'
      });
    }
    playInRound = { id: 'playIn', name: 'PLAY-IN', matches };
    rounds.push(playInRound);
  }

  // ---- Main rounds ----
  const mainRounds = roundDefs.map((rd, rIdx) => {
    const isFinal = rIdx === roundDefs.length - 1;
    const isSemi = rIdx === roundDefs.length - 2;
    let format;
    if(isFinal) format = cfg.finalFormat || 'BO7';
    else if(isSemi) format = cfg.semiFormat || 'BO5';
    else format = cfg.regularFormat || 'BO3';

    const matches = [];
    for(let j = 0; j < rd.matchesCount; j++){
      matches.push({
        id: uid(rd.id + '_' + j),
        teamA: null,
        teamB: null,
        winnerId: null,
        games: [],
        winnerTargets: [],
        format
      });
    }
    return { id: rd.id, name: rd.name, matches };
  });
  rounds.push(...mainRounds);

  // ---- Sembrado ----
  const firstRound = mainRounds[0];
  const size = firstRound.matches.length * 2;
  const seeds = new Array(size).fill(null);

  directTeams.forEach((t, i) => {
    if(i < seeds.length) seeds[i] = node(t);
  });

  const playInTargetSlots = new Set();
  if(playInRound){
    playInRound.matches.forEach((piMatch, i) => {
      const slotIndex = directTeams.length + i;
      if(slotIndex >= seeds.length) return;

      let matchIdx, matchSlot;
      if(slotIndex < size / 2){
        matchIdx = slotIndex;
        matchSlot = 'teamA';
      } else {
        matchIdx = size - 1 - slotIndex;
        matchSlot = 'teamB';
      }

      playInTargetSlots.add(`${matchIdx}:${matchSlot}`);
      piMatch.winnerTargets.push({
        roundId: firstRound.id,
        matchIndex: matchIdx,
        slot: matchSlot
      });
    });
  }

  firstRound.matches.forEach((m, idx) => {
    m.teamA = seeds[idx] || null;
    m.teamB = seeds[size - 1 - idx] || null;
  });

  for(let r = 0; r < mainRounds.length - 1; r++){
    const cur = mainRounds[r];
    const nxt = mainRounds[r + 1];
    cur.matches.forEach((m, idx) => {
      const tmi = Math.floor(idx / 2);
      const tslot = idx % 2 === 0 ? 'teamA' : 'teamB';
      m.winnerTargets.push({ roundId: nxt.id, matchIndex: tmi, slot: tslot });
    });
  }

  // ---- BYE ----
  firstRound.matches.forEach((m, idx) => {
    const aKey = `${idx}:teamA`;
    const bKey = `${idx}:teamB`;
    const aReserved = playInTargetSlots.has(aKey);
    const bReserved = playInTargetSlots.has(bKey);

    if(m.teamA && !m.teamB && !bReserved){
      m.winnerId = m.teamA.teamId;
      m.isBye = true;
      (m.winnerTargets || []).forEach(t => {
        const tr = mainRounds.find(rr => rr.id === t.roundId);
        if(!tr) return;
        const tm = tr.matches[t.matchIndex];
        if(!tm) return;
        tm[t.slot] = { ...m.teamA };
      });
    } else if(!m.teamA && m.teamB && !aReserved){
      m.winnerId = m.teamB.teamId;
      m.isBye = true;
      (m.winnerTargets || []).forEach(t => {
        const tr = mainRounds.find(rr => rr.id === t.roundId);
        if(!tr) return;
        const tm = tr.matches[t.matchIndex];
        if(!tm) return;
        tm[t.slot] = { ...m.teamB };
      });
    }
  });

  const bracket = { rounds, championId: null };

  mutate(d => {
    d.playoffs = d.playoffs.filter(p => p.divisionId !== divisionId);
    d.playoffs.push({
      divisionId,
      seasonId,
      status: 'pending',
      bracket,
      championId: null
    });
  });

  return { bracket, adjustmentMsg };
}

// ============================================================
// OBTENER
// ============================================================
export function getPlayoff(divisionId){
  const db = getDB();
  const found = db.playoffs.find(p => p.divisionId === divisionId);
  if(!found) return null;
  if(!found.bracket) return null;
  if(!found.bracket.rounds){
    const migrated = migrateBracket(found.bracket);
    if(migrated) found.bracket = migrated;
  }
  return found;
}

function migrateBracket(oldBracket){
  const rounds = [];
  let idx = 0;
  if(Array.isArray(oldBracket.playIn) && oldBracket.playIn.length){
    rounds.push({
      id: 'playIn', name: 'PLAY-IN',
      matches: oldBracket.playIn.map(m => ({ ...m, games: m.games || [], winnerTargets: m.winnerTargets || [], format: m.format || 'BO5' }))
    });
  }
  if(Array.isArray(oldBracket.semis) && oldBracket.semis.length){
    rounds.push({
      id: 'r' + idx, name: 'SEMIFINALES',
      matches: oldBracket.semis.map(m => ({ ...m, games: m.games || [], winnerTargets: m.winnerTargets || [], format: m.format || 'BO5' }))
    });
    idx++;
  }
  if(oldBracket.final){
    rounds.push({
      id: 'r' + idx, name: 'FINAL',
      matches: [{ ...oldBracket.final, games: oldBracket.final.games || [], winnerTargets: [], format: oldBracket.final.format || 'BO7' }]
    });
  }
  return { rounds, championId: oldBracket.championId || null };
}

// ============================================================
// ACTUALIZAR FORMATO DE UN PARTIDO
// ============================================================
export function updateMatchFormat(divisionId, roundId, matchIndex, format){
  mutate(d => {
    const target = d.playoffs.find(p => p.divisionId === divisionId);
    if(!target) return;
    const round = target.bracket?.rounds?.find(r => r.id === roundId);
    if(!round) return;
    const match = round.matches?.[matchIndex];
    if(!match) return;
    if(match.winnerId && !match.isBye) return; // serie finalizada, no cambiar
    match.format = format;
  });
}

// ============================================================
// REPORTAR PARTIDA (acumulativo, tipo serie)
// ============================================================
export function reportBracketMatch(divisionId, roundId, matchIndex, payload){
  const { scoreA, scoreB, players } = payload;
  if(scoreA === scoreB) throw new Error('No puede haber empate');

  mutate(d => {
    const target = d.playoffs.find(p => p.divisionId === divisionId);
    if(!target) throw new Error('Sin bracket');
    const bracket = target.bracket;
    const round = bracket.rounds.find(r => r.id === roundId);
    if(!round) throw new Error('Ronda no encontrada: ' + roundId);
    const match = round.matches[matchIndex];
    if(!match) throw new Error('Partido no encontrado (índice ' + matchIndex + ')');
    if(!match.teamA || !match.teamB) throw new Error('Equipos no asignados');
    if(match.winnerId && !match.isBye) throw new Error('Esta serie ya fue finalizada');

    const winnerTeam = scoreA > scoreB ? match.teamA : match.teamB;

    // Acumular partida
    match.games.push({
      id: uid('game'),
      scoreA, scoreB,
      winnerTeamId: winnerTeam.teamId,
      players: players || []
    });

    // Contar wins
    const wonA = match.games.filter(g => g.scoreA > g.scoreB).length;
    const wonB = match.games.filter(g => g.scoreB > g.scoreA).length;

    // Wins necesarias
    const format = match.format || 'BO5';
    const need = winsNeeded(format);

    // ¿Terminó la serie?
    if(wonA === need || wonB === need){
      const seriesWinner = wonA === need ? match.teamA : match.teamB;
      match.winnerId = seriesWinner.teamId;

      // Propagar
      (match.winnerTargets || []).forEach(t => {
        const tr = bracket.rounds.find(r => r.id === t.roundId);
        if(!tr) return;
        const tm = tr.matches[t.matchIndex];
        if(!tm) return;
        tm[t.slot] = {
          teamId: seriesWinner.teamId,
          name: seriesWinner.name,
          logo: seriesWinner.logo,
          pos: seriesWinner.pos
        };
      });

      // ¿Es la final?
      const isFinalRound = round.id === bracket.rounds[bracket.rounds.length - 1].id;
      if(isFinalRound){
        target.championId = seriesWinner.teamId;
        target.status = 'finished';
        bracket.championId = seriesWinner.teamId;
      } else {
        const allFinished = bracket.rounds.every(r =>
          r.matches.every(m => m.winnerId || !m.teamA || !m.teamB)
        );
        target.status = allFinished ? 'finished' : 'live';
      }
    } else {
      target.status = 'live';
    }
  });
}

export function deleteBracket(divisionId){
  mutate(d => {
    d.playoffs = d.playoffs.filter(p => p.divisionId !== divisionId);
  });
}