import { getDB, mutate } from '../services/storage.js';
import { getSupabase } from '../services/supabase.js';
import { toast } from '../services/ui.js';
import { doTransferPlayer } from '../services/transfers.js';
import { createContract } from '../services/contracts.js';

let _requests = [];
let _loading = false;

export function requestsView() {
  loadRequests();

  return `
    <div class="page-head">
      <h1 class="page-title">SOLICITUDES DE COACHES</h1>
      <button class="btn" id="btnRefreshRequests">↻ ACTUALIZAR</button>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title"><span class="dot">◆</span>PETICIONES PENDIENTES</div>
        <span class="card-sub" id="reqCount">Cargando...</span>
      </div>
      <div id="requestsList">
        <div style="text-align:center;padding:20px;color:var(--muted)">Cargando solicitudes de Supabase...</div>
      </div>
    </div>
  `;
}

async function loadRequests() {
  if (_loading) return;
  _loading = true;
  
  const listEl = document.getElementById('requestsList');
  const countEl = document.getElementById('reqCount');
  
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('coach_requests')
      .select('*')
      .in('status', ['pending', 'accepted_by_target'])
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    // AUTO-EJECUCIÓN DE FICHAJES
    const acceptedTransfers = data.filter(r => r.type === 'transfer_offer' && r.status === 'accepted_by_target');
    
    for (const req of acceptedTransfers) {
      const payload = req.payload;
      try {
        // 1. Ejecutar traspaso real
        doTransferPlayer(payload.playerId, req.from_team_id, false, payload.price);
        
        // 2. Marcar como completada en la BD
        await sb.from('coach_requests').update({ 
          status: 'approved_by_admin',
          admin_response_at: new Date().toISOString(),
          admin_response_note: 'Auto-aprobado por fichaje directo'
        }).eq('id', req.id);

        // 3. Notificar al coach vendedor
        const toCoachId = req.to_coach_id;
        if (toCoachId) {
          await sb.from('coach_notifications').insert({
            coach_id: toCoachId,
            type: 'transfer_completed',
            title: '✅ Fichaje Aceptado',
            body: `Tu oferta por ${payload.playerName} por $${(payload.price || 0).toLocaleString('en-US')} ha sido aceptada.`,
            link_type: 'none',
            priority: 'normal'
          });
        }
        
        toast(`💰 Fichaje automático: ${payload.playerName} transferido`, 'success');
      } catch (err) {
        console.error('Error auto-fichaje:', err);
        toast('Error al ejecutar fichaje: ' + err.message, 'error');
      }
    }

    _requests = data.filter(r => {
      if (r.type === 'transfer_offer' && r.status === 'accepted_by_target') return false; 
      return true;
    });
    
    if (countEl) countEl.textContent = `${_requests.length} pendientes`;
    
    if (_requests.length === 0) {
      if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">No hay solicitudes pendientes.</div>';
      return;
    }

    if (listEl) {
      listEl.innerHTML = _requests.map(req => renderRequestCard(req)).join('');
      bindRequestButtons();
    }

  } catch (err) {
    console.error('[REQUESTS] Error al cargar:', err);
    if (listEl) listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--danger)">Error al cargar: ${err.message}</div>`;
  } finally {
    _loading = false;
  }
}

