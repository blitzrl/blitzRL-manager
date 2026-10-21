import { getDB } from '../services/storage.js';
import { getSupabase } from '../services/supabase.js';
import { toast, openModal, closeTopModal } from '../services/ui.js';

let _accounts = null;
let _loading = false;

export function accountsView() {
  if (_accounts === null) {
    loadAccounts();
  }

  return `
    <div class="page-head">
      <h1 class="page-title">CUENTAS DE COACH</h1>
      <button class="btn btn-primary" id="btnNewAccount">+ NUEVA CUENTA</button>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title"><span class="dot">◆</span>ACCESOS AL PORTAL</div>
        <span class="card-sub" id="accCount">${_accounts ? _accounts.length + ' cuentas' : 'Cargando...'}</span>
      </div>
      <div id="accountsList">
        ${_accounts ? renderAccountsList() : '<div style="text-align:center;padding:20px;color:var(--muted)">Cargando cuentas de Supabase...</div>'}
      </div>
    </div>
  `;
}

async function loadAccounts() {
  if (_loading) return;
  _loading = true;
  
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('coach_accounts').select('*').order('created_at', { ascending: false });

    if (error) throw error;
    _accounts = data || [];
    updateUI();

  } catch (err) {
    console.error('[ACCOUNTS] Error al cargar:', err);
    const listEl = document.getElementById('accountsList');
    if (listEl) listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--danger)">Error al cargar: ${err.message}</div>`;
    const countEl = document.getElementById('accCount');
    if (countEl) countEl.textContent = 'Error';
  } finally {
    _loading = false;
  }
}

function updateUI() {
  const listEl = document.getElementById('accountsList');
  const countEl = document.getElementById('accCount');
  
  if (countEl) countEl.textContent = `${_accounts.length} cuentas`;
  if (listEl) {
    listEl.innerHTML = renderAccountsList();
    bindAccountButtons();
  }
}

