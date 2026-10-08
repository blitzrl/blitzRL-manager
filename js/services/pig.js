import { getDB } from './storage.js';

export function calculatePIG(stats){
  const w = getDB().config.pigWeights;
  const base =
    (stats.goals      * w.goal) +
    (stats.assists    * w.assist) +
    (stats.saves      * w.save) +
    ((stats.shots - stats.goals) / w.missDivisor);

  const bs = getDB().config.badStreak;
  let penalty = 0;
  if(bs.enabled && stats.games >= bs.minGames && stats.lossStreak >= bs.consecutiveLosses){
    penalty = base * bs.penalty;
  }
  return Math.max(0, +(base - penalty).toFixed(2));
}

export function efficiency(goals, shots){
  if(!shots) return 0;
  return +((goals / shots) * 100).toFixed(1);
}

export function streakLabel(stats){
  const bs = getDB().config.badStreak;
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
    .sort((a,b) => b.pig - a.pig);
}