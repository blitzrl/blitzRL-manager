import { getDB, mutate } from '../services/storage.js';
import { uid } from '../data/database.js';
import { state } from '../state.js';
import { openModal, toast, confirmDialog, closeTopModal } from '../services/ui.js';
import { logChange } from '../services/history.js';
import { NATIONS, RANKS, PLATFORMS, RANK_LEVELS, RANK_DIVISIONS, getNationFlag, getRankColor } from '../data/nations.js';
import { openRowActions } from '../services/transfers.js';
import { renderVitrina } from '../services/trophies.js';
import { recordTransaction, getTeamSquadValue } from '../services/economy.js';

export function teamsView(){
  const db = getDB();
  const activeDivisionId = state.divisionId;
  const teams = db.teams.filter(t => !activeDivisionId || t.divisionId === activeDivisionId);
  return `
    <div class="page-head">
      <h1 class="page-title">EQUIPOS</h1>
      <button class="btn btn-primary" id="btnNewTeam">+ NUEVO EQUIPO</button>
    </div>
    <div class="grid grid-3">
      ${teams.map(t=>teamCard(t)).join('') || '<div class="card">Sin equipos registrados.</div>'}
    </div>
  `;
}

function teamCard(t){
  const db = getDB();
  const roster = t.roster.map(r => ({
    ...r,
    player: db.players.find(p=>p.id===r.playerId)
  }));
  const trophies = t.trophies || [];
  
  const squadValue = getTeamSquadValue(t.id);
  const balance = t.money || 0;
  const isDebt = balance < 0;

  return `
    <div class="card">
      <div class="team-card-head" style="align-items:flex-start">
        <div class="team-logo-box">
          ${t.logo ? `<img src="${t.logo}" class="team-logo-img">` : '<span class="team-logo-fallback">◆</span>'}
        </div>
        <div style="flex:1;min-width:0">
          <div class="team-name">${t.name}</div>
          <div class="team-coach">Coach: ${t.coach||'—'}</div>
          <div style="margin-top:6px;font-size:11px;line-height:1.4">
            <div style="color:var(--accent)">Valor plantilla: <b>$${squadValue.toLocaleString()}</b></div>
            ${isDebt 
              ? `<div style="color:var(--danger)">Deuda: <b>$${Math.abs(balance).toLocaleString()}</b></div>`
              : `<div style="color:var(--success)">Saldo: <b>$${balance.toLocaleString()}</b></div>`
            }
          </div>
        </div>
      </div>
      <div class="divider"></div>
      <div class="roster-label">ROSTER</div>
      ${roster.map(r=>{
        const rankColor = r.player ? getRankColor(r.player.rank, r.player.rankLevel) : 'var(--silver)';
        return `
        <div class="roster-row" data-open-player="${r.player?.id||''}">
          <div class="roster-row-main">
            ${r.player?.profilePicture
              ? `<img class="roster-avatar" src="${r.player.profilePicture}">`
              : `<div class="roster-avatar roster-avatar-empty">${(r.player?.name||'?').slice(0,2).toUpperCase()}</div>`}
            <span class="roster-name" style="color:${rankColor}">${r.player?.name || '?'}</span>
            ${r.player?.nationalityCode ? `<span class="roster-flag">${getNationFlag(r.player.nationalityCode)}</span>` : ''}
          </div>
          <span class="badge ${r.role==='CAPITÁN'?'badge-gold':''}">${r.role}</span>
        </div>`;}).join('')}
      ${trophies.length > 0 ? `<div class="card-vitrina">${renderVitrina(trophies, { compact: true })}</div>` : ''}
      <div class="card-actions">
        <button class="btn btn-sm" data-edit-team="${t.id}">EDITAR</button>
        <button class="btn btn-sm btn-danger" data-del-team="${t.id}">ELIMINAR</button>
      </div>
    </div>
  `;
}