function renderAccountsList() {
  if (_accounts.length === 0) return '<div style="text-align:center;padding:20px;color:var(--muted)">No hay cuentas creadas.</div>';

  const db = getDB();

  return _accounts.map(acc => {
    const coach = db.coaches.find(c => c.id === acc.coach_id);
    const team = db.teams.find(t => t.id === acc.team_id);
    
    return `
      <div class="card" style="margin-bottom:10px; border-left:4px solid var(--accent)">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px">
          <div>
            <div style="font-size:14px; font-weight:600; color:var(--silver-light); margin-bottom:4px;">
              ${coach ? coach.name : acc.display_name} 
              ${team ? `<span style="color:var(--muted); font-size:12px;">(${team.name})</span>` : '<span style="color:var(--gold); font-size:12px;">(Agente Libre)</span>'}
            </div>
            <div style="font-size:12px; color:var(--muted);">
              Usuario: <strong style="color:var(--accent)">${acc.username}</strong> · 
              Estado: <span style="color:${acc.active ? 'var(--success)' : 'var(--danger)'}">${acc.active ? 'Activo' : 'Suspendido'}</span>
            </div>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-sm" data-reset-pass="${acc.id}" data-username="${acc.username}">RESETEAR PASS</button>
            <button class="btn btn-sm ${acc.active ? 'btn-danger' : 'btn-primary'}" data-toggle-acc="${acc.id}" data-active="${acc.active}">
              ${acc.active ? 'SUSPENDER' : 'ACTIVAR'}
            </button>
            <button class="btn btn-sm btn-danger" data-delete-acc="${acc.id}" title="Eliminar cuenta">🗑 ELIMINAR</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

export function bindAccountsEvents() {
  document.getElementById('btnNewAccount')?.addEventListener('click', () => {
    openNewAccountModal();
  });
  
  if (_accounts) bindAccountButtons();
}

function bindAccountButtons() {
  document.querySelectorAll('[data-reset-pass]').forEach(btn => {
    btn.addEventListener('click', () => {
      resetPassword(btn.dataset.resetPass, btn.dataset.username);
    });
  });
  
  document.querySelectorAll('[data-toggle-acc]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.toggleAcc;
      const active = btn.dataset.active === 'true';
      
      try {
        const sb = getSupabase();
        await sb.from('coach_accounts').update({ active: !active }).eq('id', id);
        toast(`Cuenta ${!active ? 'activada' : 'suspendida'}`, 'success');
        _accounts = null;
        loadAccounts();
      } catch (e) {
        toast('Error: ' + e.message, 'error');
      }
    });
  });

  document.querySelectorAll('[data-delete-acc]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar permanentemente esta cuenta? El coach será expulsado inmediatamente.')) return;
      
      const accId = btn.dataset.deleteAcc;
      const acc = _accounts.find(a => a.id === accId);
      
      try {
        const sb = getSupabase();
        
        // ELIMINAR SESIONES ACTIVAS PRIMERO (Expulsión instantánea)
        if (acc) {
          await sb.from('coach_sessions').delete().eq('coach_id', acc.coach_id);
        }

        // ELIMINAR LA CUENTA
        await sb.from('coach_accounts').delete().eq('id', accId);
        
        toast('Cuenta y sesiones eliminadas', 'success');
        _accounts = null;
        loadAccounts();
      } catch (e) {
        toast('Error al eliminar: ' + e.message, 'error');
      }
    });
  });
}

function openNewAccountModal() {
  const db = getDB();
  const availableCoaches = db.coaches.filter(c => !_accounts.some(a => a.coach_id === c.id));

  openModal({
    id: 'new-account-modal',
    title: 'NUEVA CUENTA DE COACH',
    body: `
      <div class="field">
        <label>Coach</label>
        <select class="select" id="acc-coach">
          <option value="">— Seleccionar Coach —</option>
          ${availableCoaches.map(c => {
            const team = db.teams.find(t => t.id === c.teamId);
            return `<option value="${c.id}">${c.name} (${team ? team.name : 'Libre'})</option>`;
          }).join('')}
        </select>
      </div>
      <div class="field">
        <label>Nombre de Usuario (para login)</label>
        <input class="input" id="acc-username" placeholder="ej: tigres_coach">
      </div>
      <div class="field">
        <label>Contraseña Temporal</label>
        <input class="input" id="acc-password" value="${generateTempPassword()}" readonly>
        <small class="field-hint">Copia esta contraseña y dásela al coach. No se volverá a mostrar.</small>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="saveAccountBtn">CREAR CUENTA</button>
    `,
    onMount: root => {
      root.querySelector('#saveAccountBtn').addEventListener('click', async () => {
        const coachId = root.querySelector('#acc-coach').value;
        const username = root.querySelector('#acc-username').value.trim();
        const password = root.querySelector('#acc-password').value;

        if (!coachId || !username) return toast('Faltan campos', 'error');
        const coach = db.coaches.find(c => c.id === coachId);

        try {
          const sb = getSupabase();
          const { data, error } = await sb.rpc('admin_create_coach_account', {
            p_coach_id: coachId,
            p_team_id: coach.teamId || null,
            p_username: username,
            p_password: password,
            p_display_name: coach.name
          });

          if (error) throw error;
          if (!data.ok) throw new Error(data.error);

          toast('Cuenta creada exitosamente', 'success');
          closeTopModal();
          _accounts = null;
          loadAccounts();
        } catch (e) {
          console.error(e);
          toast('Error al crear cuenta: ' + e.message, 'error');
        }
      });
    }
  });
}

function resetPassword(accountId, username) {
  const newPass = generateTempPassword();
  
  openModal({
    id: 'reset-pass-modal',
    title: 'RESETEAR CONTRASEÑA',
    body: `
      <p style="font-size:13px; color:var(--silver); margin-bottom:14px;">
        Se generará una nueva contraseña temporal para <strong>${username}</strong>. 
      </p>
      <div class="field">
        <label>Nueva Contraseña</label>
        <input class="input" id="new-temp-pass" value="${newPass}" readonly>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="confirmResetPass">CONFIRMAR</button>
    `,
    onMount: root => {
      root.querySelector('#confirmResetPass').addEventListener('click', async () => {
        try {
          const sb = getSupabase();
          const { error } = await sb.rpc('admin_reset_password', {
            p_username: username,
            p_new_password: newPass
          });
          
          if (error) throw error;
          
          toast('Contraseña reseteada. Cópiala ahora.', 'success');
          closeTopModal();
        } catch (e) {
          toast('Error: ' + e.message, 'error');
        }
      });
    }
  });
}

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let pass = '';
  for (let i = 0; i < 10; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
  return pass;
}
