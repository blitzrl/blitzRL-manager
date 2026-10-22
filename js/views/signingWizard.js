import { getDB } from '../services/storage.js';
import { openModal, closeTopModal, toast } from '../services/ui.js';
import { createContract } from '../services/contracts.js';

export function openSigningWizard(playerId, isLoan = false) {
  const db = getDB();
  const player = db.players.find(p => p.id === playerId);
  if (!player) return toast('Jugador no encontrado', 'error');

  const originTeam = db.teams.find(t => (t.roster || []).some(r => r.playerId === playerId));
  const isFreeAgent = !originTeam;

  const state = {
    step: 1,
    targetTeamId: '',
    durationSeasons: 1,
    durationMatchdays: 0,
    uniquePrice: 0,
    perMatchdayPrice: 0,
    chargeEvenIfNotPlayed: true,
    perfEnabled: false,
    perfTargets: { gamesPlayed: false, goals: false, assists: false, saves: false, efficiency: false },
    renewalOption: false,
    renewalPrice: 0,
    sellOnClause: false,
    sellOnPercentage: 15,
    sellOnSales: 1,
    customMessage: ''
  };

  openModal({
    id: 'signing-modal-' + playerId,
    title: `${isLoan ? 'PRÉSTAMO' : 'FICHAJE'} · ${player.name.toUpperCase()}`,
    wide: true,
    body: `<div id="signingWizardBody"></div>`,
    footer: `
      <button class="btn btn-ghost" id="signBtnPrev" style="display:none">← ATRÁS</button>
      <button class="btn btn-primary" id="signBtnNext">SIGUIENTE →</button>
    `,
    onMount: (root) => {
      const body = root.querySelector('#signingWizardBody');
      const btnPrev = root.querySelector('#signBtnPrev');
      const btnNext = root.querySelector('#signBtnNext');

      function render() {
        btnPrev.style.display = state.step > 1 ? 'inline-flex' : 'none';
        btnNext.textContent = state.step === 4 ? (isLoan ? 'CONFIRMAR PRÉSTAMO' : 'CONFIRMAR FICHAJE') : 'SIGUIENTE →';
        
        if (state.step === 1) {
          body.innerHTML = `
            <div class="card">
              <div class="card-header"><div class="card-title">PASO 1: DESTINO Y VIGENCIA</div></div>
              <div class="field">
                <label>Equipo Destino</label>
                <select class="select" id="sTarget">
                  <option value="">— Seleccionar equipo —</option>
                  ${db.teams.filter(t => t.id !== originTeam?.id).map(t => `
                    <option value="${t.id}" ${state.targetTeamId === t.id ? 'selected' : ''}>${t.name}</option>
                  `).join('')}
                </select>
              </div>
              <div class="row">
                <div class="field">
                  <label>Temporadas de Contrato</label>
                  <input class="input" type="number" id="sSeasons" min="1" max="5" value="${state.durationSeasons}">
                </div>
                <div class="field">
                  <label>Jornadas extra (Opcional)</label>
                  <input class="input" type="number" id="sMatchdays" min="0" max="20" value="${state.durationMatchdays}">
                </div>
              </div>
            </div>
          `;
        } 
        else if (state.step === 2) {
          body.innerHTML = `
            <div class="card">
              <div class="card-header"><div class="card-title">PASO 2: ECONÓMICO Y FUTURA VENTA</div></div>
              <div class="row">
                <div class="field">
                  <label>Precio de ${isLoan ? 'Préstamo' : 'Fichaje'} ($)</label>
                  <input class="input" type="number" id="sUnique" value="${isFreeAgent ? 0 : state.uniquePrice}" ${isFreeAgent ? 'disabled title="Agentes libres son gratis"' : ''}>
                </div>
                ${isLoan ? `
                <div class="field">
                  <label>Precio por Jornada ($)</label>
                  <input class="input" type="number" id="sPerMatch" value="${state.perMatchdayPrice}">
                </div>` : ''}
              </div>
              
              ${!isLoan ? `
              <div class="field" style="margin-top:16px; padding:12px; background:var(--bg-graphite); border-radius:8px;">
                <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                  <input type="checkbox" id="sSellOnEnabled" ${state.sellOnClause ? 'checked' : ''}>
                  Activar Cláusula de Futura Venta
                </label>
                <div id="sSellOnFields" style="opacity:${state.sellOnClause ? 1 : 0.4}; pointer-events:${state.sellOnClause ? 'auto' : 'none'};">
                  <div class="row">
                    <div class="field">
                      <label>Porcentaje de la próxima venta (%)</label>
                      <input class="input" type="number" id="sSellOnPct" min="1" max="100" value="${state.sellOnPercentage}">
                    </div>
                    <div class="field">
                      <label>Válido por X ventas</label>
                      <input class="input" type="number" id="sSellOnSales" min="1" max="5" value="${state.sellOnSales}">
                    </div>
                  </div>
                </div>
              </div>
              ` : ''}
            </div>
          `;
        }
        else if (state.step === 3) {
          body.innerHTML = `
            <div class="card">
              <div class="card-header"><div class="card-title">PASO 3: RENDIMIENTO Y RENOVACIÓN</div></div>
              <label style="display:flex; align-items:center; gap:8px; margin-bottom:16px; font-weight:600;">
                <input type="checkbox" id="sPerfEnabled" ${state.perfEnabled ? 'checked' : ''}> Activar cláusula de rendimiento
              </label>
              <div style="opacity: ${state.perfEnabled ? 1 : 0.4}; pointer-events: ${state.perfEnabled ? 'auto' : 'none'};">
                <p class="field-hint" style="margin-bottom:12px;">Si el jugador NO cumple estas metas al finalizar el contrato, se irá a Agentes Libres.</p>
                <div class="row-3">
                  <label><input type="checkbox" id="sPg" ${state.perfTargets.gamesPlayed ? 'checked' : ''}> Partidos</label>
                  <label><input type="checkbox" id="sPgoals" ${state.perfTargets.goals ? 'checked' : ''}> Goles</label>
                  <label><input type="checkbox" id="sPassists" ${state.perfTargets.assists ? 'checked' : ''}> Asistencias</label>
                </div>
                <div class="row-3" style="margin-top:10px;">
                  <input class="input" type="number" id="sPgVal" value="${state.perfTargets.gamesPlayedMin || 0}" placeholder="PJ Mín">
                  <input class="input" type="number" id="sPgoalsVal" value="${state.perfTargets.goalsMin || 0}" placeholder="Goles Mín">
                  <input class="input" type="number" id="sPassistsVal" value="${state.perfTargets.assistsMin || 0}" placeholder="Asist Mín">
                </div>
              </div>

              <div class="divider"></div>

              <label style="display:flex; align-items:center; gap:8px; margin-bottom:16px; font-weight:600;">
                <input type="checkbox" id="sRenewEnabled" ${state.renewalOption ? 'checked' : ''}> Opción de Renovación (Al final del contrato)
              </label>
              <div style="opacity: ${state.renewalOption ? 1 : 0.4}; pointer-events: ${state.renewalOption ? 'auto' : 'none'};">
                <div class="field">
                  <label>Precio para renovar ($)</label>
                  <input class="input" type="number" id="sRenewPrice" value="${state.renewalPrice}">
                </div>
              </div>
            </div>
          `;
        }
        else if (state.step === 4) {
          const targetName = db.teams.find(t => t.id === state.targetTeamId)?.name || '?';
          body.innerHTML = `
            <div class="card" style="border-left:4px solid var(--success)">
              <div class="card-header"><div class="card-title">PASO 4: MENSAJE Y CONFIRMACIÓN</div></div>
              <div class="field">
                <label>Mensaje para el otro Coach (Opcional)</label>
                <textarea class="textarea" id="sMessage" rows="4" placeholder="Ej: Podemos ofertar más, contactame por Discord...">${state.customMessage}</textarea>
              </div>
              
              <div style="display:flex; flex-direction:column; gap:6px; font-size:12px; margin-top:16px; padding:12px; background:var(--bg-deep); border-radius:6px;">
                <div><b>Jugador:</b> ${player.name}</div>
                <div><b>Destino:</b> ${targetName}</div>
                <div><b>Duración:</b> ${state.durationSeasons} Temporada(s) ${state.durationMatchdays > 0 ? `+ ${state.durationMatchdays} Jornada(s)` : ''}</div>
                ${!isFreeAgent ? `<div><b>Precio:</b> $${state.uniquePrice.toLocaleString()}</div>` : ''}
                ${state.sellOnClause ? `<div><b>Futura Venta:</b> ${state.sellOnPercentage}% por ${state.sellOnSales} venta(s)</div>` : ''}
              </div>
            </div>
          `;
        }
      }

      function saveState() {
        if (state.step === 1) {
          state.targetTeamId = body.querySelector('#sTarget')?.value;
          state.durationSeasons = parseInt(body.querySelector('#sSeasons')?.value) || 1;
          state.durationMatchdays = parseInt(body.querySelector('#sMatchdays')?.value) || 0;
        } else if (state.step === 2) {
          state.uniquePrice = parseInt(body.querySelector('#sUnique')?.value) || 0;
          if (isLoan) state.perMatchdayPrice = parseInt(body.querySelector('#sPerMatch')?.value) || 0;
          if (!isLoan) {
            state.sellOnClause = body.querySelector('#sSellOnEnabled')?.checked || false;
            state.sellOnPercentage = parseInt(body.querySelector('#sSellOnPct')?.value) || 0;
            state.sellOnSales = parseInt(body.querySelector('#sSellOnSales')?.value) || 0;
          }
        } else if (state.step === 3) {
          state.perfEnabled = body.querySelector('#sPerfEnabled')?.checked || false;
          state.renewalOption = body.querySelector('#sRenewEnabled')?.checked || false;
          state.renewalPrice = parseInt(body.querySelector('#sRenewPrice')?.value) || 0;
          if (state.perfEnabled) {
            state.perfTargets = {
              gamesPlayed: { enabled: body.querySelector('#sPg').checked, min: parseInt(body.querySelector('#sPgVal').value) || 0 },
              goals: { enabled: body.querySelector('#sPgoals').checked, min: parseInt(body.querySelector('#sPgoalsVal').value) || 0 },
              assists: { enabled: body.querySelector('#sPassists').checked, min: parseInt(body.querySelector('#sPassistsVal').value) || 0 }
            };
          }
        } else if (state.step === 4) {
          state.customMessage = body.querySelector('#sMessage')?.value.trim() || '';
        }
      }

      btnNext.addEventListener('click', () => {
        saveState();
        if (state.step === 1 && !state.targetTeamId) return toast('Selecciona un equipo destino', 'error');

        if (state.step < 4) {
          state.step++;
          render();
        } else {
          try {
            const clauses = {
              performance: { enabled: state.perfEnabled, targets: state.perfTargets },
              renewalOption: { enabled: state.renewalOption, price: state.renewalPrice },
              sellOnClauses: []
            };

            if (state.sellOnClause && !isFreeAgent) {
              clauses.sellOnClauses.push({
                originalTeamId: originTeam.id,
                percentage: state.sellOnPercentage,
                remainingSales: state.sellOnSales,
                status: 'active'
              });
            }

            createContract({
              playerId: player.id,
              type: isLoan ? 'loan' : 'permanent',
              currentTeamId: state.targetTeamId,
              ownerTeamId: isFreeAgent ? state.targetTeamId : originTeam.id,
              durationSeasons: state.durationSeasons,
              durationMatchdays: state.durationMatchdays,
              uniquePrice: state.uniquePrice,
              perMatchdayPrice: state.perMatchdayPrice,
              chargeEvenIfNotPlayed: state.chargeEvenIfNotPlayed,
              performanceEnabled: state.perfEnabled,
              performanceTargets: state.perfTargets,
              renewalOptionEnabled: state.renewalOption,
              renewalPrice: state.renewalPrice,
              sellOnClauses: clauses.sellOnClauses,
              autoReturnOnElimination: true
            });
            toast('✅ Contrato creado exitosamente', 'success');
            closeTopModal();
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          } catch (e) {
            toast('Error: ' + e.message, 'error');
          }
        }
      });

      btnPrev.addEventListener('click', () => {
        saveState();
        state.step--;
        render();
      });

      body.addEventListener('change', (e) => {
        if (e.target.id === 'sPerfEnabled' || e.target.id === 'sRenewEnabled' || e.target.id === 'sSellOnEnabled') {
          saveState();
          render();
        }
      });

      render();
    }
  });
}
