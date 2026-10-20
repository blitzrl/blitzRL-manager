// ============================================================
// ECONOMY SERVICE — Cálculo y Movimientos (Gestor)
// ============================================================
import { getDB, mutate } from './storage.js';
import { ECONOMY_DEFAULTS, uid } from '../data/database.js';
import { aggregatePlayerStats } from './statistics.js';

export function calculatePlayerPrice(player, stats, economy){
  const db = getDB();
  const eco = economy || db?.config?.economy || ECONOMY_DEFAULTS;

  if (!eco || !eco.enabled) {
    return { basePrice: 0, pig: stats?.pig || 0, pigAdjustment: 0, price: 0, rank: player.rank || 'Bronze', level: player.rankLevel || 1 };
  }

  const rank = player.rank || 'Bronze';
  const level = player.rankLevel || 1;
  
  const rankTable = eco.basePriceByRank?.[rank] || {};
  const basePrice = rankTable[level] ?? rankTable[1] ?? 0;

  const pig = stats?.pig ?? 0;
  const pigAdjustment = pig * (eco.pigMultiplier || 1000);

  const price = Math.max(0, basePrice + pigAdjustment);

  return {
    basePrice,
    pig: +pig.toFixed(2),
    pigAdjustment,
    price,
    rank,
    level
  };
}

export function getTeamSquadValue(teamId) {
  const db = getDB();
  const team = db.teams.find(t => t.id === teamId);
  if (!team) return 0;

  const allStats = aggregatePlayerStats({ teamId });
  let totalValue = 0;
  
  (team.roster || []).forEach(r => {
    const player = db.players.find(p => p.id === r.playerId);
    if (!player) return;
    const stats = allStats.find(s => s.id === r.playerId);
    const valueData = calculatePlayerPrice(player, stats, db.config.economy);
    totalValue += valueData.price;
  });

  return totalValue;
}

export function detectVictoryType(games, format, winnerId, teamAId, teamBId, economy) {
  const db = getDB();
  const eco = economy || db?.config?.economy || ECONOMY_DEFAULTS;
  if (!eco || !eco.enabled || !games || games.length === 0) return null;

  const winnerIsA = winnerId === teamAId;
  const thresholds = eco.bonuses.thresholds?.[format || 'BO3'] || eco.bonuses.thresholds['BO3'];
  
  let winnerGamesWon = 0;
  let loserGamesWon = 0;
  let shutouts = 0;
  let totalGoalDiff = 0;

  games.forEach(g => {
    const wScore = winnerIsA ? g.scoreA : g.scoreB;
    const lScore = winnerIsA ? g.scoreB : g.scoreA;
    
    if (wScore > lScore) {
      winnerGamesWon++;
      totalGoalDiff += (wScore - lScore);
      if (lScore === 0) shutouts++;
    } else {
      loserGamesWon++;
    }
  });

  if (winnerGamesWon === 0) return null;

  const avgGoalDiff = totalGoalDiff / winnerGamesWon;

  if (shutouts >= thresholds.humiliatingShutout || avgGoalDiff >= thresholds.humiliatingGoalDiff) {
    return { type: 'humiliating', label: eco.bonuses.winHumiliating.label, amount: eco.bonuses.winHumiliating.amount, emoji: '😂' };
  }
  
  if (loserGamesWon === 0) {
    return { type: 'simple', label: eco.bonuses.winSimple.label, amount: eco.bonuses.winSimple.amount, emoji: '✅' };
  }

  return { type: 'hard', label: eco.bonuses.winHard.label, amount: eco.bonuses.winHard.amount, emoji: '⚔️' };
}

export function applyMatchBonuses(matchId) {
  const db = getDB();
  const match = db.matches.find(m => m.id === matchId);
  if (!match || match.status !== 'finished' || match.bonusApplied) return;

  let winnerId = match.winnerId;
  if (!winnerId) {
    let winsA = 0, winsB = 0;
    match.games.forEach(g => {
      if (g.scoreA > g.scoreB) winsA++;
      else if (g.scoreB > g.scoreA) winsB++;
    });
    winnerId = winsA > winsB ? match.teamAId : match.teamBId;
  }

  const vType = detectVictoryType(match.games, match.format, winnerId, match.teamAId, match.teamBId, db.config.economy);
  if (!vType) return;

  recordTransaction({
    teamId: winnerId,
    type: 'bonus_win',
    amount: vType.amount,
    reason: `${vType.label} (J${match.matchday})`,
    meta: { matchId, victoryType: vType.type }
  });

  mutate(d => {
    const m = d.matches.find(x => x.id === matchId);
    if (m) m.bonusApplied = true;
  });
}

