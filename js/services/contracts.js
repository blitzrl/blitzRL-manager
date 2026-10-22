import { getDB, mutate } from './storage.js';
import { uid } from '../data/database.js';
import { recordTransactionInDB } from './economy.js';

// ============================================================
// FUNCIÓN AUXILIAR: Calcular la jornada actual de un equipo
// ============================================================
function getTeamCurrentMatchday(teamId, db) {
  if (!teamId) return 0;
  const teamMatches = db.matches.filter(m => 
    (m.teamAId === teamId || m.teamBId === teamId) && m.status === 'finished'
  );
  return Math.max(0, ...teamMatches.map(m => m.matchday));
}

// ============================================================
// 1. CREAR CONTRATO / PRÉSTAMO / FICHAJE
// ============================================================
export function createContract(payload) {
  const { 
    playerId, type, currentTeamId, ownerTeamId, 
    durationSeasons, durationMatchdays,
    uniquePrice, perMatchdayPrice, chargeEvenIfNotPlayed,
    performanceEnabled, performanceTargets,
    renewalOptionEnabled, renewalPrice,
    sellOnClauses,
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

    // CALCULAMOS LA JORNADA EN BASE AL EQUIPO DESTINO (El que recibe al jugador)
    const currentMatchday = getTeamCurrentMatchday(currentTeamId, d);
    
    // Si es un préstamo solo por jornadas, la temporada es 0 para que no diga "1 Temp"
    const isMatchdaysOnly = durationMatchdays > 0 && (!durationSeasons || durationSeasons <= 1);
    const cDurationSeasons = isMatchdaysOnly ? 0 : (parseInt(durationSeasons) || 1);
    const endMatchday = currentMatchday + (parseInt(durationMatchdays) || 0);
    
    const contract = {
      id: contractId,
      type, // 'loan' | 'permanent'
      status: 'active',
      playerId,
      ownerTeamId,
      teamId: currentTeamId, // El equipo donde jugará
      startSeasonId: activeSeason.id,
      endSeasonId: activeSeason.id,
      durationSeasons: cDurationSeasons,
      durationMatchdays: parseInt(durationMatchdays) || 0,
      endMatchday: endMatchday,
      transferPrice: uniquePrice || 0,
      clauses: {
        perMatchday: { enabled: perMatchdayPrice > 0, amount: perMatchdayPrice || 0, chargeEvenIfNotPlayed },
        performance: { enabled: performanceEnabled, targets: performanceTargets || {}, onFail: 'free_agent' },
        renewalOption: { enabled: renewalOptionEnabled, price: renewalPrice || 0 },
        sellOnClauses: sellOnClauses || []
      },
      stats: { matchdaysCharged: 0, totalCharged: 0, gamesPlayed: 0, goals: 0, assists: 0, saves: 0, shots: 0, efficiency: 0 },
      autoReturnOnElimination,
      createdAt: Date.now(),
      history: [{ ts: Date.now(), action: 'created', note: type === 'loan' ? `Préstamo a ${target?.name} por ${durationMatchdays}J` : `Fichaje por ${target?.name}` }]
    };

    d.contracts.push(contract);

    // INYECTAR EN EL HISTORIAL DEL JUGADOR
    p.history = p.history || [];
    p.history.unshift({
      seasonName: activeSeason.name,
      divisionName: target ? d.divisions.find(x => x.id === target.divisionId)?.name : '—',
      teamName: target ? target.name : '—',
      role: type === 'loan' ? 'PRÉSTAMO' : 'FICHAJE',
      fromTeamName: origin ? origin.name : 'Agente Libre',
      toTeamName: target ? target.name : 'Agente Libre',
      price: uniquePrice || 0,
      date: Date.now()
    });

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
        recordTransactionInDB(d, { teamId: target.id, type: 'loan_unique', amount: -uniquePrice, reason: `Préstamo: ${p.name}` });
        recordTransactionInDB(d, { teamId: origin.id, type: 'loan_unique', amount: +uniquePrice, reason: `Ingreso por préstamo: ${p.name}` });
      }

      d.transferLog.push({
        id: uid('mov'), playerId, playerName: p.name,
        fromTeamId: origin?.id || null, fromTeamName: origin?.name || '—',
        toTeamId: target?.id || null, toTeamName: target?.name || '—',
        fromDivisionId: origin?.divisionId || null, toDivisionId: target?.divisionId || null,
        date: Date.now(), type: 'loan', price: uniquePrice || 0
      });
    } else {
      // FICHAJE PERMANENTE
      if (origin) origin.roster = origin.roster.filter(r => r.playerId !== playerId);
      if (target) target.roster.push({ playerId, role: 'TITULAR' });
      
      p.status = 'owned';
      p.onLoan = false;
      p.ownerTeamId = currentTeamId;
      p.contractId = contractId;
      if (target) p.divisionId = target.divisionId;

      if (uniquePrice > 0 && target && origin) {
        recordTransactionInDB(d, { teamId: target.id, type: 'transfer', amount: -uniquePrice, reason: `Fichaje: ${p.name}` });
        recordTransactionInDB(d, { teamId: origin.id, type: 'transfer', amount: +uniquePrice, reason: `Venta: ${p.name}` });
      }

      d.transferLog.push({
        id: uid('mov'), playerId, playerName: p.name,
        fromTeamId: origin?.id || null, fromTeamName: origin?.name || '—',
        toTeamId: target?.id || null, toTeamName: target?.name || '—',
        fromDivisionId: origin?.divisionId || null, toDivisionId: target?.divisionId || null,
        date: Date.now(), type: 'transfer', price: uniquePrice || 0
      });
    }
  });

  return contractId;
}

