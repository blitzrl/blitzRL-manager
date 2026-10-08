// ============================================================
// SEASONS — Sistema de temporadas (Fase 4)
// ============================================================
import { getDB, mutate, setViewSeasonId } from './storage.js';
import { uid } from '../data/database.js';
import { computeStandings } from './standings.js';
import { autoAssignTrophiesToDB } from './trophies.js';
import { toast } from './ui.js';

// ============================================================
// HELPERS DE ESTADO
// ============================================================
export function isViewingArchivedSeason(){
  return !!getDB().viewSeasonId;
}

export function getViewingSeason(){
  const db = getDB();
  if(!db.viewSeasonId) return null;
  return (db.archivedSeasons || []).find(s => s.id === db.viewSeasonId) || null;
}

export function getActiveSeason(){
  const db = getDB();
  return db.seasons.find(s => s.active) || db.seasons[0] || null;
}

// ============================================================
// LISTA PARA EL SELECTOR
// ============================================================
export function getSeasonList(){
  const db = getDB();
  const active = db.seasons.find(s => s.active);
  const archived = [...(db.archivedSeasons || [])].sort((a,b) =>
    (b.archivedAt || '').localeCompare(a.archivedAt || '')
  );
  return { active, archived };
}

// ============================================================
// VALIDACIÓN PARA TERMINAR TEMPORADA
// ============================================================
export function canFinishSeason(){
  const db = getDB();
  const active = db.seasons.find(s => s.active);
  if(!active) return { ok: false, errors: ['No hay temporada activa.'] };

  const activeDivisions = db.divisions.filter(d =>
    d.visible !== false &&
    (d.seasonId === active.id || !d.seasonId)
  );

  if(activeDivisions.length === 0){
    return { ok: false, errors: ['No hay divisiones activas en esta temporada.'] };
  }

  const divisionStatus = [];
  const errors = [];

  for(const div of activeDivisions){
    const playoff = (db.playoffs || []).find(p => p.divisionId === div.id);
    let champion = null;
    let championType = null;

    if(playoff && playoff.championId){
      const t = db.teams.find(x => x.id === playoff.championId);
      if(t){
        champion = { teamId: t.id, teamName: t.name, logo: t.logo };
        championType = 'playoffs';
      }
    }

    if(!champion){
      const standings = computeStandings(div.id, active.id);
      if(standings.length > 0){
        const top = standings[0];
        champion = { teamId: top.teamId, teamName: top.name, logo: top.logo };
        championType = 'regular';
      }
    }

    const ready = !!champion;
    divisionStatus.push({
      divisionId: div.id,
      divisionName: div.name,
      tier: div.tier,
      champion,
      championType,
      ready
    });

    if(!ready){
      errors.push(`La división "${div.name}" no tiene equipos o campeón definido.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    seasonId: active.id,
    seasonName: active.name,
    divisionStatus
  };
}

// ============================================================
// TERMINAR TEMPORADA
// ============================================================
export function finishSeason({ autoAssignTrophies = true } = {}){
  const check = canFinishSeason();
  if(!check.ok){
    throw new Error('No se puede terminar la temporada: ' + check.errors.join(' '));
  }

  const db = getDB();
  const activeSeason = db.seasons.find(s => s.active) || db.seasons[0];
  const archivedAt = new Date().toISOString();

  // 1. Calcular movimientos de promoción/relegación
  const movements = [];
  for(const status of check.divisionStatus){
    const div = db.divisions.find(d => d.id === status.divisionId);
    if(!div) continue;
    const cfg = div.config || {};

    if(cfg.promotion?.enabled && cfg.promotion.spots > 0){
      const superior = db.divisions.find(d => d.tier === div.tier - 1);
      if(superior){
        const standings = computeStandings(div.id, activeSeason.id);
        standings.slice(0, cfg.promotion.spots).forEach(t => movements.push({
          type: 'promote',
          teamId: t.teamId,
          teamName: t.name,
          fromDivisionId: div.id,
          fromDivisionName: div.name,
          toDivisionId: superior.id,
          toDivisionName: superior.name,
          reason: `Ascenso por posición (${t.pos}º)`
        }));
      }
    }

    if(cfg.relegation?.enabled && cfg.relegation.spots > 0){
      const inferior = db.divisions.find(d => d.tier === div.tier + 1);
      if(inferior){
        const standings = computeStandings(div.id, activeSeason.id);
        standings.slice(-cfg.relegation.spots).forEach(t => movements.push({
          type: 'relegate',
          teamId: t.teamId,
          teamName: t.name,
          fromDivisionId: div.id,
          fromDivisionName: div.name,
          toDivisionId: inferior.id,
          toDivisionName: inferior.name,
          reason: `Descenso por posición (${t.pos}º)`
        }));
      }
    }
  }

  // 2. Snapshot de la temporada actual
  const snapshot = {
    seasons: JSON.parse(JSON.stringify(db.seasons)),
    divisions: JSON.parse(JSON.stringify(db.divisions)),
    teams: JSON.parse(JSON.stringify(db.teams)),
    players: JSON.parse(JSON.stringify(db.players)),
    matches: JSON.parse(JSON.stringify(db.matches)),
    playoffs: JSON.parse(JSON.stringify(db.playoffs)),
    news: JSON.parse(JSON.stringify(db.news)),
    awards: JSON.parse(JSON.stringify(db.awards || [])),
    history: JSON.parse(JSON.stringify(db.history || [])),
    transferLog: JSON.parse(JSON.stringify(db.transferLog || [])),
    trophyHistory: JSON.parse(JSON.stringify(db.trophyHistory || [])),
    trophies: JSON.parse(JSON.stringify(db.trophies || {})),
    transferBannerBg: db.transferBannerBg || '',
    config: JSON.parse(JSON.stringify(db.config))
  };

  const championByDivision = {};
  check.divisionStatus.forEach(s => {
    if(s.champion){
      championByDivision[s.divisionId] = {
        teamId: s.champion.teamId,
        teamName: s.champion.teamName,
        logo: s.champion.logo,
        type: s.championType,
        divisionName: s.divisionName,
        tier: s.tier
      };
    }
  });

  // 3. Nueva temporada
  const maxSeasonNum = db.seasons.reduce((max, s) => {
    const m = /SEASON\s+(\d+)/i.exec(s.name);
    return m ? Math.max(max, parseInt(m[1])) : max;
  }, 0);
  const newSeasonName = `SEASON ${maxSeasonNum + 1}`;
  const newSeasonId = uid('sea');

  // 4. TODO en un solo mutate (atómico)
  mutate(d => {
    // 4a. Archivar
    d.archivedSeasons.push({
      id: activeSeason.id,
      name: activeSeason.name,
      year: activeSeason.year,
      archivedAt,
      championByDivision,
      movements,
      snapshot
    });

    // 4b. Crear nueva temporada
    const oldActive = d.seasons.find(s => s.id === activeSeason.id);
    if(oldActive) oldActive.active = false;
    d.seasons.push({
      id: newSeasonId,
      name: newSeasonName,
      year: new Date().getFullYear(),
      active: true
    });

    // 4c. Actualizar seasonId en divisiones y equipos
    d.divisions.forEach(div => {
      if(div.seasonId === activeSeason.id || !div.seasonId){
        div.seasonId = newSeasonId;
      }
    });
    d.teams.forEach(team => {
      if(team.seasonId === activeSeason.id || !team.seasonId){
        team.seasonId = newSeasonId;
      }
    });

    // 4d. Aplicar movimientos de promoción/relegación
    movements.forEach(mv => {
      const team = d.teams.find(t => t.id === mv.teamId);
      if(team) team.divisionId = mv.toDivisionId;

      d.history.unshift({
        ts: archivedAt,
        action: mv.type,
        entity: 'team',
        entityId: mv.teamId,
        summary: `${mv.teamName}: ${mv.fromDivisionName} → ${mv.toDivisionName} · ${mv.reason}`,
        snapshot: null
      });
    });
    if(d.history.length > 500) d.history.length = 500;

    // 4e. Asignar trofeos automáticos
    if(autoAssignTrophies){
      autoAssignTrophiesToDB(d, championByDivision, movements, archivedAt);
    }

    // 4f. Resetear stats de jugadores (con snapshot final)
    d.players.forEach(p => {
      const s = p.seasonStats || {};
      const hasStats = (s.matchesPlayed || 0) + (s.goals || 0) + (s.assists || 0) + (s.saves || 0) + (s.shots || 0) > 0;
      if(hasStats){
        p.careerSnapshots = p.careerSnapshots || [];
        const team = d.teams.find(t => (t.roster || []).some(r => r.playerId === p.id));
        const div = team ? d.divisions.find(x => x.id === team.divisionId) : null;
        p.careerSnapshots.push({
          teamId: team?.id || null,
          teamName: team?.name || 'Agente Libre',
          divisionId: div?.id || null,
          divisionName: div?.name || '—',
          seasonId: activeSeason.id,
          seasonName: activeSeason.name,
          stats: JSON.parse(JSON.stringify(s)),
          date: Date.now(),
          reason: 'season_end'
        });
      }
      p.seasonStats = {
        goals:0, assists:0, saves:0, shots:0, pig:0,
        matchesPlayed:0, mvps:0,
        pigHistory:[], avgLast5PIG:0, avgPIGPerMatch:0
      };
      p.pigHistory = [];
      p.pigTrend = '—';
    });

    // 4g. Limpiar datos de la temporada vieja
    d.matches = [];
    d.playoffs = [];
    d.news = [];
    d.transferQueue = [];
  });

  // 5. Salir del modo lectura si estaba activo
  if(db.viewSeasonId) setViewSeasonId(null);

  return {
    archivedSeasonId: activeSeason.id,
    archivedSeasonName: activeSeason.name,
    newSeasonId,
    newSeasonName,
    championByDivision,
    movements
  };
}

// ============================================================
// CAMBIO DE TEMPORADA (view mode)
// ============================================================
export function switchToSeason(seasonId){
  setViewSeasonId(seasonId || null);
}

// ============================================================
// EXPORTAR TEMPORADA INDIVIDUAL
// ============================================================
export function exportSeason(seasonId){
  const db = getDB();
  const arch = (db.archivedSeasons || []).find(s => s.id === seasonId);
  if(!arch){
    toast('Temporada no encontrada', 'error');
    return;
  }
  const data = {
    meta: { exportedAt: new Date().toISOString(), version: '3', kind: 'zenith-season' },
    season: { id: arch.id, name: arch.name, year: arch.year, archivedAt: arch.archivedAt },
    championByDivision: arch.championByDivision,
    movements: arch.movements || [],
    snapshot: arch.snapshot
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ZENITH_SEASON_${(arch.name || 'season').replace(/\s+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Temporada exportada', 'success');
}

// ============================================================
// RESETEAR DIVISIONES (opción C)
// ============================================================
export function resetDivisions(){
  const db = getDB();
  if(db.viewSeasonId){
    throw new Error('No puedes resetear mientras ves una temporada archivada.');
  }

  mutate(d => {
    // Quitar equipos de sus divisiones
    d.teams.forEach(t => {
      if(t.divisionId){
        t.retiredFromDivisionId = t.divisionId;
        t.divisionId = null;
        t.retiredAt = new Date().toISOString();
      }
    });

    if(!d.unassignedTeams) d.unassignedTeams = [];
    d.teams.forEach(t => {
      if(!d.unassignedTeams.includes(t.id)) d.unassignedTeams.push(t.id);
    });

    // Limpiar calendario y playoffs de la temporada activa
    d.matches = [];
    d.playoffs = [];

    d.history.unshift({
      ts: new Date().toISOString(),
      action: 'reset',
      entity: 'divisions',
      entityId: null,
      summary: 'Divisiones reseteadas: equipos sin asignar, calendario y playoffs limpiados.',
      snapshot: null
    });
    if(d.history.length > 500) d.history.length = 500;
  });
}