import { getDB, mutate } from '../services/storage.js';
import { uid } from '../data/database.js';
import { toast, openModal, closeTopModal } from '../services/ui.js';
import { compressImage } from './teams.js';
import { getNationFlag, NATIONS } from '../data/nations.js';

export function coachesView(){
  const db = getDB();
  const coaches = db.coaches || [];

  return `
    <div class="page-head">
      <h1 class="page-title">STAFF TÉCNICO</h1>
      <button class="btn btn-primary" id="btnNewCoach">+ NUEVO COACH/AUXILIAR</button>
    </div>

    <div class="grid grid-3">
      ${coaches.map(c => coachCard(c, db)).join('') || '<div class="card" style="grid-column:1/-1;text-align:center;padding:40px;color:var(--muted)">No hay coaches registrados.</div>'}
    </div>
  `;
}

function coachCard(c, db) {
  const team = db.teams.find(t => t.id === c.teamId);
  const isPlayer = c.playerId;
  const flag = c.nationalityCode ? getNationFlag(c.nationalityCode) : '';
  
  return `
    <div class="card">
      <div style="display:flex; gap:14px; align-items:center; margin-bottom:14px">
        <div class="team-logo-box-lg" style="border-radius:50%">
          ${c.profilePicture ? `<img src="${c.profilePicture}" class="team-logo-img" style="border-radius:50%">` : '<span class="team-logo-fallback">👤</span>'}
        </div>
        <div>
          <div style="font-size:16px; font-weight:600; color:var(--silver-light)">${c.name} ${flag}</div>
          <div style="font-size:12px; color:var(--muted); margin-top:2px">${c.roleType === 'coach' ? 'Head Coach' : 'Asistente'}</div>
          ${team ? `<div class="chip chip-accent" style="margin-top:6px;font-size:10px">${team.name}</div>` : `<div class="chip" style="margin-top:6px;font-size:10px;color:var(--gold)">AGENTE LIBRE</div>`}
        </div>
      </div>
      <div class="divider"></div>
      <div style="font-size:11px; color:var(--muted); margin-bottom:12px">
        ${isPlayer ? '🔗 Licencia vinculada a jugador' : 'Puro Staff'}
      </div>
      <div class="card-actions">
        <button class="btn btn-sm" data-edit-coach="${c.id}">EDITAR</button>
        <button class="btn btn-sm btn-danger" data-del-coach="${c.id}">ELIMINAR</button>
      </div>
    </div>
  `;
}

