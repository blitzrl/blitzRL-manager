import { getDB, mutate } from './storage.js';
import { uid } from '../data/database.js';
import { recordTransactionInDB } from './economy.js';
import { aggregatePlayerStats } from './statistics.js';

// ============================================================
// 1. CREAR CONTRATO / PRÉSTAMO
// ============================================================
export function createContract(payload) {
  const { 
    playerId, type, currentTeamId, ownerTeamId, 
    durationMatchdays, uniquePrice, perMatchdayPrice, chargeEvenIfNotPlayed,
    performanceEnabled, performanceTargets,
    buyOptionEnabled, buyPrice, mandatoryBuy,
    autoReturnOnElimination
  } = payload;

  const db = getDB();
  const player = db.players.find(p => p.id === playerId);
  if (!player) throw new Error('Jugador no encontrado');

  const activeSeason = db.seasons.find(s => s.active);
  if (!activeSeason) throw new Error('No hay temporada activa');

  const contractId = uid('cnt');

  mutate(d => {
    const p = d.players.find(x => x.id === playerId);
    const origin = d.teams.find(t => t.id === ownerTeamId);
    const target = d.teams.find(t => t.id === currentTeamId);

    // 1. Registrar Contrato
    const contract = {
      id: contractId,
      type, // 'loan' | 'permanent'
      status: 'active',
      playerId,
      ownerTeamId,
      currentTeamId,
      startSeasonId: activeSeason.id,
      endSeasonId: activeSeason.id,
      durationMatchdays: parseInt(durationMatchdays) || 0,
      endMatchday: 0, // Se calcula luego
      clauses: {
        uniquePrice: { enabled: uniquePrice > 0, amount: uniquePrice || 0 },
        perMatchday: { 
          enabled: perMatchdayPrice > 0, 
          amount: perMatchdayPrice || 0, 
          chargeEvenIfNotPlayed 
        },
        performance: {
          enabled: performanceEnabled,
          targets: performanceTargets || {},
          onFail: 'return'
        }
      },
      finalization: {
        endAction: mandatoryBuy ? 'mandatory_buy' : (buyOptionEnabled ? 'buy_option' : 'return'),
        buyPrice: buyPrice || 0,
      },
      stats: {
        matchdaysCharged: 0, totalCharged: 0, gamesPlayed: 0,
        goals: 0, assists: 0, saves: 0, shots: 0, efficiency: 0
      },
      autoReturnOnElimination,
      createdAt: Date.now(),
      history: [{ ts: Date.now(), action: 'created', note: `Préstamo a ${target?.name || 'Desconocido'}` }]
    };

    // Calcular fecha de fin
    const currentMatchday = Math.max(0, ...d.matches.filter(m => m.status === 'finished').map(m => m.matchday));
    contract.endMatchday = currentMatchday + contract.durationMatchdays;

    d.contracts.push(contract);

    // 2. Mover Jugador
    if (type === 'loan') {
      if (origin) origin.roster = origin.roster.filter(r => r.playerId !== playerId);
      if (target) {
        if (target.roster.length >= (d.config.rosterRules?.max || 4)) {
          throw new Error('El equipo destino no tiene espacio en el roster');
        }
        target.roster.push({ playerId, role: 'TITULAR' });
      }
      
      p.status = 'loaned';
      p.onLoan = true;
      p.ownerTeamId = ownerTeamId;
      p.contractId = contractId;
      if (target) p.divisionId = target.divisionId;

      // 3. Cobro Único
      if (uniquePrice > 0 && target && origin) {
        recordTransactionInDB(d, {
          teamId: target.id, type: 'loan_unique', amount: -uniquePrice,
          reason: `Préstamo: ${p.name}`
        });
        recordTransactionInDB(d, {
          teamId: origin.id, type: 'loan_unique', amount: +uniquePrice,
          reason: `Ingreso por préstamo: ${p.name}`
        });
      }

      // 4. Log
      d.transferLog.push({
        id: uid('mov'), playerId, playerName: p.name,
        fromTeamId: origin?.id || null, fromTeamName: origin?.name || '—',
        toTeamId: target?.id || null, toTeamName: target?.name || '—',
        fromDivisionId: origin?.divisionId || null, toDivisionId: target?.divisionId || null,
        date: Date.now(), type: 'loan', price: uniquePrice || 0
      });
    } else {
      // Contrato permanente (solo asignación de cláusula, no mueve jugador)
      p.contractId = contractId;
      p.ownerTeamId = currentTeamId;
      contract.endMatchday = 999; // Permanente
    }
  });

  return contractId;
}

