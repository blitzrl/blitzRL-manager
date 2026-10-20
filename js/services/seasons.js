import { getDB, mutate, setViewSeasonId } from './storage.js';
import { uid } from '../data/database.js';
import { computeStandings } from './standings.js';
import { autoAssignTrophiesToDB } from './trophies.js';
import { toast } from './ui.js';
import { applySeasonBonuses, calculatePlayerPrice } from './economy.js'; // NUEVO

// ... (helpers de estado y lista para el selector se mantienen igual)

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

export function finishSeason({ autoAssignTrophies = true } = {}){
  const check = canFinishSeason();
  if(!check.ok){
    throw new Error('No se puede terminar la temporada: ' + check.errors.join(' '));
  }

  const db = getDB();
  const activeSeason = db.seasons.find(s => s.active) || db.seasons[0];
  const archivedAt = new Date().toISOString();

  // 1. Calcular movimientos
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
          type: 'promote', teamId: t.teamId, teamName: t.name,
          fromDivisionId: div.id, fromDivisionName: div.name,
          toDivisionId: superior.id, toDivisionName: superior.name,
          reason: `Ascenso por posición (${t.pos}º)`
        }));
      }
    }

    if(cfg.relegation?.enabled && cfg.relegation.spots > 0){
      const inferior = db.divisions.find(d => d.tier === div.tier + 1);
      if(inferior){
        const standings = computeStandings(div.id, activeSeason.id);
        standings.slice(-cfg.relegation.spots).forEach(t => movements.push({
          type: 'relegate', teamId: t.teamId, teamName: t.name,
          fromDivisionId: div.id, fromDivisionName: div.name,
          toDivisionId: inferior.id, toDivisionName: inferior.name,
          reason: `Descenso por posición (${t.pos}º)`
        }));
      }
    }
  }

  // 2. Snapshot
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
    economyLedger: JSON.parse(JSON.stringify(db.economyLedger || [])),
    transferBannerBg: db.transferBannerBg || '',
    config: JSON.parse(JSON.stringify(db.config))
  };

  const championByDivision = {};
  check.divisionStatus.forEach(s => {
    if(s.champion){
      championByDivision[s.divisionId] = {
        teamId: s.champion.teamId, teamName: s.champion.teamName, logo: s.champion.logo,
        type: s.championType, divisionName: s.divisionName, tier: s.tier
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

  // 4. Mutate atómico
  mutate(d => {
    d.archivedSeasons.push({
      id: activeSeason.id, name: activeSeason.name, year: activeSeason.year,
      archivedAt, championByDivision, movements, snapshot
    });

    const oldActive = d.seasons.find(s => s.id === activeSeason.id);
    if(oldActive) oldActive.active = false;
    d.seasons.push({ id: newSeasonId, name: newSeasonName, year: new Date().getFullYear(), active: true });

    d.divisions.forEach(div => {
      if(div.seasonId === activeSeason.id || !div.seasonId) div.seasonId = newSeasonId;
    });
    d.teams.forEach(team => {
      if(team.seasonId === activeSeason.id || !team.seasonId) team.seasonId = newSeasonId;
    });

    movements.forEach(mv => {
      const team = d.teams.find(t => t.id === mv.teamId);
      if(team) team.divisionId = mv.toDivisionId;
      d.history.unshift({
        ts: archivedAt, action: mv.type, entity: 'team', entityId: mv.teamId,
        summary: `${mv.teamName}: ${mv.fromDivisionName} → ${mv.toDivisionName} · ${mv.reason}`,
        snapshot: null
      });
    });
    if(d.history.length > 500) d.history.length = 500;

    if(autoAssignTrophies){
      autoAssignTrophiesToDB(d, championByDivision, movements, archivedAt);
    }

    applySeasonBonuses(d, check.divisionStatus, movements, activeSeason.id);

    // RESET STATS Y GUARDAR PRICE HISTORY
    d.players.forEach(p => {
      const s = p.seasonStats || {};
      const hasStats = (s.matchesPlayed || 0) + (s.goals || 0) + (s.assists || 0) + (s.saves || 0) + (s.shots || 0) > 0;
      
      if(hasStats){
        p.careerSnapshots = p.careerSnapshots || [];
        const team = d.teams.find(t => (t.roster || []).some(r => r.playerId === p.id));
        const div = team ? d.divisions.find(x => x.id === team.divisionId) : null;
        p.careerSnapshots.push({
          teamId: team?.id || null, teamName: team?.name || 'Agente Libre',
          divisionId: div?.id || null, divisionName: div?.name || '—',
          seasonId: activeSeason.id, seasonName: activeSeason.name,
          stats: JSON.parse(JSON.stringify(s)), date: Date.now(), reason: 'season_end'
        });

        // NUEVO: Guardar en Price History
        const pig = s.pig || 0; // O usar calculatePIG(s) si prefieres recalcular
        const price = calculatePlayerPrice(p, { pig }, d.config.economy).price;
        p.priceHistory = p.priceHistory || [];
        p.priceHistory.push({
          seasonId: activeSeason.id,
          seasonName: activeSeason.name,
          price: price,
          pig: pig,
          date: Date.now()
        });
      }
      
      p.seasonStats = { goals:0, assists:0, saves:0, shots:0, pig:0, matchesPlayed:0, mvps:0, pigHistory:[], avgLast5PIG:0, avgPIGPerMatch:0 };
      p.pigHistory = [];
      p.pigTrend = '—';
    });

    d.matches = [];
    d.playoffs = [];
    d.news = [];
    d.transferQueue = [];
  });

  if(db.viewSeasonId) setViewSeasonId(null);

  return {
    archivedSeasonId: activeSeason.id, archivedSeasonName: activeSeason.name,
    newSeasonId, newSeasonName, championByDivision, movements
  };
}

// ... (Resto de funciones: switchToSeason, exportSeason, resetDivisions sin cambios)
