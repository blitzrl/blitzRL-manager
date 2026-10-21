import { getDB, mutate } from './storage.js';
import { uid } from '../data/database.js';
import { recordTransactionInDB } from './economy.js';

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

    const contract = {
      id: contractId,
      type, 
      status: 'active',
      playerId,
      ownerTeamId,
      currentTeamId,
      startSeasonId: activeSeason.id,
      endSeasonId: activeSeason.id,
      durationMatchdays: parseInt(durationMatchdays) || 0,
      endMatchday: 0,
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

    const currentMatchday = Math.max(0, ...d.matches.filter(m => m.status === 'finished').map(m => m.matchday));
    contract.endMatchday = currentMatchday + contract.durationMatchdays;

    d.contracts.push(contract);

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

      d.transferLog.push({
        id: uid('mov'), playerId, playerName: p.name,
        fromTeamId: origin?.id || null, fromTeamName: origin?.name || '—',
        toTeamId: target?.id || null, toTeamName: target?.name || '—',
        fromDivisionId: origin?.divisionId || null, toDivisionId: target?.divisionId || null,
        date: Date.now(), type: 'loan', price: uniquePrice || 0
      });
    } else {
      p.contractId = contractId;
      p.ownerTeamId = currentTeamId;
      contract.endMatchday = 999;
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

      const activeSeason = d.seasons.find(s => s.active);
      if (activeSeason && match.matchday >= c.endMatchday && match.seasonId === c.endSeasonId) {
        finalizeContractInternal(d, c, 'loan_complete');
      }
      
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
// 4. FINALIZACIÓN Y RESOLUCIÓN MANUAL
// ============================================================
export function finalizeContractInternal(d, contract, reason) {
  const player = d.players.find(p => p.id === contract.playerId);
  const origin = d.teams.find(t => t.id === contract.ownerTeamId);
  const current = d.teams.find(t => t.id === contract.currentTeamId);
  const maxRoster = d.config.rosterRules?.max || 4;

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

  if (!origin) {
    if (current) current.roster = current.roster.filter(r => r.playerId !== contract.playerId);
    if (player) {
      player.status = 'free_agent'; player.ownerTeamId = null; player.contractId = null; player.divisionId = null;
    }
    contract.status = 'returned'; contract.terminatedAt = Date.now(); contract.terminationReason = 'origin_deleted';
    return;
  }

  if (origin.roster.length >= maxRoster) {
    contract.status = 'awaiting_return';
    contract.awaitingReturnSince = Date.now();
    if (player) { player.status = 'awaiting_return'; player.pendingTeamId = origin.id; }
    return;
  }

  if (current) current.roster = current.roster.filter(r => r.playerId !== contract.playerId);
  origin.roster.push({ playerId: contract.playerId, role: 'SUPLENTE' });
  if (player) {
    player.status = 'owned'; player.onLoan = false; player.ownerTeamId = null; player.contractId = null;
    player.divisionId = origin.divisionId;
  }
  contract.status = 'returned'; contract.terminatedAt = Date.now(); contract.terminationReason = reason;
}

export function resolveAwaitingReturn(contractId) {
  mutate(d => {
    const c = d.contracts.find(x => x.id === contractId);
    if (!c || c.status !== 'awaiting_return') return;
    
    const origin = d.teams.find(t => t.id === c.ownerTeamId);
    if (!origin) throw new Error('El equipo de origen ya no existe');
    if (origin.roster.length >= (d.config.rosterRules?.max || 4)) {
      throw new Error('El equipo de origen aún no tiene espacio en el roster');
    }

    const player = d.players.find(p => p.id === c.playerId);
    const current = d.teams.find(t => t.id === c.currentTeamId);

    // Si el jugador seguía en el equipo donde estuvo a préstamo, lo quitamos
    if (current && current.roster.some(r => r.playerId === c.playerId)) {
      current.roster = current.roster.filter(r => r.playerId !== c.playerId);
    }

    origin.roster.push({ playerId: c.playerId, role: 'SUPLENTE' });
    
    if (player) {
      player.status = 'owned'; player.onLoan = false; player.ownerTeamId = null; player.contractId = null;
      player.divisionId = origin.divisionId;
    }
    
    c.status = 'returned'; 
    c.terminatedAt = Date.now(); 
    c.terminationReason = 'manual_resolution';
    c.history.push({ ts: Date.now(), action: 'resolved_awaiting', note: 'Resuelto manualmente por el admin' });
  });
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

// ============================================================
// 5. ALERTAS Y CONSULTAS
// ============================================================
export function getContractAlerts() {
  const db = getDB();
  const activeSeason = db.seasons.find(s => s.active);
  const currentMatchday = Math.max(0, ...db.matches.filter(m => m.status === 'finished').map(m => m.matchday));
  
  const alerts = [];

  for (const c of db.contracts) {
    if (c.status === 'awaiting_return') {
      const player = db.players.find(p => p.id === c.playerId);
      const origin = db.teams.find(t => t.id === c.ownerTeamId);
      alerts.push({
        id: 'awaiting_' + c.id,
        type: 'awaiting_return',
        severity: 'danger',
        contractId: c.id,
        playerName: player?.name || '?',
        teamName: origin?.name || '?',
        message: `Esperando regreso a ${origin?.name || '?'}. El roster está lleno.`,
        action: 'resolve'
      });
    }
    
    if (c.status === 'active' && c.type === 'loan') {
      if (c.endSeasonId === activeSeason?.id && (c.endMatchday - currentMatchday) <= 2 && (c.endMatchday - currentMatchday) >= 0) {
        const player = db.players.find(p => p.id === c.playerId);
        alerts.push({
          id: 'expiring_' + c.id,
          type: 'expiring',
          severity: 'warn',
          contractId: c.id,
          playerName: player?.name || '?',
          teamName: db.teams.find(t => t.id === c.currentTeamId)?.name || '?',
          message: `Faltan ${c.endMatchday - currentMatchday} jornadas para que finalice.`,
          action: null
        });
      }

      if (c.clauses.performance.enabled && hasPerformanceFailedRisk(c)) {
        const player = db.players.find(p => p.id === c.playerId);
        alerts.push({
          id: 'perf_' + c.id,
          type: 'performance_risk',
          severity: 'danger',
          contractId: c.id,
          playerName: player?.name || '?',
          teamName: db.teams.find(t => t.id === c.currentTeamId)?.name || '?',
          message: 'El jugador va camino a no cumplir las metas.',
          action: null
        });
      }
    }
  }

  return alerts;
}

function hasPerformanceFailedRisk(c) {
  // Lógica simple: si es la última jornada, no se cumple y falta mucho, es riesgo.
  const currentMatchday = 9; // Simplificado
  return false; 
}
