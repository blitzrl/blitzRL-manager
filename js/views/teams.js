import { getDB, mutate } from '../services/storage.js';
import { uid } from '../data/database.js';
import { state } from '../state.js';
import { openModal, toast, confirmDialog, closeTopModal } from '../services/ui.js';
import { logChange } from '../services/history.js';
import { NATIONS, RANKS, PLATFORMS, RANK_LEVELS, RANK_DIVISIONS, getNationFlag, getRankColor } from '../data/nations.js';
import { openRowActions, openTransferModal } from '../services/transfers.js';
import { renderVitrina } from '../services/trophies.js';
import { recordTransaction, getTeamSquadValue } from '../services/economy.js';

let _searchQuery = '';

export function teamsView(){
  const db = getDB();
  const activeDivisionId = state.divisionId;
  const teams = db.teams.filter(t => !activeDivisionId || t.divisionId === activeDivisionId);
  
  const freeAgents = db.players.filter(p => !db.teams.some(t => (t.roster || []).some(r => r.playerId === p.id)));

  return `
    <div class="page-head" style="align-items:flex-start; flex-direction:column; gap:16px;">
      <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
        <h1 class="page-title">EQUIPOS</h1>
        <button class="btn btn-primary" id="btnNewTeam">+ NUEVO EQUIPO</button>
      </div>
      <div style="width:100%; max-width:400px;">
        <input class="input" type="text" id="teamSearchInput" placeholder="🔍 Buscar equipo o jugador..." value="${_searchQuery}">
      </div>
    </div>

    <div class="grid grid-3" id="teamsGrid">
      ${teams.map(t => teamCard(t)).join('') || '<div class="card">Sin equipos registrados.</div>'}
    </div>

    <!-- FIX: CUADRO DE AGENTES LIBRES MOVIDO ABAJO -->
    ${freeAgents.length > 0 ? `
      <div class="card" style="margin-top:24px; border-left:3px solid var(--gold);" data-searchable="agentes libres ${freeAgents.map(p => p.name).join(' ').toLowerCase()}">
        <div class="card-header">
          <div class="card-title" style="color:var(--gold)"><span class="dot" style="color:var(--gold)">◆</span>AGENTES LIBRES</div>
          <span class="card-sub">${freeAgents.length} jugadores</span>
        </div>
        <div class="grid grid-3" style="padding-top:10px;">
          ${freeAgents.map(p => `
            <div class="card" style="padding:12px; background:var(--bg-graphite); cursor:pointer;" data-open-player="${p.id}">
              <div class="player-cell" style="margin-bottom:10px;">
                 ${p.profilePicture
                    ? `<img src="${p.profilePicture}" class="player-cell-avatar">`
                    : `<div class="player-cell-avatar player-cell-avatar-empty">${(p.name||'?').slice(0,2).toUpperCase()}</div>`}
                 <div style="min-width:0;">
                    <div class="player-cell-name" style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(p.name)}</div>
                    <div style="font-size:10px; color:var(--muted);">${esc(p.rank || '—')} ${p.rankDivision && p.rank!=='SSL' ? p.rankDivision : ''}</div>
                 </div>
              </div>
              <button class="btn btn-sm btn-primary" style="width:100%;" data-fichar-free-agent="${p.id}">FICHAR</button>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
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

  const searchable = `${t.name} ${t.coach} ${roster.map(r => r.player?.name || '').join(' ')}`.toLowerCase();

  return `
    <div class="card" data-searchable="${searchable}">
      <div class="team-card-head" style="align-items:flex-start">
        <div class="team-logo-box">
          ${t.logo ? `<img src="${t.logo}" class="team-logo-img">` : '<span class="team-logo-fallback">◆</span>'}
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
            <div>
              <div class="team-name">${t.name}</div>
              <div class="team-coach">Coach: ${t.coach||'—'}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;font-size:10.5px;font-weight:600">
              <span class="chip chip-accent" style="font-size:9.5px;padding:2px 6px">Plantilla: $${squadValue.toLocaleString()}</span>
              ${isDebt 
                ? `<span class="chip" style="font-size:9.5px;padding:2px 6px;color:var(--danger);border-color:rgba(226,92,92,.35)">Deuda: $${Math.abs(balance).toLocaleString()}</span>`
                : `<span class="chip" style="font-size:9.5px;padding:2px 6px;color:var(--success);border-color:rgba(99,194,138,.35)">Saldo: $${balance.toLocaleString()}</span>`
              }
            </div>
          </div>
        </div>
      </div>
      <div class="divider"></div>
      <div class="roster-label">ROSTER</div>
      ${roster.map(r=>{
        const rankColor = r.player ? getRankColor(r.player.rank, r.player.rankLevel) : 'var(--silver)';
        return `
        <div class="roster-row" data-open-player="${r.player?.id||''}" style="cursor:pointer;">
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
  
  // FIX: Hacer clickeables a los jugadores en las tarjetas de equipo y agentes libres
  document.querySelectorAll('[data-open-player]').forEach(row => {
    row.addEventListener('click', (e) => {
      if(e.target.closest('button')) return; // Evitar que el botón Fichar dispare esto
      const pid = row.dataset.openPlayer;
      if(pid) location.hash = '#/players/' + pid;
    });
  });

  document.querySelectorAll('[data-fichar-free-agent]').forEach(btn => {
    btn.addEventListener('click', (e) => {
       e.stopPropagation();
       openTransferModal(btn.dataset.ficharFreeAgent);
    });
  });

  const searchInput = document.getElementById('teamSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      _searchQuery = e.target.value.toLowerCase();
      const cards = document.querySelectorAll('[data-searchable]');
      cards.forEach(card => {
        const text = card.dataset.searchable;
        if (text.includes(_searchQuery)) {
          card.style.display = ''; // Mostrar
        } else {
          card.style.display = 'none'; // Ocultar
        }
      });
    });
  }
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

  const drop = root.querySelector('#logoDrop');
  const input = root.querySelector('#logoInput');
  drop.addEventListener('click', ()=>input.click());
  drop.addEventListener('dragover', e=>{e.preventDefault(); drop.classList.add('dragover');});
  drop.addEventListener('dragleave', ()=>drop.classList.remove('dragover'));
  drop.addEventListener('drop', e=>{e.preventDefault(); drop.classList.remove('dragover'); handleFile(e.dataTransfer.files[0]);});
  input.addEventListener('change', ()=>handleFile(input.files[0]));

  async function handleFile(f){
    if(!f) return;
    try{
      const res = await compressImage(f, 512, 512);
      formState.logo = res;
      drop.innerHTML = `<img src="${res}" class="dropzone-preview">`;
    }catch(e){ toast('Error procesando imagen','error'); }
  }

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

      if (team && moneyDiff !== 0) {
        recordTransaction({
          teamId: team.id, type: 'manual_adjust', amount: moneyDiff,
          reason: 'Ajuste manual desde formulario', meta: { previousMoney, newMoney }
        });
      } else if (!team && newMoney > 0) {
        recordTransaction({
          teamId: savedTeamId, type: 'manual_adjust', amount: newMoney,
          reason: 'Saldo inicial de equipo', meta: { previousMoney: 0, newMoney }
        });
      }

      toast('Equipo guardado','success');
      modalCtl.close();
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch(err) {
      console.error(err);
      toast('Error al guardar: ' + err.message, 'error');
    }
  });
}

export function openPlayerForm(playerId=null, onSaved=null){
  const db = getDB();
  const player = playerId ? db.players.find(p=>p.id===playerId) : null;

  const optsRank = RANKS.map(r => `<option value="${r}" ${player?.rank===r?'selected':''}>${r}</option>`).join('');
  const optsLevel = RANK_LEVELS.map(n => `<option value="${n}" ${player?.rankLevel===n?'selected':''}>${n}</option>`).join('');
  const optsDiv = RANK_DIVISIONS.map(d => `<option value="${d}" ${player?.rankDivision===d?'selected':''}>${d}</option>`).join('');
  const optsPlatform = PLATFORMS.map(p =>
    `<option value="${p.id}" ${player?.platform===p.id?'selected':''}>${p.label}</option>`).join('');
  const optsNation = `
    <option value="">— Sin especificar —</option>
    ${NATIONS.map(n => `<option value="${n.code}" ${player?.nationalityCode===n.code?'selected':''}>${n.flag} ${n.name}</option>`).join('')}
  `;

  const extraButtons = player ? `
    <div class="player-form-actions">
      <button type="button" class="btn btn-sm" id="pfTransfer">🔄 TRANSFERIR</button>
      <button type="button" class="btn btn-sm" id="pfFree">🆓 AGENTE LIBRE</button>
      <button type="button" class="btn btn-sm btn-danger" id="pfDelete">🗑 ELIMINAR</button>
    </div>
  ` : '';

  openModal({
    id: 'player-form-' + (playerId || 'new'),
    title: player ? 'EDITAR JUGADOR' : 'NUEVO JUGADOR',
    wide: true,
    body: `
      ${extraButtons}
      <div class="player-form-head">
        <div class="player-photo-block">
          <div class="player-photo-frame" id="photoDrop">
            ${player?.profilePicture
              ? `<img id="photoImg" src="${player.profilePicture}" class="player-photo-img">`
              : `<div class="player-photo-placeholder">SIN<br>FOTO</div>`}
          </div>
          <input type="file" id="photoInput" accept="image/*" hidden>
          <button class="btn btn-sm" id="photoBtn" type="button">SUBIR FOTO</button>
          <small class="field-hint">256×256 px recomendado</small>
        </div>

        <div class="player-form-fields">
          <div class="field"><label>Nombre del jugador</label><input class="input" id="pfName" value="${player?.name||''}"></div>
          <div class="row">
            <div class="field"><label>Plataforma</label><select class="select" id="pfPlatform">${optsPlatform}</select></div>
            <div class="field"><label>Nacionalidad</label><select class="select" id="pfNation">${optsNation}</select></div>
          </div>
          <div class="row-3">
            <div class="field"><label>Rango</label><select class="select" id="pfRank">${optsRank}</select></div>
            <div class="field" id="levelWrap"><label>Nivel</label><select class="select" id="pfLevel">${optsLevel}</select></div>
            <div class="field" id="divWrap"><label>División</label><select class="select" id="pfDiv">${optsDiv}</select></div>
          </div>
          <div class="field">
            <label>RL Tracker (URL del perfil)</label>
            <input class="input" id="pfTracker" type="url" placeholder="https://rocketleague.tracker.network/rocket-league/profile/..." value="${player?.rlTracker||''}">
          </div>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="savePlayer">GUARDAR JUGADOR</button>
    `,
    onMount: (root) => {
      let photoData = player?.profilePicture || '';
      const photoDrop = root.querySelector('#photoDrop');
      const photoInput = root.querySelector('#photoInput');
      const photoBtn = root.querySelector('#photoBtn');
      const openPicker = () => photoInput.click();
      photoDrop.addEventListener('click', openPicker);
      photoBtn.addEventListener('click', openPicker);
      photoInput.addEventListener('change', () => handlePhoto(photoInput.files[0]));

      async function handlePhoto(f){
        if(!f) return;
        try{
          const res = await compressImage(f, 256, 256);
          photoData = res;
          photoDrop.innerHTML = `<img src="${res}" class="player-photo-img">`;
        }catch(e){ toast('Error procesando foto','error'); }
      }

      const rankSel = root.querySelector('#pfRank');
      const levelWrap = root.querySelector('#levelWrap');
      const divWrap = root.querySelector('#divWrap');
      function refresh(){
        const isSSL = rankSel.value === 'SSL';
        levelWrap.style.display = isSSL ? 'none' : '';
        divWrap.style.display = isSSL ? 'none' : '';
      }
      rankSel.addEventListener('change', refresh);
      refresh();

      if(player){
        const importLazy = async () => await import('../services/transfers.js');
        root.querySelector('#pfTransfer')?.addEventListener('click', async () => {
          closeTopModal();
          setTimeout(async () => {
            const { openTransferModal } = await importLazy();
            openTransferModal(player.id);
          }, 100);
        });
        root.querySelector('#pfFree')?.addEventListener('click', async () => {
          if(!confirm(`¿Convertir a ${player.name} en agente libre?`)) return;
          const { doFreeAgent } = await importLazy();
          doFreeAgent(player.id);
        });
        root.querySelector('#pfDelete')?.addEventListener('click', async () => {
          if(!confirm(`⚠️ ¿Eliminar definitivamente a ${player.name}?`)) return;
          const { doDeletePlayer } = await importLazy();
          doDeletePlayer(player.id);
        });
      }

      root.querySelector('#savePlayer').addEventListener('click', ()=>{
        try {
          const name = root.querySelector('#pfName').value.trim();
          if(!name) return toast('El nombre es obligatorio','error');
          const rank = root.querySelector('#pfRank').value;
          const isSSL = rank === 'SSL';
          const payload = {
            name,
            platform: root.querySelector('#pfPlatform').value,
            nationalityCode: root.querySelector('#pfNation').value,
            rank,
            rankLevel: isSSL ? null : +root.querySelector('#pfLevel').value,
            rankDivision: isSSL ? null : root.querySelector('#pfDiv').value,
            rlTracker: root.querySelector('#pfTracker').value.trim(),
            profilePicture: photoData
          };

          let saved;
          mutate(d => {
            if(player){
              const p = d.players.find(x=>x.id===player.id);
              if(!p) throw new Error('El jugador ya no existe');
              Object.assign(p, payload);
              saved = p;
            } else {
              saved = {
                id: uid('ply'),
                history: [], sanctions: [], pigHistory: [], pigTrend: '—',
                careerSnapshots: [], trophies: [], priceHistory: [], status: 'owned', pendingTeamId: null,
                ...payload
              };
              d.players.push(saved);
            }
          });

          try { logChange(player?'edit':'create','player', saved.id, `Jugador "${name}" ${player?'editado':'creado'}`); }
          catch(e){ console.warn(e); }

          toast('Jugador guardado','success');
          closeTopModal();
          onSaved?.(saved);
          if(location.hash.startsWith('#/players')) window.dispatchEvent(new HashChangeEvent('hashchange'));
        } catch(err) {
          console.error('[ZENITH] Error guardando jugador:', err);
          toast('Error al guardar: ' + (err.message || 'desconocido'), 'error');
        }
      });
    }
  });
}

export function compressImage(file, maxW, maxH){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const ratio = Math.min(maxW / width, maxH / height, 1);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/webp', 0.85));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}
