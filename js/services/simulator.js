import { getDB, mutate } from './storage.js';
import { uid } from '../data/database.js';
import { generateBracket, reportBracketMatch } from './playoffs.js';
import { applyMatchBonuses, calculatePlayerPrice, recordTransaction } from './economy.js';
import { aggregatePlayerStats } from './statistics.js';
import { computeStandings } from './standings.js';
import { toast } from './ui.js';

// ============================================================
// 1. GENERADOR DE JUGADORES
// ============================================================
export function generatePlayers(namesText) {
  const db = getDB();
  let namesPool = [];

  // Parser inteligente para nombres (quita "1.-", comas, saltos de línea, etc.)
  if (namesText && namesText.trim()) {
    const cleanedText = namesText.replace(/[0-9]+[\s\.\-)]*/g, ','); // Reemplaza "1.- " por coma
    namesPool = cleanedText.split(/[\n,]+/).map(n => n.trim()).filter(n => n);
  }

  let nameIndex = 0;
  let createdCount = 0;

  mutate(d => {
    const seasonId = d.seasons.find(s => s.active)?.id || d.seasons[0]?.id;

    d.teams.forEach(team => {
      const currentSize = (team.roster || []).length;
      if (currentSize >= 4) return; // Ya está lleno

      const missing = 4 - currentSize; // Llenar hasta 4 (3 titulares, 1 sub)
      
      for (let i = 0; i < missing; i++) {
        let pName = namesPool[nameIndex];
        if (!pName) {
          pName = `Player ${d.players.length + 1}`; // Fallback
        }
        nameIndex++;
        createdCount++;

        const newPlayer = {
          id: uid('ply'),
          name: pName,
          platform: 'Steam',
          nationalityCode: '',
          rank: 'Diamond',
          rankLevel: 2,
          rankDivision: 'II',
          rlTracker: '',
          profilePicture: '',
          history: [],
          sanctions: [],
          pigHistory: [],
          pigTrend: '—',
          careerSnapshots: [],
          trophies: [],
          priceHistory: [],
          status: 'owned',
          pendingTeamId: null,
          divisionId: team.divisionId,
          seasonStats: { goals:0, assists:0, saves:0, shots:0, pig:0, matchesPlayed:0, mvps:0, pigHistory:[], avgLast5PIG:0, avgPIGPerMatch:0 },
          marketValue: 25000 // Precio base inicial
        };

        d.players.push(newPlayer);
        
        // Asignar rol (los primeros 3 son titulares, el último suplente)
        const role = currentSize + i < 3 ? 'TITULAR' : 'SUPLENTE';
        team.roster.push({ playerId: newPlayer.id, role });
      }
    });
  });

  return createdCount;
}


// ============================================================
// 2. SIMULADOR DE PARTIDOS
// ============================================================
export async function simulateMatchdays(amount, simulatePlayoffs = false, onProgress) {
  const db = getDB();
  const divisionId = getDB().divisions[0].id; // Simulamos la división activa por defecto
  const seasonId = getDB().seasons.find(s => s.active)?.id;

  // 1. Simular partidos de liga regular
  const matchesToSim = db.matches
    .filter(m => m.divisionId === divisionId && m.status === 'pending' && m.matchday <= amount)
    .sort((a, b) => a.matchday - b.matchday);

  if (matchesToSim.length > 0) {
    for (let i = 0; i < matchesToSim.length; i++) {
      simulateSingleMatch(matchesToSim[i].id, divisionId, seasonId);
      if (onProgress && i % 5 === 0) await new Promise(r => setTimeout(r, 10)); // UI breath
    }
  }

  // 2. Simular Playoffs si se solicitó
  if (simulatePlayoffs) {
    await simulatePlayoffsLogic(divisionId, seasonId, onProgress);
  }
}