export function bindCoachesEvents(){
  document.getElementById('btnNewCoach')?.addEventListener('click', () => openCoachForm());

  document.querySelectorAll('[data-edit-coach]').forEach(b => {
    b.addEventListener('click', () => openCoachForm(b.dataset.editCoach));
  });

  document.querySelectorAll('[data-del-coach]').forEach(b => {
    b.addEventListener('click', () => {
      if (!confirm('¿Eliminar este perfil de coach?')) return;
      mutate(d => { d.coaches = d.coaches.filter(x => x.id !== b.dataset.delCoach); });
      toast('Coach eliminado', 'success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  });
}

function openCoachForm(coachId = null) {
  const db = getDB();
  const coach = coachId ? db.coaches.find(c => c.id === coachId) : null;
  
  const state = {
    profilePicture: coach?.profilePicture || '',
    name: coach?.name || '',
    roleType: coach?.roleType || 'coach',
    teamId: coach?.teamId || '',
    playerId: coach?.playerId || '',
    nationalityCode: coach?.nationalityCode || '',
    rlTracker: coach?.rlTracker || '',
    socials: coach?.socials || { twitter: '', twitch: '', instagram: '' }
  };

  openModal({
    id: 'coach-form-' + (coachId || 'new'),
    title: coach ? 'EDITAR COACH' : 'NUEVO COACH',
    wide: true,
    body: `
      <div class="row">
        <div class="field" style="align-items:center">
          <div class="player-photo-frame" id="cPhotoDrop" style="cursor:pointer; width:100px; height:100px;">
            ${state.profilePicture ? `<img src="${state.profilePicture}" class="player-photo-img">` : '<div class="player-photo-placeholder">FOTO</div>'}
          </div>
          <input type="file" id="cPhotoInput" accept="image/*" hidden>
          <button class="btn btn-sm" id="cPhotoBtn" type="button" style="margin-top:8px">SUBIR FOTO</button>
        </div>
        <div style="flex:1">
          <div class="row">
            <div class="field"><label>Nombre</label><input class="input" id="cName" value="${state.name}"></div>
            <div class="field"><label>Rol</label>
              <select class="select" id="cRole">
                <option value="coach" ${state.roleType === 'coach' ? 'selected' : ''}>Head Coach</option>
                <option value="assistant" ${state.roleType === 'assistant' ? 'selected' : ''}>Asistente</option>
              </select>
            </div>
          </div>
          <div class="row">
            <div class="field"><label>Equipo (Opcional)</label>
              <select class="select" id="cTeam">
                <option value="">— Sin Equipo (Agente Libre) —</option>
                ${db.teams.map(t => `<option value="${t.id}" ${state.teamId === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
              </select>
            </div>
            <div class="field"><label>Vincular a Jugador (Opcional)</label>
              <select class="select" id="cPlayer">
                <option value="">— No es jugador —</option>
                ${db.players.map(p => `<option value="${p.id}" ${state.playerId === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
      </div>
      <div class="row">
        <div class="field"><label>Nacionalidad</label>
          <select class="select" id="cNation">
            <option value="">— Sin especificar —</option>
            ${NATIONS.map(n => `<option value="${n.code}" ${state.nationalityCode === n.code ? 'selected' : ''}>${n.flag} ${n.name}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>RL Tracker</label><input class="input" id="cTracker" value="${state.rlTracker}"></div>
      </div>
      <div class="row-3">
        <div class="field"><label>Twitter</label><input class="input" id="cTwitter" value="${state.socials.twitter}"></div>
        <div class="field"><label>Twitch</label><input class="input" id="cTwitch" value="${state.socials.twitch}"></div>
        <div class="field"><label>Instagram</label><input class="input" id="cInsta" value="${state.socials.instagram}"></div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="saveCoach">GUARDAR</button>
    `,
    onMount: (root) => {
      const photoDrop = root.querySelector('#cPhotoDrop');
      const photoInput = root.querySelector('#cPhotoInput');
      const photoBtn = root.querySelector('#cPhotoBtn');
      photoBtn.addEventListener('click', () => photoInput.click());
      photoDrop.addEventListener('click', () => photoInput.click());
      
      photoInput.addEventListener('change', async () => {
        const f = photoInput.files[0];
        if (!f) return;
        try {
          const res = await compressImage(f, 256, 256);
          state.profilePicture = res;
          photoDrop.innerHTML = `<img src="${res}" class="player-photo-img">`;
        } catch (e) { toast('Error con la foto', 'error'); }
      });

      root.querySelector('#cPlayer').addEventListener('change', (e) => {
        const pid = e.target.value;
        if (pid) {
          const p = db.players.find(x => x.id === pid);
          if (p) {
            root.querySelector('#cName').value = p.name;
            root.querySelector('#cNation').value = p.nationalityCode || '';
            root.querySelector('#cTracker').value = p.rlTracker || '';
            if (p.profilePicture) {
               state.profilePicture = p.profilePicture;
               photoDrop.innerHTML = `<img src="${p.profilePicture}" class="player-photo-img">`;
            }
          }
        }
      });

      root.querySelector('#saveCoach').addEventListener('click', () => {
        const name = root.querySelector('#cName').value.trim();
        if (!name) return toast('El nombre es obligatorio', 'error');

        const payload = {
          id: coachId || uid('ch'),
          name,
          roleType: root.querySelector('#cRole').value,
          teamId: root.querySelector('#cTeam').value || null,
          playerId: root.querySelector('#cPlayer').value || null,
          nationalityCode: root.querySelector('#cNation').value,
          rlTracker: root.querySelector('#cTracker').value,
          socials: {
            twitter: root.querySelector('#cTwitter').value,
            twitch: root.querySelector('#cTwitch').value,
            instagram: root.querySelector('#cInsta').value
          },
          profilePicture: state.profilePicture,
          history: coach?.history || [],
          trophies: coach?.trophies || []
        };

        mutate(d => {
          if (coachId) {
            const idx = d.coaches.findIndex(x => x.id === coachId);
            d.coaches[idx] = payload;
          } else {
            d.coaches.push(payload);
          }

          // Sincronizar nombre en el equipo
          if (payload.teamId) {
            const team = d.teams.find(t => t.id === payload.teamId);
            if (team) {
              if (payload.roleType === 'coach') team.coach = payload.name;
              if (payload.roleType === 'assistant') team.assistant = payload.name;
            }
          }
        });

        toast('Coach guardado', 'success');
        closeTopModal();
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    }
  });
}

export function showCoachProfile(coachId) {
  const db = getDB();
  const c = db.coaches.find(x => x.id === coachId);
  if (!c) return;

  const team = db.teams.find(t => t.id === c.teamId);
  const flag = c.nationalityCode ? getNationFlag(c.nationalityCode) : '';

  openModal({
    id: 'coach-profile-' + coachId,
    title: 'PERFIL DE COACH',
    body: `
      <div style="display:flex; gap:20px; align-items:center; margin-bottom:20px">
        <div class="team-logo-box-xl" style="border-radius:50%">
          ${c.profilePicture ? `<img src="${c.profilePicture}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : '👤'}
        </div>
        <div>
          <h2 style="font-family:var(--font-display); font-size:24px; color:var(--silver-light); margin:0;">${c.name} ${flag}</h2>
          <div style="color:var(--accent); font-weight:600; margin-top:4px">${c.roleType === 'coach' ? 'Head Coach' : 'Asistente'}</div>
          <div style="color:var(--muted); font-size:12px; margin-top:4px">${team ? team.name : 'Agente Libre'}</div>
        </div>
      </div>
      
      <div class="divider"></div>
      <div class="grid grid-2">
        <div>
          <div class="section-minihead">REDES SOCIALES</div>
          <div style="display:flex; flex-direction:column; gap:6px; font-size:12px">
            ${c.socials?.twitter ? `<div><b>Twitter:</b> ${c.socials.twitter}</div>` : ''}
            ${c.socials?.twitch ? `<div><b>Twitch:</b> ${c.socials.twitch}</div>` : ''}
            ${c.socials?.instagram ? `<div><b>Instagram:</b> ${c.socials.instagram}</div>` : ''}
          </div>
        </div>
        <div>
          <div class="section-minihead">TRACKER</div>
          ${c.rlTracker ? `<a href="${c.rlTracker}" target="_blank" style="color:var(--accent); font-size:12px">Ver RL Tracker ↗</a>` : '<div style="color:var(--muted); font-size:12px">No registrado</div>'}
        </div>
      </div>
    `,
    footer: `<button class="btn btn-ghost" data-close>CERRAR</button>`
  });
}
