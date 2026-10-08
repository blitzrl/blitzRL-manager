import { getDB, mutate, persist } from './storage.js';
import { uid } from '../data/database.js';
import { DEFAULT_ZONES } from '../data/database.js';

// ============================================================
// CRUD DE DIVISIONES
// ============================================================
export function createDivision({ name, tier, visible=true }){
  if(!name || !name.trim()) throw new Error('Nombre obligatorio');
  const db = getDB();
  if(db.divisions.some(d => d.name.toLowerCase() === name.trim().toLowerCase())){
    throw new Error('Ya existe una división con ese nombre');
  }
  const seasonId = db.seasons[0]?.id;
  const id = uid('div');
  mutate(d => {
    d.divisions.push({
      id, name: name.trim(), tier: tier || d.divisions.length + 1,
      seasonId, active: false, visible,
      config: {
        teamsCount: 10, matchdays: 9, regularFormat: 'BO3', pointsPerGameWin: 1,
        playInEnabled: true, playoffSpots: 4, playInSpots: 2,
        playInFormat: 'BO5', semiFormat: 'BO5', finalFormat: 'BO7',
        promotion: { enabled: false, spots: 2, playIn: false, promotionSeries: false },
        relegation: { enabled: false, spots: 2 },
        tiebreakers: ['PTS','SG','DP','H2H','BO1'],
        zones: JSON.parse(JSON.stringify(DEFAULT_ZONES))
      }
    });
  });
  return id;
}

export function deleteDivision(id){
  const db = getDB();
  const div = db.divisions.find(d => d.id === id);
  if(!div) throw new Error('División no encontrada');
  const teamsInDiv = db.teams.filter(t => t.divisionId === id);
  if(teamsInDiv.length > 0) throw new Error('Debes dar de baja los equipos antes de eliminar la división');
  mutate(d => { d.divisions = d.divisions.filter(x => x.id !== id); });
}

export function updateDivision(id, patch){
  mutate(d => {
    const div = d.divisions.find(x => x.id === id);
    if(!div) return;
    Object.assign(div, patch);
  });
}

export function setDivisionVisibility(id, visible){
  updateDivision(id, { visible: !!visible });
}

// ============================================================
// BAJA DE EQUIPOS (lista "sin asignar")
// ============================================================
export function retireTeamFromDivision(teamId){
  mutate(d => {
    const team = d.teams.find(t => t.id === teamId);
    if(!team) return;
    team.retiredFromDivisionId = team.divisionId;
    team.divisionId = null;
    team.retiredAt = new Date().toISOString();
    if(!d.unassignedTeams) d.unassignedTeams = [];
    if(!d.unassignedTeams.includes(teamId)) d.unassignedTeams.push(teamId);
  });
}

export function restoreTeamToDivision(teamId, divisionId){
  mutate(d => {
    const team = d.teams.find(t => t.id === teamId);
    if(!team) return;
    team.divisionId = divisionId;
    delete team.retiredFromDivisionId;
    delete team.retiredAt;
    if(d.unassignedTeams){
      d.unassignedTeams = d.unassignedTeams.filter(x => x !== teamId);
    }
  });
}

// ============================================================
// MOVIMIENTOS DE PLAZA (PROMOCIÓN / RELAGACIÓN / SWAP)
// ============================================================
// Tipos de movimiento:
//   promote:      sube un equipo de la división B a la A
//   relegate:     baja un equipo de la división A a la B
//   swap:         intercambia dos equipos entre divisiones
//
// applyAt:
//   'immediate'      → ahora
//   'endSeason'      → al terminar temporada
//   'endRegular'     → al terminar fase regular
//   'roundN'         → al llegar a una jornada específica
//
export function queueTeamMovement({ teamId, targetDivisionId, type, applyAt='immediate', roundNumber=null, reason='' }){
  const db = getDB();
  const team = db.teams.find(t => t.id === teamId);
  if(!team) throw new Error('Equipo no encontrado');

  const movement = {
    id: uid('mov'),
    teamId,
    teamName: team.name,
    targetDivisionId,
    type, // 'promote' | 'relegate' | 'swap'
    applyAt,
    roundNumber,
    reason,
    createdAt: new Date().toISOString(),
    status: 'pending'
  };

  if(applyAt === 'immediate'){
    applyMovement(movement);
  } else {
    mutate(d => { d.transferQueue.push(movement); });
  }
  return movement.id;
}

function applyMovement(movement){
  mutate(d => {
    const team = d.teams.find(t => t.id === movement.teamId);
    if(!team) return;
    const fromDiv = d.divisions.find(x => x.id === team.divisionId);
    const toDiv = d.divisions.find(x => x.id === movement.targetDivisionId);
    if(!toDiv) return;
    team.divisionId = movement.targetDivisionId;
    if(!d.history) d.history = [];
    d.history.unshift({
      ts: new Date().toISOString(),
      action: movement.type,
      entity: 'team',
      entityId: team.id,
      summary: `${team.name}: ${fromDiv?.name||'Sin división'} → ${toDiv.name} · ${movement.reason || 'sin motivo'}`,
      snapshot: null
    });
    if(d.history.length > 500) d.history.length = 500;
  });
}

