import { getDB, mutate } from '../services/storage.js';
import { getSupabase } from '../services/supabase.js';
import { toast, openModal, closeTopModal } from '../services/ui.js';
import { doTransferPlayer } from '../services/transfers.js';
import { createContract } from '../services/contracts.js';

let _requests = [];
let _loading = false;

export function requestsView() {
  // Lanzamos la carga asíncrona
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
    // Traemos solicitudes que estén pending, accepted_by_target o pending_approval
    const { data, error } = await sb.from('coach_requests')
      .select('*')
      .in('status', ['pending', 'accepted_by_target', 'pending_approval'])
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    _requests = data || [];
    
    if (countEl) countEl.textContent = `${_requests.length} pendientes`;
    
    if (_requests.length === 0) {
      if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">No hay solicitudes pendientes.</div>';
      return;
    }

    // Renderizamos
    if (listEl) {
      listEl.innerHTML = _requests.map(req => {
        const payload = req.payload || {};
        const typeLabel = req.type === 'transfer' ? 'FICHAJE' : req.type === 'loan_request' ? 'PRÉSTAMO' : 'CAMBIO DE CONTRATO';
        const statusLabel = req.status === 'pending' ? 'PENDIENTE (COACH DESTINO)' : req.status === 'accepted_by_target' ? 'ACEPTADO POR DESTINO' : 'PENDIENTE APROBACIÓN';
        const badgeClass = req.status === 'pending' ? 'badge-live' : req.status === 'accepted_by_target' ? 'badge-win' : 'badge-gold';
        
        return `
          <div class="card" style="margin-bottom:10px; border-left:4px solid var(--accent)">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px">
              <div>
                <div style="font-size:14px; font-weight:600; color:var(--silver-light); margin-bottom:4px;">
                  ${typeLabel} · ${req.from_team_id} → ${req.to_team_id || 'Agente Libre'}
                </div>
                <div style="font-size:12px; color:var(--muted);">
                  Solicitado por: Coach ID ${req.from_coach_id} · ${new Date(req.created_at).toLocaleString()}
                </div>
                <div style="margin-top:8px; font-size:12.5px; color:var(--silver)">
                  ${JSON.stringify(payload)}
                </div>
              </div>
              <div style="display:flex; align-items:center; gap:8px">
                <span class="badge ${badgeClass}">${statusLabel}</span>
                <button class="btn btn-sm btn-primary" data-approve-req="${req.id}">✅ APROBAR</button>
                <button class="btn btn-sm btn-danger" data-reject-req="${req.id}">❌ RECHAZAR</button>
              </div>
            </div>
          </div>
        `;
      }).join('');
      
      bindRequestButtons();
    }

  } catch (err) {
    console.error('[REQUESTS] Error al cargar:', err);
    if (listEl) listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--danger)">Error al cargar: ${err.message}</div>`;
  } finally {
    _loading = false;
  }
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
  
  if (req.type === 'transfer') {
    const { playerId, targetTeamId, price } = req.payload;
    try {
      doTransferPlayer(playerId, targetTeamId, false, price);
      await updateRequestStatus(reqId, 'approved_by_admin', 'Aprobado y ejecutado por el admin');
    } catch (e) {
      toast(e.message, 'error');
    }
  } else if (req.type === 'loan_request') {
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
        buyOptionEnabled: payload.buyOptionEnabled || false,
        buyPrice: payload.buyPrice || 0,
        mandatoryBuy: payload.mandatoryBuy || false,
        autoReturnOnElimination: payload.autoReturnOnElimination ?? true
      });
      await updateRequestStatus(reqId, 'approved_by_admin', 'Préstamo ejecutado por el admin');
    } catch (e) {
      toast(e.message, 'error');
    }
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
