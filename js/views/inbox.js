import { getSupabase } from '../services/supabase.js';
import { toast } from '../services/ui.js';

// Variable global en el módulo para no saturar la BD
let _notifications = null;
let _loading = false;

export function renderInboxView(DB, session) {
  if (_notifications === null) {
    loadNotifications(session.coachId);
  }

  return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">BANDEJA DE NOTIFICACIONES</div>
      </div>
      <div id="inboxList">
        ${_notifications ? renderNotifs() : '<div style="text-align:center; padding:40px; color:var(--muted)">Cargando notificaciones...</div>'}
      </div>
    </div>
  `;
}

async function loadNotifications(coachId) {
  if (_loading) return;
  _loading = true;
  
  try {
    const sb = getSupabase();
    // Traemos las notificaciones ordenadas de más reciente a más antigua
    const { data, error } = await sb.from('coach_notifications')
      .select('*')
      .eq('coach_id', coachId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    _notifications = data || [];
    
    const listEl = document.getElementById('inboxList');
    if (listEl) listEl.innerHTML = renderNotifs();
    
  } catch (err) {
    console.error('[INBOX] Error:', err);
    const listEl = document.getElementById('inboxList');
    if (listEl) listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--danger)">Error al cargar: ${err.message}</div>`;
  } finally {
    _loading = false;
  }
}

function renderNotifs() {
  if (_notifications.length === 0) {
    return '<div style="text-align:center; padding:40px; color:var(--muted)">No tienes notificaciones por ahora.</div>';
  }

  return _notifications.map(n => {
    let icon = '📢';
    let color = 'var(--accent)';
    let borderColor = 'rgba(111,168,255,.3)';
    let bg = 'var(--bg-elev)';

    if (n.type === 'admin_warning') {
      icon = '⚠️';
      color = n.priority === 'urgent' ? 'var(--danger)' : 'var(--gold)';
      borderColor = n.priority === 'urgent' ? 'rgba(226,92,92,.5)' : 'rgba(230,196,118,.5)';
      bg = 'linear-gradient(90deg, rgba(226,92,92,0.1), var(--bg-panel))';
    } else if (n.type === 'request_new') {
      icon = '📩';
      color = 'var(--accent)';
      borderColor = 'rgba(111,168,255,.5)';
    }

    const date = new Date(n.created_at).toLocaleString();

    return `
      <div class="card" style="margin-bottom:10px; border-left:4px solid ${borderColor}; background:${bg}">
        <div style="display:flex; gap:16px; align-items:flex-start">
          <div style="font-size:24px; flex-shrink:0">${icon}</div>
          <div style="flex:1">
            <div style="font-size:14px; font-weight:600; color:${color}; margin-bottom:4px;">
              ${n.title}
            </div>
            <div style="font-size:13px; color:var(--silver-light); line-height:1.5; margin-bottom:8px;">
              ${n.body}
            </div>
            <div style="font-size:11px; color:var(--muted);">
              ${date}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}
