// ============================================================
// PERFORMANCE VIEW (Gestor)
// ============================================================
import { getDB } from '../services/storage.js';
import { state } from '../state.js';
import { getPlayerTimeline, getTeamTimeline } from '../services/statistics.js';
import { calculatePlayerPrice } from '../services/economy.js';
import { aggregatePlayerStats } from '../services/statistics.js';

let _activeTab = 'players';
let _selectedPlayerId = null;
let _selectedTeamId = null;

// FIX: Usar el objeto global para Chart.js instancias
let chartStats = null;
let chartEconomy = null;

export function performanceView(){
  const db = getDB();
  if (!db) return `<div class="card">Cargando...</div>`;

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
          <div class="field"><label>Jugador</label>
            <select class="select" id="perf-player-select">
              ${players.map(p => `<option value="${p.id}" ${p.id === _selectedPlayerId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select>
          </div>
        ` : `
          <div class="field"><label>Equipo</label>
            <select class="select" id="perf-team-select">
              ${teams.map(t => `<option value="${t.id}" ${t.id === _selectedTeamId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
            </select>
          </div>
        `}
        <div class="field"><label>Temporada</label><select class="select" disabled><option>${season?.name || 'Actual'}</option></select></div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>RENDIMIENTO POR JORNADA</div></div>
        <div style="position:relative; height:300px; width:100%;">
          <canvas id="perfStatsChart"></canvas>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title"><span class="dot">◆</span>EVOLUCIÓN DE PRECIO (POR JORNADA)</div></div>
        <div style="position:relative; height:300px; width:100%;">
          <canvas id="perfEconomyChart"></canvas>
        </div>
      </div>
    </div>
  `;
}

export function bindPerformanceEvents(){
  const ctxStats = document.getElementById('perfStatsChart');
  const ctxEco = document.getElementById('perfEconomyChart');
  if (!ctxStats || !ctxEco) return;

  if (chartStats) { chartStats.destroy(); chartStats = null; }
  if (chartEconomy) { chartEconomy.destroy(); chartEconomy = null; }

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

  chartStats = new Chart(ctxStats, { type: 'line', data: { labels: [], datasets: [] } });
  chartEconomy = new Chart(ctxEco, { type: 'line', data: { labels: [], datasets: [] } });
  
  updateChartsData();
}

function updateChartsData() {
  if (!chartStats || !chartEconomy) return;

  const db = getDB();
  const season = db.seasons.find(s => s.active) || db.seasons[0];

  if (_activeTab === 'players') {
    const player = db.players.find(p => p.id === _selectedPlayerId);
    if (!player) return;

    const timeline = getPlayerTimeline(player.id, { seasonId: season?.id, divisionId: state.divisionId });
    chartStats.data.labels = timeline.map(t => `J${t.matchday}`);
    chartStats.data.datasets = [
      { label: 'Goles', data: timeline.map(t => t.goals), borderColor: '#E6C476', backgroundColor: 'rgba(230,196,118,0.1)', tension: 0.3, fill: true },
      { label: 'Asistencias', data: timeline.map(t => t.assists), borderColor: '#6FA8FF', backgroundColor: 'rgba(111,168,255,0.1)', tension: 0.3, fill: true }
    ];

    // FIX: Leer historial filtrado por matchday
    const history = (player.priceHistory || [])
      .filter(h => h.matchday)
      .sort((a,b) => a.matchday - b.matchday);

    if (history.length === 0) {
      const stats = aggregatePlayerStats().find(s => s.id === player.id);
      const currentPriceData = calculatePlayerPrice(player, stats || {}, db.config.economy);
      chartEconomy.data.labels = ['Actual'];
      chartEconomy.data.datasets = [{
        label: 'Valor de Mercado ($)', data: [currentPriceData.price || 1000], borderColor: '#63C28A', backgroundColor: 'rgba(99,194,138,0.1)', tension: 0.3, fill: true
      }];
    } else {
      chartEconomy.data.labels = history.map(h => `J${h.matchday}`);
      chartEconomy.data.datasets = [{
        label: 'Valor de Mercado ($)', data: history.map(h => h.price), borderColor: '#63C28A', backgroundColor: 'rgba(99,194,138,0.1)', tension: 0.3, fill: true
      }];
    }
  } else {
    const team = db.teams.find(t => t.id === _selectedTeamId);
    if (!team) return;

    const timeline = getTeamTimeline(team.id, { seasonId: season?.id, divisionId: state.divisionId });
    chartStats.data.labels = timeline.map(t => `J${t.matchday}`);
    chartStats.data.datasets = [
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

    chartEconomy.data.labels = balLabels.length ? balLabels : ['Actual'];
    chartEconomy.data.datasets = [{
      label: 'Saldo Acumulado ($)', data: balData.length ? balData : [team.money || 0], borderColor: '#63C28A', backgroundColor: 'rgba(99,194,138,0.1)', tension: 0.1, fill: true
    }];
  }

  chartStats.update();
  chartEconomy.update();
}

function esc(str) { return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
