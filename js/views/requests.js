// ============================================================
// PUENTE DE REGISTRO: Escucha las ofertas que el Portal completó
// ============================================================
export async function syncPortalTransfers() {
  const sb = getSupabase();
  
  const { data, error } = await sb.from('coach_requests')
    .select('*')
    .eq('status', 'completed')
    .like('admin_response_note', 'Procesado por el Portal%');

  if (error || !data || data.length === 0) return;

  for (const req of data) {
    if (_processingIds.has(req.id)) continue;
    _processingIds.add(req.id);

    try {
      const payload = req.payload;
      
      mutate(d => {
        const p = d.players.find(x => x.id === payload.playerId);
        
        // 🔄 CORRECCIÓN DE LÓGICA: Invertimos los equipos
        const origin = d.teams.find(t => t.id === req.to_team_id); // Vendedor
        const target = d.teams.find(t => t.id === req.from_team_id); // Comprador

        if (p && target) {
          // 1. Crear el registro en el TransferLog (SOLO si no es firma interna)
          if (!payload.is_internal_signing) {
            d.transferLog.push({
              id: 'mov_' + Date.now(), 
              playerId: p.id, 
              playerName: p.name,
              fromTeamId: origin?.id || null, 
              fromTeamName: origin?.name || 'Agente Libre',
              toTeamId: target.id, 
              toTeamName: target.name,
              fromDivisionId: origin?.divisionId || null, 
              toDivisionId: target.divisionId,
              date: Date.now(), 
              type: req.type === 'loan_request' ? 'loan' : 'transfer', 
              price: payload.uniquePrice || 0
            });

            // 2. Crear el registro en el EconomyLedger
            if (payload.uniquePrice > 0) {
               d.economyLedger ||= [];
               d.economyLedger.unshift({
                  id: 'led_' + Date.now(), 
                  ts: Date.now(), 
                  type: 'transfer', 
                  teamId: target.id, 
                  teamName: target.name,
                  amount: -payload.uniquePrice, 
                  reason: `Fichaje: ${p.name}`, 
                  meta: { playerId: p.id, fromTeamId: origin?.id || null }
               });
               if (origin) {
                  d.economyLedger.unshift({
                    id: 'led_' + Date.now(), 
                    ts: Date.now(), 
                    type: 'transfer', 
                    teamId: origin.id, 
                    teamName: origin.name,
                    amount: payload.uniquePrice, 
                    reason: `Venta: ${p.name}`, 
                    meta: { playerId: p.id, toTeamId: target.id }
                  });
               }
            }
          }

          // 3. Crear el CONTRATO (Aquí estaba el error de no generarlo en firmas internas)
          // Este bloque simula la creación del contrato en el Gestor
          const contractId = 'cnt_' + Date.now();
          d.contracts.push({
            id: contractId,
            type: req.type === 'loan_request' ? 'loan' : 'permanent',
            status: 'active',
            playerId: p.id,
            ownerTeamId: target.id,
            teamId: target.id,
            startSeasonId: d.seasons.find(s=>s.active)?.id,
            endSeasonId: d.seasons.find(s=>s.active)?.id,
            durationSeasons: payload.durationSeasons || 1,
            durationMatchdays: payload.durationMatchdays || 0,
            endMatchday: 0,
            transferPrice: payload.uniquePrice || 0,
            clauses: {
              perMatchday: { enabled: (payload.perMatchdayPrice || 0) > 0, amount: payload.perMatchdayPrice || 0, chargeEvenIfNotPlayed: payload.chargeEvenIfNotPlayed },
              performance: { enabled: payload.performanceEnabled, targets: payload.performanceTargets || {}, onFail: 'free_agent' },
              renewalOption: { enabled: payload.renewalOptionEnabled, price: payload.renewalPrice || 0 },
              sellOnClauses: payload.sellOnClauses || []
            },
            stats: { matchdaysCharged: 0, totalCharged: 0, gamesPlayed: 0, goals: 0, assists: 0, saves: 0, shots: 0, efficiency: 0 },
            createdAt: Date.now()
          });

          p.contractId = contractId;
        }
      });

      // Marcar como "sync_done" para no volver a procesarla
      await sb.from('coach_requests')
        .update({ status: 'sync_done', admin_response_note: 'Registrado en el Gestor' })
        .eq('id', req.id);

      console.log(`[PORTAL SYNC] ${payload.is_internal_signing ? 'Contrato firmado' : 'Movimiento'} de ${payload.playerName} registrado.`);

    } catch (e) {
      console.error('Error al sincronizar movimiento:', e);
    } finally {
      _processingIds.delete(req.id);
    }
  }
}