export function applyBracketMatchBonuses(divisionId, roundId, matchIndex) {
  const db = getDB();
  const target = db.playoffs.find(p => p.divisionId === divisionId);
  if (!target || !target.bracket) return;

  const round = target.bracket.rounds.find(r => r.id === roundId);
  if (!round) return;
  const match = round.matches[matchIndex];
  if (!match || !match.winnerId || match.bonusApplied) return;

  const vType = detectVictoryType(match.games, match.format, match.winnerId, match.teamA?.teamId, match.teamB?.teamId, db.config.economy);
  if (!vType) return;

  recordTransaction({
    teamId: match.winnerId,
    type: 'bonus_win',
    amount: vType.amount,
    reason: `${vType.label} (${round.name})`,
    meta: { divisionId, roundId, matchIndex, victoryType: vType.type }
  });

  mutate(d => {
    const t = d.playoffs.find(p => p.divisionId === divisionId);
    const r = t.bracket.rounds.find(rr => rr.id === roundId);
    const m = r.matches[matchIndex];
    if (m) m.bonusApplied = true;
  });
}

export function applySeasonBonuses(d, divisionStatus, movements, seasonId) {
  const eco = d.config.economy || ECONOMY_DEFAULTS;
  if (!eco.enabled) return;

  const bonuses = eco.bonuses;

  divisionStatus.forEach(status => {
    if (!status.ready) return;
    const div = d.divisions.find(x => x.id === status.divisionId);
    if (!div) return;

    if (status.champion && status.champion.teamId) {
      recordTransactionInDB(d, {
        teamId: status.champion.teamId,
        type: 'bonus_season',
        amount: bonuses.winLeague.amount,
        reason: `Campeón de ${div.name} (${bonuses.winLeague.label})`,
        meta: { divisionId: div.id, seasonId }
      });
    }
  });

  movements.filter(mv => mv.type === 'promote').forEach(mv => {
    recordTransactionInDB(d, {
      teamId: mv.teamId,
      type: 'bonus_season',
      amount: bonuses.promote.amount,
      reason: `Ascenso a ${mv.toDivisionName}`,
      meta: { seasonId, fromDivisionId: mv.fromDivisionId, toDivisionId: mv.toDivisionId }
    });
  });
}

export function recordTransaction({ teamId, type, amount, reason, meta = {} }) {
  const db = getDB();
  mutate(d => {
    recordTransactionInDB(d, { teamId, type, amount, reason, meta });
  });
}

export function recordTransactionInDB(d, { teamId, type, amount, reason, meta = {} }) {
  const t = d.teams.find(x => x.id === teamId);
  if (!t) return;

  const eco = d.config.economy || ECONOMY_DEFAULTS;
  let newMoney = (t.money || 0) + amount;
  if (!eco.allowDebt && newMoney < 0) newMoney = 0;
  
  t.money = newMoney;

  d.economyLedger ||= [];
  d.economyLedger.unshift({
    id: uid('led'),
    ts: Date.now(),
    type,
    teamId: t.id,
    teamName: t.name,
    amount,
    reason: reason || 'Movimiento',
    meta
  });
}

export function applySanction({ teamId, amount, reasonId, customReason }) {
  const db = getDB();
  const eco = db.config.economy || ECONOMY_DEFAULTS;
  const reasonObj = eco.sanctions?.reasons?.find(r => r.id === reasonId);
  const finalReason = customReason?.trim() || reasonObj?.label || 'Sanción';

  recordTransaction({
    teamId,
    type: 'sanction',
    amount: -Math.abs(amount),
    reason: `Sanción: ${finalReason}`,
    meta: { sanctionReasonId: reasonId }
  });
}

export function exportLedgerTXT() {
  const db = getDB();
  const ledger = db.economyLedger || [];
  const teams = db.teams || [];

  const byTeam = {};
  teams.forEach(t => byTeam[t.id] = { name: t.name, money: t.money || 0, items: [] });
  
  ledger.forEach(item => {
    if (byTeam[item.teamId]) byTeam[item.teamId].items.push(item);
  });

  let txt = '';
  txt += `═══════════════════════════════════════════════\n`;
  txt += `  ZENITH — HOJA CONTABLE\n`;
  txt += `  Exportado: ${new Date().toLocaleString()}\n`;
  txt += `  Movimientos registrados: ${ledger.length}\n`;
  txt += `═══════════════════════════════════════════════\n\n`;

  Object.values(byTeam).forEach(teamData => {
    if (teamData.items.length === 0 && teamData.money === 0) return;

    txt += `[${teamData.name.toUpperCase()}]\n`;
    const sortedItems = [...teamData.items].sort((a, b) => a.ts - b.ts);
    
    sortedItems.forEach(item => {
      const date = new Date(item.ts).toLocaleDateString();
      const sign = item.amount >= 0 ? '+' : '';
      const amtStr = `${sign}$${Math.abs(item.amount).toLocaleString()}`;
      const reasonStr = item.reason.padEnd(40, '.');
      txt += `  [${date}] ${reasonStr} ${amtStr}\n`;
    });

    txt += `  ─────────────────────────────────────────\n`;
    if (teamData.money < 0) {
      txt += `  DEUDA ACTUAL: $${Math.abs(teamData.money).toLocaleString()}\n\n`;
    } else {
      txt += `  SALDO ACTUAL: $${teamData.money.toLocaleString()}\n\n`;
    }
  });

  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ZENITH_CONTABILIDAD_${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
