// ============================================================
// PERFORMANCE VIEW — Gráficas de rendimiento y economía
// ============================================================
import { getDB } from '../services/storage.js';
import { state } from '../state.js';
import { getPlayerTimeline, getTeamTimeline } from '../services/statistics.js';

let _activeTab = 'players'; // 'players' | 'teams'
let _selectedPlayerId = null;
let _selectedTeamId = null;

// Referencias a las instancias de Chart.js para poder destruirlas al re-renderizar
let _chartStatsInstance = null;
let _chartEconomyInstance = null;

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
            <label>Seleccionar Jugador</label>
            <select class="select" id="perf-player-select">
              ${players.map(p => `<option value="${p.id}" ${p.id === _selectedPlayerId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select>
          </div>
        ` : `
          <div class="field">
            <label>Seleccionar Equipo</label>
            <select class="select" id="perf-team-select">
              ${teams.map(t => `<option value="${t.id}" ${t.id === _selectedTeamId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
            </select>
          </div>
        `}
        <div class="field">
          <label>Temporada</label>
          <select class="select" disabled>
            <option>${season?.name || 'Actual'}</option>
          </select>
        </div>
      </div>
    </div>

    <div class="grid grid-2">
      <!-- Gráfica de Stats por Jornada -->
      <div class="card" style="min-height: 400px; display: flex; flex-direction: column;">
        <div class="card-header">
          <div class="card-title"><span class="dot">◆</span>RENDIMIENTO POR JORNADA</div>
        </div>
        <div style="flex:1; position:relative; min-height:300px;">
          <canvas id="perfStatsChart"></canvas>
        </div>
      </div>

      <!-- Gráfica de Evolución de Precio -->
      <div class="card" style="min-height: 400px; display: flex; flex-direction: column;">
        <div class="card-header">
          <div class="card-title"><span class="dot">◆</span>EVOLUCIÓN DE PRECIO</div>
        </div>
        <div style="flex:1; position:relative; min-height:300px;">
          <canvas id="perfEconomyChart"></canvas>
        </div>
      </div>
    </div>
  `;
}

export function bindPerformanceEvents(){
  // Destruir instancias previas si existen
  if (_chartStatsInstance) { _chartStatsInstance.destroy(); _chartStatsInstance = null; }
  if (_chartEconomyInstance) { _chartEconomyInstance.destroy(); _chartEconomyInstance = null; }

  const tabs = document.querySelectorAll('[data-perf-tab]');
  tabs.forEach(t => t.addEventListener('click', () => {
    _activeTab = t.dataset.perfTab;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }));

  const playerSelect = document.getElementById('perf-player-select');
  if (playerSelect) playerSelect.addEventListener('change', (e) => {
    _selectedPlayerId = e.target.value;
    renderCharts();
  });

  const teamSelect = document.getElementById('perf-team-select');
  if (teamSelect) teamSelect.addEventListener('change', (e) => {
    _selectedTeamId = e.target.value;
    renderCharts();
  });

  renderCharts();
}

function renderCharts() {
  const db = getDB();
  const season = db.seasons.find(s => s.active) || db.seasons[0];
  
  const ctxStats = document.getElementById('perfStatsChart');
  const ctxEco = document.getElementById('perfEconomyChart');
  if (!ctxStats || !ctxEco) return;

  // Chart.js Global Defaults para tema oscuro
  Chart.defaults.color = '#8D929A';
  Chart.defaults.borderColor = '#25272B';

  if (_activeTab === 'players') {
    const player = db.players.find(p => p.id === _selectedPlayerId);
    if (!player) return;

    // 1. TIMELINE STATS
    const timeline = getPlayerTimeline(player.id, { seasonId: season?.id, divisionId: state.divisionId });
    const labels = timeline.map(t => `J${t.matchday}`);
    const goalsData = timeline.map(t => t.goals);
    const assistsData = timeline.map(t => t.assists);

    _chartStatsInstance = new Chart(ctxStats, {
      type: 'line',
      data: {
        labels: labels.length ? labels : ['Sin Datos'],
        datasets: [
          { label: 'Goles', data: goalsData.length ? goalsData : [0], borderColor: '#E6C476', backgroundColor: 'rgba(230,196,118,0.1)', tension: 0.3, fill: true },
          { label: 'Asistencias', data: assistsData.length ? assistsData : [0], borderColor: '#6FA8FF', backgroundColor: 'rgba(111,168,255,0.1)', tension: 0.3, fill: true }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#C7CBD1' } } },
        scales: {
          x: { grid: { color: '#1C1E22' } },
          y: { grid: { color: '#1C1E22' }, beginAtZero: true }
        }
      }
    });

    // 2. EVOLUCIÓN PRECIO
    const history = player.priceHistory || [];
    const seasonLabels = history.map(h => h.seasonName);
    const priceData = history.map(h => h.price);

    // Si no hay historial, mostramos al menos el precio actual
    if (seasonLabels.length === 0) {
      seasonLabels.push(season?.name || 'Actual');
      priceData.push(0); // Temporal hasta que termine la temporada
    }

    _chartEconomyInstance = new Chart(ctxEco, {
      type: 'line',
      data: {
        labels: seasonLabels,
        datasets: [
          { label: 'Valor de Mercado ($)', data: priceData, borderColor: '#63C28A', backgroundColor: 'rgba(99,194,138,0.1)', tension: 0.3, fill: true }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#C7CBD1' } } },
        scales: {
          x: { grid: { color: '#1C1E22' } },
          y: { grid: { color: '#1C1E22' }, beginAtZero: true, ticks: { callback: value => '$' + value.toLocaleString() } }
        }
      }
    });

  } else {
    // TEAMS
    const team = db.teams.find(t => t.id === _selectedTeamId);
    if (!team) return;

    const timeline = getTeamTimeline(team.id, { seasonId: season?.id, divisionId: state.divisionId });
    const labels = timeline.map(t => `J${t.matchday}`);
    const goalsData = timeline.map(t => t.goals);
    const assistsData = timeline.map(t => t.assists);

    _chartStatsInstance = new Chart(ctxStats, {
      type: 'line',
      data: {
        labels: labels.length ? labels : ['Sin Datos'],
        datasets: [
          { label: 'Goles Totales', data: goalsData.length ? goalsData : [0], borderColor: '#E6C476', backgroundColor: 'rgba(230,196,118,0.1)', tension: 0.3, fill: true },
          { label: 'Asistencias Totales', data: assistsData.length ? assistsData : [0], borderColor: '#6FA8FF', backgroundColor: 'rgba(111,168,255,0.1)', tension: 0.3, fill: true }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#C7CBD1' } } },
        scales: {
          x: { grid: { color: '#1C1E22' } },
          y: { grid: { color: '#1C1E22' }, beginAtZero: true }
        }
      }
    });

    // Gráfica de Economía de Equipo (Falsa por ahora, basada en la historia del Ledger)
    const ledger = db.economyLedger || [];
    const teamLedger = ledger.filter(l => l.teamId === team.id).sort((a,b) => a.ts - b.ts);
    
    // Acumulamos el saldo a lo largo del tiempo
    let currentBal = 0;
    const balData = [];
    const balLabels = [];
    teamLedger.forEach(l => {
      currentBal += l.amount;
      balData.push(currentBal);
      balLabels.push(new Date(l.ts).toLocaleDateString());
    });

    _chartEconomyInstance = new Chart(ctxEco, {
      type: 'line',
      data: {
        labels: balLabels.length ? balLabels : ['Sin Datos'],
        datasets: [
          { label: 'Saldo Acumulado ($)', data: balData.length ? balData : [0], borderColor: '#63C28A', backgroundColor: 'rgba(99,194,138,0.1)', tension: 0.1, fill: true }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#C7CBD1' } } },
        scales: {
          x: { grid: { color: '#1C1E22' } },
          y: { grid: { color: '#1C1E22' }, ticks: { callback: value => '$' + value.toLocaleString() } }
        }
      }
    });
  }
}

function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}
