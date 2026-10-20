import { getDB, mutate } from '../services/storage.js';
import { AIService } from '../services/aiService.js';
import { openModal, closeTopModal, toast } from '../services/ui.js';
import { state } from '../state.js';
import { computeStandings } from '../services/standings.js';
import { aggregatePlayerStats } from '../services/statistics.js';
import { ballonDor } from '../services/pig.js';
import { openAdvancedNewsEditor } from './news.js';
import { uid } from '../data/database.js';

let activeSubTab = 'matches';

export function renderNewsroomTab() {
  return `
    <div class="card" style="border-left:4px solid var(--gold); margin-bottom:20px;">
      <div class="card-header">
        <div class="card-title" style="color:var(--gold)"><span class="dot" style="color:var(--gold)">◆</span>PRENSA IA</div>
      </div>
      <p style="font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:14px;">
        Tu centro de prensa automatizado. Genera crónicas de partidos, analiza el mercado, audita la economía o escribe sobre el Balón de Oro.
      </p>
      
      <div class="stats-tabs" style="margin-bottom:0">
        <button class="stats-tab ${activeSubTab === 'matches' ? 'active' : ''}" data-nr-tab="matches">⚽ Partidos</button>
        <button class="stats-tab ${activeSubTab === 'transfers' ? 'active' : ''}" data-nr-tab="transfers">💰 Fichajes</button>
        <button class="stats-tab ${activeSubTab === 'economy' ? 'active' : ''}" data-nr-tab="economy">📊 Economía</button>
        <button class="stats-tab ${activeSubTab === 'ballondor' ? 'active' : ''}" data-nr-tab="ballondor">🏆 Balón de Oro</button>
        <button class="stats-tab ${activeSubTab === 'custom' ? 'active' : ''}" data-nr-tab="custom">📝 Custom</button>
      </div>
    </div>

    <div id="newsroomContent" style="min-height:300px;">
      ${renderSubTab(activeSubTab)}
    </div>
  `;
}

export function bindNewsroomEvents() {
  document.querySelectorAll('[data-nr-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSubTab = btn.dataset.nrTab;
      document.querySelectorAll('[data-nr-tab]').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('newsroomContent').innerHTML = renderSubTab(activeSubTab);
      bindSubTabEvents(activeSubTab);
    });
  });
  bindSubTabEvents(activeSubTab);
}

function renderSubTab(tab) {
  if (tab === 'matches') return renderMatchesTab();
  if (tab === 'transfers') return renderTransfersTab();
  if (tab === 'economy') return renderEconomyTabNewsroom();
  if (tab === 'ballondor') return renderBallonDorTab();
  if (tab === 'custom') return renderCustomTab();
  return '';
}

function bindSubTabEvents(tab) {
  if (tab === 'matches') bindMatchesTabEvents();
  if (tab === 'transfers') bindTransfersTabEvents();
  if (tab === 'economy') bindEconomyTabEvents();
  if (tab === 'ballondor') bindBallonDorTabEvents();
  if (tab === 'custom') bindCustomTabEvents();
}