function simulateSingleMatch(matchId, divisionId, seasonId) {
  const db = getDB();
  const match = db.matches.find(m => m.id === matchId);
  if (!match) return;

  const teamA = db.teams.find(t => t.id === match.teamAId);
  const teamB = db.teams.find(t => t.id === match.teamBId);
  if (!teamA || !teamB) return;

  // Híbrido: Basado en puntos, pero con probabilidad de sorpresa
  const standings = computeStandings(divisionId, seasonId);
  const ptsA = standings.find(s => s.teamId === teamA.id)?.PTS || 0;
  const ptsB = standings.find(s => s.teamId === teamB.id)?.PTS || 0;

  let aWinChance = 0.5 + (ptsA - ptsB) * 0.05;
  aWinChance = Math.max(0.1, Math.min(0.9, aWinChance)); // Entre 10% y 90%

  const aWins = Math.random() < aWinChance;
  const need = match.format === 'BO3' ? 2 : match.format === 'BO5' ? 3 : 4;

  // Generar partidas (simulamos 2 a 4 juegos rápido)
  const games = [];
  let wonA = 0, wonB = 0;

  while (wonA < need && wonB < need) {
    const isAWinner = (wonA === need - 1 && Math.random() < 0.7) || (wonB === need - 1 && Math.random() < 0.3) || (Math.random() < (aWins ? 0.6 : 0.4));
    
    let scoreA = isAWinner ? Math.floor(Math.random() * 3) + 2 : Math.floor(Math.random() * 2);
    let scoreB = isAWinner ? Math.floor(Math.random() * 2) : Math.floor(Math.random() * 3) + 2;

    if (scoreA === scoreB) scoreA++; // Evitar empates
    if (scoreA > scoreB) wonA++; else wonB++;

    // Asignar stats a los jugadores
    const gamePlayers = [];
    const assignStats = (team, score, isWin) => {
      const roster = team.roster.map(r => r.playerId);
      if (roster.length === 0) return;
      
      const goalPool = Array(score).fill(0).map(() => roster[Math.floor(Math.random() * roster.length)]);
      
      roster.forEach(pid => {
        let goals = goalPool.filter(id => id === pid).length;
        let assists = Math.random() > 0.5 ? Math.floor(Math.random() * 2) : 0;
        let saves = Math.floor(Math.random() * 4);
        let shots = goals + Math.floor(Math.random() * 3);

        gamePlayers.push({
          playerId: pid, teamId: team.id,
          goals, assists, saves, shots
        });
      });
    };

    assignStats(teamA, scoreA, scoreA > scoreB);
    assignStats(teamB, scoreB, scoreB > scoreA);

    games.push({
      id: uid('game'),
      scoreA, scoreB,
      winnerTeamId: scoreA > scoreB ? teamA.id : teamB.id,
      players: gamePlayers
    });
  }

  mutate(d => {
    const m = d.matches.find(x => x.id === matchId);
    m.games = games;
    m.status = 'finished';
    m.winnerId = wonA === need ? teamA.id : teamB.id;
    
    // Log
    d.history.unshift({
      ts: new Date().toISOString(),
      action: 'simulate',
      entity: 'match',
      entityId: m.id,
      summary: `Simulado: ${teamA.name} ${wonA}-${wonB} ${teamB.name}`,
      snapshot: null
    });
  });

  // Efectos post-partido
  applyMatchBonuses(matchId);
  updatePlayerPriceHistorySim(matchId);
}