// ============================================================
// 2. PROCESAR JORNADA (Cobros y Stats)
// ============================================================
export function processContractMatchday(match) {
  const db = getDB();
  const involvedTeams = [match.teamAId, match.teamBId];
  
  const activeLoans = db.contracts.filter(c => 
    c.status === 'active' && c.type === 'loan' &&
    involvedTeams.includes(c.currentTeamId)
  );

  if (activeLoans.length === 0) return;

  mutate(d => {
    activeLoans.forEach(loan => {
      const c = d.contracts.find(x => x.id === loan.id);
      if (!c) return;
      const player = d.players.find(p => p.id === c.playerId);

      // A) Cobro por jornada
      if (c.clauses.perMatchday.enabled) {
        const played = match.games.some(g => 
          (g.players || []).some(p => p.playerId === c.playerId)
        );
        
        if (c.clauses.perMatchday.chargeEvenIfNotPlayed || played) {
          recordTransactionInDB(d, {
            teamId: c.currentTeamId, type: 'loan_matchday', amount: -c.clauses.perMatchday.amount,
            reason: `Préstamo J${match.matchday}: ${player?.name}`
          });
          c.stats.matchdaysCharged++;
          c.stats.totalCharged += c.clauses.perMatchday.amount;
        }
      }

      // B) Acumular Stats
      if (c.clauses.performance.enabled) {
        match.games.forEach(g => {
          (g.players || []).filter(p => p.playerId === c.playerId).forEach(p => {
            c.stats.gamesPlayed++;
            c.stats.goals += p.goals || 0;
            c.stats.assists += p.assists || 0;
            c.stats.saves += p.saves || 0;
            c.stats.shots += p.shots || 0;
          });
        });
        c.stats.efficiency = c.stats.shots > 0 ? +((c.stats.goals / c.stats.shots) * 100).toFixed(1) : 0;
      }

      // C) Verificar Expiración (Por jornadas)
      const activeSeason = d.seasons.find(s => s.active);
      if (activeSeason && match.matchday >= c.endMatchday && match.seasonId === c.endSeasonId) {
        finalizeContractInternal(d, c, 'loan_complete');
      }
      
      // D) Verificar Rendimiento
      if (c.clauses.performance.enabled && hasPerformanceFailed(c)) {
        finalizeContractInternal(d, c, 'performance_failed');
      }
    });
  });
}

// ============================================================
// 3. PROCESAR ELIMINACIÓN EN PLAYOFFS
// ============================================================
export function processTeamElimination(divisionId, teamId) {
  const db = getDB();
  const teamLoans = db.contracts.filter(c => 
    c.status === 'active' && c.type === 'loan' &&
    c.currentTeamId === teamId && c.autoReturnOnElimination
  );

  if (teamLoans.length === 0) return;

  mutate(d => {
    teamLoans.forEach(loan => {
      const c = d.contracts.find(x => x.id === loan.id);
      if (c) finalizeContractInternal(d, c, 'team_eliminated');
    });
  });
}

// ============================================================
// 4. FINALIZACIÓN INTERNA
// ============================================================
export function finalizeContractInternal(d, contract, reason) {
  const player = d.players.find(p => p.id === contract.playerId);
  const origin = d.teams.find(t => t.id === contract.ownerTeamId);
  const current = d.teams.find(t => t.id === contract.currentTeamId);
  const maxRoster = d.config.rosterRules?.max || 4;

  // Caso: Compra (Forzada o por Cláusula)
  if (contract.finalization.endAction === 'mandatory_buy' || reason === 'buy_executed') {
    contract.status = 'bought';
    contract.terminatedAt = Date.now();
    
    if (player) {
      player.status = 'owned';
      player.onLoan = false;
      player.ownerTeamId = current?.id || null;
      player.contractId = null;
    }
    
    if (current && origin && contract.finalization.buyPrice > 0) {
      recordTransactionInDB(d, { teamId: current.id, type: 'buy_option', amount: -contract.finalization.buyPrice, reason: `Compra: ${player?.name}` });
      recordTransactionInDB(d, { teamId: origin.id, type: 'buy_option', amount: +contract.finalization.buyPrice, reason: `Venta: ${player?.name}` });
    }
    return;
  }

  // Caso: Regreso al origen
  if (!origin) {
    // El origen fue borrado
    if (current) current.roster = current.roster.filter(r => r.playerId !== contract.playerId);
    if (player) {
      player.status = 'free_agent'; player.ownerTeamId = null; player.contractId = null; player.divisionId = null;
    }
    contract.status = 'returned'; contract.terminatedAt = Date.now(); contract.terminationReason = 'origin_deleted';
    return;
  }

  if (origin.roster.length >= maxRoster) {
    // El origen está lleno -> ESPERA
    contract.status = 'awaiting_return';
    contract.awaitingReturnSince = Date.now();
    if (player) { player.status = 'awaiting_return'; player.pendingTeamId = origin.id; }
    return;
  }

  // Regreso Normal
  if (current) current.roster = current.roster.filter(r => r.playerId !== contract.playerId);
  origin.roster.push({ playerId: contract.playerId, role: 'SUPLENTE' });
  if (player) {
    player.status = 'owned'; player.onLoan = false; player.ownerTeamId = null; player.contractId = null;
    player.divisionId = origin.divisionId;
  }
  contract.status = 'returned'; contract.terminatedAt = Date.now(); contract.terminationReason = reason;
}

function hasPerformanceFailed(c) {
  const t = c.clauses.performance.targets;
  const s = c.stats;
  if (t.gamesPlayed?.enabled && s.gamesPlayed < t.gamesPlayed.min) return true;
  if (t.goals?.enabled && s.goals < t.goals.min) return true;
  if (t.assists?.enabled && s.assists < t.assists.min) return true;
  if (t.saves?.enabled && s.saves < t.saves.min) return true;
  if (t.efficiency?.enabled && s.efficiency < t.efficiency.min) return true;
  return false;
}
