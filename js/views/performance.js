// ============================================================
// PERFORMANCE VIEW (Gestor)
// ============================================================
import { getDB } from '../services/storage.js';
import { state } from '../state.js';
import { getPlayerTimeline, getTeamTimeline } from '../services/statistics.js';
import { calculatePlayerPrice } from '../services/economy.js';

let _activeTab = 'players';
let _selectedPlayerId = null;
let _selectedTeamId = null;

export function performanceView(){
  const db = getDB();
  const season = db.seasons.find(s => s.active) || db.seasons[0];
  const division = db.divisions.find(d => d.id === state.divisionId) || db.divisions[0];
  
  const players = db.players.filter(p => !division || p.divisionId === division.id || db.teams.some(t => t.divisionId === division.id && (t.roster||[]).some(r => r.playerId === p.id)));
  const teams = db.teams.filter(t => !division || t.divisionId === division.id);

  if (!_selectedPlayerId && players.length > 0) _selectedPlayerId = players[0].id;
  if (!_selectedTeamId && teams.length > 0) _selectedTeamId = teams[0].id;

  return `
    <div class="page-head">
      <h1 class="page-title">PERFORMANCE</h1>
      <div class="stats-tabs" style="margin-bottom:0">
        <button class="stats-tab ${_activeTab === 'players' ? 'active' : ''}" data-perf-tab="players">👤 Jugadores</button>
        <button class="stats-tab ${_activeTab === 'teams' ? 'active' : ''}" data-perf-tab="teams">🛡 Equipos</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="row">
        ${_activeTab === 'players' ? `
          <div class="field">
            <label>Jugador</label>
            <select class="select" id="perf-player-select">
              ${players.map(p => `<option value="${p.id}" ${p.id === _selectedPlayerId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select>
          </div>
        ` : `
          <div class="field">
            <label>Equipo</label>
            <select class="select" id="perf-team-select">
              ${teams.map(t => `<option value="${t.id}" ${t.id === _selectedTeamId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
            </select>
          </div>
        `}
        <div class="field"><label>Temporada</label><select class="select" disabled><option>${season?.name || 'Actual'}</option></select></div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card" style="min-height: 400px; display: flex; flex-direction: column;">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>RENDIMIENTO POR JORNADA</div></div>
        <div style="flex:1; position:relative; min-height:300px;"><canvas id="perfStatsChart"></canvas></div>
      </div>
      <div class="card" style="min-height: 400px; display: flex; flex-direction: column;">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>EVOLUCIÓN DE PRECIO</div></div>
        <div style="flex:1; position:relative; min-height:300px;"><canvas id="perfEconomyChart"></canvas></div>
      </div>
    </div>
  `;
}

export function bindPerformanceEvents(){
  // Destruir instancias previas si el canvas cambió
  const ctxStats = document.getElementById('perfStatsChart');
  const ctxEco = document.getElementById('perfEconomyChart');
  if (!ctxStats || !ctxEco) return;

  // Limpiar gráficos viejos si existen
  if (window._chartStatsInstance) { window._chartStatsInstance.destroy(); window._chartStatsInstance = null; }
  if (window._chartEconomyInstance) { window._chartEconomyInstance.destroy(); window._chartEconomyInstance = null; }

  document.querySelectorAll('[data-perf-tab]').forEach(t => t.addEventListener('click', () => {
    _activeTab = t.dataset.perfTab;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }));

  document.getElementById('perf-player-select')?.addEventListener('change', (e) => {
    _selectedPlayerId = e.target.value;
    updateChartsData();
  });

  document.getElementById('perf-team-select')?.addEventListener('change', (e) => {
    _selectedTeamId = e.target.value;
    updateChartsData();
  });

  renderCharts();
}

function renderCharts() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.color = '#8D929A';
  Chart.defaults.borderColor = '#25272B';

  const ctxStats = document.getElementById('perfStatsChart');
  const ctxEco = document.getElementById('perfEconomyChart');
  if (!ctxStats || !ctxEco) return;

  window._chartStatsInstance = new Chart(ctxStats, { type: 'line', data: { labels: [], datasets: [] } });
  window._chartEconomyInstance = new Chart(ctxEco, { type: 'line', data: { labels: [], datasets: [] } });
  
  updateChartsData();
}

function updateChartsData() {
  if (!window._chartStatsInstance || !window._chartEconomyInstance) return;

  const db = getDB();
  const season = db.seasons.find(s => s.active) || db.seasons[0];

  if (_activeTab === 'players') {
    const player = db.players.find(p => p.id === _selectedPlayerId);
    if (!player) return;

    const timeline = getPlayerTimeline(player.id, { seasonId: season?.id, divisionId: state.divisionId });
    window._chartStatsInstance.data.labels = timeline.map(t => `J${t.matchday}`);
    window._chartStatsInstance.data.datasets = [
      { label: 'Goles', data: timeline.map(t => t.goals), borderColor: '#E6C476', backgroundColor: 'rgba(230,196,118,0.1)', tension: 0.3, fill: true },
      { label: 'Asistencias', data: timeline.map(t => t.assists), borderColor: '#6FA8FF', backgroundColor: 'rgba(111,168,255,0.1)', tension: 0.3, fill: true }
    ];

    const history = player.priceHistory || [];
    if (history.length === 0) {
      // Si no hay historial, mostrar el precio actual calculado
      const currentPriceData = calculatePlayerPrice(player, player.seasonStats || {}, db.config.economy);
      window._chartEconomyInstance.data.labels = [season?.name || 'Actual'];
      window._chartEconomyInstance.data.datasets = [{
        label: 'Valor de Mercado ($)', data: [currentPriceData.price], borderColor: '#63C28A', backgroundColor: 'rgba(99,194,138,0.1)', tension: 0.3, fill: true
      }];
    } else {
      window._chartEconomyInstance.data.labels = history.map(h => h.seasonName);
      window._chartEconomyInstance.data.datasets = [{
        label: 'Valor de Mercado ($)', data: history.map(h => h.price), borderColor: '#63C28A', backgroundColor: 'rgba(99,194,138,0.1)', tension: 0.3, fill: true
      }];
    }
  } else {
    const team = db.teams.find(t => t.id === _selectedTeamId);
    if (!team) return;

    const timeline = getTeamTimeline(team.id, { seasonId: season?.id, divisionId: state.divisionId });
    window._chartStatsInstance.data.labels = timeline.map(t => `J${t.matchday}`);
    window._chartStatsInstance.data.datasets = [
      { label: 'Goles', data: timeline.map(t => t.goals), borderColor: '#E6C476', backgroundColor: 'rgba(230,196,118,0.1)', tension: 0.3, fill: true },
      { label: 'Asistencias', data: timeline.map(t => t.assists), borderColor: '#6FA8FF', backgroundColor: 'rgba(111,168,255,0.1)', tension: 0.3, fill: true }
    ];

    const ledger = db.economyLedger || [];
    const teamLedger = ledger.filter(l => l.teamId === team.id).sort((a,b) => a.ts - b.ts);
    let currentBal = 0;
    const balData = [];
    const balLabels = [];
    teamLedger.forEach(l => {
      currentBal += l.amount;
      balData.push(currentBal);
      balLabels.push(new Date(l.ts).toLocaleDateString());
    });

    window._chartEconomyInstance.data.labels = balLabels.length ? balLabels : ['Actual'];
    window._chartEconomyInstance.data.datasets = [{
      label: 'Saldo Acumulado ($)', data: balData.length ? balData : [team.money || 0], borderColor: '#63C28A', backgroundColor: 'rgba(99,194,138,0.1)', tension: 0.1, fill: true
    }];
  }

  window._chartStatsInstance.update();
  window._chartEconomyInstance.update();
}

function esc(str) { return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
