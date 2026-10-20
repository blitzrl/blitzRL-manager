import { getDB, mutate } from './storage.js';
import { uid } from '../data/database.js';
import { generateBracket } from './playoffs.js';
import { applyMatchBonuses, calculatePlayerPrice } from './economy.js';
import { aggregatePlayerStats } from './statistics.js';
import { computeStandings } from './standings.js';

// ============================================================
// 1. GENERADOR DE JUGADORES (Con variedad de rangos)
// ============================================================
// FIX: Se agregó la palabra 'export' que faltaba
export function generatePlayers(namesText) {
  const db = getDB();
  let namesPool = [];

  if (namesText && namesText.trim()) {
    const cleanedText = namesText.replace(/[0-9]+[\s\.\-)]*/g, ','); 
    namesPool = cleanedText.split(/[\n,]+/).map(n => n.trim()).filter(n => n);
  }

  let nameIndex = 0;
  let createdCount = 0;

  // Distribución de rangos (Probabilidad)
  const rankPool = [
    { rank: 'Bronze', level: 1 }, { rank: 'Silver', level: 2 },
    { rank: 'Gold', level: 3 }, { rank: 'Platinum', level: 2 },
    { rank: 'Diamond', level: 1 }, { rank: 'Diamond', level: 2 }, { rank: 'Diamond', level: 3 },
    { rank: 'Champion', level: 1 }, { rank: 'Champion', level: 2 },
    { rank: 'Grand Champion', level: 1 }, { rank: 'SSL', level: 1 }
  ];

  mutate(d => {
    const seasonId = d.seasons.find(s => s.active)?.id || d.seasons[0]?.id;

    d.teams.forEach(team => {
      const currentSize = (team.roster || []).length;
      if (currentSize >= 4) return;

      const missing = 4 - currentSize;
      
      for (let i = 0; i < missing; i++) {
        let pName = namesPool[nameIndex];
        if (!pName) pName = `Player ${d.players.length + 1}`;
        nameIndex++;
        createdCount++;

        // Asignar rango aleatorio basado en el pool
        const randomRank = rankPool[Math.floor(Math.random() * rankPool.length)];

        const newPlayer = {
          id: uid('ply'),
          name: pName,
          platform: 'Steam',
          nationalityCode: '',
          rank: randomRank.rank,
          rankLevel: randomRank.level,
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
          marketValue: 15000 // Valor inicial base
        };

        d.players.push(newPlayer);
        const role = currentSize + i < 3 ? 'TITULAR' : 'SUPLENTE';
        team.roster.push({ playerId: newPlayer.id, role });
      }

      // Si el equipo no tiene dinero, darle fondo inicial
      if (!team.money || team.money === 0) {
        team.money = 100000;
      }
    });
  });

  return createdCount;
}

// ============================================================
// 2. SIMULADOR DE FICHAJES (Mercado realista)
// ============================================================
export function simulateTransfers() {
  const db = getDB();
  let transfersMade = 0;

  mutate(d => {
    // 1. Obtener Agentes Libres
    const freeAgents = d.players.filter(p => !d.teams.some(t => (t.roster || []).some(r => r.playerId === p.id)));
    
    // 2. Ordenar equipos por dinero (de mayor a menor)
    const richTeams = [...d.teams].sort((a, b) => (b.money || 0) - (a.money || 0));

    // Función auxiliar para calcular el poder de un equipo
    const getTeamPower = (team) => {
      if (!team.roster || team.roster.length === 0) return 0;
      let totalPower = 0;
      team.roster.forEach(r => {
        const p = d.players.find(x => x.id === r.playerId);
        if (!p) return;
        // Peso por rango
        const rankWeights = { 'Bronze': 1, 'Silver': 2, 'Gold': 3, 'Platinum': 4, 'Diamond': 5, 'Champion': 7, 'Grand Champion': 9, 'SSL': 12 };
        totalPower += (rankWeights[p.rank] || 1) * 10 + (p.marketValue || 0) / 10000;
      });
      return totalPower / team.roster.length;
    };

    // 3. Proceso de Fichajes
    freeAgents.forEach(fa => {
      // Un agente libre busca equipo. Los equipos más ricos tienen más prioridad.
      for (let i = 0; i < richTeams.length; i++) {
        const team = richTeams[i];
        const teamPower = getTeamPower(team);
        
        // Calcular peso del jugador (qué tan bueno es)
        const rankWeights = { 'Bronze': 1, 'Silver': 2, 'Gold': 3, 'Platinum': 4, 'Diamond': 5, 'Champion': 7, 'Grand Champion': 9, 'SSL': 12 };
        const playerWeight = rankWeights[fa.rank] || 1;

        // Regla de oro: Un jugador Top no va a un equipo malo (a menos que no haya de otra)
        // Si el peso del jugador es mayor al poder del equipo + 3, lo rechaza (a no ser que sea el último equipo con dinero)
        const isTeamGoodEnough = playerWeight <= (teamPower / 10) + 3;
        const hasMoney = (team.money || 0) >= 20000;
        
        if (hasMoney && (isTeamGoodEnough || i === richTeams.length - 1)) {
          // Traspaso
          const price = fa.marketValue || 20000;
          
          // Cobrar al equipo
          team.money -= price;
          
          // Cambiar estado del jugador
          fa.status = 'owned';
          fa.divisionId = team.divisionId;
          
          // Añadir al roster si hay espacio
          if ((team.roster || []).length < 4) {
            team.roster.push({ playerId: fa.id, role: 'SUPLENTE' });
            
            // Registrar historial del jugador
            fa.history = fa.history || [];
            fa.history.unshift({
              seasonName: d.seasons.find(s=>s.active)?.name || 'Actual',
              divisionName: d.divisions.find(x => x.id === team.divisionId)?.name || '—',
              teamName: team.name,
              role: 'FICHAJE',
              fromTeamName: 'Agente Libre',
              toTeamName: team.name,
              price: price,
              date: Date.now()
            });

            // Registrar log de transferencia
            d.transferLog.push({
              id: uid('mov'), playerId: fa.id, playerName: fa.name,
              fromTeamId: null, fromTeamName: 'Agente Libre',
              toTeamId: team.id, toTeamName: team.name,
              fromDivisionId: null, toDivisionId: team.divisionId,
              date: Date.now(), type: 'transfer', price: price
            });
            
            transfersMade++;
          }
          break; // Ya fichó, pasar al siguiente agente libre
        }
      }
    });
  });

  return transfersMade;
}

