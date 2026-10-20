// ============================================================
// ECONOMY SERVICE — Cálculo de valores de mercado (Gestor)
// ============================================================
import { getDB } from './storage.js';
import { ECONOMY_DEFAULTS } from '../data/database.js';
import { aggregatePlayerStats } from './statistics.js';

/**
 * Calcula el valor de mercado de un jugador individual.
 * @param {Object} player - Objeto del jugador (con rank, rankLevel, etc.)
 * @param {Object} stats - Objeto con las estadísticas agregadas (debe incluir .pig)
 * @param {Object} economy - Configuración de economía (opcional, usa la DB por defecto)
 * @returns {Object} { basePrice, pig, pigAdjustment, price, rank, level }
 */
export function calculatePlayerPrice(player, stats, economy){
  const db = getDB();
  const eco = economy || db?.config?.economy || ECONOMY_DEFAULTS;

  if (!eco || !eco.enabled) {
    return { basePrice: 0, pig: stats?.pig || 0, pigAdjustment: 0, price: 0, rank: player.rank || 'Bronze', level: player.rankLevel || 1 };
  }

  const rank = player.rank || 'Bronze';
  const level = player.rankLevel || 1;
  
  // 1. Precio Base según Rango y Nivel
  const rankTable = eco.basePriceByRank?.[rank] || {};
  const basePrice = rankTable[level] ?? rankTable[1] ?? 0;

  // 2. Ajuste por PIG
  const pig = stats?.pig ?? 0;
  const pigAdjustment = pig * (eco.pigMultiplier || 1000);

  // 3. Precio Final (nunca menor a 0)
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
 * Calcula el valor total de la plantilla de un equipo (suma de los precios de sus jugadores).
 * @param {string} teamId 
 * @returns {number} Valor total de la plantilla
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
