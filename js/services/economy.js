// ============================================================
// ECONOMY SERVICE — Cálculo y Movimientos (Gestor)
// ============================================================
import { getDB, mutate } from './storage.js';
import { ECONOMY_DEFAULTS, uid } from '../data/database.js';
import { aggregatePlayerStats } from './statistics.js';

/**
 * Calcula el valor de mercado de un jugador individual.
 */
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

/**
 * Calcula el valor total de la plantilla de un equipo.
 */
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

// ============================================================
// MOVIMIENTOS CONTABLES
// ============================================================

/**
 * Registra una transacción en el Ledger global y actualiza el saldo del equipo.
 */
export function recordTransaction({ teamId, type, amount, reason, meta = {} }) {
  const db = getDB();
  const team = db.teams.find(t => t.id === teamId);
  if (!team) throw new Error('Equipo no encontrado');

  mutate(d => {
    const t = d.teams.find(x => x.id === teamId);
    if (!t) return;

    // Actualizar saldo (respetando si se permiten deudas o no)
    const eco = d.config.economy || ECONOMY_DEFAULTS;
    let newMoney = (t.money || 0) + amount;
    
    if (!eco.allowDebt && newMoney < 0) {
      newMoney = 0; // Si no se permite deuda, el saldo no baja de 0
    }
    
    t.money = newMoney;

    // Añadir al Ledger
    d.economyLedger ||= [];
    d.economyLedger.unshift({
      id: uid('led'),
      ts: Date.now(),
      type: type, // 'transfer', 'free', 'bonus_win', 'bonus_season', 'sanction', 'manual_adjust'
      teamId: t.id,
      teamName: t.name,
      amount: amount, // Negativo = gasto, Positivo = ingreso
      reason: reason || 'Movimiento',
      meta: meta
    });
  });

  return team.money;
}

/**
 * Aplica una sanción económica.
 */
export function applySanction({ teamId, amount, reasonId, customReason }) {
  const db = getDB();
  const eco = db.config.economy || ECONOMY_DEFAULTS;
  const reasonObj = eco.sanctions?.reasons?.find(r => r.id === reasonId);
  const finalReason = customReason?.trim() || reasonObj?.label || 'Sanción';

  return recordTransaction({
    teamId,
    type: 'sanction',
    amount: -Math.abs(amount), // Siempre negativo
    reason: `Sanción: ${finalReason}`,
    meta: { sanctionReasonId: reasonId }
  });
}

/**
 * Exporta el Ledger en formato de texto agrupado por equipos.
 */
export function exportLedgerTXT() {
  const db = getDB();
  const ledger = db.economyLedger || [];
  const teams = db.teams || [];

  const byTeam = {};
  teams.forEach(t => byTeam[t.id] = { name: t.name, money: t.money || 0, items: [] });
  
  // Llenar items
  ledger.forEach(item => {
    if (byTeam[item.teamId]) {
      byTeam[item.teamId].items.push(item);
    }
  });

  let txt = '';
  txt += `═══════════════════════════════════════════════\n`;
  txt += `  ZENITH — HOJA CONTABLE\n`;
  txt += `  Exportado: ${new Date().toLocaleString()}\n`;
  txt += `  Movimientos registrados: ${ledger.length}\n`;
  txt += `═══════════════════════════════════════════════\n\n`;

  Object.values(byTeam).forEach(teamData => {
    if (teamData.items.length === 0 && teamData.money === 0) return; // Saltar equipos vacíos

    txt += `[${teamData.name.toUpperCase()}]\n`;
    
    // Ordenar del más antiguo al más nuevo
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
