import { getDB } from './storage.js';
import { ECONOMY_DEFAULTS } from '../data/database.js';

export function calculatePIG(stats){
  const db = getDB();
  const eco = db?.config?.economy || ECONOMY_DEFAULTS;
  const w = db?.config?.pigWeights || { goal: 2.0, assist: 1.5, save: 1.0, missDivisor: 5 };
  const bs = db?.config?.badStreak || { enabled: true, minGames: 5, consecutiveLosses: 3, penalty: 0.10 };

  // 1. Cálculo base (Goles, Asistencias, Salvadas, Tiros fallados)
  const base =
    (stats.goals      * w.goal) +
    (stats.assists    * w.assist) +
    (stats.saves      * w.save) +
    ((stats.shots - stats.goals) / w.missDivisor);

  // 2. Penalización por mala racha
  let penalty = 0;
  if(bs.enabled && stats.games >= bs.minGames && stats.lossStreak >= bs.consecutiveLosses){
    penalty = base * bs.penalty;
  }

  let pig = base - penalty;

  // 3. Manejo de PIG Negativo
  if (eco.pigAllowNegative) {
    // 3a. Penalización por inactividad ofensiva (jugó pero no metió goles ni asistió)
    const offContribution = (stats.goals || 0) + (stats.assists || 0);
    if (stats.games > 0 && offContribution === 0) {
      pig -= 2 * Math.min(stats.games, 5); // Resta hasta -10 PIG
    }

    // 3b. Penalización adicional por tiros fallados
    const missedShots = Math.max(0, (stats.shots || 0) - (stats.goals || 0));
    if (missedShots > 0) {
      const shotPenalty = missedShots * (eco.missedShotsPenalty ?? 0.5);
      pig -= shotPenalty;
    }

    // 3c. Aplicar el piso (Floor) para que no baje del límite configurado
    pig = Math.max(eco.pigNegativeFloor ?? -25, +pig.toFixed(2));
  } else {
    // Comportamiento clásico (nunca negativo)
    pig = Math.max(0, +pig.toFixed(2));
  }

  return pig;
}

export function efficiency(goals, shots){
  if(!shots) return 0;
  return +((goals / shots) * 100).toFixed(1);
}

export function streakLabel(stats){
  const db = getDB();
  const bs = db.config.badStreak;
  if(!bs.enabled) return { label: 'NEUTRA', cls: '' };
  if(stats.lossStreak >= bs.consecutiveLosses) return { label: 'MALA RACHA', cls: 'badge-loss' };
  if(stats.winStreak >= 3) return { label: 'RACHA POSITIVA', cls: 'badge-win' };
  return { label: 'NEUTRA', cls: '' };
}

export function ballonDor(players, divisionId=null, seasonId=null){
  return players
    .filter(p => !divisionId || p.divisionId === divisionId)
    .filter(p => !seasonId   || p.seasonId   === seasonId)
    .map(p => ({ ...p, pig: calculatePIG(p) }))
    .sort((a,b) => b.pig - a.pig); // Con negativos, los peores caen al final automáticamente
}
