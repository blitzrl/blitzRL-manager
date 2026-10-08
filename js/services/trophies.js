// ============================================================
// TROPHIES — Configuración y asignación de trofeos
// ============================================================
import { getDB, mutate } from './storage.js';
import { uid } from '../data/database.js';

export const TROPHY_TYPES = [
  { id: 'league',     label: 'Campeón Liga' },
  { id: 'playoffs',   label: 'Campeón Playoffs' },
  { id: 'promotion',  label: 'Ascenso' },
  { id: 'relegation', label: 'Descenso' }
];

export function getTrophyConfig(divisionId, type){
  const db = getDB();
  return db.trophies?.[divisionId]?.[type] || { name: '', image: '' };
}

export function saveTrophyConfig(divisionId, type, { name, image }){
  mutate(d => {
    d.trophies ||= {};
    d.trophies[divisionId] ||= {};
    d.trophies[divisionId][type] ||= {};
    d.trophies[divisionId][type].name  = name  || '';
    d.trophies[divisionId][type].image = image || '';
  });
}

export function assignTrophyToTeam(teamId, trophy){
  mutate(d => {
    const t = d.teams.find(x => x.id === teamId);
    if(!t) return;
    t.trophies ||= [];
    t.trophies.push({ id: uid('tro'), date: Date.now(), ...trophy });
    d.trophyHistory.push({ id: uid('th'), target: 'team', targetId: teamId, date: Date.now(), ...trophy });
  });
}

export function assignTrophyToPlayer(playerId, trophy){
  mutate(d => {
    const p = d.players.find(x => x.id === playerId);
    if(!p) return;
    p.trophies ||= [];
    p.trophies.push({ id: uid('tro'), date: Date.now(), ...trophy });
    d.trophyHistory.push({ id: uid('th'), target: 'player', targetId: playerId, date: Date.now(), ...trophy });
  });
}

// ============================================================
// ELIMINAR TROFEOS
// ============================================================
export function removeTrophyFromTeam(teamId, trophyId){
  mutate(d => {
    const t = d.teams.find(x => x.id === teamId);
    if(!t) return;
    t.trophies = (t.trophies || []).filter(tr => tr.id !== trophyId);
    d.trophyHistory = (d.trophyHistory || []).filter(th => !(th.target === 'team' && th.targetId === teamId && th.id === trophyId));
  });
}

export function removeTrophyFromPlayer(playerId, trophyId){
  mutate(d => {
    const p = d.players.find(x => x.id === playerId);
    if(!p) return;
    p.trophies = (p.trophies || []).filter(tr => tr.id !== trophyId);
    d.trophyHistory = (d.trophyHistory || []).filter(th => !(th.target === 'player' && th.targetId === playerId && th.id === trophyId));
  });
}

// ============================================================
// HELPERS INTERNOS
// ============================================================
function pushTrophyToTeam(d, team, trophy){
  team.trophies ||= [];
  team.trophies.push({ ...trophy, id: uid('tro') });
  d.trophyHistory.push({
    id: uid('th'),
    target: 'team',
    targetId: team.id,
    targetName: team.name,
    ...trophy
  });
}

function pushTrophyToPlayerRoster(d, team, trophy){
  (team.roster || []).forEach(r => {
    const player = d.players.find(p => p.id === r.playerId);
    if(!player) return;
    player.trophies ||= [];
    const playerTrophy = {
      ...trophy,
      id: uid('tro'),
      fromTeamId: team.id,
      fromTeamName: team.name,
      wonWith: `${trophy.divisionName || ''} - ${team.name}`.replace(/^ - /, '')
    };
    player.trophies.push(playerTrophy);
    d.trophyHistory.push({
      id: uid('th'),
      target: 'player',
      targetId: player.id,
      targetName: player.name,
      ...playerTrophy
    });
  });
}