// ============================================================
// 2. PROCESAR JORNADA (Cobros y Expiración)
// ============================================================
export function processContractMatchday(match) {
  const db = getDB();
  const involvedTeams = [match.teamAId, match.teamBId];
  
  const activeContracts = db.contracts.filter(c => 
    c.status === 'active' && involvedTeams.includes(c.teamId)
  );

  if (activeContracts.length === 0) return;

  mutate(d => {
    activeContracts.forEach(loan => {
      const c = d.contracts.find(x => x.id === loan.id);
      if (!c) return;
      const player = d.players.find(p => p.id === c.playerId);

      // A) COBRO POR JORNADA (Solo Préstamos)
      if (c.type === 'loan' && c.clauses.perMatchday.enabled) {
        const played = match.games.some(g => 
          (g.players || []).some(p => p.playerId === c.playerId)
        );
        
        if (c.clauses.perMatchday.chargeEvenIfNotPlayed || played) {
          recordTransactionInDB(d, { teamId: c.teamId, type: 'loan_matchday', amount: -c.clauses.perMatchday.amount, reason: `Préstamo J${match.matchday}: ${player?.name}` });
          recordTransactionInDB(d, { teamId: c.ownerTeamId, type: 'loan_matchday', amount: +c.clauses.perMatchday.amount, reason: `Ingreso Préstamo J${match.matchday}: ${player?.name}` });
          
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

      // C) EXPIRACIÓN Y RETORNO AUTOMÁTICO
      const activeSeason = d.seasons.find(s => s.active);
      
      // El match.matchday es la jornada del equipo que acaba de jugar. Si es >= a la fecha de fin, se devuelve.
      if (activeSeason && c.endMatchday > 0 && match.matchday >= c.endMatchday) {
        console.log(`[Contract] Fin de contrato para ${player?.name}. Jornada actual ${match.matchday} >= ${c.endMatchday}. Retornando...`);
        finalizeContractInternal(d, c, 'contract_complete');
      } else if (c.clauses.performance.enabled && hasPerformanceFailed(c) && match.matchday >= c.endMatchday) {
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
    c.teamId === teamId && c.autoReturnOnElimination
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
// 4. FINALIZACIÓN Y PAGO DE CLÁUSULAS
// ============================================================
export function finalizeContractInternal(d, contract, reason) {
  const player = d.players.find(p => p.id === contract.playerId);
  const origin = d.teams.find(t => t.id === contract.ownerTeamId);
  const current = d.teams.find(t => t.id === contract.teamId);
  const maxRoster = d.config.rosterRules?.max || 4;
  const activeSeason = d.seasons.find(s => s.active);

  // Pago de cláusula de futura venta (Solo si se vende)
  if (reason === 'transfer_executed') {
    const sellPrice = contract.transferPrice || 0;
    const clauses = contract.clauses.sellOnClauses || [];
    clauses.forEach(clause => {
      if (clause.remainingSales > 0 && clause.status === 'active') {
        const payout = sellPrice * (clause.percentage / 100);
        recordTransactionInDB(d, { teamId: clause.originalTeamId, type: 'sell_on_clause', amount: payout, reason: `Cláusula futura venta: ${player?.name} (${clause.percentage}%)` });
        clause.remainingSales--;
      }
    });
  }

  // Fin de contrato permanente
  if (contract.type === 'permanent') {
    contract.status = 'expired';
    contract.terminatedAt = Date.now();
    contract.terminationReason = reason;

    if (player) {
      player.status = 'free_agent';
      player.ownerTeamId = null;
      player.contractId = null;
      player.divisionId = null;
      
      player.history = player.history || [];
      player.history.unshift({
        seasonName: activeSeason?.name || 'Actual',
        divisionName: current ? d.divisions.find(x => x.id === current.divisionId)?.name : '—',
        teamName: 'Agente Libre',
        role: 'FIN DE CONTRATO',
        fromTeamName: current ? current.name : '—',
        toTeamName: 'Agente Libre',
        price: 0,
        date: Date.now()
      });
    }
    if (current) current.roster = current.roster.filter(r => r.playerId !== contract.playerId);
    return;
  }

  // Compra obligatoria o ejecutada (Préstamos)
  if (reason === 'buy_executed' || reason === 'mandatory_buy') {
    contract.status = 'bought';
    if (player) { 
      player.status = 'owned'; 
      player.onLoan = false; 
      player.ownerTeamId = current?.id; 
      player.contractId = null; 
    }
    if (current && origin && contract.clauses.renewalOption?.price > 0) {
      recordTransactionInDB(d, { teamId: current.id, type: 'buy_option', amount: -contract.clauses.renewalOption.price, reason: `Compra: ${player?.name}` });
      recordTransactionInDB(d, { teamId: origin.id, type: 'buy_option', amount: +contract.clauses.renewalOption.price, reason: `Venta: ${player?.name}` });
    }
    return;
  }

  // Si el equipo de origen fue borrado
  if (!origin) {
    if (current) current.roster = current.roster.filter(r => r.playerId !== contract.playerId);
    if (player) { 
      player.status = 'free_agent'; 
      player.ownerTeamId = null; 
      player.contractId = null; 
      player.divisionId = null; 
    }
    contract.status = 'returned'; 
    contract.terminatedAt = Date.now(); 
    contract.terminationReason = 'origin_deleted';
    return;
  }

  // SI EL EQUIPO DE ORIGEN ESTÁ LLENO, SE QUEDA EN ESPERA
  if (origin.roster.length >= maxRoster) {
    contract.status = 'awaiting_return';
    contract.awaitingReturnSince = Date.now();
    if (player) { player.status = 'awaiting_return'; player.pendingTeamId = origin.id; }
    console.log(`[Contract] ${player?.name} quiere volver a ${origin.name} pero el roster está lleno. Estado: awaiting_return.`);
    return;
  }

  // REGRESO NORMAL (PRÉSTAMO COMPLETADO)
  if (current) current.roster = current.roster.filter(r => r.playerId !== contract.playerId);
  origin.roster.push({ playerId: contract.playerId, role: 'SUPLENTE' });
  
  if (player) {
    player.status = 'owned'; 
    player.onLoan = false; 
    player.ownerTeamId = null; 
    player.contractId = null;
    player.divisionId = origin.divisionId;
    
    player.history = player.history || [];
    player.history.unshift({
      seasonName: activeSeason?.name || 'Actual',
      divisionName: d.divisions.find(x => x.id === origin.divisionId)?.name || '—',
      teamName: origin.name,
      role: 'RETORNO',
      fromTeamName: current ? current.name : 'Préstamo',
      toTeamName: origin.name,
      price: 0,
      date: Date.now()
    });
  }
  contract.status = 'returned'; 
  contract.terminatedAt = Date.now(); 
  contract.terminationReason = reason;
  console.log(`[Contract] ${player?.name} ha regresado exitosamente a ${origin.name}.`);
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
// 5. ALERTAS
// ============================================================
export function getContractAlerts() {
  const db = getDB();
  const activeSeason = db.seasons.find(s => s.active);
  
  const alerts = [];

  for (const c of db.contracts) {
    if (c.status === 'awaiting_return') {
      const player = db.players.find(p => p.id === c.playerId);
      const origin = db.teams.find(t => t.id === c.ownerTeamId);
      alerts.push({ id: 'awaiting_' + c.id, type: 'awaiting_return', severity: 'danger', contractId: c.id, playerName: player?.name || '?', teamName: origin?.name || '?', message: `Esperando regreso a ${origin?.name || '?'}. El roster está lleno.`, action: 'resolve' });
    }
    
    if (c.status === 'active' && c.type === 'loan') {
      // Calculamos la jornada actual del equipo específico que tiene al jugador prestado
      const teamCurrentMatchday = getTeamCurrentMatchday(c.teamId, db);
      const restantes = c.endMatchday - teamCurrentMatchday;
      
      if (c.endSeasonId === activeSeason?.id && restantes <= 2 && restantes >= 0) {
        const player = db.players.find(p => p.id === c.playerId);
        alerts.push({ 
          id: 'expiring_' + c.id, 
          type: 'expiring', 
          severity: 'warn', 
          contractId: c.id, 
          playerName: player?.name || '?', 
          teamName: db.teams.find(t => t.id === c.teamId)?.name || '?', 
          message: restantes === 0 ? `El contrato finaliza al terminar esta jornada.` : `Faltan ${restantes} jornadas para que finalice.`, 
          action: null 
        });
      }
    }
  }

  return alerts;
}

// ============================================================
// 6. RESOLVER RETORNO PENDIENTE
// ============================================================
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
    const current = d.teams.find(t => t.id === c.teamId);
    const activeSeason = d.seasons.find(s => s.active);

    if (current && current.roster.some(r => r.playerId === c.playerId)) {
      current.roster = current.roster.filter(r => r.playerId !== c.playerId);
    }

    origin.roster.push({ playerId: c.playerId, role: 'SUPLENTE' });
    
    if (player) {
      player.status = 'owned'; player.onLoan = false; player.ownerTeamId = null; player.contractId = null;
      player.divisionId = origin.divisionId;
      
      player.history = player.history || [];
      player.history.unshift({
        seasonName: activeSeason?.name || 'Actual',
        divisionName: d.divisions.find(x => x.id === origin.divisionId)?.name || '—',
        teamName: origin.name,
        role: 'RETORNO',
        fromTeamName: current ? current.name : 'Préstamo',
        toTeamName: origin.name,
        price: 0,
        date: Date.now()
      });
    }
    
    c.status = 'returned'; 
    c.terminatedAt = Date.now(); 
    c.terminationReason = 'manual_resolution';
    c.history.push({ ts: Date.now(), action: 'resolved_awaiting', note: 'Resuelto manualmente por el admin' });
  });
}
