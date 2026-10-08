import { getDB, mutate } from '../services/storage.js';
import { uid } from '../data/database.js';
import { state } from '../state.js';
import { openModal, toast, closeTopModal } from '../services/ui.js';
import { AIService } from '../services/aiService.js';
import { logChange } from '../services/history.js';
import { swapTeamsInMatchday } from '../services/schedule.js';
import { openMatchSummary } from './matchSummary.js';

export function matchesView(){
  const db = getDB();
  const division = db.divisions.find(d => d.id === state.divisionId) || db.divisions[0];
  if(!division) return `<div class="card">Sin división activa.</div>`;
  const matches = db.matches
    .filter(m => m.divisionId === division.id)
    .sort((a, b) => a.matchday - b.matchday);

  const byDay = {};
  matches.forEach(m => (byDay[m.matchday] ||= []).push(m));

  return `
    <div class="page-head">
      <h1 class="page-title">JORNADAS</h1>
      <div style="display:flex;gap:8px">
        <button class="btn" id="btnGenSchedule">REGENERAR</button>
        <button class="btn btn-primary" id="btnGenAdvanced">✨ GENERACIÓN AVANZADA</button>
      </div>
    </div>
    ${Object.keys(byDay).length === 0 ? '<div class="card">No hay jornadas generadas. Pulsa GENERACIÓN AVANZADA.</div>' : ''}
    ${Object.entries(byDay).map(([day, list]) => `
      <div class="card" style="margin-bottom:16px" data-matchday="${day}">
        <div class="card-header">
          <div class="card-title"><span class="dot">◆</span>JORNADA ${day}</div>
          <span class="card-sub">${list.length} partidos · arrastra equipos para reorganizar</span>
        </div>
        ${list.map(m => matchRow(m)).join('')}
      </div>
    `).join('')}
  `;
}

function matchRow(m){
  const db = getDB();
  const A = db.teams.find(t => t.id === m.teamAId) || null;
  const B = db.teams.find(t => t.id === m.teamBId) || null;
  const sA = m.games.filter(g => g.scoreA > g.scoreB).length;
  const sB = m.games.filter(g => g.scoreB > g.scoreA).length;
  const status = m.status === 'finished'
    ? `<span class="badge badge-win">FINAL</span>`
    : m.status === 'live' ? `<span class="badge badge-live">EN JUEGO</span>`
    : `<span class="badge">PENDIENTE</span>`;
  const dateLine = (m.date || m.time)
    ? `<div class="match-meta-line">
         ${m.date ? `<i class="fa-solid fa-calendar"></i> ${m.date}` : ''}
         ${m.time ? `<i class="fa-solid fa-clock"></i> ${m.time}` : ''}
         <span class="chip chip-accent" style="margin-left:6px">${m.format || 'BO3'}</span>
       </div>`
    : `<div class="match-meta-line"><span class="chip">${m.format||'BO3'}</span> <span style="color:var(--muted);font-size:11px">sin fecha asignada</span></div>`;

  const locked = m.status === 'finished';
  const draggable = !locked;
  const summaryAttr = locked ? `data-match-summary="${m.id}"` : '';

  const renderSide = (team, side) => {
    if(!team){
      return `<div class="match-team match-team-${side === 'A' ? 'home' : 'away'}" data-slot="${side}" data-match-id="${m.id}" data-empty="true">
        <span style="color:var(--muted);font-size:11px">— vacío —</span>
      </div>`;
    }
    const logo = team.logo
      ? `<img src="${team.logo}" class="match-team-logo" alt="">`
      : `<div class="match-team-logo match-team-logo-empty">◆</div>`;
    const content = side === 'A'
      ? `${logo}<span class="match-team-name">${esc(team.name)}</span>`
      : `<span class="match-team-name">${esc(team.name)}</span>${logo}`;
    return `<div class="match-team match-team-${side === 'A' ? 'home' : 'away'}"
                 data-slot="${side}" data-match-id="${m.id}"
                 ${draggable ? 'draggable="true"' : ''}>${content}</div>`;
  };

  return `
    <div class="match-row" data-match-id="${m.id}" ${summaryAttr} style="${locked ? 'cursor:pointer' : ''}">
      <div class="match-row-top">
        ${renderSide(A, 'A')}
        <div class="match-score">
          <span class="match-score-value">${sA}</span>
          <span class="match-score-sep">–</span>
          <span class="match-score-value">${sB}</span>
        </div>
        ${renderSide(B, 'B')}
      </div>
      <div class="match-row-bottom">
        ${dateLine}
        <div class="match-actions">
          ${status}
          <button class="btn btn-sm" data-edit-match="${m.id}" title="Editar fecha/hora/formato">⚙</button>
          <button class="btn btn-sm" data-open-match="${m.id}">REPORTAR</button>
        </div>
      </div>
    </div>
  `;
}