// ============================================================
// 3. SIMULADOR DE PARTIDOS
// ============================================================
export async function simulateMatchdays(amount, simulatePlayoffs = false, onProgress) {
  const db = getDB();
  const divisionId = getDB().divisions[0].id;
  const seasonId = getDB().seasons.find(s => s.active)?.id;

  // Primero, simular mercado
  if (onProgress) onProgress('Simulando mercado de fichajes...');
  simulateTransfers();

  // Luego, simular partidos
  const matchesToSim = db.matches
    .filter(m => m.divisionId === divisionId && m.status === 'pending' && m.matchday <= amount)
    .sort((a, b) => a.matchday - b.matchday);

  if (matchesToSim.length > 0) {
    for (let i = 0; i < matchesToSim.length; i++) {
      simulateSingleMatch(matchesToSim[i].id, divisionId, seasonId);
      if (onProgress && i % 5 === 0) await new Promise(r => setTimeout(r, 10)); 
    }
  }

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

  // Calcular Poder de Equipo
  const calcPower = (team) => {
    if (!team.roster || team.roster.length === 0) return 1;
    let power = 0;
    const rankWeights = { 'Bronze': 1, 'Silver': 2, 'Gold': 3, 'Platinum': 4, 'Diamond': 5, 'Champion': 7, 'Grand Champion': 9, 'SSL': 12 };
    team.roster.forEach(r => {
      const p = db.players.find(x => x.id === r.playerId);
      if (p) power += (rankWeights[p.rank] || 1);
    });
    return power / team.roster.length;
  };

  const powerA = calcPower(teamA);
  const powerB = calcPower(teamB);

  // Probabilidad base
  let probA = powerA / (powerA + powerB);
  
  // Factor Sorpresa (Aleatoriedad)
  probA = probA + (Math.random() - 0.5) * 0.2; // ±10% de variación
  
  // Limitar entre 5% y 95%
  probA = Math.max(0.05, Math.min(0.95, probA));

  const aWins = Math.random() < probA;
  const need = match.format === 'BO3' ? 2 : match.format === 'BO5' ? 3 : 4;

  const games = [];
  let wonA = 0, wonB = 0;

  while (wonA < need && wonB < need) {
    const isAWinner = (wonA === need - 1 && Math.random() < 0.7) || (wonB === need - 1 && Math.random() < 0.3) || (Math.random() < (aWins ? 0.6 : 0.4));
    
    let scoreA = isAWinner ? Math.floor(Math.random() * 3) + 2 : Math.floor(Math.random() * 2);
    let scoreB = isAWinner ? Math.floor(Math.random() * 2) : Math.floor(Math.random() * 3) + 2;

    if (scoreA === scoreB) scoreA++;
    if (scoreA > scoreB) wonA++; else wonB++;

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

        gamePlayers.push({ playerId: pid, teamId: team.id, goals, assists, saves, shots });
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
    
    d.history.unshift({
      ts: new Date().toISOString(),
      action: 'simulate',
      entity: 'match',
      entityId: m.id,
      summary: `Simulado: ${teamA.name} ${wonA}-${wonB} ${teamB.name}`,
      snapshot: null
    });
  });

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
      const finalPrice = priceData.price > 0 ? priceData.price : 1000;
      
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
// 4. SIMULADOR DE PLAYOFFS
// ============================================================
async function simulatePlayoffsLogic(divisionId, seasonId, onProgress) {
  let db = getDB();
  let playoff = db.playoffs.find(p => p.divisionId === divisionId);

  if (!playoff || !playoff.bracket || !playoff.bracket.rounds) {
    if (onProgress) onProgress('Generando bracket de Playoffs...');
    generateBracket(divisionId);
    db = getDB(); 
    playoff = db.playoffs.find(p => p.divisionId === divisionId);
  }

  if (!playoff) return;

  const bracket = playoff.bracket;
  
  for (let r = 0; r < bracket.rounds.length; r++) {
    const round = bracket.rounds[r];
    if (onProgress) onProgress(`Simulando ${round.name}...`);

    for (let m = 0; m < round.matches.length; m++) {
      const match = round.matches[m];
      if (match.winnerId || !match.teamA || !match.teamB) continue;

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
          players: [] 
        });
      }

      const winner = wonA === need ? match.teamA : match.teamB;

      mutate(d => {
        const p = d.playoffs.find(x => x.divisionId === divisionId);
        const rd = p.bracket.rounds.find(x => x.id === round.id);
        const mt = rd.matches[m];
        
        mt.games = games;
        mt.winnerId = winner.teamId;
        
        (mt.winnerTargets || []).forEach(t => {
          const tr = p.bracket.rounds.find(rr => rr.id === t.roundId);
          if(!tr) return;
          const tm = tr.matches[t.matchIndex];
          if(!tm) return;
          tm[t.slot] = { ...winner };
        });

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