export function bindTeamsEvents(){
  document.getElementById('btnNewTeam')?.addEventListener('click', ()=>openTeamForm());
  document.querySelectorAll('[data-edit-team]').forEach(b =>
    b.addEventListener('click', ()=>openTeamForm(b.dataset.editTeam)));
  document.querySelectorAll('[data-del-team]').forEach(b =>
    b.addEventListener('click', ()=>confirmDialog('¿Eliminar equipo?', ()=>{
      try {
        const id = b.dataset.delTeam;
        const name = getDB().teams.find(t=>t.id===id)?.name;
        mutate(d => { d.teams = d.teams.filter(t => t.id !== id); });
        try { logChange('delete', 'team', id, `Equipo "${name}" eliminado`); } catch(e){ console.warn(e); }
        toast('Equipo eliminado','success');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch(e) {
        toast('Error al eliminar: ' + e.message, 'error');
      }
    })));
  document.querySelectorAll('[data-open-player]').forEach(row => {
    row.addEventListener('click', (e) => {
      if(e.target.closest('button')) return;
      const pid = row.dataset.openPlayer;
      if(pid) location.hash = '#/players/' + pid;
    });
  });
}

export function openTeamForm(teamId=null){
  const db = getDB();
  const team = teamId ? db.teams.find(t=>t.id===teamId) : null;
  const activeSeason = db.seasons.find(s => s.active) || db.seasons[0];
  const seasonId = activeSeason?.id || db.seasons[0]?.id;
  const activeDivisionId = state.divisionId || db.divisions[0].id;

  const formState = {
    logo: team?.logo || '',
    name: team?.name || '',
    coach: team?.coach || '',
    money: team?.money || 0,
    roster: team ? JSON.parse(JSON.stringify(team.roster)) : []
  };

  openModal({
    id: 'team-form-' + (teamId || 'new'),
    title: team ? 'EDITAR EQUIPO' : 'NUEVO EQUIPO',
    wide: true,
    body: `<div id="teamFormBody">${renderTeamFormBody(formState, db)}</div>`,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="saveTeam">GUARDAR</button>
    `,
    onMount: (root) => {
      bindTeamForm(root, formState, db, team, seasonId, activeDivisionId, { close: () => closeTopModal() });
    }
  });
}

function renderTeamFormBody(formState, db){
  const isDebt = formState.money < 0;
  return `
    <div class="field">
      <label>Logo</label>
      <div class="dropzone" id="logoDrop">${formState.logo ? `<img src="${formState.logo}" class="dropzone-preview">` : 'Subir imagen'}</div>
      <input type="file" id="logoInput" accept="image/*" hidden>
    </div>
    <div class="row">
      <div class="field"><label>Nombre</label><input class="input" id="tName" value="${formState.name}"></div>
      <div class="field"><label>Coach</label><input class="input" id="tCoach" value="${formState.coach}"></div>
    </div>
    <div class="field">
      <label>Saldo / Dinero ($)</label>
      <input class="input" type="number" id="tMoney" value="${formState.money}">
      <small class="field-hint" style="color:${isDebt ? 'var(--danger)' : 'var(--muted)'}">Los cambios manuales se registrarán como "Ajuste manual".</small>
    </div>
    <div class="divider"></div>
    <div class="section-minihead">
      <span>ROSTER (máx. ${db.config.rosterRules.max})</span>
      <button class="btn btn-sm btn-primary" id="addRosterRow" type="button">+ AÑADIR JUGADOR</button>
    </div>
    <div id="rosterRows" class="roster-edit-list"></div>
  `;
}

function renderRosterRows(formState, db, container){
  if(formState.roster.length === 0){
    container.innerHTML = `<div class="roster-empty">Sin jugadores.</div>`;
    return;
  }
  container.innerHTML = formState.roster.map((r,i)=>{
    const p = db.players.find(x=>x.id===r.playerId);
    const rankColor = p ? getRankColor(p.rank, p.rankLevel) : 'var(--silver)';
    return `
      <div class="roster-edit-row">
        ${p?.profilePicture ? `<img class="roster-avatar" src="${p.profilePicture}">` : `<div class="roster-avatar roster-avatar-empty">${(p?.name||'?').slice(0,2).toUpperCase()}</div>`}
        <div class="roster-edit-info">
          <div class="roster-edit-name" style="color:${rankColor}">${p?.name || '<em>Sin nombre</em>'}</div>
        </div>
        <select class="select roster-edit-role" data-row-role="${i}">${['CAPITÁN','TITULAR','SUPLENTE'].map(x=>`<option ${r.role===x?'selected':''}>${x}</option>`).join('')}</select>
        <button class="btn btn-sm" data-row-edit="${i}" type="button">EDITAR</button>
        <button class="btn btn-sm btn-danger" data-row-del="${i}" type="button">✕</button>
      </div>`;
  }).join('');

  container.querySelectorAll('[data-row-del]').forEach(b => b.addEventListener('click', ()=>{ formState.roster.splice(+b.dataset.rowDel,1); renderRosterRows(formState, db, container); }));
  container.querySelectorAll('[data-row-edit]').forEach(b => b.addEventListener('click', ()=>{
    const idx = +b.dataset.rowEdit;
    openPlayerForm(formState.roster[idx].playerId, (updated) => { formState.roster[idx].playerId = updated.id; renderRosterRows(formState, db, container); });
  }));
}

function bindTeamForm(root, formState, db, team, seasonId, activeDivisionId, modalCtl){
  const nameInput = root.querySelector('#tName');
  const coachInput = root.querySelector('#tCoach');
  const moneyInput = root.querySelector('#tMoney');
  const rosterRows = root.querySelector('#rosterRows');

  nameInput.addEventListener('input', ()=> formState.name = nameInput.value);
  coachInput.addEventListener('input', ()=> formState.coach = coachInput.value);
  moneyInput.addEventListener('input', ()=> formState.money = +moneyInput.value || 0);

  root.querySelector('#addRosterRow').addEventListener('click', ()=>{
    if(formState.roster.length >= db.config.rosterRules.max) return toast('Máximo alcanzado','error');
    openPlayerForm(null, (newPlayer)=>{
      formState.roster.push({ playerId: newPlayer.id, role: 'TITULAR' });
      renderRosterRows(formState, db, rosterRows);
    });
  });

  renderRosterRows(formState, db, rosterRows);

  root.querySelector('#saveTeam').addEventListener('click', ()=>{
    try {
      const name = formState.name.trim();
      if(!name) return toast('Nombre obligatorio','error');

      rosterRows.querySelectorAll('[data-row-role]').forEach(inp => {
        const idx = +inp.dataset.rowRole;
        if(formState.roster[idx]) formState.roster[idx].role = inp.value;
      });

      const validRoster = formState.roster.filter(r => db.players.find(p=>p.id===r.playerId));
      let savedTeamId = team?.id || null;
      
      const previousMoney = team ? (team.money || 0) : 0;
      const newMoney = formState.money;
      const moneyDiff = newMoney - previousMoney;

      // 1. Guardar equipo SIN el dinero (para no duplicar el registro)
      mutate(d => {
        if(team){
          const t = d.teams.find(x=>x.id===team.id);
          if(t) Object.assign(t, { name, coach: formState.coach, logo: formState.logo, roster: validRoster });
        } else {
          savedTeamId = uid('team');
          d.teams.push({
            id: savedTeamId, name, tag:'', logo: formState.logo, coach: formState.coach,
            divisionId: activeDivisionId, seasonId, roster: validRoster, trophies: [], money: 0
          });
        }
      });

      // 2. Si el dinero cambió, registrarlo como movimiento contable
      if (team && moneyDiff !== 0) {
        recordTransaction({
          teamId: team.id,
          type: 'manual_adjust',
          amount: moneyDiff,
          reason: 'Ajuste manual desde formulario',
          meta: { previousMoney, newMoney }
        });
      } else if (!team && newMoney > 0) {
        recordTransaction({
          teamId: savedTeamId,
          type: 'manual_adjust',
          amount: newMoney,
          reason: 'Saldo inicial de equipo',
          meta: { previousMoney: 0, newMoney }
        });
      }

      toast('Equipo guardado','success');
      modalCtl.close();
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch(err) {
      toast('Error: ' + err.message, 'error');
    }
  });
}

// ... openPlayerForm y compressImage se mantienen igual