export function bindMatchesEvents(){
  document.getElementById('btnGenSchedule')?.addEventListener('click', () => {
    if(!confirm('¿Regenerar calendario? Se perderán los partidos no bloqueados.')) return;
    try {
      import('../services/schedule.js').then(({ resetSchedule, generateSchedule }) => {
        const id = state.divisionId || getDB().divisions[0].id;
        resetSchedule(id);
        generateSchedule(id);
        logChange('regenerate', 'schedule', null, 'Calendario regenerado');
        toast('Calendario regenerado','success');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    } catch(e){ toast(e.message, 'error'); }
  });

  document.getElementById('btnGenAdvanced')?.addEventListener('click', () => {
    openAdvancedScheduleModal();
  });

  document.querySelectorAll('[data-open-match]').forEach(b =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openMatchReporter(b.dataset.openMatch);
    }));
  document.querySelectorAll('[data-edit-match]').forEach(b =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openMatchEditor(b.dataset.editMatch);
    }));

  // Click en partido reportado → summary
  document.querySelectorAll('[data-match-summary]').forEach(row => {
    row.addEventListener('click', (e) => {
      if(e.target.closest('button')) return;
      const m = getDB().matches.find(x => x.id === row.dataset.matchSummary);
      if(!m) return;
      openMatchSummary(m, { title: `JORNADA ${m.matchday} · RESUMEN` });
    });
  });

  initMatchdayDragDrop();
}

function initMatchdayDragDrop(){
  let dragSrc = null;

  document.querySelectorAll('.match-team[draggable="true"]').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      dragSrc = { matchId: el.dataset.matchId, slot: el.dataset.slot };
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      dragSrc = null;
      document.querySelectorAll('.match-team.drop-hover').forEach(x => x.classList.remove('drop-hover'));
    });
  });

  document.querySelectorAll('.match-team').forEach(el => {
    el.addEventListener('dragover', (e) => {
      if(!dragSrc) return;
      const m = getDB().matches.find(x => x.id === el.dataset.matchId);
      const srcM = getDB().matches.find(x => x.id === dragSrc.matchId);
      if(!m || !srcM) return;
      if(m.matchday !== srcM.matchday) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drop-hover');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-hover'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-hover');
      if(!dragSrc) return;

      const targetMatchId = el.dataset.matchId;
      const targetSlot = el.dataset.slot;
      if(dragSrc.matchId === targetMatchId && dragSrc.slot === targetSlot) return;

      try {
        swapTeamsInMatchday(
          state.divisionId || getDB().divisions[0].id,
          dragSrc.matchId, dragSrc.slot,
          targetMatchId, targetSlot
        );
        toast('Equipos reorganizados','success');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch(err){
        toast(err.message, 'error');
      }
      dragSrc = null;
    });
  });
}

