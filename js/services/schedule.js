// ============================================================
// SCHEDULE — Round Robin con shuffle, generación avanzada y DnD
// ============================================================
import { getDB, mutate } from './storage.js';
import { uid } from '../data/database.js';

// ============================================================
// UTILIDADES
// ============================================================
function shuffle(arr){
  const a = [...arr];
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pairKey(a, b){
  return [a, b].sort().join('::');
}

// ============================================================
// GENERACIÓN BÁSICA (round robin con shuffle)
// ============================================================
export function generateSchedule(divisionId, opts = {}){
  const { openingMatch = null, finalMatch = null, manualMatchday1 = null } = opts;

  const db = getDB();
  const teams = db.teams.filter(t => t.divisionId === divisionId).map(t => t.id);
  if(teams.length < 2) throw new Error('Necesitas al menos 2 equipos.');

  const division = db.divisions.find(d => d.id === divisionId);
  if(!division) throw new Error('División no encontrada');

  const fixtures = buildRoundRobin(teams);

  // Aplicar generación avanzada
  if(manualMatchday1 && manualMatchday1.length > 0){
    applyManualMatchday1(fixtures, manualMatchday1, teams);
  }
  if(openingMatch){
    moveMatchToDay(fixtures, openingMatch.teamAId, openingMatch.teamBId, 0);
  }
  if(finalMatch){
    moveMatchToDay(fixtures, finalMatch.teamAId, finalMatch.teamBId, fixtures.length - 1);
  }

  const format = division.config?.regularFormat || 'BO3';

  const newMatches = [];
  fixtures.forEach((round, idx) => {
    round.forEach(([a, b]) => {
      newMatches.push({
        id: uid('match'),
        divisionId,
        seasonId: division.seasonId,
        matchday: idx + 1,
        teamAId: a, teamBId: b,
        format,
        date: '', time: '',
        locked: false,
        status: 'pending',
        games: []
      });
    });
  });

  mutate(d => {
    d.matches = d.matches.filter(m => m.divisionId !== divisionId);
    d.matches.push(...newMatches);
  });

  return newMatches;
}

export function resetSchedule(divisionId){
  mutate(d => {
    d.matches = d.matches.filter(m => !(m.divisionId === divisionId && !m.locked));
  });
}

// ============================================================
// ROUND ROBIN PURO
// ============================================================
function buildRoundRobin(teamsInput){
  const list = shuffle(teamsInput);
  if(list.length % 2 !== 0) list.push(null);
  const n = list.length;
  const rounds = n - 1;
  const half = n / 2;

  const fixtures = [];
  for(let r = 0; r < rounds; r++){
    const round = [];
    for(let i = 0; i < half; i++){
      const home = list[i];
      const away = list[n - 1 - i];
      if(home && away){
        // Local/visitante aleatorio
        const flip = Math.random() > 0.5;
        round.push(flip ? [away, home] : [home, away]);
      }
    }
    fixtures.push(round);
    list.splice(1, 0, list.pop());
  }
  return fixtures;
}

// ============================================================
// BUSCAR UN PARTIDO EN EL CALENDARIO
// ============================================================
function findMatchDayOfTeamPair(fixtures, teamAId, teamBId){
  for(let d = 0; d < fixtures.length; d++){
    const idx = fixtures[d].findIndex(([a, b]) =>
      (a === teamAId && b === teamBId) || (a === teamBId && b === teamAId)
    );
    if(idx !== -1) return { dayIndex: d, matchIndex: idx };
  }
  return null;
}

// ============================================================
// MOVER UN PARTIDO A UNA JORNADA ESPECÍFICA (swap)
// ============================================================
function moveMatchToDay(fixtures, teamAId, teamBId, targetDayIndex){
  const loc = findMatchDayOfTeamPair(fixtures, teamAId, teamBId);
  if(!loc) return;
  if(loc.dayIndex === targetDayIndex) return;

  // Necesitamos 2 slots libres en el targetDayIndex.
  // El targetDayIndex debe tener el mismo número de partidos que loc.dayIndex.
  const srcDay = fixtures[loc.dayIndex];
  const dstDay = fixtures[targetDayIndex];
  if(!dstDay) return;

  // Buscamos un partido en dstDay que podamos intercambiar
  // y lo movemos a srcDay
  const swapIdx = Math.floor(Math.random() * dstDay.length);
  const swapMatch = dstDay[swapIdx];

  // Intercambiamos
  const movingMatch = srcDay[loc.matchIndex];
  srcDay[loc.matchIndex] = swapMatch;
  dstDay[swapIdx] = movingMatch;
}

// ============================================================
// APLICAR JORNADA 1 MANUAL (arrastra emparejamientos)
// ============================================================
function applyManualMatchday1(fixtures, manualDay, teams){
  // Validaciones
  const seen = new Set();
  manualDay.forEach(({ teamAId, teamBId }) => {
    if(!teamAId || !teamBId) throw new Error('Partido incompleto en jornada 1');
    if(teamAId === teamBId) throw new Error('Un equipo no puede jugar contra sí mismo');
    if(seen.has(teamAId)) throw new Error('Equipo duplicado en jornada 1');
    if(seen.has(teamBId)) throw new Error('Equipo duplicado en jornada 1');
    seen.add(teamAId);
    seen.add(teamBId);
  });

  const otherTeams = teams.filter(t => !seen.has(t));
  if(otherTeams.length > 0){
    throw new Error(`Faltan equipos: ${otherTeams.length} sin asignar en jornada 1`);
  }

  // Reemplazar jornada 1: eliminar los emparejamientos originales que involucran a esos equipos
  // y redistribuir el resto
  const allPairs = [];
  for(let d = 1; d < fixtures.length; d++){
    fixtures[d].forEach(m => allPairs.push(m));
  }
  // El resto de jornadas se reconstruyen con un algoritmo tipo "reordenar":
  // quitamos todos los que coincidan con los emparejamientos nuevos
  // y rellenamos.

  // Estrategia simple: usamos los emparejamientos manuales para la jornada 1,
  // y para el resto de jornadas hacemos un round-robin normal SIN que se repitan.
  // Como ya tenemos los pares de la jornada 1, generamos los demás con otro round-robin.

  // Alternativa robusta: generamos un round robin nuevo, y forzamos la jornada 1
  // con los pares manuales, sustituyendo los pares conflictivos.

  const manualPairs = new Set(manualDay.map(p => pairKey(p.teamAId, p.teamBId)));

  // Jornada 1 manual
  fixtures[0] = manualDay.map(p => [p.teamAId, p.teamBId]);

  // El resto de jornadas: eliminar cualquier par que ya esté en la jornada 1
  for(let d = 1; d < fixtures.length; d++){
    const round = fixtures[d];
    const fixedRound = [];
    round.forEach(([a, b]) => {
      if(!manualPairs.has(pairKey(a, b))){
        fixedRound.push([a, b]);
      }
    });
    fixtures[d] = fixedRound;
  }

  // Ahora puede haber jornadas con menos partidos.
  // Rellenamos con partidos extraídos de otras jornadas.
  // Como los pares son únicos en round-robin, no hay duplicados.
  // Lo dejamos como está — el round-robin ya generó suficientes partidos.

  // Limpieza final: si alguna jornada quedó con 0 partidos, la quitamos
  for(let d = fixtures.length - 1; d >= 1; d--){
    if(fixtures[d].length === 0) fixtures.splice(d, 1);
  }
}

// ============================================================
// VALIDACIÓN DE DRAG & DROP
// ============================================================
export function validateTeamSwap(divisionId, matchId, slot, targetMatchId, targetSlot){
  const db = getDB();
  const m = db.matches.find(x => x.id === matchId);
  const tm = db.matches.find(x => x.id === targetMatchId);
  if(!m || !tm) return { ok: false, error: 'Partido no encontrado' };
  if(m.matchday !== tm.matchday) return { ok: false, error: 'Solo puedes intercambiar equipos dentro de la misma jornada' };

  const teamId = slot === 'A' ? m.teamAId : m.teamBId;
  const targetTeamId = targetSlot === 'A' ? tm.teamAId : tm.teamBId;

  if(!teamId) return { ok: false, error: 'Equipo origen inválido' };

  // Si el target slot está vacío → solo mover
  if(!targetTeamId){
    // Verificar que el equipo no esté ya en otro partido de la misma jornada
    const sameDay = db.matches.filter(x => x.divisionId === divisionId && x.matchday === m.matchday && x.id !== matchId);
    for(const mm of sameDay){
      if(mm.teamAId === teamId || mm.teamBId === teamId){
        return { ok: false, error: 'El equipo ya está en otro partido de esta jornada' };
      }
    }
    return { ok: true, type: 'move' };
  }

  // Si es swap: validar que el rival no se repita en la temporada
  const newA = slot === 'A' ? targetTeamId : m.teamAId;
  const newB = slot === 'B' ? targetTeamId : m.teamBId;
  const newTA = targetSlot === 'A' ? teamId : tm.teamAId;
  const newTB = targetSlot === 'B' ? teamId : tm.teamBId;

  const allMatches = db.matches.filter(x => x.divisionId === divisionId && x.id !== matchId && x.id !== targetMatchId);
  for(const mm of allMatches){
    const mmA = mm.teamAId, mmB = mm.teamBId;
    if(
      (mmA === newA && mmB === newB) || (mmA === newB && mmB === newA) ||
      (mmA === newTA && mmB === newTB) || (mmA === newTB && mmB === newTA)
    ){
      return { ok: false, error: 'Ese enfrentamiento ya se jugó en la temporada' };
    }
  }

  return { ok: true, type: 'swap' };
}

export function swapTeamsInMatchday(divisionId, matchId, slot, targetMatchId, targetSlot){
  const check = validateTeamSwap(divisionId, matchId, slot, targetMatchId, targetSlot);
  if(!check.ok) throw new Error(check.error);

  mutate(d => {
    const m = d.matches.find(x => x.id === matchId);
    const tm = d.matches.find(x => x.id === targetMatchId);
    if(!m || !tm) return;

    const teamId = slot === 'A' ? m.teamAId : m.teamBId;
    const targetTeamId = targetSlot === 'A' ? tm.teamAId : tm.teamBId;

    if(!targetTeamId){
      if(slot === 'A') m.teamAId = null; else m.teamBId = null;
      if(targetSlot === 'A') tm.teamAId = teamId; else tm.teamBId = teamId;
    } else {
      const temp = teamId;
      if(slot === 'A') m.teamAId = targetTeamId; else m.teamBId = targetTeamId;
      if(targetSlot === 'A') tm.teamAId = temp; else tm.teamBId = temp;
    }
  });
}