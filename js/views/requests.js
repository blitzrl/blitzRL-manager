import { getDB, mutate } from '../services/storage.js';
import { getSupabase } from '../services/supabase.js';
import { toast } from '../services/ui.js';
import { createContract } from '../services/contracts.js';
import { doTransferPlayer } from '../services/transfers.js';

let _requests = [];
let _loading = false;

export function requestsView() {
  setTimeout(() => loadRequests(), 100);

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

// AUTO-PROCESAMIENTO BLINDADO CONTRA DUPLICADOS
export async function processAutoRequests() {
  const sb = getSupabase();
  try {
    // 1. Buscamos ofertas que estén aceptadas.
    const { data, error } = await sb.from('coach_requests')
      .select('*')
      .eq('status', 'accepted_by_target');

    if (error || !data || data.length === 0) return;

    for (const req of data) {
      const payload = req.payload;
      try {
        // 2. BLOQUEO ATÓMICO: Intentamos cambiar el estado de la oferta a 'processing'.
        // Si devuelve datos, es porque nosotros fuimos los primeros en tomarla.
        // Si devuelve array vacío, es porque otro proceso (Realtime o Radar) ya la tomó.
        const { data: lockData, error: lockErr } = await sb.from('coach_requests')
          .update({ status: 'processing' })
          .eq('id', req.id)
          .eq('status', 'accepted_by_target')
          .select();

        if (lockErr || !lockData || lockData.length === 0) {
          // Otro proceso ya la tomó. Saltamos esta oferta.
          continue;
        }

        // 3. Ejecutamos la transacción (sabiendo que somos los únicos dueños de esta oferta)
        if (req.type === 'transfer_offer') {
          doTransferPlayer(payload.playerId, req.from_team_id, false, payload.uniquePrice || 0);
          createContract({
            playerId: payload.playerId, type: 'permanent', currentTeamId: req.from_team_id, ownerTeamId: req.to_team_id,
            durationSeasons: payload.durationSeasons || 1, durationMatchdays: payload.durationMatchdays || 0,
            uniquePrice: payload.uniquePrice || 0, performanceEnabled: payload.performanceEnabled || false,
            performanceTargets: payload.performanceTargets || {}, renewalOptionEnabled: payload.renewalOptionEnabled || false,
            renewalPrice: payload.renewalPrice || 0, sellOnClauses: payload.sellOnClauses || [], autoReturnOnElimination: true
          });
        } 
        else if (req.type === 'loan_request') {
          doTransferPlayer(payload.playerId, req.from_team_id, false, 0);
          createContract({
            playerId: payload.playerId, type: 'loan', currentTeamId: req.from_team_id, ownerTeamId: req.to_team_id,
            durationSeasons: payload.durationSeasons || 0, durationMatchdays: payload.durationMatchdays || 0,
            uniquePrice: payload.uniquePrice || 0, perMatchdayPrice: payload.perMatchdayPrice || 0,
            performanceEnabled: payload.performanceEnabled || false, performanceTargets: payload.performanceTargets || {},
            renewalOptionEnabled: false, renewalPrice: 0, sellOnClauses: [], autoReturnOnElimination: true
          });
        }
        
        // 4. Marcamos como aprobado definitivamente.
        await sb.from('coach_requests').update({ 
          status: 'approved_by_admin', 
          admin_response_at: new Date().toISOString(), 
          admin_response_note: 'Auto-aprobado por el sistema' 
        }).eq('id', req.id);
        
        toast(`✅ Procesado automáticamente: ${payload.playerName}`, 'success');

      } catch (err) {
        console.error('Error auto-fichaje:', err);
        toast('Error auto-fichaje: ' + err.message, 'error');
        // Si falla la transacción, devolvemos la oferta a 'accepted_by_target' para que el Radar lo reintente
        await sb.from('coach_requests').update({ status: 'accepted_by_target' }).eq('id', req.id);
      }
    }
  } catch (err) {
    console.error('[AUTO-REQUESTS] Error:', err);
  }
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
      .in('status', ['pending', 'accepted_by_target', 'processing'])
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    await processAutoRequests();

    const { data: freshData, error: freshError } = await sb.from('coach_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (freshError) throw freshError;
    _requests = freshData || [];
    
    if (countEl) countEl.textContent = `${_requests.length} pendientes`;
    
    if (listEl) {
      if (_requests.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">No hay solicitudes pendientes.</div>';
      } else {
        listEl.innerHTML = _requests.map(req => renderRequestCard(req)).join('');
        bindRequestButtons();
      }
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
  
  let typeLabel = 'CAMBIO';
  if (req.type === 'transfer_offer') typeLabel = '💰 FICHAJE';
  else if (req.type === 'loan_request') typeLabel = '📤 PRÉSTAMO';
  else if (req.type === 'free_agent_sign') typeLabel = '📋 FICHAJE LIBRE';
  else if (req.type === 'lineup_change') typeLabel = '⚙️ CAMBIO DE ALINEACIÓN';

  let clausesHTML = '';
  if (req.type === 'lineup_change') {
    clausesHTML = `<div><b>Jugadores involucrados:</b> ${payload.newLineup?.length || 0} (Actualización de roles)</div>`;
  } else {
    if (payload.durationSeasons) clausesHTML += `<div><b>Duración:</b> ${payload.durationSeasons} Temporadas ${payload.durationMatchdays ? `+ ${payload.durationMatchdays} Jornadas` : ''}</div>`;
    if (payload.uniquePrice > 0) clausesHTML += `<div><b>Precio:</b> $${payload.uniquePrice.toLocaleString('en-US')}</div>`;
    if (payload.sellOnClause) clausesHTML += `<div><b>Futura Venta:</b> ${payload.sellOnPercentage}% x ${payload.sellOnSales} ventas</div>`;
    if (payload.performanceEnabled) clausesHTML += `<div><b>Metas:</b> ${payload.performanceTargets.goals?.enabled ? 'Goles ' + payload.performanceTargets.goals.min : ''} ${payload.performanceTargets.assists?.enabled ? 'Asist ' + payload.performanceTargets.assists.min : ''}</div>`;
  }

  return `
    <div class="card" style="margin-bottom:10px; border-left:4px solid var(--accent)">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px">
        <div>
          <div style="font-size:14px; font-weight:600; color:var(--silver-light); margin-bottom:4px;">
            ${typeLabel} · ${fromTeam} ${toTeam !== 'Agente Libre' ? '→ '+toTeam : ''}
          </div>
          <div style="font-size:13px; color:var(--silver); margin:8px 0; background:var(--bg-graphite); padding:10px; border-radius:6px; display:flex; flex-direction:column; gap:4px;">
            <div><b>Jugador:</b> ${payload.playerName || 'Múltiples'}</div>
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
          <span class="badge badge-live">ESPERANDO</span>
          ${req.type === 'free_agent_sign' || req.type === 'lineup_change' ? `
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
    if (req.type === 'lineup_change') {
      mutate(d => {
        const team = d.teams.find(t => t.id === req.from_team_id);
        if (team) team.roster = payload.newLineup;
      });
    } 
    else if (req.type === 'free_agent_sign') {
      doTransferPlayer(payload.playerId, req.from_team_id, false, payload.price || 0);
      createContract({
        playerId: payload.playerId, type: 'permanent', currentTeamId: req.from_team_id, ownerTeamId: req.from_team_id,
        durationSeasons: 1, durationMatchdays: 0, uniquePrice: payload.price || 0,
        performanceEnabled: false, performanceTargets: {}, renewalOptionEnabled: false,
        renewalPrice: 0, sellOnClauses: [], autoReturnOnElimination: true
      });
    }
    
    await updateRequestStatus(reqId, 'approved_by_admin', 'Aprobado por el admin');
    
  } catch (e) {
    toast('Error al ejecutar: ' + e.message, 'error');
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