function openAdvancedScheduleModal(){
  const db = getDB();
  const division = db.divisions.find(d => d.id === state.divisionId) || db.divisions[0];
  const teams = db.teams.filter(t => t.divisionId === division.id);
  if(teams.length < 2) return toast('Necesitas al menos 2 equipos', 'error');

  const pairs = [];
  for(let i = 0; i < teams.length; i++){
    for(let j = i + 1; j < teams.length; j++){
      pairs.push({ a: teams[i], b: teams[j] });
    }
  }

  const pairLabel = p => `${esc(p.a.name)} vs ${esc(p.b.name)}`;

  openModal({
    id: 'advanced-schedule',
    title: '✨ GENERACIÓN AVANZADA',
    wide: true,
    body: `
      <p class="field-hint" style="margin-bottom:16px">
        Personaliza cómo se generan las jornadas. Si no eliges nada, se hace un sorteo aleatorio normal.
      </p>

      <div class="field">
        <label>Partido inaugural (Jornada 1)</label>
        <select class="select" id="advOpening">
          <option value="">— Aleatorio —</option>
          ${pairs.map(p => `<option value="${p.a.id}::${p.b.id}">${pairLabel(p)}</option>`).join('')}
        </select>
      </div>

      <div class="field">
        <label>Partido final (Última jornada)</label>
        <select class="select" id="advFinal">
          <option value="">— Aleatorio —</option>
          ${pairs.map(p => `<option value="${p.a.id}::${p.b.id}">${pairLabel(p)}</option>`).join('')}
        </select>
      </div>

      <div class="divider"></div>

      <label style="display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--silver-light);cursor:pointer">
        <input type="checkbox" id="advShuffle" checked> Aleatorizar orden de los partidos restantes
      </label>
    `,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="advGenerate">✨ GENERAR</button>
    `,
    onMount: root => {
      root.querySelector('#advGenerate').addEventListener('click', () => {
        try {
          const openingVal = root.querySelector('#advOpening').value;
          const finalVal = root.querySelector('#advFinal').value;
          const openingMatch = openingVal ? parsePairVal(openingVal) : null;
          const finalMatch = finalVal ? parsePairVal(finalVal) : null;

          if(openingMatch && finalMatch){
            const used = new Set([openingMatch.teamAId, openingMatch.teamBId, finalMatch.teamAId, finalMatch.teamBId]);
            if(used.size < 4) return toast('El partido inaugural y final no pueden compartir equipos', 'error');
          }

          import('../services/schedule.js').then(({ resetSchedule, generateSchedule }) => {
            const id = state.divisionId || getDB().divisions[0].id;
            resetSchedule(id);
            generateSchedule(id, { openingMatch, finalMatch });
            logChange('generate-advanced', 'schedule', null, 'Calendario generado (avanzado)');
            toast('Calendario generado','success');
            closeTopModal();
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          });
        } catch(e){
          console.error(e);
          toast('Error: ' + e.message, 'error');
        }
      });
    }
  });
}

function parsePairVal(val){
  const [teamAId, teamBId] = val.split('::');
  return { teamAId, teamBId };
}

function openMatchEditor(matchId){
  const db = getDB();
  const m = db.matches.find(x => x.id === matchId);
  if(!m) return;
  const A = db.teams.find(t => t.id === m.teamAId);
  const B = db.teams.find(t => t.id === m.teamBId);

  openModal({
    id: 'match-editor-' + matchId,
    title: `EDITAR · ${A?.name || '?'} vs ${B?.name || '?'}`,
    body: `
      <div class="row">
        <div class="field"><label>Fecha</label><input class="input" type="date" id="edDate" value="${m.date||''}"></div>
        <div class="field"><label>Hora</label><input class="input" type="time" id="edTime" value="${m.time||''}"></div>
      </div>
      <div class="field">
        <label>Formato de la serie</label>
        <select class="select" id="edFormat">
          ${['BO3','BO5','BO7'].map(f => `<option ${(m.format||'BO3')===f?'selected':''}>${f}</option>`).join('')}
        </select>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="saveMatchMeta">GUARDAR</button>
    `,
    onMount: (root) => {
      root.querySelector('#saveMatchMeta').addEventListener('click', () => {
        const date = root.querySelector('#edDate').value;
        const time = root.querySelector('#edTime').value;
        const format = root.querySelector('#edFormat').value;
        mutate(d => {
          const t = d.matches.find(x => x.id === m.id);
          t.date = date; t.time = time; t.format = format;
        });
        logChange('edit', 'match', m.id, `Fecha/hora/formato actualizado (${format})`);
        toast('Cambios guardados','success');
        closeTopModal();
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    }
  });
}

function openMatchReporter(matchId){
  const db = getDB();
  const m = db.matches.find(x => x.id === matchId);
  const A = db.teams.find(t => t.id === m.teamAId);
  const B = db.teams.find(t => t.id === m.teamBId);

  openModal({
    id: 'match-reporter-' + matchId,
    title: `REPORTAR · ${A.name} vs ${B.name}`,
    wide: true,
    body: `
      <div class="field">
        <label>Formato de la serie (se aplicará a este partido)</label>
        <select class="select" id="reportFormat">
          ${['BO3','BO5','BO7'].map(f => `<option ${(m.format||'BO3')===f?'selected':''}>${f}</option>`).join('')}
        </select>
      </div>
      <div class="tabs" id="reporterTabs">
        <button class="tab active" data-tab="manual">MANUAL</button>
        <button class="tab" data-tab="ai">ANALIZAR CAPTURA CON IA</button>
      </div>
      <div id="tab-manual"></div>
      <div id="tab-ai" style="display:none"></div>
    `,
    footer: `<button class="btn btn-ghost" data-close>CERRAR</button>`,
    onMount: (root) => {
      const fmtSel = root.querySelector('#reportFormat');
      if(fmtSel){
        fmtSel.addEventListener('change', () => {
          mutate(d => { const t = d.matches.find(x => x.id === m.id); t.format = fmtSel.value; });
          toast('Formato actualizado');
        });
      }
      const tabs = root.querySelector('#reporterTabs');
      tabs.addEventListener('click', e => {
        const t = e.target.closest('[data-tab]'); if(!t) return;
        tabs.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
        root.querySelector('#tab-manual').style.display = t.dataset.tab === 'manual' ? '' : 'none';
        root.querySelector('#tab-ai').style.display     = t.dataset.tab === 'ai' ? '' : 'none';
      });
      renderManual(root.querySelector('#tab-manual'), m, A, B);
      renderAI(root.querySelector('#tab-ai'), m, A, B);
    }
  });
}

function renderManual(container, m, A, B){
  const db = getDB();
  const format = m.format || 'BO3';
  const wonA = m.games.filter(g => g.scoreA > g.scoreB).length;
  const wonB = m.games.filter(g => g.scoreB > g.scoreA).length;
  const finished = m.status === 'finished';

  const activeRoster = (team) => team.roster.map(r => ({
    playerId: r.playerId,
    name: db.players.find(p => p.id === r.playerId)?.name || '?'
  }));

  container.innerHTML = `
    <div class="reporter-header">
      <div class="reporter-serie">
        SERIE · ${A.name} <span style="color:var(--accent)">${wonA}</span> – <span style="color:var(--accent)">${wonB}</span> ${B.name}
      </div>
      <span class="chip chip-accent">${format}</span>
    </div>
    ${finished ? `<div class="card" style="text-align:center;color:var(--success)">SERIE FINALIZADA</div>` : ''}
    <div id="gameList">
      ${m.games.map((g, i) => gameCardHTML(g, i + 1, A, B)).join('')}
    </div>
    ${!finished ? `
      <div class="divider"></div>
      <div class="reporter-subhead">PARTIDA ${m.games.length + 1}</div>
      <div id="newGame"></div>
    ` : ''}
  `;

  if(!finished) renderNewGame(container.querySelector('#newGame'), m, A, B, activeRoster);
}

function gameCardHTML(g, num, A, B){
  const db = getDB();
  const rows = (team) => g.players
    .filter(p => p.teamId === team.id)
    .map(p => {
      const name = db.players.find(x => x.id === p.playerId)?.name || '?';
      return `<tr>
        <td>${name}</td>
        <td class="num">${p.goals}</td>
        <td class="num">${p.assists}</td>
        <td class="num">${p.saves}</td>
        <td class="num">${p.shots}</td>
      </tr>`;
    }).join('');
  const winner = g.winnerTeamId === A.id ? A.name : B.name;
  return `
    <div class="card" style="margin-bottom:10px">
      <div class="card-header">
        <div class="card-title"><span class="dot">◆</span>PARTIDA ${num}</div>
        <span class="card-sub">${A.name} ${g.scoreA} – ${g.scoreB} ${B.name}</span>
      </div>
      <div class="grid grid-2">
        <div>
          <div class="reporter-subhead">${A.name}</div>
          <table class="ztable">
            <thead><tr><th>JUGADOR</th><th class="num">G</th><th class="num">A</th><th class="num">S</th><th class="num">T</th></tr></thead>
            <tbody>${rows(A)}</tbody>
          </table>
        </div>
        <div>
          <div class="reporter-subhead">${B.name}</div>
          <table class="ztable">
            <thead><tr><th>JUGADOR</th><th class="num">G</th><th class="num">A</th><th class="num">S</th><th class="num">T</th></tr></thead>
            <tbody>${rows(B)}</tbody>
          </table>
        </div>
      </div>
      <div class="reporter-winner">Ganador: ${winner}</div>
    </div>
  `;
}

function renderNewGame(container, m, A, B, activeRoster){
  const rowsA = activeRoster(A);
  const rowsB = activeRoster(B);
  container.innerHTML = `
    <div class="grid grid-2" style="margin-bottom:12px">
      <div>
        <div class="reporter-subhead">${A.name}</div>
        <div id="playersA">${rowsA.map((p, i) => playerStatRow(p, 'A', i)).join('')}</div>
      </div>
      <div>
        <div class="reporter-subhead">${B.name}</div>
        <div id="playersB">${rowsB.map((p, i) => playerStatRow(p, 'B', i)).join('')}</div>
      </div>
    </div>
    <div class="row">
      <div class="field"><label>Marcador ${A.name}</label><input class="input" type="number" min="0" id="scoreA" value="0"></div>
      <div class="field"><label>Marcador ${B.name}</label><input class="input" type="number" min="0" id="scoreB" value="0"></div>
    </div>
    <button class="btn btn-primary" id="reportGame">REPORTAR PARTIDA</button>
  `;

  container.querySelector('#reportGame').addEventListener('click', () => {
    const scoreA = +container.querySelector('#scoreA').value;
    const scoreB = +container.querySelector('#scoreB').value;
    if(scoreA === scoreB) return toast('No puede haber empate en Rocket League', 'error');

    const collect = (side, team) =>
      [...container.querySelector(`#players${side}`).children].map(row => ({
        playerId: row.dataset.playerId,
        teamId: team.id,
        goals:   +row.querySelector('[data-g]').value || 0,
        assists: +row.querySelector('[data-a]').value || 0,
        saves:   +row.querySelector('[data-s]').value || 0,
        shots:   +row.querySelector('[data-t]').value || 0
      }));

    const game = {
      id: uid('game'),
      scoreA, scoreB,
      winnerTeamId: scoreA > scoreB ? A.id : B.id,
      players: [...collect('A', A), ...collect('B', B)]
    };

    mutate(d => {
      const target = d.matches.find(x => x.id === m.id);
      target.games.push(game);
      const wonA = target.games.filter(g => g.scoreA > g.scoreB).length;
      const wonB = target.games.filter(g => g.scoreB > g.scoreA).length;
      const need = target.format === 'BO3' ? 2 : target.format === 'BO5' ? 3 : 4;
      target.status = (wonA === need || wonB === need) ? 'finished' : 'live';
    });

    logChange('report', 'match', m.id, `Partida ${scoreA}-${scoreB} (${A.name} vs ${B.name})`);
    toast('Partida reportada','success');
    closeTopModal();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

