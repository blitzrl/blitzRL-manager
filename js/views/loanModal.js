import { getDB } from '../services/storage.js';
import { openModal, closeTopModal, toast } from '../services/ui.js';
import { createContract } from '../services/contracts.js';

export function openLoanModal(playerId) {
  const db = getDB();
  const player = db.players.find(p => p.id === playerId);
  if (!player) return toast('Jugador no encontrado', 'error');

  const originTeam = db.teams.find(t => (t.roster || []).some(r => r.playerId === playerId));
  if (!originTeam) return toast('El jugador debe pertenecer a un equipo para ser prestado', 'error');

  // Estado local del wizard
  const state = {
    step: 1,
    targetTeamId: '',
    durationMatchdays: 5,
    uniquePrice: 0,
    perMatchdayPrice: 0,
    chargeEvenIfNotPlayed: true,
    perfEnabled: false,
    perfTargets: { gamesPlayed: false, goals: false, assists: false, saves: false, efficiency: false },
    buyOption: false,
    mandatoryBuy: false,
    buyPrice: 0,
    autoReturnOnElimination: true
  };

  openModal({
    id: 'loan-modal-' + playerId,
    title: `PRÉSTAMO · ${player.name.toUpperCase()}`,
    wide: true,
    body: `<div id="loanWizardBody"></div>`,
    footer: `
      <button class="btn btn-ghost" id="loanBtnPrev" style="display:none">← ATRÁS</button>
      <button class="btn btn-primary" id="loanBtnNext">SIGUIENTE →</button>
    `,
    onMount: (root) => {
      const body = root.querySelector('#loanWizardBody');
      const btnPrev = root.querySelector('#loanBtnPrev');
      const btnNext = root.querySelector('#loanBtnNext');

      function render() {
        btnPrev.style.display = state.step > 1 ? 'inline-flex' : 'none';
        btnNext.textContent = state.step === 4 ? 'CONFIRMAR PRÉSTAMO' : 'SIGUIENTE →';
        
        if (state.step === 1) {
          body.innerHTML = `
            <div class="card">
              <div class="card-header"><div class="card-title">PASO 1: DESTINO Y DURACIÓN</div></div>
              <div class="field">
                <label>Equipo Destino</label>
                <select class="select" id="lTarget">
                  <option value="">— Seleccionar equipo —</option>
                  ${db.teams.filter(t => t.id !== originTeam.id).map(t => `
                    <option value="${t.id}" ${state.targetTeamId === t.id ? 'selected' : ''}>
                      ${t.name} (${t.roster.length}/4 slots)
                    </option>
                  `).join('')}
                </select>
              </div>
              <div class="field">
                <label>Duración (Jornadas)</label>
                <input class="input" type="number" id="lDuration" min="1" max="20" value="${state.durationMatchdays}">
              </div>
              <div class="field">
                <label style="display:flex; align-items:center; gap:8px;">
                  <input type="checkbox" id="lAutoReturn" ${state.autoReturnOnElimination ? 'checked' : ''}>
                  Regresar automáticamente si el equipo es eliminado en Playoffs
                </label>
              </div>
            </div>
          `;
        } 
        else if (state.step === 2) {
          body.innerHTML = `
            <div class="card">
              <div class="card-header"><div class="card-title">PASO 2: CLÁUSULAS FINANCIERAS</div></div>
              <div class="row">
                <div class="field">
                  <label>Precio Único ($)</label>
                  <input class="input" type="number" id="lUnique" value="${state.uniquePrice}">
                  <small class="field-hint">Se paga una sola vez al inicio.</small>
                </div>
                <div class="field">
                  <label>Precio por Jornada ($)</label>
                  <input class="input" type="number" id="lPerMatch" value="${state.perMatchdayPrice}">
                  <small class="field-hint">Se cobra al equipo destino por cada jornada.</small>
                </div>
              </div>
              <div class="field">
                <label style="display:flex; align-items:center; gap:8px;">
                  <input type="checkbox" id="lChargePlayed" ${state.chargeEvenIfNotPlayed ? 'checked' : ''}>
                  Cobrar por jornada incluso si el jugador NO juega.
                </label>
              </div>
            </div>
          `;
        }
        else if (state.step === 3) {
          body.innerHTML = `
            <div class="card">
              <div class="card-header"><div class="card-title">PASO 3: CLÁUSULAS DE RENDIMIENTO (OPCIONAL)</div></div>
              <label style="display:flex; align-items:center; gap:8px; margin-bottom:16px; font-weight:600;">
                <input type="checkbox" id="lPerfEnabled" ${state.perfEnabled ? 'checked' : ''}> Activar cláusula de rendimiento
              </label>
              <div style="opacity: ${state.perfEnabled ? 1 : 0.4}; pointer-events: ${state.perfEnabled ? 'auto' : 'none'};">
                <p class="field-hint" style="margin-bottom:12px;">Si el jugador NO cumple estas metas, regresará al equipo de origen.</p>
                <div class="row-3">
                  <label><input type="checkbox" id="lPg" ${state.perfTargets.gamesPlayed ? 'checked' : ''}> Partidos Jugados</label>
                  <label><input type="checkbox" id="lPgoals" ${state.perfTargets.goals ? 'checked' : ''}> Goles</label>
                  <label><input type="checkbox" id="lPassists" ${state.perfTargets.assists ? 'checked' : ''}> Asistencias</label>
                  <label><input type="checkbox" id="lPsaves" ${state.perfTargets.saves ? 'checked' : ''}> Salvadas</label>
                  <label><input type="checkbox" id="lPeff" ${state.perfTargets.efficiency ? 'checked' : ''}> Eficiencia (%)</label>
                </div>
                <div class="row-3" style="margin-top:10px;">
                  <input class="input" type="number" id="lPgVal" value="${state.perfTargets.gamesPlayedMin || 0}" placeholder="PJ Mín">
                  <input class="input" type="number" id="lPgoalsVal" value="${state.perfTargets.goalsMin || 0}" placeholder="Goles Mín">
                  <input class="input" type="number" id="lPassistsVal" value="${state.perfTargets.assistsMin || 0}" placeholder="Asist Mín">
                  <input class="input" type="number" id="lPsavesVal" value="${state.perfTargets.savesMin || 0}" placeholder="Salv Mín">
                  <input class="input" type="number" id="lPeffVal" value="${state.perfTargets.efficiencyMin || 0}" placeholder="Efic %">
                </div>
              </div>
            </div>
          `;
        }
        else if (state.step === 4) {
          const targetName = db.teams.find(t => t.id === state.targetTeamId)?.name || '?';
          body.innerHTML = `
            <div class="card" style="border-left:4px solid var(--success)">
              <div class="card-header"><div class="card-title">PASO 4: CONFIRMACIÓN</div></div>
              <div style="display:flex; flex-direction:column; gap:10px; font-size:13px;">
                <div><b>Jugador:</b> ${player.name}</div>
                <div><b>Origen:</b> ${originTeam.name}</div>
                <div><b>Destino:</b> ${targetName}</div>
                <div><b>Duración:</b> ${state.durationMatchdays} jornadas</div>
                <div><b>Cláusulas Financieras:</b> ${state.uniquePrice > 0 ? `$${state.uniquePrice} único` : ''} ${state.perMatchdayPrice > 0 ? `+ $${state.perMatchdayPrice}/jornada` : ''}</div>
                <div><b>Opción de Compra:</b> ${state.buyOption ? `Sí ($${state.buyPrice})` : 'No'}</div>
                <div><b>Compra Obligatoria:</b> ${state.mandatoryBuy ? 'Sí' : 'No'}</div>
              </div>
            </div>
          `;
        }
      }

      // Event Listeners para guardar el estado antes de cambiar de paso
      function saveState() {
        if (state.step === 1) {
          state.targetTeamId = body.querySelector('#lTarget')?.value;
          state.durationMatchdays = parseInt(body.querySelector('#lDuration')?.value) || 5;
          state.autoReturnOnElimination = body.querySelector('#lAutoReturn')?.checked;
        } else if (state.step === 2) {
          state.uniquePrice = parseInt(body.querySelector('#lUnique')?.value) || 0;
          state.perMatchdayPrice = parseInt(body.querySelector('#lPerMatch')?.value) || 0;
          state.chargeEvenIfNotPlayed = body.querySelector('#lChargePlayed')?.checked;
        } else if (state.step === 3) {
          state.perfEnabled = body.querySelector('#lPerfEnabled')?.checked;
          if (state.perfEnabled) {
            state.perfTargets = {
              gamesPlayed: { enabled: body.querySelector('#lPg').checked, min: parseInt(body.querySelector('#lPgVal').value) || 0 },
              goals: { enabled: body.querySelector('#lPgoals').checked, min: parseInt(body.querySelector('#lPgoalsVal').value) || 0 },
              assists: { enabled: body.querySelector('#lPassists').checked, min: parseInt(body.querySelector('#lPassistsVal').value) || 0 },
              saves: { enabled: body.querySelector('#lPsaves').checked, min: parseInt(body.querySelector('#lPsavesVal').value) || 0 },
              efficiency: { enabled: body.querySelector('#lPeff').checked, min: parseInt(body.querySelector('#lPeffVal').value) || 0 }
            };
          }
        }
      }

      btnNext.addEventListener('click', () => {
        saveState();
        
        if (state.step === 1 && !state.targetTeamId) {
          return toast('Selecciona un equipo destino', 'error');
        }

        if (state.step < 4) {
          state.step++;
          render();
        } else {
          // EJECUTAR
          try {
            createContract({
              playerId: player.id,
              type: 'loan',
              currentTeamId: state.targetTeamId,
              ownerTeamId: originTeam.id,
              durationMatchdays: state.durationMatchdays,
              uniquePrice: state.uniquePrice,
              perMatchdayPrice: state.perMatchdayPrice,
              chargeEvenIfNotPlayed: state.chargeEvenIfNotPlayed,
              performanceEnabled: state.perfEnabled,
              performanceTargets: state.perfTargets,
              buyOptionEnabled: state.buyOption,
              buyPrice: state.buyPrice,
              mandatoryBuy: state.mandatoryBuy,
              autoReturnOnElimination: state.autoReturnOnElimination
            });
            toast('✅ Préstamo creado con éxito', 'success');
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

      // Listener para el checkbox de rendimiento
      body.addEventListener('change', (e) => {
        if(e.target.id === 'lPerfEnabled') {
          state.perfEnabled = e.target.checked;
          render(); // Re-render para actualizar opacity
        }
      });

      render();
    }
  });
}
