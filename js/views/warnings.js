import { getDB } from '../services/storage.js';
import { getSupabase } from '../services/supabase.js';
import { toast, openModal, closeTopModal } from '../services/ui.js';

export function warningsView() {
  return `
    <div class="page-head">
      <h1 class="page-title">ADVERTENCIAS Y NOTIFICACIONES</h1>
      <button class="btn btn-primary" id="btnNewWarning">+ NUEVO MENSAJE</button>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title"><span class="dot">◆</span>HISTORIAL</div></div>
      <div id="warningsList"><div style="text-align:center;padding:20px;color:var(--muted)">Cargando...</div></div>
    </div>
  `;
}

export function bindWarningsEvents() {
  document.getElementById('btnNewWarning')?.addEventListener('click', () => openWarningModal());
  loadWarnings();
}

async function loadWarnings() {
  const listEl = document.getElementById('warningsList');
  if (!listEl) return;
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('coach_warnings').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    if (!data || data.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">No hay advertencias registradas.</div>';
      return;
    }
    const db = getDB();
    listEl.innerHTML = data.map(w => {
      const coach = db.coaches.find(c => c.id === w.coach_id);
      const coachName = coach ? coach.name : w.coach_id;
      const status = w.acknowledged_at ? '✅ Respondida' : '🟡 Pendiente';
      let severityClass = 'var(--accent)'; 
      let severityLabel = 'INFO';
      if (w.severity === 'critical') { severityClass = 'var(--danger)'; severityLabel = 'CRÍTICO'; }
      else if (w.severity === 'warning') { severityClass = 'var(--gold)'; severityLabel = 'AVISO'; }

      return `
        <div class="card" style="margin-bottom:10px; border-left:4px solid ${severityClass}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px">
            <div>
              <div style="font-size:14px; font-weight:600; color:var(--silver-light); margin-bottom:4px;">Coach: ${coachName} (${severityLabel})</div>
              <div style="font-size:13px; color:var(--silver); margin-bottom:8px; padding:8px; background:var(--bg-graphite); border-radius:6px;">"${w.message}"</div>
              <div style="font-size:11px; color:var(--muted);">Enviada: ${new Date(w.created_at).toLocaleString()}</div>
              ${w.acknowledgment_message ? `<div style="margin-top:8px; font-size:12px; color:var(--success);"><b>Respuesta:</b> "${w.acknowledgment_message}"</div>` : ''}
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
              <span class="badge">${status}</span>
              <button class="btn btn-sm btn-danger" data-del-warning="${w.id}">🗑 ELIMINAR</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('[data-del-warning]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar permanentemente?')) return;
        try {
          await getSupabase().from('coach_warnings').delete().eq('id', btn.dataset.delWarning);
          toast('Eliminado', 'success');
          loadWarnings();
        } catch (e) { toast('Error: ' + e.message, 'error'); }
      });
    });
  } catch (err) { listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--danger)">Error: ${err.message}</div>`; }
}

function openWarningModal() {
  const db = getDB();
  const coaches = db.coaches || [];
  openModal({
    id: 'new-warning-modal',
    title: 'NUEVO MENSAJE A COACHES',
    wide: true,
    body: `
      <div class="field">
        <label>Destinatarios</label>
        <div style="margin-bottom:8px;"><button type="button" class="btn btn-sm" id="btnSelectAll">Seleccionar Todos</button></div>
        <div style="max-height:150px; overflow-y:auto; border:1px solid var(--border-soft); border-radius:6px; padding:10px; background:var(--bg-graphite);">
          ${coaches.map(c => `<label style="display:flex; align-items:center; gap:8px; margin-bottom:6px; cursor:pointer;"><input type="checkbox" class="chk-coach" value="${c.id}"> ${c.name}</label>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>Severidad</label>
        <select class="select" id="warn-severity">
          <option value="info">Información (Azul)</option>
          <option value="warning" selected>Advertencia (Amarillo)</option>
          <option value="critical">Crítica (Rojo)</option>
        </select>
      </div>
      <div class="field"><label>Mensaje</label><textarea class="textarea" id="warn-message" rows="4"></textarea></div>
    `,
    footer: `<button class="btn btn-ghost" data-close>CANCELAR</button><button class="btn btn-primary" id="saveWarningBtn">ENVIAR</button>`,
    onMount: (root) => {
      root.querySelector('#btnSelectAll').addEventListener('click', () => {
        const checkboxes = root.querySelectorAll('.chk-coach');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => cb.checked = !allChecked);
      });
      root.querySelector('#saveWarningBtn').addEventListener('click', async () => {
        const selectedCoaches = Array.from(root.querySelectorAll('.chk-coach:checked')).map(cb => cb.value);
        const severity = root.querySelector('#warn-severity').value;
        const message = root.querySelector('#warn-message').value.trim();
        if (selectedCoaches.length === 0 || !message) return toast('Faltan datos', 'error');

        try {
          const btn = root.querySelector('#saveWarningBtn');
          btn.disabled = true; btn.textContent = 'ENVIANDO...';
          const sb = getSupabase();
          
          let titleStr = '';
          if (severity === 'info') titleStr = 'INFORMACIÓN DEL ADMINISTRADOR';
          else if (severity === 'warning') titleStr = 'ADVERTENCIA DEL ADMINISTRADOR';
          else if (severity === 'critical') titleStr = 'ADVERTENCIA CRÍTICA DEL ADMINISTRADOR';

          for (const coachId of selectedCoaches) {
            const { data: warnData, error: wErr } = await sb.from('coach_warnings').insert({ coach_id: coachId, message, severity, created_by: 'Admin' }).select('id').single();
            if (wErr) throw wErr;
            await sb.from('coach_notifications').insert({ coach_id: coachId, type: 'admin_warning', title: titleStr, body: message, link_type: 'warning', link_id: warnData.id, priority: severity === 'critical' ? 'urgent' : 'high' });
          }
          toast('Mensajes enviados', 'success');
          closeTopModal();
          loadWarnings();
        } catch (e) {
          toast('Error: ' + e.message, 'error');
          root.querySelector('#saveWarningBtn').disabled = false;
          root.querySelector('#saveWarningBtn').textContent = 'ENVIAR';
        }
      });
    }
  });
}