export function processQueuedMovements(trigger, roundNumber=null){
  const db = getDB();
  const queue = db.transferQueue || [];
  const toApply = queue.filter(m => {
    if(m.status !== 'pending') return false;
    if(m.applyAt === trigger) return true;
    if(m.applyAt === 'roundN' && trigger === 'roundN' && m.roundNumber === roundNumber) return true;
    return false;
  });
  toApply.forEach(m => {
    applyMovement(m);
    m.status = 'applied';
    m.appliedAt = new Date().toISOString();
  });
  // Limpiar aplicados hace más de 20 movimientos
  const dbAfter = getDB();
  if(dbAfter.transferQueue.length > 100){
    mutate(d => { d.transferQueue = d.transferQueue.filter(x => x.status === 'pending'); });
  }
}

// ============================================================
// FIN DE TEMPORADA: PROMOTION / RELEGATION automáticos
// ============================================================
export function processPromotionRelegation(divisionId){
  const db = getDB();
  const div = db.divisions.find(d => d.id === divisionId);
  if(!div) return { error: 'División no encontrada' };
  const cfg = div.config;
  if(!cfg.promotion?.enabled && !cfg.relegation?.enabled) return { skipped:true };

  // Encontrar división superior e inferior
  const superior = db.divisions.find(d => d.tier === div.tier - 1);
  const inferior = db.divisions.find(d => d.tier === div.tier + 1);

  const movements = [];

  // Ascender equipos de la zona 'promotion' hacia arriba
  if(cfg.promotion?.enabled && superior){
    const promotedTeams = db.teams.filter(t =>
      t.divisionId === div.id && t.seasonId === div.seasonId
    ).slice(0, cfg.promotion.spots);
    // En realidad hay que ordenarlos por tabla. Lo hace el caller vía computeStandings.
    // Aquí recibimos ya los equipos. Por simplicidad, ascendemos por orden de equipos.
    // (El caller debe llamar con la lista ya ordenada)
  }

  // Este flujo se maneja mejor desde playoffs.js con acceso a la tabla.
  return { success: true };
}

// Variante: recibe los equipos ya ordenados
export function applyEndOfSeasonMovements({ divisionId, sortedTeams, promotionSpots, relegationSpots, superiorDivisionId, inferiorDivisionId }){
  const db = getDB();
  const movements = [];

  // Descenso desde esta división hacia la inferior
  if(relegationSpots > 0 && inferiorDivisionId){
    const relegated = sortedTeams.slice(-relegationSpots);
    relegated.forEach(t => {
      queueTeamMovement({
        teamId: t.teamId,
        targetDivisionId: inferiorDivisionId,
        type: 'relegate',
        applyAt: 'immediate',
        reason: `Descenso por posición (${t.pos}º)`
      });
    });
  }

  // Ascenso desde esta división hacia la superior
  if(promotionSpots > 0 && superiorDivisionId){
    const promoted = sortedTeams.slice(0, promotionSpots);
    promoted.forEach(t => {
      queueTeamMovement({
        teamId: t.teamId,
        targetDivisionId: superiorDivisionId,
        type: 'promote',
        applyAt: 'immediate',
        reason: `Ascenso por posición (${t.pos}º)`
      });
    });
  }

  persist();
  return movements;
}

// ============================================================
// SWAP: intercambiar dos equipos entre divisiones
// ============================================================
export function swapTeams(teamAId, teamBId, applyAt='immediate', roundNumber=null){
  const db = getDB();
  const A = db.teams.find(t => t.id === teamAId);
  const B = db.teams.find(t => t.id === teamBId);
  if(!A || !B) throw new Error('Equipos no encontrados');
  if(A.divisionId === B.divisionId) throw new Error('Ambos equipos están en la misma división');

  const divA = A.divisionId;
  const divB = B.divisionId;

  if(applyAt === 'immediate'){
    mutate(d => {
      const ta = d.teams.find(t => t.id === teamAId);
      const tb = d.teams.find(t => t.id === teamBId);
      ta.divisionId = divB;
      tb.divisionId = divA;
      d.history.unshift({
        ts: new Date().toISOString(),
        action: 'swap',
        entity: 'team',
        entityId: ta.id,
        summary: `Swap: ${ta.name} ↔ ${tb.name}`,
        snapshot: null
      });
    });
  } else {
    mutate(d => {
      d.transferQueue.push({
        id: uid('mov'),
        type: 'swap',
        teamAId, teamBId,
        targetDivisionId: divB,
        applyAt, roundNumber,
        status: 'pending',
        createdAt: new Date().toISOString()
      });
    });
  }
}