// ============================================================
// PARTIDOS
// ============================================================
function renderMatchesTab() {
  const db = getDB();
  const divisionId = state.divisionId || db.divisions[0]?.id;
  const division = db.divisions.find(d => d.id === divisionId);
  
  if (!division) return '<div class="card">Sin división activa.</div>';

  const matches = db.matches
    .filter(m => m.divisionId === division.id)
    .sort((a, b) => b.matchday - a.matchday);

  const byDay = {};
  matches.forEach(m => (byDay[m.matchday] ||= []).push(m));

  return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">PARTIDOS RECIENTES</div>
        <select class="select" id="nr-matchday-select" style="width:auto;">
          ${Object.keys(byDay).sort((a,b)=>b-a).map(day => `<option value="${day}">Jornada ${day}</option>`).join('')}
        </select>
      </div>
      <div id="nr-match-list">
        ${renderMatchList(byDay[Object.keys(byDay)[0]] || [])}
      </div>
    </div>
  `;
}

function renderMatchList(matches) {
  if (matches.length === 0) return '<div style="color:var(--muted);padding:20px;text-align:center;">No hay partidos en esta jornada.</div>';
  const db = getDB();
  
  return matches.map(m => {
    const A = db.teams.find(t => t.id === m.teamAId) || { name: '?' };
    const B = db.teams.find(t => t.id === m.teamBId) || { name: '?' };
    const status = m.status === 'finished' ? '<span class="badge badge-win">FINAL</span>' : m.status === 'live' ? '<span class="badge badge-live">EN JUEGO</span>' : '<span class="badge">PENDIENTE</span>';
    
    return `
      <div class="card" style="margin-bottom:10px; padding:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-weight:600; color:var(--silver-light);">${esc(A.name)} vs ${esc(B.name)}</div>
          ${status}
        </div>
        <div style="margin-top:10px; text-align:right;">
          <button class="btn btn-sm btn-primary" data-nr-match="${m.id}">Analizar con IA</button>
        </div>
      </div>
    `;
  }).join('');
}

function bindMatchesTabEvents() {
  const select = document.getElementById('nr-matchday-select');
  if (select) {
    select.addEventListener('change', (e) => {
      const db = getDB();
      const divisionId = state.divisionId || db.divisions[0]?.id;
      const matches = db.matches.filter(m => m.divisionId === divisionId && m.matchday == e.target.value);
      document.getElementById('nr-match-list').innerHTML = renderMatchList(matches);
      bindMatchButtons();
    });
  }
  bindMatchButtons();
}

function bindMatchButtons() {
  document.querySelectorAll('[data-nr-match]').forEach(btn => {
    btn.addEventListener('click', () => openMatchIA(btn.dataset.nrMatch));
  });
}

function openMatchIA(matchId) {
  const db = getDB();
  const m = db.matches.find(x => x.id === matchId);
  if (!m) return;
  const A = db.teams.find(t => t.id === m.teamAId) || { name: '?' };
  const B = db.teams.find(t => t.id === m.teamBId) || { name: '?' };
  
  let statusText = m.status === 'finished' ? 'FINALIZADO' : (m.status === 'live' ? 'EN VIVO' : 'PENDIENTE');
  let gameDetails = '';
  if (m.games && m.games.length > 0) {
    gameDetails = m.games.map(g => `Game: ${g.scoreA}-${g.scoreB}`).join(', ');
  }

  openModal({
    id: 'nr-match-ia-' + matchId,
    title: `PRENSA IA · ${esc(A.name)} vs ${esc(B.name)}`,
    wide: true,
    body: `
      <div id="nrMatchIAResult" style="display:none; margin-bottom:20px; padding:15px; background:var(--bg-graphite); border-radius:8px; border:1px solid var(--border);"></div>
      
      <div class="field">
        <label>Borrador de la noticia (Edita el texto aquí)</label>
        <textarea class="textarea" id="nrMatchDraft" rows="6" placeholder="Escribe la noticia aquí o pide consejo a la IA..."></textarea>
      </div>
      
      <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:15px;">
        <button class="btn" id="btnNrAskMatch">🤖 Pedir Consejo a la IA</button>
        <button class="btn btn-primary" id="btnNrNextMatch">Siguiente (Ir al Editor) →</button>
      </div>
    `,
    onMount: (root) => {
      const resDiv = root.querySelector('#nrMatchIAResult');
      const draftArea = root.querySelector('#nrMatchDraft');
      
      root.querySelector('#btnNrAskMatch').addEventListener('click', async () => {
        const btn = root.querySelector('#btnNrAskMatch');
        btn.disabled = true; btn.textContent = 'ANALIZANDO...';
        
        try {
          const context = {
            status: statusText,
            teamA: A.name,
            teamB: B.name,
            score: gameDetails,
            matchday: m.matchday,
            format: m.format
          };
          
          const result = await AIService.generateMatchNews(context);
          
          resDiv.style.display = 'block';
          resDiv.innerHTML = `
            <div style="font-size:11px; color:var(--accent); font-weight:600; margin-bottom:5px;">TÍTULO SUGERIDO:</div>
            <div style="font-size:14px; color:var(--silver-light); margin-bottom:10px;">${esc(result.advice.title)}</div>
            <div style="font-size:11px; color:var(--accent); font-weight:600; margin-bottom:5px;">PUNTOS CLAVE:</div>
            <ul style="font-size:12px; color:var(--silver); margin-left:15px; margin-bottom:10px;">
              ${result.advice.keyPoints.map(p => `<li>${esc(p)}</li>`).join('')}
            </ul>
            <div style="font-size:11px; color:var(--muted); font-style:italic;">${esc(result.advice.angle)}</div>
          `;
          
          if (!draftArea.value.trim()) {
            draftArea.value = `${result.advice.title}\n\n${result.generatedNews.text}`;
          }
        } catch (e) {
          toast('Error: ' + e.message, 'error');
        } finally {
          btn.disabled = false; btn.textContent = '🤖 Pedir Consejo a la IA';
        }
      });

      root.querySelector('#btnNrNextMatch').addEventListener('click', () => {
        const text = draftArea.value.trim();
        if (!text) return toast('Escribe algo en el borrador primero', 'error');
        
        closeTopModal();
        
        const prefillData = {
          title: text.split('\n')[0].substring(0, 60), // Tomar la primera línea como título
          date: new Date().toISOString().slice(0, 10),
          category: 'COMPETICIÓN',
          banner: db.transferBannerBg || '',
          blocks: [{ type: 'text', content: text }]
        };
        
        location.hash = '#/news';
        setTimeout(() => openAdvancedNewsEditor(null, prefillData), 100);
      });
    }
  });
}

// ============================================================
// FICHAJES
// ============================================================
function renderTransfersTab() {
  return `
    <div class="card">
      <div class="card-header"><div class="card-title">ÚLTIMOS FICHAJES</div></div>
      <p style="font-size:12px;color:var(--muted);margin-bottom:15px;">Analiza los movimientos más recientes del mercado.</p>
      <button class="btn btn-primary" id="btnNrAnalyzeTransfers">Analizar Fichajes Recientes</button>
      <div id="nrTransfersResult" style="margin-top:20px; display:none;"></div>
    </div>
  `;
}

function bindTransfersTabEvents() {
  const btn = document.getElementById('btnNrAnalyzeTransfers');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'ANALIZANDO...';
    try {
      const db = getDB();
      const recent = [...(db.transferLog || [])].sort((a,b) => b.date - a.date).slice(0, 5);
      if (recent.length === 0) throw new Error('No hay fichajes recientes');
      
      const result = await AIService.generateTransferNews(recent);
      
      document.getElementById('nrTransfersResult').style.display = 'block';
      document.getElementById('nrTransfersResult').innerHTML = `
        <div class="card" style="background:var(--bg-graphite);">
          <div style="font-weight:600; color:var(--accent); margin-bottom:5px;">${esc(result.advice.title)}</div>
          <p style="font-size:12px; color:var(--silver); margin-bottom:15px;">${esc(result.advice.angle)}</p>
          <button class="btn btn-sm btn-primary" id="btnNrNextTransfers">Siguiente (Ir al Editor) →</button>
        </div>
      `;
      
      document.getElementById('btnNrNextTransfers').addEventListener('click', () => {
        closeTopModal();
        const prefillData = {
          title: result.advice.title,
          date: new Date().toISOString().slice(0, 10),
          category: 'TRANSFERENCIAS',
          banner: db.transferBannerBg || '',
          blocks: [{ type: 'text', content: result.generatedNews.text }]
        };
        location.hash = '#/news';
        setTimeout(() => openAdvancedNewsEditor(null, prefillData), 100);
      });
      
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Analizar Fichajes Recientes';
    }
  });
}

// ============================================================
// ECONOMÍA
// ============================================================
function renderEconomyTabNewsroom() {
  return `
    <div class="card">
      <div class="card-header"><div class="card-title">AUDITORÍA ECONÓMICA</div></div>
      <p style="font-size:12px;color:var(--muted);margin-bottom:15px;">Analiza la hoja contable y los saldos de los equipos en busca de anomalías.</p>
      <button class="btn btn-primary" id="btnNrAnalyzeEco">Auditar Economía</button>
      <div id="nrEcoResult" style="margin-top:20px; display:none;"></div>
    </div>
  `;
}

function bindEconomyTabEvents() {
  const btn = document.getElementById('btnNrAnalyzeEco');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'ANALIZANDO...';
    try {
      const db = getDB();
      const summary = db.teams.map(t => ({ name: t.name, money: t.money }));
      const result = await AIService.analyzeEconomy(summary);
      
      document.getElementById('nrEcoResult').style.display = 'block';
      document.getElementById('nrEcoResult').innerHTML = `
        <div class="card" style="background:var(--bg-graphite);">
          <div style="font-weight:600; color:var(--accent); margin-bottom:5px;">${esc(result.advice.title)}</div>
          <p style="font-size:12px; color:var(--silver); margin-bottom:15px;">${esc(result.advice.angle)}</p>
          <button class="btn btn-sm btn-primary" id="btnNrNextEco">Siguiente (Ir al Editor) →</button>
        </div>
      `;
      
      document.getElementById('btnNrNextEco').addEventListener('click', () => {
        closeTopModal();
        const prefillData = {
          title: result.advice.title,
          date: new Date().toISOString().slice(0, 10),
          category: 'GENERAL',
          banner: db.transferBannerBg || '',
          blocks: [{ type: 'text', content: result.generatedNews.text }]
        };
        location.hash = '#/news';
        setTimeout(() => openAdvancedNewsEditor(null, prefillData), 100);
      });
      
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Auditar Economía';
    }
  });
}

// ============================================================
// BALÓN DE ORO
// ============================================================
function renderBallonDorTab() {
  return `
    <div class="card">
      <div class="card-header"><div class="card-title">BALÓN DE ORO</div></div>
      <div class="row">
        <div class="field">
          <label>Jugadores a analizar (Top)</label>
          <input class="input" type="number" id="nrBdorCount" value="5" min="1" max="20">
        </div>
        <div class="field" style="display:flex; align-items:flex-end;">
          <button class="btn btn-primary" id="btnNrAnalyzeBdor" style="width:100%;">Generar Reportaje</button>
        </div>
      </div>
      <div id="nrBdorResult" style="margin-top:20px; display:none;"></div>
    </div>
  `;
}

function bindBallonDorTabEvents() {
  const btn = document.getElementById('btnNrAnalyzeBdor');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const count = parseInt(document.getElementById('nrBdorCount').value) || 5;
    btn.disabled = true; btn.textContent = 'ANALIZANDO...';
    try {
      const db = getDB();
      const divisionId = state.divisionId || db.divisions[0]?.id;
      const allStats = aggregatePlayerStats({ divisionId });
      const topPlayers = ballonDor(allStats.filter(p => p.games > 0), divisionId).slice(0, count);
      
      const context = topPlayers.map(p => {
        const player = db.players.find(x => x.id === p.id);
        return {
          name: p.name,
          pig: p.pig,
          goals: p.goals,
          assists: p.assists,
          trophies: player.trophies || []
        };
      });

      const result = await AIService.generateBallonDorReport(context);
      
      document.getElementById('nrBdorResult').style.display = 'block';
      document.getElementById('nrBdorResult').innerHTML = `
        <div class="card" style="background:var(--bg-graphite);">
          <div style="font-weight:600; color:var(--gold); margin-bottom:5px;">${esc(result.advice.title)}</div>
          <p style="font-size:12px; color:var(--silver); margin-bottom:15px;">${esc(result.advice.angle)}</p>
          <button class="btn btn-sm btn-primary" id="btnNrNextBdor">Siguiente (Ir al Editor) →</button>
        </div>
      `;
      
      document.getElementById('btnNrNextBdor').addEventListener('click', () => {
        closeTopModal();
        const prefillData = {
          title: result.advice.title,
          date: new Date().toISOString().slice(0, 10),
          category: 'STATS',
          banner: db.transferBannerBg || '',
          blocks: [{ type: 'text', content: result.generatedNews.text }]
        };
        location.hash = '#/news';
        setTimeout(() => openAdvancedNewsEditor(null, prefillData), 100);
      });
      
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Generar Reportaje';
    }
  });
}

// ============================================================
// CUSTOM
// ============================================================
function renderCustomTab() {
  return `
    <div class="card">
      <div class="card-header"><div class="card-title">NOTICIA CUSTOM</div></div>
      <div class="field">
        <label>¿Sobre qué quieres escribir?</label>
        <textarea class="textarea" id="nrCustomTopic" rows="3" placeholder="Ej: El ascenso sorpresa del equipo X, la sanción a Y, los rumores de fichajes..."></textarea>
      </div>
      <button class="btn btn-primary" id="btnNrAnalyzeCustom">Generar Noticia</button>
      <div id="nrCustomResult" style="margin-top:20px; display:none;"></div>
    </div>
  `;
}

function bindCustomTabEvents() {
  const btn = document.getElementById('btnNrAnalyzeCustom');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const topic = document.getElementById('nrCustomTopic').value.trim();
    if (!topic) return toast('Escribe un tema primero', 'error');
    
    btn.disabled = true; btn.textContent = 'ANALIZANDO...';
    try {
      const db = getDB();
      const divisionId = state.divisionId || db.divisions[0]?.id;
      const standings = computeStandings(divisionId, db.seasons.find(s=>s.active)?.id);
      const globalContext = {
        leagueName: db.config.theme?.active?.brandName || 'ZENITH',
        topTeams: standings.slice(0, 3).map(t => t.name)
      };

      const result = await AIService.generateCustomNews(topic, globalContext);
      
      document.getElementById('nrCustomResult').style.display = 'block';
      document.getElementById('nrCustomResult').innerHTML = `
        <div class="card" style="background:var(--bg-graphite);">
          <div style="font-weight:600; color:var(--accent); margin-bottom:5px;">${esc(result.advice.title)}</div>
          <p style="font-size:12px; color:var(--silver); margin-bottom:15px;">${esc(result.advice.angle)}</p>
          <button class="btn btn-sm btn-primary" id="btnNrNextCustom">Siguiente (Ir al Editor) →</button>
        </div>
      `;
      
      document.getElementById('btnNrNextCustom').addEventListener('click', () => {
        closeTopModal();
        const prefillData = {
          title: result.advice.title,
          date: new Date().toISOString().slice(0, 10),
          category: result.generatedNews.category || 'GENERAL',
          banner: db.transferBannerBg || '',
          blocks: [{ type: 'text', content: result.generatedNews.text }]
        };
        location.hash = '#/news';
        setTimeout(() => openAdvancedNewsEditor(null, prefillData), 100);
      });
      
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Generar Noticia';
    }
  });
}

function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}