// ============================================================
// ASIGNACIÓN AUTOMÁTICA AL TERMINAR TEMPORADA
// ============================================================
export function autoAssignTrophiesToDB(d, championByDivision, movements, date){
  d.trophies ||= {};
  d.trophyHistory ||= [];

  Object.entries(championByDivision || {}).forEach(([divId, champ]) => {
    if(!champ || !champ.teamId) return;
    const divCfg = d.trophies[divId] || {};
    const trophyCfg = champ.type === 'playoffs'
      ? (divCfg.playoffs || divCfg.league)
      : (divCfg.league || divCfg.playoffs);

    if(!trophyCfg || (!trophyCfg.name && !trophyCfg.image)) return;

    const team = d.teams.find(t => t.id === champ.teamId);
    if(!team) return;

    const trophy = {
      name: trophyCfg.name || (champ.type === 'playoffs' ? 'Campeón Playoffs' : 'Campeón Liga'),
      image: trophyCfg.image || '',
      date: Date.now(),
      auto: true,
      type: champ.type === 'playoffs' ? 'playoffs' : 'league',
      divisionId: divId,
      divisionName: champ.divisionName || '',
      teamName: team.name
    };

    pushTrophyToTeam(d, team, trophy);
    pushTrophyToPlayerRoster(d, team, trophy);
  });

  (movements || []).filter(mv => mv.type === 'promote').forEach(mv => {
    const divCfg = d.trophies[mv.fromDivisionId] || {};
    const promo = divCfg.promotion;
    if(!promo || (!promo.name && !promo.image)) return;

    const team = d.teams.find(t => t.id === mv.teamId);
    if(!team) return;

    const trophy = {
      name: promo.name || 'Ascenso',
      image: promo.image || '',
      date: Date.now(),
      auto: true,
      type: 'promotion',
      divisionId: mv.fromDivisionId,
      divisionName: mv.fromDivisionName || '',
      teamName: team.name
    };

    pushTrophyToTeam(d, team, trophy);
    pushTrophyToPlayerRoster(d, team, trophy);
  });
}

// ============================================================
// RENDER
// ============================================================
export function renderTrophySlot(tr, options = {}){
  const year = tr.date ? new Date(tr.date).getFullYear() : '';
  let tooltip = tr.name || 'Trofeo';
  if(tr.wonWith) tooltip = `${tr.name} · ${tr.wonWith}`;
  else if(tr.divisionName && tr.teamName) tooltip = `${tr.name} · ${tr.divisionName} - ${tr.teamName}`;
  else if(tr.teamName) tooltip = `${tr.name} · ${tr.teamName}`;

  const removable = options.removable;
  return `
    <div class="vitrina-slot" title="${esc(tooltip)}" data-trophy-id="${tr.id || ''}">
      ${tr.image ? `<img src="${tr.image}" alt="">` : '<span class="vitrina-icon">🏆</span>'}
      <div class="vitrina-name">${esc(tr.name)}</div>
      ${year ? `<div class="vitrina-year">${year}</div>` : ''}
      ${removable ? `<button class="vitrina-remove" data-remove-trophy="${tr.id || ''}" title="Quitar trofeo">🗑</button>` : ''}
    </div>
  `;
}

export function renderVitrina(trophies, { compact = false, emptyMessage = 'Sin trofeos todavía', removable = false } = {}){
  const list = trophies || [];
  const items = compact ? list.slice(0, 4) : list;
  return `
    <div class="vitrina-wrap">
      <div class="vitrina-title">🏆 VITRINA · ${list.length} TROFEOS</div>
      <div class="vitrina-grid ${compact ? 'vitrina-compact' : ''}">
        ${items.length === 0
          ? `<div class="vitrina-empty">${esc(emptyMessage)}</div>`
          : items.map(tr => renderTrophySlot(tr, { removable })).join('')}
        ${compact && list.length > 4 ? `<div class="vitrina-more">+${list.length - 4}</div>` : ''}
      </div>
    </div>
  `;
}

// ============================================================
// LISTA PLANA DE TROFEOS EXISTENTES
// ============================================================
export function listExistingTrophies(){
  const db = getDB();
  const out = [];
  const trophies = db.trophies || {};
  Object.entries(trophies).forEach(([divId, types]) => {
    const div = db.divisions.find(d => d.id === divId);
    const divName = div?.name || 'División';
    const tier = div?.tier || '';
    Object.entries(types || {}).forEach(([type, cfg]) => {
      if(!cfg || (!cfg.name && !cfg.image)) return;
      const typeMeta = TROPHY_TYPES.find(t => t.id === type);
      out.push({
        key: `${divId}::${type}`,
        divisionId: divId,
        divisionName: divName,
        tier,
        type,
        typeLabel: typeMeta?.label || type,
        name: cfg.name || typeMeta?.label || type,
        image: cfg.image || '',
        label: `${tier ? tier + 'ª · ' : ''}${divName} — ${cfg.name || typeMeta?.label || type}`
      });
    });
  });
  return out;
}

function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}