function renderRequestCard(req) {
  const payload = req.payload || {};
  const db = getDB();
  
  const fromTeam = db.teams.find(t => t.id === req.from_team_id)?.name || 'Equipo';
  const toTeam = db.teams.find(t => t.id === req.to_team_id)?.name || 'Agente Libre';
  const coach = db.coaches.find(c => c.id === req.from_coach_id)?.name || 'Coach';
  
  let typeLabel = '';
  let description = '';
  
  if (req.type === 'transfer_offer') {
    typeLabel = '💰 OFERTA DE FICHAJE';
    description = `El coach <b>${coach}</b> (${fromTeam}) quiere fichar a <b>${payload.playerName || 'Jugador'}</b> por <b>$${(payload.price || 0).toLocaleString('en-US')}</b>.`;
  } else if (req.type === 'loan_request') {
    typeLabel = '📤 SOLICITUD DE PRÉSTAMO';
    description = `El coach <b>${coach}</b> (${fromTeam}) quiere a <b>${payload.playerName || 'Jugador'}</b> en préstamo por <b>${payload.durationMatchdays} jornadas</b>.`;
  } else if (req.type === 'staff_transfer') {
    typeLabel = '🧑‍💼 CONTRATO DE STAFF';
    description = `El coach <b>${coach}</b> (${fromTeam}) quiere contratar a <b>${payload.coachName || 'Staff'}</b>.`;
  } else {
    typeLabel = '📄 CAMBIO DE CONTRATO';
    description = `El coach <b>${coach}</b> solicita un cambio de contrato para <b>${payload.playerName || 'Jugador'}</b>.`;
  }

  const statusLabel = req.status === 'pending' ? 'PENDIENTE (ESPERANDO AL COACH)' : 'ACEPTADO POR EL COACH (REQUIERE TU APROBACIÓN)';
  const badgeClass = req.status === 'pending' ? 'badge-live' : 'badge-win';

  const canAdminAct = req.status === 'accepted_by_target';

  return `
    <div class="card" style="margin-bottom:10px; border-left:4px solid ${req.status === 'accepted_by_target' ? 'var(--success)' : 'var(--accent)'}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px">
        <div>
          <div style="font-size:14px; font-weight:600; color:var(--silver-light); margin-bottom:4px;">
            ${typeLabel} · ${fromTeam} ${req.to_team_id ? '→ ' + toTeam : ''}
          </div>
          <div style="font-size:13px; color:var(--silver); margin:8px 0; background:var(--bg-graphite); padding:10px; border-radius:6px;">
            ${description}
          </div>
          <div style="font-size:11px; color:var(--muted);">
            Solicitado: ${new Date(req.created_at).toLocaleString()}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="badge ${badgeClass}">${statusLabel}</span>
          ${canAdminAct ? `
            <button class="btn btn-sm btn-primary" data-approve-req="${req.id}">✅ APROBAR</button>
            <button class="btn btn-sm btn-danger" data-reject-req="${req.id}">❌ RECHAZAR</button>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

export function bindRequestsEvents() {
  document.getElementById('btnRefreshRequests')?.addEventListener('click', () => {
    loadRequests();
  });
}

function bindRequestButtons() {
  document.querySelectorAll('[data-approve-req]').forEach(btn => {
    btn.addEventListener('click', () => approveRequest(btn.dataset.approveReq));
  });
  document.querySelectorAll('[data-reject-req]').forEach(btn => {
    btn.addEventListener('click', () => rejectRequest(btn.dataset.rejectReq));
  });
}

async function approveRequest(reqId) {
  const req = _requests.find(r => r.id === reqId);
  if (!req) return;
  
  if (req.type === 'loan_request') {
    const payload = req.payload;
    try {
      createContract({
        playerId: payload.playerId,
        type: 'loan',
        currentTeamId: req.to_team_id,
        ownerTeamId: req.from_team_id,
        durationMatchdays: payload.durationMatchdays,
        uniquePrice: payload.uniquePrice || 0,
        perMatchdayPrice: payload.perMatchdayPrice || 0,
        chargeEvenIfNotPlayed: payload.chargeEvenIfNotPlayed ?? true,
        performanceEnabled: payload.performanceEnabled || false,
        performanceTargets: payload.performanceTargets || {},
        buyOptionEnabled: false,
        buyPrice: 0,
        mandatoryBuy: false,
        autoReturnOnElimination: true
      });
      await updateRequestStatus(reqId, 'approved_by_admin', 'Préstamo ejecutado por el admin');
    } catch (e) {
      toast(e.message, 'error');
    }
  } else {
    await updateRequestStatus(reqId, 'approved_by_admin', 'Aprobado por el administrador');
  }
}

async function rejectRequest(reqId) {
  await updateRequestStatus(reqId, 'rejected_by_admin', 'Rechazado por el administrador');
}

async function updateRequestStatus(reqId, status, note) {
  try {
    const sb = getSupabase();
    const { error } = await sb.from('coach_requests').update({ 
      status: status,
      admin_response_at: new Date().toISOString(),
      admin_response_note: note
    }).eq('id', reqId);
    
    if (error) throw error;
    
    toast('Solicitud procesada', 'success');
    loadRequests();
  } catch (e) {
    console.error(e);
    toast('Error al actualizar estado: ' + e.message, 'error');
  }
}