function playerStatRow(p, side, idx){
  return `<div class="card" style="padding:8px;margin-bottom:6px" data-player-id="${p.playerId}">
    <div class="reporter-player-name">${p.name}</div>
    <div class="stat-input-grid">
      <input class="input" type="number" min="0" data-g placeholder="G" value="0">
      <input class="input" type="number" min="0" data-a placeholder="A" value="0">
      <input class="input" type="number" min="0" data-s placeholder="S" value="0">
      <input class="input" type="number" min="0" data-t placeholder="T" value="0">
    </div>
  </div>`;
}

function renderAI(container, m, A, B){
  const db = getDB();
  const rosterOf = team => (team.roster || []).map(r => {
    const p = db.players.find(x => x.id === r.playerId);
    return p ? { id: p.id, name: p.name } : null;
  }).filter(Boolean);

  const candidateTeams = [
    { id: A.id, name: A.name, roster: rosterOf(A) },
    { id: B.id, name: B.name, roster: rosterOf(B) }
  ];

  const iaState = {
    raw: null, matched: null,
    teamOverrides: {}, playerOverrides: {},
    teamIgnored: {}, playerIgnored: {},
    scoreA: 0, scoreB: 0
  };

  container.innerHTML = `
    <div class="field">
      <label>Captura del scoreboard</label>
      <div class="dropzone" id="iaDrop">Arrastra la captura o haz click</div>
      <input type="file" id="iaFile" accept="image/*" hidden>
    </div>
    <div id="iaResult"></div>
  `;

  const drop = container.querySelector('#iaDrop');
  const file = container.querySelector('#iaFile');
  const out = container.querySelector('#iaResult');

  drop.addEventListener('click', () => file.click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dragover'); run(e.dataTransfer.files[0]); });
  file.addEventListener('change', () => run(file.files[0]));

  async function run(f){
    if(!f) return;
    out.innerHTML = `<div class="card">Analizando captura…</div>`;
    try {
      const data = await AIService.analyzeMatchScreenshot(f);
      const matched = AIService.matchWithRoster(data, A, B);
      iaState.raw = data;
      iaState.matched = matched;
      iaState.teamOverrides = {};
      iaState.playerOverrides = {};
      iaState.teamIgnored = {};
      iaState.playerIgnored = {};
      iaState.scoreA = 0; iaState.scoreB = 0;
      matched.detectedTeams.forEach(t => {
        if(!t.assignedTeamId) return;
        if(t.assignedTeamId === A.id) iaState.scoreA = t.detectedScore;
        if(t.assignedTeamId === B.id) iaState.scoreB = t.detectedScore;
      });
      renderResult();
    } catch(e){
      console.error('[ZENITH] IA error:', e);
      out.innerHTML = `<div class="card" style="color:var(--danger)">Error: ${e.message}</div>`;
    }
  }

  function renderResult(){
    const md = iaState.matched;
    const thresholds = md.thresholds;
    out.innerHTML = `
      <div class="divider"></div>
      <div class="reporter-subhead">EQUIPOS Y JUGADORES DETECTADOS</div>
      ${md.warnings.length > 0 ? `<div class="ia-warnings">${md.warnings.map(w => `<div class="ia-warning-item">${escapeHtml(w)}</div>`).join('')}</div>` : ''}
      <div class="ia-thresholds-note">
        Umbrales: ≥ ${(thresholds.high*100).toFixed(0)}% auto · ≥ ${(thresholds.low*100).toFixed(0)}% aviso · &lt; ${(thresholds.low*100).toFixed(0)}% manual
      </div>
      <div class="ia-team-blocks" id="iaTeamBlocks"></div>
      <div class="ia-score-row">
        <div class="field"><label>Marcador ${escapeHtml(A.name)}</label><input class="input" type="number" min="0" id="iaScoreA" value="${iaState.scoreA}"></div>
        <div class="field"><label>Marcador ${escapeHtml(B.name)}</label><input class="input" type="number" min="0" id="iaScoreB" value="${iaState.scoreB}"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn" id="reanalyze">REANALIZAR CAPTURA</button>
        <button class="btn btn-primary" id="confirmIA">CONFIRMAR REPORTE</button>
      </div>
    `;
    const blocksEl = out.querySelector('#iaTeamBlocks');
    blocksEl.innerHTML = md.detectedTeams.map((t, tIdx) => renderTeamBlock(t, tIdx)).join('');
    bindTeamBlockEvents(blocksEl);
    bindActions();
    updateConfirmButton();
  }

  function renderTeamBlock(t, tIdx){
    const ignored = iaState.teamIgnored[tIdx];
    const overrideTeamId = iaState.teamOverrides[tIdx];
    const effectiveTeamId = overrideTeamId || t.assignedTeamId;
    const effectiveTeam = candidateTeams.find(c => c.id === effectiveTeamId);
    const teamScore = overrideTeamId ? 1 : t.matchScore;
    const teamLevel = overrideTeamId ? 'manual' : t.matchLevel;
    let teamRowClass = `ia-team-block ia-team-${teamLevel}`;
    if(ignored) teamRowClass += ' ia-team-ignored';
    let teamBadge = '';
    if(ignored) teamBadge = `<span class="ia-match-badge ia-badge-ignored">🚫 Equipo ignorado</span>`;
    else if(effectiveTeam) teamBadge = `<span class="ia-match-badge ${badgeClassFor(teamLevel)}">${badgeLabelFor(teamLevel, teamScore)}</span>`;
    else teamBadge = `<span class="ia-match-badge ia-badge-low">❌ Equipo sin asignar</span>`;
    const showTeamApproval = !ignored && (!effectiveTeam || overrideTeamId);
    return `
      <div class="${teamRowClass}" data-team-idx="${tIdx}">
        <div class="ia-team-header">
          <div class="ia-team-title">
            <span class="ia-team-name">${escapeHtml(t.detectedName || '?')}</span>
            <span class="ia-team-score">${t.detectedScore ?? 0}</span>
            ${teamBadge}
            ${effectiveTeam ? `<span class="ia-team-assigned">→ ${escapeHtml(effectiveTeam.name)}</span>` : ''}
          </div>
          <div class="ia-team-actions"><button type="button" class="btn btn-sm" data-team-ignore="${tIdx}">🚫 Ignorar equipo</button></div>
        </div>
        ${showTeamApproval ? `<div class="ia-team-approval"><span class="ia-approval-label">Asignar equipo a:</span><select class="select ia-team-select" data-team-select="${tIdx}"><option value="">— Seleccionar equipo —</option>${candidateTeams.map(c => `<option value="${c.id}" ${effectiveTeamId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>` : ''}
        ${ignored ? `<div class="ia-team-approval"><button type="button" class="btn btn-sm" data-team-unignore="${tIdx}">↩ Restaurar equipo</button></div>` : `<div class="ia-team-players">${t.players.map((p, pIdx) => renderPlayerRow(p, tIdx, pIdx, effectiveTeam)).join('')}</div>`}
      </div>
    `;
  }

  function renderPlayerRow(p, tIdx, pIdx, effectiveTeam){
    const key = `${tIdx}:${pIdx}`;
    const ignored = iaState.playerIgnored[key];
    const overridePid = iaState.playerOverrides[key];
    let effectivePid = overridePid || p.matchedPlayerId;
    let effectiveName = '—';
    if(overridePid && effectiveTeam) effectiveName = effectiveTeam.roster.find(x => x.id === overridePid)?.name || '—';
    else if(p.matchedName) effectiveName = p.matchedName;
    const effScore = overridePid ? 1 : p.matchScore;
    const effLevel = overridePid ? 'manual' : p.matchLevel;
    let rowClass = `ia-row ia-row-${effLevel}`;
    if(ignored) rowClass += ' ia-row-ignored';
    let badge = '';
    if(ignored) badge = `<span class="ia-match-badge ia-badge-ignored">🚫 Ignorado</span>`;
    else if(effLevel === 'manual') badge = `<span class="ia-match-badge ia-badge-manual">✋ Manual</span>`;
    else if(effLevel === 'high') badge = `<span class="ia-match-badge ia-badge-high">✅ (${(effScore*100).toFixed(0)}%)</span>`;
    else if(effLevel === 'medium') badge = `<span class="ia-match-badge ia-badge-medium">⚠️ (${(effScore*100).toFixed(0)}%)</span>`;
    else badge = `<span class="ia-match-badge ia-badge-low">❌ Sin coincidencia</span>`;
    const canPick = !ignored && effectiveTeam;
    const showApproval = canPick && (p.needsApproval || overridePid || !p.matchedPlayerId);
    return `
      <div class="${rowClass}" data-player-key="${key}">
        <div class="ia-row-main">
          <div class="ia-row-info">
            <div class="ia-row-name">${escapeHtml(p.name)}</div>
            ${badge}
            ${effectiveName !== '—' ? `<div class="ia-match-detail">→ ${escapeHtml(effectiveName)}</div>` : ''}
          </div>
          <div class="ia-row-stats">
            <input class="input" type="number" min="0" value="${p.goals||0}"   data-ia-key="${key}" data-field="goals"   placeholder="G">
            <input class="input" type="number" min="0" value="${p.assists||0}" data-ia-key="${key}" data-field="assists" placeholder="A">
            <input class="input" type="number" min="0" value="${p.saves||0}"   data-ia-key="${key}" data-field="saves"   placeholder="S">
            <input class="input" type="number" min="0" value="${p.shots||0}"   data-ia-key="${key}" data-field="shots"   placeholder="T">
          </div>
        </div>
        ${showApproval ? `<div class="ia-row-approval"><span class="ia-approval-label">Asignar a:</span><select class="select ia-roster-select" data-player-select="${key}"><option value="">— Seleccionar jugador —</option>${effectiveTeam.roster.map(pl => `<option value="${pl.id}" ${(overridePid || p.matchedPlayerId) === pl.id ? 'selected' : ''}>${escapeHtml(pl.name)}</option>`).join('')}</select><button type="button" class="btn btn-sm" data-player-ignore="${key}">🚫 Ignorar</button></div>` : ''}
        ${ignored ? `<div class="ia-row-approval"><button type="button" class="btn btn-sm" data-player-unignore="${key}">↩ Restaurar</button></div>` : ''}
      </div>
    `;
  }

  function bindTeamBlockEvents(blocksEl){
    blocksEl.querySelectorAll('[data-team-select]').forEach(sel => sel.addEventListener('change', () => {
      const tIdx = +sel.dataset.teamSelect;
      if(sel.value){
        iaState.teamOverrides[tIdx] = sel.value;
        iaState.matched.detectedTeams[tIdx].players.forEach((_, pIdx) => {
          delete iaState.playerOverrides[`${tIdx}:${pIdx}`];
        });
      } else delete iaState.teamOverrides[tIdx];
      renderResult();
    }));
    blocksEl.querySelectorAll('[data-team-ignore]').forEach(btn => btn.addEventListener('click', () => { iaState.teamIgnored[+btn.dataset.teamIgnore] = true; renderResult(); }));
    blocksEl.querySelectorAll('[data-team-unignore]').forEach(btn => btn.addEventListener('click', () => { delete iaState.teamIgnored[+btn.dataset.teamUnignore]; renderResult(); }));
    blocksEl.querySelectorAll('[data-player-select]').forEach(sel => sel.addEventListener('change', () => {
      const key = sel.dataset.playerSelect;
      if(sel.value) iaState.playerOverrides[key] = sel.value;
      else delete iaState.playerOverrides[key];
      renderResult();
    }));
    blocksEl.querySelectorAll('[data-player-ignore]').forEach(btn => btn.addEventListener('click', () => { iaState.playerIgnored[btn.dataset.playerIgnore] = true; renderResult(); }));
    blocksEl.querySelectorAll('[data-player-unignore]').forEach(btn => btn.addEventListener('click', () => { delete iaState.playerIgnored[btn.dataset.playerUnignore]; renderResult(); }));
  }

  function bindActions(){
    out.querySelector('#reanalyze')?.addEventListener('click', () => file.click());
    out.querySelector('#confirmIA')?.addEventListener('click', confirm);
    out.querySelector('#iaScoreA')?.addEventListener('input', e => { iaState.scoreA = +e.target.value || 0; });
    out.querySelector('#iaScoreB')?.addEventListener('input', e => { iaState.scoreB = +e.target.value || 0; });
  }

  function updateConfirmButton(){
    const btn = out.querySelector('#confirmIA');
    if(!btn) return;
    const md = iaState.matched;
    let hasUnresolved = false;
    md.detectedTeams.forEach((t, tIdx) => {
      if(iaState.teamIgnored[tIdx]) return;
      const effTeamId = iaState.teamOverrides[tIdx] || t.assignedTeamId;
      if(!effTeamId){ hasUnresolved = true; return; }
      t.players.forEach((p, pIdx) => {
        const key = `${tIdx}:${pIdx}`;
        if(iaState.playerIgnored[key]) return;
        const effPid = iaState.playerOverrides[key] || p.matchedPlayerId;
        if(!effPid) hasUnresolved = true;
      });
    });
    btn.disabled = hasUnresolved;
    btn.textContent = hasUnresolved ? 'CONFIRMAR (HAY PENDIENTES)' : 'CONFIRMAR REPORTE';
  }

  function confirm(){
    const md = iaState.matched;
    const values = {};
    out.querySelectorAll('[data-ia-key]').forEach(inp => {
      const key = inp.dataset.iaKey;
      values[key] = values[key] || {};
      values[key][inp.dataset.field] = +inp.value || 0;
    });
    const players = [];
    md.detectedTeams.forEach((t, tIdx) => {
      if(iaState.teamIgnored[tIdx]) return;
      const effTeamId = iaState.teamOverrides[tIdx] || t.assignedTeamId;
      if(!effTeamId) return;
      t.players.forEach((p, pIdx) => {
        const key = `${tIdx}:${pIdx}`;
        if(iaState.playerIgnored[key]) return;
        const effPid = iaState.playerOverrides[key] || p.matchedPlayerId;
        if(!effPid) return;
        players.push({
          playerId: effPid, teamId: effTeamId,
          goals:   values[key]?.goals   ?? p.goals   ?? 0,
          assists: values[key]?.assists ?? p.assists ?? 0,
          saves:   values[key]?.saves   ?? p.saves   ?? 0,
          shots:   values[key]?.shots   ?? p.shots   ?? 0
        });
      });
    });
    if(players.length < 2) return toast('Se necesitan al menos 2 jugadores', 'error');
    const scoreA = iaState.scoreA ?? 0;
    const scoreB = iaState.scoreB ?? 0;
    if(scoreA === scoreB) return toast('No puede haber empate', 'error');

    const game = {
      id: uid('game'),
      scoreA, scoreB,
      winnerTeamId: scoreA > scoreB ? A.id : B.id,
      players
    };

    mutate(d => {
      const t = d.matches.find(x => x.id === m.id);
      t.games.push(game);
      const wonA = t.games.filter(g => g.scoreA > g.scoreB).length;
      const wonB = t.games.filter(g => g.scoreB > g.scoreA).length;
      const need = t.format === 'BO3' ? 2 : t.format === 'BO5' ? 3 : 4;
      t.status = (wonA === need || wonB === need) ? 'finished' : 'live';
    });
    logChange('report-ai', 'match', m.id, `Reporte IA (${scoreA}-${scoreB})`);
    toast('Reporte IA confirmado','success');
    closeTopModal();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}

function badgeClassFor(level){
  if(level === 'high')   return 'ia-badge-high';
  if(level === 'medium') return 'ia-badge-medium';
  if(level === 'manual') return 'ia-badge-manual';
  return 'ia-badge-low';
}
function badgeLabelFor(level, score){
  if(level === 'high')   return `✅ (${(score*100).toFixed(0)}%)`;
  if(level === 'medium') return `⚠️ (${(score*100).toFixed(0)}%)`;
  if(level === 'manual') return `✋ Manual`;
  return `❌ Sin asignar`;
}
function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}
function esc(str){ return escapeHtml(str); }