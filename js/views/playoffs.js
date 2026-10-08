// ============================================================
// PLAYOFFS VIEW — Bracket absoluto + SVG + series acumulativas
// ============================================================
import { getDB, mutate } from '../services/storage.js';
import { state } from '../state.js';
import {
  generateBracket,
  getPlayoff,
  reportBracketMatch,
  updateMatchFormat
} from '../services/playoffs.js';
import { AIService } from '../services/aiService.js';
import { openModal, toast, closeTopModal } from '../services/ui.js';
import { logChange } from '../services/history.js';
import { openMatchSummary } from './matchSummary.js';

// ============================================================
// LAYOUT
// ============================================================
const W = 220;
const H = 125;
const GAP_V = 26;
const GAP_H = 90;
const PAD = 40;
const TITLE_OFFSET = 34;

export function playoffsView(){
  const db = getDB();
  const division = db.divisions.find(d => d.id === state.divisionId) || db.divisions[0];
  if(!division) return `<div class="card">Sin división activa.</div>`;
  const playoff = getPlayoff(division.id);

  if(!playoff || !playoff.bracket || !playoff.bracket.rounds){
    return `
      <div class="page-head">
        <h1 class="page-title">PLAY-OFFS</h1>
        <button class="btn btn-primary" id="btnGenBracket">GENERAR BRACKET</button>
      </div>
      <div class="card" style="text-align:center;padding:40px;color:var(--muted)">
        Aún no se ha generado el bracket. Pulsa <b style="color:var(--accent)">GENERAR BRACKET</b> cuando finalice la fase regular.
      </div>
    `;
  }

  const champion = playoff.championId ? db.teams.find(t => t.id === playoff.championId) : null;

  return `
    <div class="page-head">
      <h1 class="page-title">PLAY-OFFS</h1>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="chip chip-accent">${esc(division.name)}</span>
        ${champion ? `<span class="chip chip-gold">🏆 ${esc(champion.name)}</span>` : ''}
        <button class="btn btn-sm btn-danger" id="btnResetBracket" title="Regenerar bracket">↺</button>
      </div>
    </div>

    <div class="bracket-v6-wrap" id="bracketWrap">
      <div class="bracket-v6-canvas" id="bracketCanvas"></div>
    </div>
  `;
}