function updatePlayerPriceHistorySim(matchId) {
  const db = getDB();
  const m = db.matches.find(x => x.id === matchId);
  if (!m) return;

  const stats = aggregatePlayerStats({ divisionId: m.divisionId, seasonId: m.seasonId });
  const playerIds = [...new Set(m.games.flatMap(g => g.players.map(p => p.playerId)))];

  mutate(d => {
    playerIds.forEach(pid => {
      const p = d.players.find(x => x.id === pid);
      if (!p) return;

      const pStats = stats.find(s => s.id === pid) || { pig: 0 };
      const priceData = calculatePlayerPrice(p, pStats, d.config.economy);
      const finalPrice = priceData.price > 0 ? priceData.price : (pStats.pig * (d.config.economy.pigMultiplier || 1000)) || 1000;
      
      p.priceHistory = p.priceHistory || [];
      const mdNum = parseInt(m.matchday, 10);
      
      p.priceHistory = p.priceHistory.filter(h => !(h.matchday === mdNum && h.seasonId === m.seasonId));
      
      const currentTeam = d.teams.find(t => (t.roster || []).some(r => r.playerId === p.id));

      p.priceHistory.push({
        seasonId: m.seasonId,
        divisionId: m.divisionId,
        matchday: mdNum,
        price: finalPrice,
        pig: pStats.pig,
        teamId: currentTeam?.id || null,
        teamName: currentTeam?.name || 'Agente Libre',
        date: Date.now()
      });
    });
  });
}

// ============================================================
// 3. SIMULADOR DE PLAYOFFS
// ============================================================
async function simulatePlayoffsLogic(divisionId, seasonId, onProgress) {
  let db = getDB();
  let playoff = db.playoffs.find(p => p.divisionId === divisionId);

  // Generar bracket si no existe
  if (!playoff || !playoff.bracket || !playoff.bracket.rounds) {
    if (onProgress) onProgress('Generando bracket de Playoffs...');
    generateBracket(divisionId);
    db = getDB(); // Refresh
    playoff = db.playoffs.find(p => p.divisionId === divisionId);
  }

  if (!playoff) return;

  const bracket = playoff.bracket;
  
  // Recorrer rondas y simular
  for (let r = 0; r < bracket.rounds.length; r++) {
    const round = bracket.rounds[r];
    if (onProgress) onProgress(`Simulando ${round.name}...`);

    for (let m = 0; m < round.matches.length; m++) {
      const match = round.matches[m];
      
      // Si ya tiene ganador (BYE), pasar al siguiente
      if (match.winnerId || !match.teamA || !match.teamB) continue;

      // Simular serie
      const need = match.format === 'BO3' ? 2 : match.format === 'BO5' ? 3 : 4;
      let wonA = 0, wonB = 0;
      const games = [];

      while (wonA < need && wonB < need) {
        const isAWinner = Math.random() < 0.5;
        let scoreA = isAWinner ? Math.floor(Math.random() * 3) + 2 : Math.floor(Math.random() * 2);
        let scoreB = isAWinner ? Math.floor(Math.random() * 2) : Math.floor(Math.random() * 3) + 2;
        if (scoreA === scoreB) scoreA++;
        if (scoreA > scoreB) wonA++; else wonB++;

        games.push({
          id: uid('game'),
          scoreA, scoreB,
          winnerTeamId: scoreA > scoreB ? match.teamA.teamId : match.teamB.teamId,
          players: [] // No detallamos stats en playoffs para ahorrar memoria
        });
      }

      const winner = wonA === need ? match.teamA : match.teamB;

      // Reportar en el bracket
      mutate(d => {
        const p = d.playoffs.find(x => x.divisionId === divisionId);
        const rd = p.bracket.rounds.find(x => x.id === round.id);
        const mt = rd.matches[m];
        
        mt.games = games;
        mt.winnerId = winner.teamId;
        
        // Propagar
        (mt.winnerTargets || []).forEach(t => {
          const tr = p.bracket.rounds.find(rr => rr.id === t.roundId);
          if(!tr) return;
          const tm = tr.matches[t.matchIndex];
          if(!tm) return;
          tm[t.slot] = { ...winner };
        });

        // Si es la final
        if (r === bracket.rounds.length - 1) {
          p.status = 'finished';
          p.championId = winner.teamId;
          p.bracket.championId = winner.teamId;
        }
      });
      
      if (onProgress && m % 2 === 0) await new Promise(res => setTimeout(res, 10));
    }
  }
}
