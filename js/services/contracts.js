import { getDB, mutate } from './storage.js';
import { uid } from '../data/database.js';
import { recordTransactionInDB } from './economy.js';

function getTeamCurrentMatchday(teamId, db) {
  if (!teamId) return 0;
  const teamMatches = db.matches.filter(m => 
    (m.teamAId === teamId || m.teamBId === teamId) && m.status === 'finished'
  );
  return Math.max(0, ...teamMatches.map(m => m.matchday));
}

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

    const currentMatchday = getTeamCurrentMatchday(currentTeamId, d);
    
    const isMatchdaysOnly = durationMatchdays > 0 && (!durationSeasons || durationSeasons <= 1);
    const cDurationSeasons = isMatchdaysOnly ? 0 : (parseInt(durationSeasons) || 1);
    const endMatchday = currentMatchday + (parseInt(durationMatchdays) || 0);
    
    const contract = {
      id: contractId,
      type: type,
      status: 'active',
      playerId,
      ownerTeamId,
      teamId: currentTeamId,
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
        if (!target.roster.some(r => r.playerId === playerId)) {
            target.roster.push({ playerId, role: 'TITULAR' });
        }
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
      if (origin) origin.roster = origin.roster.filter(r => r.playerId !== playerId);
      if (target) {
        if (!target.roster.some(r => r.playerId === playerId)) {
            target.roster.push({ playerId, role: 'TITULAR' });
        }
      }
      
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

// (El resto del archivo contracts.js sigue igual...)