export function bindPlayoffsEvents(){
  document.getElementById('btnGenBracket')?.addEventListener('click', () => {
    try {
      const divId = state.divisionId || getDB().divisions[0].id;
      const result = generateBracket(divId);
      logChange('generate', 'playoffs', null, 'Bracket generado');
      if(result && result.adjustmentMsg){
        toast('⚠ ' + result.adjustmentMsg, 'error');
      } else {
        toast('Bracket generado', 'success');
      }
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch(e){ toast(e.message, 'error'); }
  });

  document.getElementById('btnResetBracket')?.addEventListener('click', () => {
    if(!confirm('¿Regenerar el bracket? Se perderán los resultados actuales.')) return;
    try {
      const divId = state.divisionId || getDB().divisions[0].id;
      const result = generateBracket(divId);
      if(result && result.adjustmentMsg){
        toast('⚠ ' + result.adjustmentMsg, 'error');
      } else {
        toast('Bracket regenerado', 'success');
      }
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch(e){ toast(e.message, 'error'); }
  });

  renderBracketCanvas();

  const wrap = document.getElementById('bracketWrap');
  if(wrap){
    wrap.addEventListener('click', (e) => {
      const reportBtn = e.target.closest('[data-report-bracket]');
      if(reportBtn){
        e.preventDefault();
        e.stopPropagation();
        const [roundId, idx] = reportBtn.dataset.reportBracket.split(':');
        openBracketReporter(roundId, +idx);
        return;
      }
      const nodeEl = e.target.closest('[data-summary-match]');
      if(nodeEl && !e.target.closest('button')){
        const [roundId, idx] = nodeEl.dataset.summaryMatch.split(':');
        try {
          const db2 = getDB();
          const div2 = db2.divisions.find(d => d.id === state.divisionId) || db2.divisions[0];
          const pl2 = getPlayoff(div2.id);
          const rd = pl2?.bracket?.rounds?.find(r => r.id === roundId);
          const m = rd?.matches?.[+idx];
          if(!m) return;
          openMatchSummary({
            id: m.id,
            teamAId: m.teamA?.teamId,
            teamBId: m.teamB?.teamId,
            games: m.games,
            format: m.format || getFormatForRound(roundId, div2)
          }, { title: `RESUMEN · ${rd.name}` });
        } catch(err){
          console.error('[ZENITH] Summary error:', err);
        }
      }
    });
  }

  initBracketDragDrop();
}

// ============================================================
// RENDER DEL BRACKET
// ============================================================
function renderBracketCanvas(){
  const canvas = document.getElementById('bracketCanvas');
  if(!canvas) return;

  const db = getDB();
  const division = db.divisions.find(d => d.id === state.divisionId) || db.divisions[0];
  const playoff = getPlayoff(division.id);
  if(!playoff || !playoff.bracket || !playoff.bracket.rounds) return;

  const rounds = playoff.bracket.rounds;
  const playInRound = rounds.find(r => r.id === 'playIn');
  const mainRounds = rounds.filter(r => r.id !== 'playIn');
  if(mainRounds.length === 0) return;

  const N0 = mainRounds[0].matches.length;
  const H_TOTAL = N0 * H + (N0 - 1) * GAP_V;

  let xCursor = PAD;
  const xPlayIn = playInRound ? xCursor : null;
  if(playInRound) xCursor += W + GAP_H;
  const mainX = [];
  mainRounds.forEach(() => {
    mainX.push(xCursor);
    xCursor += W + GAP_H;
  });

  const positions = {};

  if(playInRound){
    const piMatches = playInRound.matches;
    const piH = piMatches.length * H + (piMatches.length - 1) * GAP_V;
    const piTop0 = TITLE_OFFSET + (H_TOTAL - piH) / 2;
    positions.playIn = piMatches.map((_, i) => {
      const top = piTop0 + i * (H + GAP_V);
      return { top, center: top + H / 2, x: xPlayIn };
    });
  }

  positions[mainRounds[0].id] = [];
  for(let i = 0; i < N0; i++){
    const center = TITLE_OFFSET + i * (H + GAP_V) + H / 2;
    positions[mainRounds[0].id].push({ top: center - H / 2, center, x: mainX[0] });
  }

  for(let r = 1; r < mainRounds.length; r++){
    const prev = positions[mainRounds[r - 1].id];
    const cur = mainRounds[r];
    positions[cur.id] = [];
    for(let i = 0; i < cur.matches.length; i++){
      const cA = prev[2 * i].center;
      const cB = prev[2 * i + 1].center;
      const center = (cA + cB) / 2;
      positions[cur.id].push({ top: center - H / 2, center, x: mainX[r] });
    }
  }

  const canvasW = xCursor - GAP_H + PAD;
  const canvasH = TITLE_OFFSET + H_TOTAL + PAD;
  canvas.style.width = canvasW + 'px';
  canvas.style.height = canvasH + 'px';

  let html = '';

  if(playInRound){
    html += `<div class="bracket-v6-title" style="left:${xPlayIn}px;top:0;width:${W}px">${esc(playInRound.name)}</div>`;
  }
  mainRounds.forEach((round, r) => {
    const isFinal = r === mainRounds.length - 1;
    html += `<div class="bracket-v6-title ${isFinal ? 'is-final' : ''}" style="left:${mainX[r]}px;top:0;width:${W}px">${esc(round.name)}</div>`;
  });

  if(playInRound){
    playInRound.matches.forEach((m, i) => {
      const p = positions.playIn[i];
      html += renderNode(m, playInRound.id, i, p.x, p.top, true);
    });
  }

  mainRounds.forEach(round => {
    round.matches.forEach((m, i) => {
      const p = positions[round.id][i];
      html += renderNode(m, round.id, i, p.x, p.top, false);
    });
  });

  const paths = [];

  for(let r = 0; r < mainRounds.length - 1; r++){
    const cur = mainRounds[r];
    const nxt = mainRounds[r + 1];
    const curPos = positions[cur.id];
    const nxtPos = positions[nxt.id];

    nxt.matches.forEach((m, i) => {
      const pA = curPos[2 * i];
      const pB = curPos[2 * i + 1];
      const pP = nxtPos[i];
      if(!pA || !pB || !pP) return;

      const xRight = pA.x + W;
      const xLeftNext = pP.x;
      const xMid = xRight + (GAP_H / 2);

      paths.push(`M ${xRight} ${pA.center} L ${xMid} ${pA.center}`);
      paths.push(`M ${xRight} ${pB.center} L ${xMid} ${pB.center}`);
      paths.push(`M ${xMid} ${pA.center} L ${xMid} ${pB.center}`);
      paths.push(`M ${xMid} ${pP.center} L ${xLeftNext} ${pP.center}`);
    });
  }

  const svgPathHTML = paths.map(d => `<path d="${d}" />`).join('');
  const svg = `<svg class="bracket-v6-lines" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">${svgPathHTML}</svg>`;

  canvas.innerHTML = svg + html;
}

function renderNode(m, roundId, idx, x, y, isPlayIn){
  const ready = m.teamA?.teamId && m.teamB?.teamId;
  const reported = !!m.winnerId;
  const isBye = m.isBye === true;
  const hasGames = (m.games || []).length > 0;

  const wonA = (m.games || []).filter(g => g.scoreA > g.scoreB).length;
  const wonB = (m.games || []).filter(g => g.scoreB > g.scoreA).length;

  const winnerA = reported && m.teamA?.teamId === m.winnerId;
  const winnerB = reported && m.teamB?.teamId === m.winnerId;

  let footHTML = '';
  if(isBye){
    footHTML = `<span class="bracket-v6-foot-text muted">— BYE —</span>`;
  } else if(reported){
    footHTML = `<span class="bracket-v6-foot-text">✔ FINAL</span>`;
  } else if(hasGames){
    footHTML = `<span class="badge badge-live" style="font-size:9px;padding:2px 6px">EN JUEGO</span>
                <button class="btn btn-sm btn-primary" data-report-bracket="${roundId}:${idx}">REPORTAR</button>`;
  } else if(ready){
    footHTML = `<button class="btn btn-sm btn-primary" data-report-bracket="${roundId}:${idx}">REPORTAR</button>`;
  } else {
    footHTML = `<span class="bracket-v6-foot-text muted">ESPERANDO</span>`;
  }

  const classes = ['bracket-v6-node'];
  if(isPlayIn) classes.push('is-playin');
  if(reported && !isBye && hasGames) classes.push('is-reported');

  const summaryAttr = (reported && !isBye && hasGames) ? `data-summary-match="${roundId}:${idx}"` : '';

  return `
    <div class="${classes.join(' ')}" style="left:${x}px;top:${y}px;width:${W}px;height:${H}px" ${summaryAttr}>
      ${renderRow(m.teamA, winnerA, 'A', m, roundId, idx, wonA, wonB, isBye)}
      ${renderRow(m.teamB, winnerB, 'B', m, roundId, idx, wonA, wonB, isBye)}
      <div class="bracket-v6-foot">${footHTML}</div>
    </div>
  `;
}

function renderRow(team, isWinner, side, match, roundId, idx, wonA, wonB, isBye){
  const canDrag = !match.winnerId && team && team.teamId;
  if(!team || !team.teamId){
    return `
      <div class="bracket-v6-row empty" data-slot="${side}" data-match-id="${match.id}" data-round-id="${roundId}" data-match-index="${idx}">
        <span class="bracket-v6-seed">–</span>
        <span class="bracket-v6-name tbd">TBD</span>
      </div>`;
  }
  const seed = team.pos ? `${team.pos}` : '–';

  // Score a mostrar
  let scoreDisplay = '';
  let scoreColor = 'var(--muted)';
  if(isBye){
    scoreDisplay = '—';
    scoreColor = 'var(--muted)';
  } else if((wonA + wonB) > 0){
    scoreDisplay = side === 'A' ? wonA : wonB;
    scoreColor = isWinner ? 'var(--success)' : 'var(--silver-light)';
  } else {
    scoreDisplay = '0';
    scoreColor = 'var(--muted)';
  }

  return `
    <div class="bracket-v6-row ${isWinner ? 'winner' : ''}"
         data-slot="${side}" data-match-id="${match.id}" data-round-id="${roundId}" data-match-index="${idx}"
         ${canDrag ? 'draggable="true"' : ''}>
      <span class="bracket-v6-seed">${seed}</span>
      ${team.logo
        ? `<img src="${team.logo}" class="bracket-v6-logo" alt="">`
        : `<span class="bracket-v6-logo placeholder">◆</span>`}
      <span class="bracket-v6-name">${esc(team.name)}</span>
      <span style="font-family:var(--font-display);font-size:15px;color:${scoreColor};min-width:22px;text-align:right;letter-spacing:.04em;flex-shrink:0;font-weight:600">${scoreDisplay}</span>
    </div>
  `;
}

function getFormatForRound(roundId, division){
  if(roundId === 'playIn') return division.config.playInFormat || 'BO5';
  const pl = getPlayoff(division.id);
  if(!pl) return 'BO5';
  const rounds = pl.bracket.rounds;
  if(rounds[rounds.length - 1]?.id === roundId) return division.config.finalFormat || 'BO7';
  if(rounds[rounds.length - 2]?.id === roundId) return division.config.semiFormat || 'BO5';
  return division.config.playInFormat || 'BO5';
}

// ============================================================
// DRAG & DROP
// ============================================================
function initBracketDragDrop(){
  let dragSrc = null;

  document.querySelectorAll('.bracket-v6-row[draggable="true"]').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      dragSrc = {
        matchId: el.dataset.matchId,
        slot: el.dataset.slot,
        roundId: el.dataset.roundId
      };
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      dragSrc = null;
      document.querySelectorAll('.bracket-v6-row.drop-hover').forEach(x => x.classList.remove('drop-hover'));
    });
  });

  document.querySelectorAll('.bracket-v6-row').forEach(el => {
    el.addEventListener('dragover', (e) => {
      if(!dragSrc) return;
      if(el.dataset.roundId !== dragSrc.roundId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drop-hover');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-hover'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-hover');
      if(!dragSrc) return;
      if(el.dataset.roundId !== dragSrc.roundId){
        return toast('Solo puedes intercambiar equipos dentro de la misma ronda', 'error');
      }
      if(el.dataset.matchId === dragSrc.matchId && el.dataset.slot === dragSrc.slot) return;

      try {
        swapTeamsInBracket(dragSrc, {
          matchId: el.dataset.matchId,
          slot: el.dataset.slot,
          roundId: el.dataset.roundId
        });
        toast('Equipos reorganizados', 'success');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch(err){
        toast(err.message, 'error');
      }
      dragSrc = null;
    });
  });
}

function swapTeamsInBracket(src, dst){
  const db = getDB();
  const divisionId = state.divisionId || db.divisions[0].id;
  const playoff = getPlayoff(divisionId);
  if(!playoff) throw new Error('Bracket no encontrado');
  const bracket = playoff.bracket;

  const srcRound = bracket.rounds.find(r => r.id === src.roundId);
  const dstRound = bracket.rounds.find(r => r.id === dst.roundId);
  if(!srcRound || !dstRound) throw new Error('Ronda no encontrada');
  if(srcRound.id !== dstRound.id) throw new Error('Rondas distintas');

  const srcMatch = srcRound.matches.find(m => m.id === src.matchId);
  const dstMatch = dstRound.matches.find(m => m.id === dst.matchId);
  if(!srcMatch || !dstMatch) throw new Error('Partido no encontrado');
  if(srcMatch.winnerId || dstMatch.winnerId) throw new Error('No puedes mover equipos de un partido ya reportado');

  const srcTeam = src.slot === 'A' ? srcMatch.teamA : srcMatch.teamB;
  const dstTeam = dst.slot === 'A' ? dstMatch.teamA : dstMatch.teamB;
  if(!srcTeam) throw new Error('Origen sin equipo');

  const allTeamsInRound = new Set();
  srcRound.matches.forEach(m => {
    if(m.id === src.matchId || m.id === dst.matchId) return;
    if(m.teamA?.teamId) allTeamsInRound.add(m.teamA.teamId);
    if(m.teamB?.teamId) allTeamsInRound.add(m.teamB.teamId);
  });
  if(dstTeam && dstTeam.teamId && allTeamsInRound.has(dstTeam.teamId)) throw new Error('El equipo ya está en esta ronda');
  if(allTeamsInRound.has(srcTeam.teamId)) throw new Error('El equipo ya está en esta ronda');

  mutate(d => {
    const target = d.playoffs.find(p => p.divisionId === divisionId);
    const rd = target.bracket.rounds.find(r => r.id === src.roundId);
    const sm = rd.matches.find(m => m.id === src.matchId);
    const dm = rd.matches.find(m => m.id === dst.matchId);
    if(!sm || !dm) return;

    const sT = src.slot === 'A' ? sm.teamA : sm.teamB;
    const dT = dst.slot === 'A' ? dm.teamA : dm.teamB;

    if(src.slot === 'A') sm.teamA = dT; else sm.teamB = dT;
    if(dst.slot === 'A') dm.teamA = sT; else dm.teamB = sT;
  });
}

// ============================================================
// REPORTER
// ============================================================
function openBracketReporter(roundId, matchIndex){
  try {
    const db = getDB();
    const division = db.divisions.find(d => d.id === state.divisionId) || db.divisions[0];
    if(!division) return toast('Sin división activa', 'error');

    const playoff = getPlayoff(division.id);
    if(!playoff) return toast('Bracket no encontrado', 'error');

    const round = playoff.bracket.rounds.find(r => r.id === roundId);
    if(!round) return toast('Ronda no encontrada: ' + roundId, 'error');

    const m = round.matches[matchIndex];
    if(!m) return toast('Partido no encontrado (índice ' + matchIndex + ')', 'error');
    if(!m.teamA || !m.teamB) return toast('Equipos no asignados', 'error');

    const A = db.teams.find(t => t.id === m.teamA.teamId);
    const B = db.teams.find(t => t.id === m.teamB.teamId);
    if(!A || !B) return toast('Equipos no encontrados en la DB', 'error');

    const format = m.format || getFormatForRound(roundId, division);

    openModal({
      id: 'bracket-reporter-' + roundId + '-' + matchIndex,
      title: `REPORTAR · ${esc(A.name)} vs ${esc(B.name)}`,
      wide: true,
      body: `
        <div class="tabs" id="bracketReporterTabs">
          <button class="tab active" data-tab="manual">MANUAL</button>
          <button class="tab" data-tab="ai">ANALIZAR CAPTURA CON IA</button>
        </div>
        <div id="bracketTabManual"></div>
        <div id="bracketTabAI" style="display:none"></div>
      `,
      footer: `<button class="btn btn-ghost" data-close>CERRAR</button>`,
      onMount: root => {
        const tabs = root.querySelector('#bracketReporterTabs');
        tabs.addEventListener('click', e => {
          const t = e.target.closest('[data-tab]'); if(!t) return;
          tabs.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
          root.querySelector('#bracketTabManual').style.display = t.dataset.tab === 'manual' ? '' : 'none';
          root.querySelector('#bracketTabAI').style.display     = t.dataset.tab === 'ai' ? '' : 'none';
        });
        renderManual(m, A, B, roundId, matchIndex, format);
        renderAI(m, A, B, roundId, matchIndex);
      }
    });
  } catch(err){
    console.error('[ZENITH] openBracketReporter error:', err);
    toast('Error: ' + err.message, 'error');
  }
}

function renderManual(m, A, B, roundId, matchIndex, format){
  const container = document.querySelector('#bracketTabManual');
  if(!container) return;

  const db = getDB();
  const rosterOf = team => (team.roster || []).map(r => {
    const p = db.players.find(x => x.id === r.playerId);
    return p ? { playerId: p.id, name: p.name } : null;
  }).filter(Boolean);

  const rowsA = rosterOf(A);
  const rowsB = rosterOf(B);

  const wonA = (m.games || []).filter(g => g.scoreA > g.scoreB).length;
  const wonB = (m.games || []).filter(g => g.scoreB > g.scoreA).length;
  const finished = !!m.winnerId;

  container.innerHTML = `
    <div class="field">
      <label>Formato de la serie (se aplicará a este partido)</label>
      <select class="select" id="bpFormat" ${finished ? 'disabled' : ''}>
        ${['BO3','BO5','BO7'].map(f => `<option ${format === f ? 'selected' : ''}>${f}</option>`).join('')}
      </select>
    </div>

    <div class="reporter-header">
      <div class="reporter-serie">
        SERIE · ${esc(A.name)} <span style="color:var(--accent)">${wonA}</span> – <span style="color:var(--accent)">${wonB}</span> ${esc(B.name)}
      </div>
      <span class="chip chip-accent">${format}</span>
    </div>

    ${finished ? `<div class="card" style="text-align:center;color:var(--success)">SERIE FINALIZADA</div>` : ''}

    <div id="bpGameList">
      ${(m.games || []).map((g, i) => bpGameCardHTML(g, i + 1, A, B)).join('')}
    </div>

    ${!finished ? `
      <div class="divider"></div>
      <div class="reporter-subhead">PARTIDA ${(m.games || []).length + 1}</div>

      <div class="grid grid-2" style="margin-bottom:12px">
        <div>
          <div class="reporter-subhead">${esc(A.name)}</div>
          <div id="bpPlayersA">${rowsA.map((p, i) => playerStatRow(p, 'A', i)).join('') || '<div style="color:var(--muted);font-size:11px;text-align:center;padding:10px">Sin roster</div>'}</div>
        </div>
        <div>
          <div class="reporter-subhead">${esc(B.name)}</div>
          <div id="bpPlayersB">${rowsB.map((p, i) => playerStatRow(p, 'B', i)).join('') || '<div style="color:var(--muted);font-size:11px;text-align:center;padding:10px">Sin roster</div>'}</div>
        </div>
      </div>

      <div class="row">
        <div class="field"><label>Marcador ${esc(A.name)}</label><input class="input" type="number" min="0" id="bpScoreA" value="0"></div>
        <div class="field"><label>Marcador ${esc(B.name)}</label><input class="input" type="number" min="0" id="bpScoreB" value="0"></div>
      </div>

      <button class="btn btn-primary" id="bpReport" style="width:100%">REPORTAR PARTIDA</button>
    ` : ''}
  `;

  // Cambio de formato
  const formatSel = container.querySelector('#bpFormat');
  if(formatSel && !finished){
    formatSel.addEventListener('change', (e) => {
      try {
        updateMatchFormat(state.divisionId || getDB().divisions[0].id, roundId, matchIndex, e.target.value);
        toast('Formato actualizado');
      } catch(err){ toast(err.message, 'error'); }
    });
  }

  // Reportar partida
  if(!finished){
    container.querySelector('#bpReport').addEventListener('click', () => {
      const liveContainer = document.querySelector('#bracketTabManual');
      if(!liveContainer) return toast('Contenedor perdido. Reabre el modal.', 'error');

      const scoreAEl = liveContainer.querySelector('#bpScoreA');
      const scoreBEl = liveContainer.querySelector('#bpScoreB');
      if(!scoreAEl || !scoreBEl) return toast('Campos de marcador no encontrados', 'error');

      const scoreA = +scoreAEl.value || 0;
      const scoreB = +scoreBEl.value || 0;
      if(scoreA === scoreB) return toast('No puede haber empate', 'error');

      const collect = (side, team) => {
        const wrap = liveContainer.querySelector(`#bpPlayers${side}`);
        if(!wrap) return [];
        return [...wrap.children].map(row => ({
          playerId: row.dataset.playerId,
          teamId: team.id,
          goals:   +(row.querySelector('[data-g]')?.value || 0),
          assists: +(row.querySelector('[data-a]')?.value || 0),
          saves:   +(row.querySelector('[data-s]')?.value || 0),
          shots:   +(row.querySelector('[data-t]')?.value || 0)
        }));
      };

      const players = [...collect('A', A), ...collect('B', B)];

      try {
        reportBracketMatch(state.divisionId || getDB().divisions[0].id, roundId, matchIndex, { scoreA, scoreB, players });
        logChange('report', 'playoffs', null, `Bracket ${roundId}: ${A.name} ${scoreA}-${scoreB} ${B.name}`);
        toast('Partida reportada', 'success');
        closeTopModal();
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch(e){
        console.error(e);
        toast('Error: ' + e.message, 'error');
      }
    });
  }
}

function bpGameCardHTML(g, num, A, B){
  const db = getDB();
  const rows = (team) => g.players
    .filter(p => p.teamId === team.id)
    .map(p => {
      const name = db.players.find(x => x.id === p.playerId)?.name || '?';
      return `<tr>
        <td>${esc(name)}</td>
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
        <span class="card-sub">${esc(A.name)} ${g.scoreA} – ${g.scoreB} ${esc(B.name)}</span>
      </div>
      <div class="grid grid-2">
        <div>
          <div class="reporter-subhead">${esc(A.name)}</div>
          <table class="ztable">
            <thead><tr><th>JUGADOR</th><th class="num">G</th><th class="num">A</th><th class="num">S</th><th class="num">T</th></tr></thead>
            <tbody>${rows(A)}</tbody>
          </table>
        </div>
        <div>
          <div class="reporter-subhead">${esc(B.name)}</div>
          <table class="ztable">
            <thead><tr><th>JUGADOR</th><th class="num">G</th><th class="num">A</th><th class="num">S</th><th class="num">T</th></tr></thead>
            <tbody>${rows(B)}</tbody>
          </table>
        </div>
      </div>
      <div class="reporter-winner">Ganador: ${esc(winner)}</div>
    </div>
  `;
}

function playerStatRow(p, side, idx){
  return `<div class="card" style="padding:8px;margin-bottom:6px" data-player-id="${p.playerId}">
    <div class="reporter-player-name">${esc(p.name)}</div>
    <div class="stat-input-grid">
      <input class="input" type="number" min="0" data-g placeholder="G" value="0">
      <input class="input" type="number" min="0" data-a placeholder="A" value="0">
      <input class="input" type="number" min="0" data-s placeholder="S" value="0">
      <input class="input" type="number" min="0" data-t placeholder="T" value="0">
    </div>
  </div>`;
}

function renderAI(m, A, B, roundId, matchIndex){
  const container = document.querySelector('#bracketTabAI');
  if(!container) return;

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
      <div class="dropzone" id="bpIaDrop">Arrastra la captura o haz click</div>
      <input type="file" id="bpIaFile" accept="image/*" hidden>
    </div>
    <div id="bpIaResult"></div>
  `;

  const drop = container.querySelector('#bpIaDrop');
  const file = container.querySelector('#bpIaFile');
  const out = container.querySelector('#bpIaResult');

  drop.addEventListener('click', () => file.click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dragover'); run(e.dataTransfer.files[0]); });
  file.addEventListener('change', () => run(file.files[0]));

  async function run(f){
    if(!f) return;
    out.innerHTML = `<div class="card" style="padding:16px;text-align:center;color:var(--muted)">Analizando captura…</div>`;
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
      out.innerHTML = `<div class="card" style="padding:16px;color:var(--danger)">Error: ${e.message}</div>`;
    }
  }

  function renderResult(){
    const md = iaState.matched;
    const thresholds = md.thresholds;
    out.innerHTML = `
      <div class="divider"></div>
      ${md.warnings.length > 0 ? `<div class="ia-warnings">${md.warnings.map(w => `<div class="ia-warning-item">${escapeHtml(w)}</div>`).join('')}</div>` : ''}
      <div class="ia-thresholds-note">Umbrales: ≥ ${(thresholds.high*100).toFixed(0)}% auto · ≥ ${(thresholds.low*100).toFixed(0)}% aviso · &lt; ${(thresholds.low*100).toFixed(0)}% manual</div>
      <div class="ia-team-blocks" id="bpIaTeamBlocks"></div>
      <div class="ia-score-row">
        <div class="field"><label>Marcador ${escapeHtml(A.name)}</label><input class="input" type="number" min="0" id="bpIaScoreA" value="${iaState.scoreA}"></div>
        <div class="field"><label>Marcador ${escapeHtml(B.name)}</label><input class="input" type="number" min="0" id="bpIaScoreB" value="${iaState.scoreB}"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn" id="bpIaReanalyze">REANALIZAR</button>
        <button class="btn btn-primary" id="bpIaConfirm">CONFIRMAR PARTIDA</button>
      </div>
    `;
    const blocksEl = out.querySelector('#bpIaTeamBlocks');
    blocksEl.innerHTML = md.detectedTeams.map((t, tIdx) => renderTeamBlock(t, tIdx)).join('');
    bindEvents(blocksEl);
    bindActions();
    updateConfirm();
  }

  function renderTeamBlock(t, tIdx){
    const ignored = iaState.teamIgnored[tIdx];
    const overrideTeamId = iaState.teamOverrides[tIdx];
    const effectiveTeamId = overrideTeamId || t.assignedTeamId;
    const effectiveTeam = candidateTeams.find(c => c.id === effectiveTeamId);
    const teamScore = overrideTeamId ? 1 : t.matchScore;
    const teamLevel = overrideTeamId ? 'manual' : t.matchLevel;
    let cls = `ia-team-block ia-team-${teamLevel}`;
    if(ignored) cls += ' ia-team-ignored';
    let badge = '';
    if(ignored) badge = `<span class="ia-match-badge ia-badge-ignored">🚫 Ignorado</span>`;
    else if(effectiveTeam) badge = `<span class="ia-match-badge ${badgeClassFor(teamLevel)}">${badgeLabelFor(teamLevel, teamScore)}</span>`;
    else badge = `<span class="ia-match-badge ia-badge-low">❌ Sin asignar</span>`;
    const showApproval = !ignored && (!effectiveTeam || overrideTeamId);
    return `
      <div class="${cls}" data-team-idx="${tIdx}">
        <div class="ia-team-header">
          <div class="ia-team-title">
            <span class="ia-team-name">${escapeHtml(t.detectedName || '?')}</span>
            <span class="ia-team-score">${t.detectedScore ?? 0}</span>
            ${badge}
            ${effectiveTeam ? `<span class="ia-team-assigned">→ ${escapeHtml(effectiveTeam.name)}</span>` : ''}
          </div>
          <div class="ia-team-actions"><button type="button" class="btn btn-sm" data-team-ignore="${tIdx}">🚫</button></div>
        </div>
        ${showApproval ? `<div class="ia-team-approval"><span class="ia-approval-label">Equipo:</span><select class="select ia-team-select" data-team-select="${tIdx}"><option value="">— Seleccionar —</option>${candidateTeams.map(c => `<option value="${c.id}" ${effectiveTeamId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>` : ''}
        ${ignored ? `<div class="ia-team-approval"><button type="button" class="btn btn-sm" data-team-unignore="${tIdx}">↩ Restaurar</button></div>` : `<div class="ia-team-players">${t.players.map((p, pIdx) => renderPlayerRow(p, tIdx, pIdx, effectiveTeam)).join('')}</div>`}
      </div>
    `;
  }

  function renderPlayerRow(p, tIdx, pIdx, effectiveTeam){
    const key = `${tIdx}:${pIdx}`;
    const ignored = iaState.playerIgnored[key];
    const overridePid = iaState.playerOverrides[key];
    let effPid = overridePid || p.matchedPlayerId;
    let effName = '—';
    if(overridePid && effectiveTeam) effName = effectiveTeam.roster.find(x => x.id === overridePid)?.name || '—';
    else if(p.matchedName) effName = p.matchedName;
    const effScore = overridePid ? 1 : p.matchScore;
    const effLevel = overridePid ? 'manual' : p.matchLevel;
    let rowCls = `ia-row ia-row-${effLevel}`;
    if(ignored) rowCls += ' ia-row-ignored';
    let badge = '';
    if(ignored) badge = `<span class="ia-match-badge ia-badge-ignored">🚫</span>`;
    else if(effLevel === 'manual') badge = `<span class="ia-match-badge ia-badge-manual">✋ Manual</span>`;
    else if(effLevel === 'high') badge = `<span class="ia-match-badge ia-badge-high">✅ (${(effScore*100).toFixed(0)}%)</span>`;
    else if(effLevel === 'medium') badge = `<span class="ia-match-badge ia-badge-medium">⚠️ (${(effScore*100).toFixed(0)}%)</span>`;
    else badge = `<span class="ia-match-badge ia-badge-low">❌</span>`;
    const canPick = !ignored && effectiveTeam;
    const showApproval = canPick && (p.needsApproval || overridePid || !p.matchedPlayerId);
    return `
      <div class="${rowCls}" data-player-key="${key}">
        <div class="ia-row-main">
          <div class="ia-row-info">
            <div class="ia-row-name">${escapeHtml(p.name)}</div>
            ${badge}
            ${effName !== '—' ? `<div class="ia-match-detail">→ ${escapeHtml(effName)}</div>` : ''}
          </div>
          <div class="ia-row-stats">
            <input class="input" type="number" min="0" value="${p.goals||0}"   data-ia-key="${key}" data-field="goals"   placeholder="G">
            <input class="input" type="number" min="0" value="${p.assists||0}" data-ia-key="${key}" data-field="assists" placeholder="A">
            <input class="input" type="number" min="0" value="${p.saves||0}"   data-ia-key="${key}" data-field="saves"   placeholder="S">
            <input class="input" type="number" min="0" value="${p.shots||0}"   data-ia-key="${key}" data-field="shots"   placeholder="T">
          </div>
        </div>
        ${showApproval ? `<div class="ia-row-approval"><span class="ia-approval-label">Jugador:</span><select class="select ia-roster-select" data-player-select="${key}"><option value="">— Seleccionar —</option>${effectiveTeam.roster.map(pl => `<option value="${pl.id}" ${(overridePid || p.matchedPlayerId) === pl.id ? 'selected' : ''}>${escapeHtml(pl.name)}</option>`).join('')}</select><button type="button" class="btn btn-sm" data-player-ignore="${key}">🚫</button></div>` : ''}
        ${ignored ? `<div class="ia-row-approval"><button type="button" class="btn btn-sm" data-player-unignore="${key}">↩ Restaurar</button></div>` : ''}
      </div>
    `;
  }

  function bindEvents(blocksEl){
    blocksEl.querySelectorAll('[data-team-select]').forEach(sel => sel.addEventListener('change', () => {
      const tIdx = +sel.dataset.teamSelect;
      if(sel.value){ iaState.teamOverrides[tIdx] = sel.value; }
      else delete iaState.teamOverrides[tIdx];
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
    out.querySelector('#bpIaReanalyze')?.addEventListener('click', () => file.click());
    out.querySelector('#bpIaConfirm')?.addEventListener('click', confirm);
    out.querySelector('#bpIaScoreA')?.addEventListener('input', e => { iaState.scoreA = +e.target.value || 0; });
    out.querySelector('#bpIaScoreB')?.addEventListener('input', e => { iaState.scoreB = +e.target.value || 0; });
  }

  function updateConfirm(){
    const btn = out.querySelector('#bpIaConfirm');
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
    btn.textContent = hasUnresolved ? 'CONFIRMAR (PENDIENTES)' : 'CONFIRMAR PARTIDA';
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
    try {
      reportBracketMatch(state.divisionId || getDB().divisions[0].id, roundId, matchIndex, { scoreA, scoreB, players });
      logChange('report-ai', 'playoffs', null, `Reporte IA (${scoreA}-${scoreB})`);
      toast('Partida reportada', 'success');
      closeTopModal();
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch(e){
      toast('Error: ' + e.message, 'error');
    }
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