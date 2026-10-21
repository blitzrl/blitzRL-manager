import { getDB } from '../services/storage.js';
import { getSupabase } from '../services/supabase.js';
import { toast, openModal, closeTopModal } from '../services/ui.js';

export function warningsView() {
  const db = getDB();
  const coaches = db.coaches || [];

  return `
    <div class="page-head">
      <h1 class="page-title">ADVERTENCIAS A COACHES</h1>
      <button class="btn btn-primary" id="btnNewWarning">+ NUEVA ADVERTENCIA</button>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title"><span class="dot">◆</span>HISTORIAL DE ADVERTENCIAS</div>
      </div>
      <div id="warningsList">
        <div style="text-align:center;padding:20px;color:var(--muted)">Cargando advertencias de Supabase...</div>
      </div>
    </div>
  `;
}

export function bindWarningsEvents() {
  const db = getDB();
  const coaches = db.coaches || [];

  document.getElementById('btnNewWarning')?.addEventListener('click', () => {
    openWarningModal(coaches);
  });

  loadWarnings();
}

async function loadWarnings() {
  const listEl = document.getElementById('warningsList');
  if (!listEl) return;

  try {
    const sb = getSupabase();
    // Obtenemos las advertencias
    const { data, error } = await sb.from('coach_warnings')
      .select('*')
      .order('created_at', { ascending: false });

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
      const severityClass = w.severity === 'critical' ? 'var(--danger)' : w.severity === 'warning' ? 'var(--gold)' : 'var(--accent)';

      return `
        <div class="card" style="margin-bottom:10px; border-left:4px solid ${severityClass}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px">
            <div>
              <div style="font-size:14px; font-weight:600; color:var(--silver-light); margin-bottom:4px;">
                Coach: ${coachName} (${w.severity.toUpperCase()})
              </div>
              <div style="font-size:13px; color:var(--silver); margin-bottom:8px; padding:8px; background:var(--bg-graphite); border-radius:6px;">
                "${w.message}"
              </div>
              <div style="font-size:11px; color:var(--muted);">
                Enviada: ${new Date(w.created_at).toLocaleString()}
                ${w.acknowledged_at ? ` · Respondida el ${new Date(w.acknowledged_at).toLocaleString()}` : ''}
              </div>
              ${w.acknowledgment_message ? `
                <div style="margin-top:8px; font-size:12px; color:var(--success);">
                  <b>Respuesta del coach:</b> "${w.acknowledgment_message}"
                </div>
              ` : ''}
            </div>
            <div>
              <span class="badge">${status}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('[WARNINGS] Error al cargar:', err);
    listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--danger)">Error: ${err.message}</div>`;
  }
}

function openWarningModal(coaches) {
  openModal({
    id: 'new-warning-modal',
    title: 'NUEVA ADVERTENCIA',
    body: `
      <div class="field">
        <label>Coach Destinatario</label>
        <select class="select" id="warn-coach">
          <option value="">— Seleccionar Coach —</option>
          ${coaches.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Severidad</label>
        <select class="select" id="warn-severity">
          <option value="info">Info (Azul)</option>
          <option value="warning" selected>Aviso (Amarillo)</option>
          <option value="critical">Crítico (Rojo)</option>
        </select>
      </div>
      <div class="field">
        <label>Mensaje</label>
        <textarea class="textarea" id="warn-message" rows="4" placeholder="Escribe el motivo de la advertencia..."></textarea>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="saveWarningBtn">ENVIAR ADVERTENCIA</button>
    `,
    onMount: root => {
      root.querySelector('#saveWarningBtn').addEventListener('click', async () => {
        const coachId = root.querySelector('#warn-coach').value;
        const severity = root.querySelector('#warn-severity').value;
        const message = root.querySelector('#warn-message').value.trim();

        if (!coachId || !message) return toast('Faltan campos obligatorios', 'error');

        try {
          const sb = getSupabase();
          
          // 1. Insertar Advertencia
          const { error: wErr } = await sb.from('coach_warnings').insert({
            coach_id: coachId,
            message,
            severity,
            created_by: 'Admin'
          });
          if (wErr) throw wErr;

          // 2. Insertar Notificación para el coach
          const { error: nErr } = await sb.from('coach_notifications').insert({
            coach_id: coachId,
            type: 'admin_warning',
            title: 'Advertencia del Administrador',
            body: message,
            link_type: 'warning',
            priority: severity === 'critical' ? 'urgent' : 'high'
          });
          if (nErr) throw nErr;

          toast('Advertencia enviada', 'success');
          closeTopModal();
          loadWarnings();
        } catch (e) {
          console.error(e);
          toast('Error al enviar: ' + e.message, 'error');
        }
      });
    }
  });
}
