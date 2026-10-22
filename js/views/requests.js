import { getDB } from '../services/storage.js';
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
      <h1 class="page-title">SOLICITUDES Y NEGOCIACIONES</h1>
      <button class="btn" id="btnRefreshRequests">↻ ACTUALIZAR</button>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title"><span class="dot">◆</span>BANDEJA DE ENTRADA</div>
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
    
    // AUTO-EJECUCIÓN DE FICHAJES ACEPTADOS
    const acceptedTransfers = data.filter(r => r.type === 'transfer_offer' && r.status === 'accepted_by_target');
    
    for (const req of acceptedTransfers) {
      const payload = req.payload;
      try {
        // Ejecutamos el traspaso con la lógica del Gestor
        doTransferPlayer(payload.playerId, req.from_team_id, false, payload.uniquePrice || payload.price);
        
        // Creamos el contrato con las cláusulas pactadas
        createContract({
          playerId: payload.playerId,
          type: 'permanent',
          currentTeamId: req.from_team_id,
          ownerTeamId: req.to_team_id,
          durationSeasons: payload.durationSeasons || 1,
          durationMatchdays: payload.durationMatchdays || 0,
          uniquePrice: payload.uniquePrice || 0,
          performanceEnabled: payload.performanceEnabled || false,
          performanceTargets: payload.performanceTargets || {},
          renewalOptionEnabled: payload.renewalOptionEnabled || false,
          renewalPrice: payload.renewalPrice || 0,
          sellOnClauses: payload.sellOnClauses || [],
          autoReturnOnElimination: true
        });
        
        // Marcamos como aprobada en la BD
        await sb.from('coach_requests').update({ 
          status: 'approved_by_admin',
          admin_response_at: new Date().toISOString(),
          admin_response_note: 'Auto-aprobado por fichaje directo'
        }).eq('id', req.id);
        
        toast(`💰 Fichaje automático: ${payload.playerName} transferido`, 'success');
      } catch (err) {
        console.error('Error auto-fichaje:', err);
        toast('Error al ejecutar fichaje automático: ' + err.message, 'error');
      }
    }

    _requests = data.filter(r => {
      // Si ya se auto-ejecutó, lo ocultamos de la lista
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
  
  let typeLabel = req.type === 'transfer_offer' ? '💰 FICHAJE' : req.type === 'loan_request' ? '📤 PRÉSTAMO' : 'CAMBIO';
  
  let clausesHTML = '';
  if (payload.durationSeasons) clausesHTML += `<div><b>Duración:</b> ${payload.durationSeasons} Temporadas ${payload.durationMatchdays ? `+ ${payload.durationMatchdays} Jornadas` : ''}</div>`;
  if (payload.uniquePrice > 0) clausesHTML += `<div><b>Precio:</b> $${payload.uniquePrice.toLocaleString('en-US')}</div>`;
  if (payload.sellOnClause) clausesHTML += `<div><b>Futura Venta:</b> ${payload.sellOnPercentage}% x ${payload.sellOnSales} ventas</div>`;
  if (payload.performanceEnabled) clausesHTML += `<div><b>Metas:</b> ${payload.performanceTargets.goals?.enabled ? 'Goles ' + payload.performanceTargets.goals.min : ''} ${payload.performanceTargets.assists?.enabled ? 'Asist ' + payload.performanceTargets.assists.min : ''}</div>`;

  const statusLabel = req.status === 'pending' ? 'ESPERANDO AL COACH' : 'ACEPTADO POR EL COACH (APROBACIÓN)';
  const badgeClass = req.status === 'pending' ? 'badge-live' : 'badge-win';

  return `
    <div class="card" style="margin-bottom:10px; border-left:4px solid ${req.status === 'accepted_by_target' ? 'var(--success)' : 'var(--accent)'}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px">
        <div>
          <div style="font-size:14px; font-weight:600; color:var(--silver-light); margin-bottom:4px;">
            ${typeLabel} · ${fromTeam} → ${toTeam}
          </div>
          <div style="font-size:13px; color:var(--silver); margin:8px 0; background:var(--bg-graphite); padding:10px; border-radius:6px; display:flex; flex-direction:column; gap:4px;">
            <div><b>Jugador:</b> ${payload.playerName || 'Jugador'}</div>
            ${clausesHTML}
          </div>
          
          ${payload.customMessage ? `
            <div style="font-size:12px; color:var(--accent); font-style:italic; padding:8px; border-left:2px solid var(--accent); background:rgba(111,168,255,0.05); margin-bottom:8px;">
              "${payload.customMessage}"
            </div>
          ` : ''}
          
          <div style="font-size:11px; color:var(--muted);">
            Solicitado por ${coach} el ${new Date(req.created_at).toLocaleString()}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="badge ${badgeClass}">${statusLabel}</span>
          ${req.status === 'accepted_by_target' ? `
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
  
  const payload = req.payload;
  try {
    if (req.type === 'loan_request' || req.type === 'transfer_offer') {
      createContract({
        playerId: payload.playerId,
        type: req.type === 'loan_request' ? 'loan' : 'permanent',
        currentTeamId: req.to_team_id,
        ownerTeamId: req.from_team_id,
        durationSeasons: payload.durationSeasons || 1,
        durationMatchdays: payload.durationMatchdays || 0,
        uniquePrice: payload.uniquePrice || 0,
        perMatchdayPrice: payload.perMatchdayPrice || 0,
        performanceEnabled: payload.performanceEnabled || false,
        performanceTargets: payload.performanceTargets || {},
        renewalOptionEnabled: payload.renewalOptionEnabled || false,
        renewalPrice: payload.renewalPrice || 0,
        sellOnClauses: payload.sellOnClauses || [],
        autoReturnOnElimination: true
      });
    }
    
    const sb = getSupabase();
    await sb.from('coach_requests').update({ 
      status: 'approved_by_admin',
      admin_response_at: new Date().toISOString()
    }).eq('id', reqId);
    
    toast('✅ Solicitud aprobada y ejecutada', 'success');
    loadRequests();
  } catch (e) {
    toast('Error al ejecutar: ' + e.message, 'error');
  }
}

async function rejectRequest(reqId) {
  try {
    const sb = getSupabase();
    await sb.from('coach_requests').update({ 
      status: 'rejected_by_admin',
      admin_response_at: new Date().toISOString()
    }).eq('id', reqId);
    toast('Solicitud rechazada', 'success');
    loadRequests();
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}
