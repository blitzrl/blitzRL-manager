import { getDB, mutate } from '../services/storage.js';
import { state } from '../state.js';
import { computeStandings } from '../services/standings.js';
import { aggregatePlayerStats } from '../services/statistics.js';
import { ballonDor } from '../services/pig.js';
import { openModal, toast, closeTopModal } from '../services/ui.js';
import { getNationFlag } from '../data/nations.js';
import { uid, getWidgetType } from '../data/database.js';
import { bindCarouselEvents } from './widgetCarousel.js';

let isEditMode = false;

export function dashboardView(){
  const db = getDB();
  const season = db.seasons.find(s => s.active) || db.seasons[0];
  const division = db.divisions.find(d => d.id === state.divisionId) || db.divisions[0];

  const viewBanner = db.viewSeasonId ? renderViewBanner(db) : '';

  if(!division){
    return `${viewBanner}<div class="card">Sin divisiones configuradas.</div>`;
  }

  const standings = computeStandings(division.id, season?.id);
  const players = aggregatePlayerStats({ divisionId: division.id, seasonId: season?.id });
  const topPIG = ballonDor(players.filter(p => p.games > 0), division.id, season?.id).slice(0,5);

  const widgets = [...db.widgets].filter(w => w.enabled).sort((a,b) => a.order - b.order);

  const renderers = {
    upcoming:        (w) => widgetUpcoming(w, division),
    standings:       (w) => widgetStandings(standings, division),
    topPlayers:      (w) => widgetTopPlayers(topPIG),
    lastResult:      (w) => widgetLastResult(w, division),
    nextMatchdays:   (w) => widgetNextMatchdays(division.id, 4),
    ballonDor:       (w) => widgetBallonDor(topPIG),
    news:            (w) => widgetNews(db.news),
    mvpCarousel:     (w) => widgetMvpCarousel(topPIG),
    topScorers:      (w) => widgetTopScorers(players),
    topAssists:      (w) => widgetTopAssists(players),
    topSaves:        (w) => widgetTopSaves(players),
    topEfficiency:   (w) => widgetTopEfficiency(players),
    playerSpotlight: (w) => widgetPlayerSpotlight(players, db),
    playInUpcoming:  (w) => widgetPlayInUpcoming(w, division),
    playoffUpcoming: (w) => widgetPlayoffUpcoming(w, division),
    playoffBracket:  (w) => widgetPlayoffBracket(division)
  };

  return `
    ${viewBanner}
    <div class="home-toolbar">
      <span class="chip">${isEditMode ? 'MODO EDICIÓN' : 'MODO LECTURA'}</span>
      <button class="btn btn-sm" id="btnToggleEdit">${isEditMode ? '✓ GUARDAR LAYOUT' : '⚙ EDITAR HOME'}</button>
    </div>
    <div class="grid-dash" id="dashGrid">
      ${widgets.map(w => {
        const t = getWidgetType(w.id);
        const canConfig = t?.configurable;
        return `
          <div class="widget-slot ${isEditMode?'draggable':''}"
               data-widget="${w.id}"
               data-instance="${w.instanceId}"
               style="grid-column: span ${w.span}; grid-row: span ${w.rowSpan||1};"
               draggable="${isEditMode}">
            ${isEditMode ? widgetEditHeader(w, canConfig) : ''}
            ${renderers[w.id] ? renderers[w.id](w) : `<div class="card">${esc(w.name)}</div>`}
          </div>`;
      }).join('')}
    </div>
  `;
}

function renderViewBanner(db){
  const arch = (db.archivedSeasons || []).find(s => s.id === db.viewSeasonId);
  const name = arch?.name || 'Temporada archivada';
  const year = arch?.year || '';
  const champs = arch?.championByDivision || {};
  const champCount = Object.keys(champs).length;

  return `
    <div class="card" style="margin-bottom:16px;border-left:4px solid var(--gold);background:linear-gradient(90deg,rgba(230,196,118,.06),transparent)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
        <div>
          <div style="color:var(--gold);font-family:var(--font-display);letter-spacing:.14em;font-size:15px;margin-bottom:6px">
            📖 MODO LECTURA · ${esc(name)}${year ? ' · ' + year : ''}
          </div>
          <div style="font-size:11.5px;color:var(--muted);line-height:1.6">
            Estás viendo datos históricos. Para editar, vuelve a la temporada activa.
            ${champCount > 0 ? ` · ${champCount} campeón${champCount > 1 ? 'es' : ''} registrado${champCount > 1 ? 's' : ''}.` : ''}
          </div>
        </div>
        <button class="btn btn-sm btn-primary" id="btnExitViewMode">← VOLVER A TEMPORADA ACTIVA</button>
      </div>
    </div>
  `;
}

function widgetEditHeader(w, canConfig){
  const isCustom = !w.instanceId.endsWith('_default');
  return `
    <div class="widget-edit-bar">
      <span class="widget-handle">⠿ ${esc(w.name)}</span>
      <div class="widget-instance-actions">
        <button class="widget-action-btn" data-duplicate="${w.instanceId}" title="Duplicar widget">📋</button>
        ${canConfig ? `<button class="widget-action-btn" data-config="${w.instanceId}" title="Configurar">⚙</button>` : ''}
        ${isCustom ? `<button class="widget-action-btn danger" data-remove-instance="${w.instanceId}" title="Eliminar instancia">🗑</button>` : ''}
        <span class="widget-size-controls">
          <button class="wsize-btn" data-wsize="${w.instanceId}" data-axis="span">↔ ${w.span}</button>
          <button class="wsize-btn" data-wsize="${w.instanceId}" data-axis="rowSpan">↕ ${w.rowSpan||1}</button>
        </span>
      </div>
    </div>`;
}

export function bindDashboardEvents(){
  document.getElementById('btnExitViewMode')?.addEventListener('click', () => {
    import('../services/seasons.js').then(({ switchToSeason }) => {
      switchToSeason(null);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  });

  document.getElementById('btnToggleEdit')?.addEventListener('click', () => {
    if(getDB().viewSeasonId){
      return toast('📖 Estás en modo lectura. Vuelve a la temporada activa para editar.', 'error');
    }
    isEditMode = !isEditMode;
    if(!isEditMode) toast('Layout guardado', 'success');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

  document.querySelectorAll('[data-wsize]').forEach(btn => {
    btn.addEventListener('click', () => {
      const instanceId = btn.dataset.wsize;
      const axis = btn.dataset.axis;
      try {
        mutate(d => {
          const w = d.widgets.find(x => x.instanceId === instanceId);
          if(!w) return;
          if(axis === 'span') w.span = w.span >= 3 ? 1 : w.span + 1;
          else w.rowSpan = (w.rowSpan || 1) >= 3 ? 1 : (w.rowSpan || 1) + 1;
        });
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch(e){ toast(e.message, 'error'); }
    });
  });

  document.querySelectorAll('[data-duplicate]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const srcInstance = btn.dataset.duplicate;
      try {
        mutate(d => {
          const src = d.widgets.find(x => x.instanceId === srcInstance);
          if(!src) return;
          const maxOrder = Math.max(...d.widgets.map(w => w.order || 0));
          d.widgets.push({
            ...JSON.parse(JSON.stringify(src)),
            instanceId: uid('w'),
            name: src.name + ' (copia)',
            order: maxOrder + 1,
            config: JSON.parse(JSON.stringify(src.config || {}))
          });
        });
        toast('Widget duplicado', 'success');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch(e){
        console.error(e);
        toast('Error al duplicar: ' + e.message, 'error');
      }
    });
  });

  document.querySelectorAll('[data-remove-instance]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const instanceId = btn.dataset.removeInstance;
      if(!confirm('¿Eliminar esta instancia del widget?')) return;
      try {
        mutate(d => { d.widgets = d.widgets.filter(w => w.instanceId !== instanceId); });
        toast('Widget eliminado', 'success');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch(err){ toast('Error: ' + err.message, 'error'); }
    });
  });

  document.querySelectorAll('[data-config]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openWidgetConfig(btn.dataset.config);
    });
  });

  document.querySelectorAll('[data-news-open]').forEach(card => {
    card.addEventListener('click', () => openNewsModal(card.dataset.newsOpen));
  });

  if(isEditMode && !getDB().viewSeasonId) initWidgetResize();

  bindCarouselEvents(document);

  if(!isEditMode) return;

  const grid = document.getElementById('dashGrid');
  if(!grid) return;
  let dragged = null;

  grid.querySelectorAll('.widget-slot').forEach(slot => {
    slot.addEventListener('dragstart', (e) => {
      if(e.target.closest('button')) { e.preventDefault(); return; }
      dragged = slot; slot.classList.add('dragging');
    });
    slot.addEventListener('dragend', () => {
      slot.classList.remove('dragging');
      dragged = null;
      const order = [...grid.querySelectorAll('.widget-slot')].map((el, i) => ({
        instanceId: el.dataset.instance,
        order: i + 1
      }));
      try {
        mutate(d => {
          order.forEach(({ instanceId, order }) => {
            const w = d.widgets.find(x => x.instanceId === instanceId);
            if(w) w.order = order;
          });
        });
        toast('Orden guardado', 'success');
      } catch(e){ /* ignore in view mode */ }
    });
    slot.addEventListener('dragover', e => {
      e.preventDefault();
      if(!dragged || dragged === slot) return;
      const rect = slot.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      grid.insertBefore(dragged, after ? slot.nextSibling : slot);
    });
  });
}

// ============================================================
// CONFIG DE WIDGET
// ============================================================
function openWidgetConfig(instanceId){
  const db = getDB();
  const w = db.widgets.find(x => x.instanceId === instanceId);
  if(!w) return;
  const t = getWidgetType(w.id);
  if(!t?.configurable) return;

  if(db.viewSeasonId) return toast('📖 Estás en modo lectura.', 'error');

  const divisionId = state.divisionId || db.divisions[0]?.id;

  let matchSource = [];
  if(w.id === 'upcoming' || w.id === 'lastResult'){
    matchSource = db.matches.filter(m => m.divisionId === divisionId);
  } else if(w.id === 'playInUpcoming' || w.id === 'playoffUpcoming'){
    const pl = (db.playoffs || []).find(p => p.divisionId === divisionId);
    if(pl && pl.bracket && pl.bracket.rounds){
      pl.bracket.rounds.forEach(r => {
        if(w.id === 'playInUpcoming' && r.id !== 'playIn') return;
        if(w.id === 'playoffUpcoming' && r.id === 'playIn') return;
        r.matches.forEach(m => {
          matchSource.push({
            id: m.id,
            _round: r.name,
            _roundId: r.id,
            teamAId: m.teamA?.teamId,
            teamBId: m.teamB?.teamId,
            _teamAName: m.teamA?.name,
            _teamBName: m.teamB?.name,
            status: m.winnerId ? 'finished' : 'pending'
          });
        });
      });
    }
  }

  matchSource.sort((a, b) => (a.matchday || 0) - (b.matchday || 0));

  const labelFor = (m) => {
    if(m._round) return `${m._round} · ${m._teamAName || 'TBD'} vs ${m._teamBName || 'TBD'}`;
    const A = db.teams.find(x => x.id === m.teamAId)?.name || 'TBD';
    const B = db.teams.find(x => x.id === m.teamBId)?.name || 'TBD';
    const st = m.status === 'finished' ? 'FINAL' : m.status === 'live' ? 'EN JUEGO' : 'PENDIENTE';
    return `J${m.matchday} · ${A} vs ${B} · ${st}`;
  };

  const currentIds = w.config?.itemIds || (w.config?.matchId ? [w.config.matchId] : []);
  const currentInterval = w.config?.interval || 5;

  openModal({
    id: 'widget-config-' + instanceId,
    title: `CONFIGURAR · ${esc(w.name)}`,
    wide: true,
    body: `
      <p class="field-hint" style="margin-bottom:14px">
        Elige hasta 5 partidos para mostrar en el carrusel. Si no eliges ninguno, se usa el comportamiento automático.
      </p>

      <div class="field">
        <label>Intervalo del carrusel (segundos)</label>
        <input class="input" type="number" id="wcfg-interval" min="2" max="60" value="${currentInterval}">
      </div>

      <div class="field">
        <label>Partidos seleccionados (máx. 5)</label>
        <div id="wcfg-list" style="max-height:340px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:8px;padding:8px;background:var(--bg-graphite)">
          ${matchSource.length === 0
            ? '<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px">No hay partidos disponibles</div>'
            : matchSource.map(m => `
                <label class="wcfg-item">
                  <input type="checkbox" data-wcfg-match="${m.id}" ${currentIds.includes(m.id) ? 'checked' : ''}>
                  <span>${esc(labelFor(m))}</span>
                </label>
              `).join('')}
        </div>
        <small class="field-hint" id="wcfg-count">${currentIds.length} de 5 seleccionados</small>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="wcfg-save">GUARDAR</button>
    `,
    onMount: root => {
      const list = root.querySelector('#wcfg-list');
      const counter = root.querySelector('#wcfg-count');

      function refresh(){
        const checked = list.querySelectorAll('[data-wcfg-match]:checked');
        counter.textContent = `${checked.length} de 5 seleccionados`;
        const atLimit = checked.length >= 5;
        list.querySelectorAll('[data-wcfg-match]').forEach(cb => {
          cb.disabled = atLimit && !cb.checked;
        });
      }
      list.querySelectorAll('[data-wcfg-match]').forEach(cb => cb.addEventListener('change', refresh));
      refresh();

      root.querySelector('#wcfg-save').addEventListener('click', () => {
        const itemIds = [...list.querySelectorAll('[data-wcfg-match]:checked')].map(cb => cb.dataset.wcfgMatch);
        const interval = Math.max(2, +root.querySelector('#wcfg-interval').value || 5);
        try {
          mutate(d => {
            const ww = d.widgets.find(x => x.instanceId === instanceId);
            if(!ww) return;
            ww.config = ww.config || {};
            ww.config.itemIds = itemIds;
            ww.config.interval = interval;
            delete ww.config.matchId;
          });
          toast('Widget configurado', 'success');
          closeTopModal();
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        } catch(e){ toast('Error: ' + e.message, 'error'); }
      });
    }
  });
}

// ============================================================
// RESIZE
// ============================================================
function initWidgetResize(){
  document.querySelectorAll('.widget-slot').forEach(slot => {
    if(slot.querySelector('.widget-resize-corner')) return;
    const corner = document.createElement('div');
    corner.className = 'widget-resize-corner';
    corner.title = 'Arrastra para redimensionar';
    slot.appendChild(corner);
    corner.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const instanceId = slot.dataset.instance;
      const startX = e.clientX, startY = e.clientY;
      const colWidth = 340, rowHeight = 200;
      const db = getDB();
      const w = db.widgets.find(x => x.instanceId === instanceId);
      if(!w) return;
      const startSpan = w.span, startRow = w.rowSpan || 1;

      const onMove = (ev) => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        const newSpan = Math.max(1, Math.min(3, startSpan + Math.round(dx / colWidth)));
        const newRow  = Math.max(1, Math.min(3, startRow + Math.round(dy / rowHeight)));
        slot.style.gridColumn = `span ${newSpan}`;
        slot.style.gridRow = `span ${newRow}`;
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const span = parseInt(slot.style.gridColumn.match(/span (\d+)/)?.[1] || startSpan);
        const rowSpan = parseInt(slot.style.gridRow.match(/span (\d+)/)?.[1] || startRow);
        try {
          mutate(d => {
            const ww = d.widgets.find(x => x.instanceId === instanceId);
            if(ww){ ww.span = span; ww.rowSpan = rowSpan; }
          });
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        } catch(e){ /* ignore */ }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

// ============================================================
// MODAL DE NOTICIA
// ============================================================
function openNewsModal(newsId){
  const db = getDB();
  const n = db.news.find(x => x.id === newsId);
  if(!n) return;

  const body = (n.blocks && n.blocks.length > 0)
    ? renderBlocksHTML(n.blocks, db)
    : `<div class="news-modal-body">${esc((n.body || '')).replace(/\n/g,'<br>')}</div>`;

  openModal({
    id: 'news-view-' + newsId,
    title: n.category || 'NOTICIA',
    wide: true,
    body: `
      <div class="news-modal ${n.goldenFrame ? 'golden-frame' : ''}">
        ${n.banner ? `<div class="news-modal-banner"><img src="${n.banner}" alt=""></div>` : ''}
        <h2 class="news-modal-title">${n.goldenFrame ? '🏆 ' : ''}${esc(n.title)}</h2>
        <div class="news-modal-meta">
          <span>${n.date || ''}</span>
          ${n.category ? `<span class="chip">${esc(n.category)}</span>` : ''}
          ${n.pinned ? `<span class="chip chip-gold">📌 FIJADA</span>` : ''}
        </div>
        ${body}
      </div>
    `,
    footer: `<button class="btn btn-ghost" data-close>CERRAR</button>`
  });
}

export function renderBlocksHTML(blocks, db){
  return blocks.map(b => {
    switch(b.type){
      case 'text':
        return `<div class="news-block news-block-text">${esc(b.content || '').replace(/\n/g,'<br>')}</div>`;
      case 'title':
        return `<h3 class="news-block news-block-title">${esc(b.content || '')}</h3>`;
      case 'image':
        return b.src ? `<div class="news-block news-block-image"><img src="${b.src}" alt="${esc(b.alt||'')}"></div>` : '';
      case 'team-logo': {
        const t = db.teams.find(x => x.id === b.teamId);
        if(!t) return '';
        return `<div class="news-block news-block-team">
          ${t.logo ? `<img src="${t.logo}" alt="">` : '<span class="news-block-team-fallback">◆</span>'}
          <div>
            <div class="news-block-team-name">${esc(t.name)}</div>
            ${b.caption ? `<div class="news-block-team-cap">${esc(b.caption)}</div>` : ''}
          </div>
        </div>`;
      }
      case 'player-card': {
        const p = db.players.find(x => x.id === b.playerId);
        if(!p) return '';
        const team = db.teams.find(t => (t.roster||[]).some(r => r.playerId === p.id));
        return `<div class="news-block news-block-player">
          ${p.profilePicture
            ? `<img class="news-block-player-avatar" src="${p.profilePicture}" alt="">`
            : `<div class="news-block-player-avatar news-block-player-avatar-empty">${(p.name||'?').slice(0,2).toUpperCase()}</div>`}
          <div>
            <div class="news-block-player-name">${esc(p.name)}</div>
            <div class="news-block-player-meta">
              ${team ? esc(team.name) : 'Agente libre'}
              ${p.rank ? ` · ${esc(p.rank)}${p.rank!=='SSL' && p.rankDivision ? ' ' + p.rankDivision : ''}` : ''}
            </div>
            ${b.caption ? `<div class="news-block-player-cap">${esc(b.caption)}</div>` : ''}
          </div>
        </div>`;
      }
      case 'divider':
        return `<div class="news-block news-block-divider"><hr></div>`;
      default: return '';
    }
  }).join('');
}

// ============================================================
// HELPERS DE CARRUSEL INLINE
// ============================================================
function buildCarouselHTML(items, slideHTMLs, instanceId, interval){
  if(items.length === 0) return '';
  if(items.length === 1){
    return `<div class="wc" data-instance="${instanceId}"><div class="wc-track">${slideHTMLs[0]}</div></div>`;
  }
  const dotsHTML = items.map((_, i) => `<button class="wc-dot ${i === 0 ? 'active' : ''}" data-carousel-dot="${i}" data-carousel-instance="${instanceId}"></button>`).join('');
  return `
    <div class="wc" data-instance="${instanceId}" data-interval="${interval}">
      <div class="wc-viewport">
        <div class="wc-track">${slideHTMLs.join('')}</div>
      </div>
      <button class="wc-nav wc-prev" data-carousel-prev="${instanceId}" aria-label="Anterior">‹</button>
      <button class="wc-nav wc-next" data-carousel-next="${instanceId}" aria-label="Siguiente">›</button>
      <div class="wc-dots">${dotsHTML}</div>
    </div>
  `;
}

// ============================================================
// WIDGETS CON CARRUSEL
// ============================================================
function widgetUpcoming(w, division){
  const db = getDB();
  const itemIds = w.config?.itemIds || (w.config?.matchId ? [w.config.matchId] : []);

  let matches;
  if(itemIds.length > 0){
    matches = itemIds.map(id => db.matches.find(m => m.id === id)).filter(Boolean);
  } else {
    const auto = nextUpcoming(division.id);
    matches = auto ? [auto] : [];
  }
  if(matches.length === 0) return cardHero('PRÓXIMO PARTIDO', '<div style="color:var(--muted);padding:20px;text-align:center">Sin partidos pendientes</div>');

  const activeSeasonId = (db.seasons.find(s => s.active) || db.seasons[0])?.id;
  const standings = computeStandings(division.id, activeSeasonId);
  const posOf = id => standings.find(r => r.teamId === id)?.pos || '—';
  const ptsOf = id => standings.find(r => r.teamId === id)?.PTS || 0;

  const slides = matches.map(m => {
    const A = db.teams.find(t => t.id === m.teamAId) || { name: 'TBD' };
    const B = db.teams.find(t => t.id === m.teamBId) || { name: 'TBD' };
    return `
      <div class="wc-slide">
        <div class="hero">
          <div class="hero-top">
            <span class="chip chip-accent">JORNADA ${m.matchday}</span>
            <span class="chip">${esc(division.name)}</span>
          </div>
          <div class="hero-teams">
            <div class="hero-team">
              <div class="logo">${logo(A)}</div>
              <div class="name">${esc(A.name)}</div>
              <div class="meta">${posOf(A.id)}º · ${ptsOf(A.id)} PTS</div>
            </div>
            <div class="hero-vs">VS</div>
            <div class="hero-team">
              <div class="logo">${logo(B)}</div>
              <div class="name">${esc(B.name)}</div>
              <div class="meta">${posOf(B.id)}º · ${ptsOf(B.id)} PTS</div>
            </div>
          </div>
          <div class="hero-meta">
            <div style="color:var(--silver-light);letter-spacing:.14em;font-size:12px;margin-bottom:8px">
              ${m.date || 'FECHA POR CONFIRMAR'} ${m.time ? '· ' + m.time : ''}
            </div>
            <span class="chip chip-accent">${m.format}</span>
          </div>
          <div class="hero-footer">
            <button class="btn" data-route="matches">VER DETALLE DEL PARTIDO →</button>
          </div>
        </div>
      </div>
    `;
  });

  return cardHero('PRÓXIMO PARTIDO', buildCarouselHTML(matches, slides, w.instanceId, w.config?.interval || 5));
}

function widgetLastResult(w, division){
  const db = getDB();
  const itemIds = w.config?.itemIds || (w.config?.matchId ? [w.config.matchId] : []);

  let matches;
  if(itemIds.length > 0){
    matches = itemIds.map(id => db.matches.find(m => m.id === id)).filter(Boolean);
  } else {
    const auto = lastFinished(division.id);
    matches = auto ? [auto] : [];
  }
  if(matches.length === 0) return cardHero('ÚLTIMO RESULTADO', '<div style="color:var(--muted);padding:20px;text-align:center">Sin resultados</div>');

  const slides = matches.map(m => {
    const A = db.teams.find(t => t.id === m.teamAId) || { name: 'TBD', logo: '' };
    const B = db.teams.find(t => t.id === m.teamBId) || { name: 'TBD', logo: '' };
    const sA = m.games.filter(g => g.scoreA > g.scoreB).length;
    const sB = m.games.filter(g => g.scoreB > g.scoreA).length;
    return `
      <div class="wc-slide">
        <div>
          <div class="last-result">
            <div class="last-result-team">
              ${A.logo ? `<img src="${A.logo}" class="last-result-logo">` : ''}
              <div class="last-result-name">${esc(A.name)}</div>
            </div>
            <div class="last-result-score">${sA} – ${sB}</div>
            <div class="last-result-team">
              ${B.logo ? `<img src="${B.logo}" class="last-result-logo">` : ''}
              <div class="last-result-name">${esc(B.name)}</div>
            </div>
          </div>
          <div class="widget-footnote" style="text-align:center">SERIE ${m.format} · JORNADA ${m.matchday}</div>
        </div>
      </div>
    `;
  });

  return cardHero('ÚLTIMO RESULTADO', buildCarouselHTML(matches, slides, w.instanceId, w.config?.interval || 5));
}

function widgetPlayInUpcoming(w, division){
  const db = getDB();
  const pl = (db.playoffs || []).find(p => p.divisionId === division.id);
  if(!pl || !pl.bracket || !pl.bracket.rounds){
    return cardHero('PRÓXIMO PLAY-IN', '<div style="color:var(--muted);font-size:12px;padding:20px;text-align:center">Bracket no generado</div>');
  }

  const round = pl.bracket.rounds.find(r => r.id === 'playIn');
  if(!round) return cardHero('PRÓXIMO PLAY-IN', '<div style="color:var(--muted);font-size:12px;padding:20px;text-align:center">Sin ronda de Play-In</div>');

  const pending = round.matches.filter(m => !m.winnerId && m.teamA && m.teamB);
  const itemIds = w.config?.itemIds || [];
  let matches;
  if(itemIds.length > 0){
    matches = itemIds.map(id => round.matches.find(m => m.id === id)).filter(Boolean);
  } else {
    matches = pending;
  }
  if(matches.length === 0) return cardHero('PRÓXIMO PLAY-IN', '<div style="color:var(--muted);font-size:12px;padding:20px;text-align:center">Sin partidos pendientes</div>');

  const slides = matches.map(m => `<div class="wc-slide">${renderPlayoffMatchHero(m, round, division)}</div>`);

  return cardHero('PRÓXIMO PLAY-IN', buildCarouselHTML(matches, slides, w.instanceId, w.config?.interval || 5));
}

function widgetPlayoffUpcoming(w, division){
  const db = getDB();
  const pl = (db.playoffs || []).find(p => p.divisionId === division.id);
  if(!pl || !pl.bracket || !pl.bracket.rounds){
    return cardHero('PRÓXIMO PLAY-OFF', '<div style="color:var(--muted);font-size:12px;padding:20px;text-align:center">Bracket no generado</div>');
  }

  const allMatches = [];
  pl.bracket.rounds.forEach(r => {
    if(r.id === 'playIn') return;
    r.matches.forEach(m => {
      allMatches.push({ match: m, round: r });
    });
  });

  const itemIds = w.config?.itemIds || [];
  let items;
  if(itemIds.length > 0){
    items = itemIds.map(id => allMatches.find(x => x.match.id === id)).filter(Boolean);
  } else {
    items = allMatches.filter(x => !x.match.winnerId && x.match.teamA && x.match.teamB);
  }
  if(items.length === 0) return cardHero('PRÓXIMO PLAY-OFF', '<div style="color:var(--muted);font-size:12px;padding:20px;text-align:center">Sin partidos pendientes</div>');

  const slides = items.map(item => `<div class="wc-slide">${renderPlayoffMatchHero(item.match, item.round, division)}</div>`);

  return cardHero('PRÓXIMO PLAY-OFF', buildCarouselHTML(items, slides, w.instanceId, w.config?.interval || 5));
}

function renderPlayoffMatchHero(m, round, division){
  const A = m.teamA || { name: 'TBD' };
  const B = m.teamB || { name: 'TBD' };
  const format = round.id === 'final'
    ? (division.config.finalFormat || 'BO7')
    : round.id === 'semi'
      ? (division.config.semiFormat || 'BO5')
      : (division.config.playInFormat || 'BO5');
  return `
    <div class="hero">
      <div class="hero-top">
        <span class="chip">${esc(division.name)}</span>
      </div>
      <div class="hero-round-badge">
        <span class="chip chip-round">${esc(round.name)}</span>
      </div>
      <div class="hero-teams">
        <div class="hero-team">
          <div class="logo">${logo(A)}</div>
          <div class="name">${esc(A.name)}</div>
        </div>
        <div class="hero-vs">VS</div>
        <div class="hero-team">
          <div class="logo">${logo(B)}</div>
          <div class="name">${esc(B.name)}</div>
        </div>
      </div>
      <div class="hero-meta">
        <span class="chip chip-accent">${format}</span>
      </div>
    </div>
  `;
}

function widgetPlayoffBracket(division){
  const db = getDB();
  const pl = (db.playoffs || []).find(p => p.divisionId === division.id);
  if(!pl || !pl.bracket || !pl.bracket.rounds){
    return card('LLAVE PLAY-OFFS', '<div style="color:var(--muted);font-size:12px">Bracket no generado</div>');
  }

  const rounds = pl.bracket.rounds;

  return card('LLAVE PLAY-OFFS', `
    <div class="mini-bracket">
      ${rounds.map(r => `
        <div class="mini-bracket-col">
          <div class="mini-bracket-round">${esc(r.name)}</div>
          <div class="mini-bracket-matches">
            ${r.matches.map(m => `
              <div class="mini-bracket-match">
                <div class="mini-bracket-team ${m.winnerId && m.teamA?.teamId === m.winnerId ? 'winner' : ''}">
                  ${esc(m.teamA?.name || 'TBD')}
                </div>
                <div class="mini-bracket-team ${m.winnerId && m.teamB?.teamId === m.winnerId ? 'winner' : ''}">
                  ${esc(m.teamB?.name || 'TBD')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `);
}

// ============================================================
// OTROS WIDGETS
// ============================================================
function widgetStandings(rows, division){
  const zones = division?.config?.zones?.zones || [];
  const typeLabels = { champion:'Campeón', playoff:'Play-Offs', playin:'Play-In', promotion:'Ascenso', relegation:'Descenso' };
  const typeColors = { champion:'#E6C476', playoff:'#4ade80', playin:'#6FA8FF', promotion:'#facc15', relegation:'#f87171' };
  const seen = new Set();
  const legendItems = [];
  zones.forEach(z => {
    if(seen.has(z.type) || z.type === 'none') return;
    seen.add(z.type);
    legendItems.push({ label: typeLabels[z.type] || z.type, color: z.color || typeColors[z.type] || '#8D929A' });
  });
  return card('TABLA GENERAL', `
    <div class="table-wrap widget-scroll">
      <table class="ztable">
        <thead><tr><th>#</th><th>EQUIPO</th><th class="num">PTS</th><th class="num">SG</th><th class="num">DP</th></tr></thead>
        <tbody>
        ${rows.map(r => `
          <tr class="${r.pos === 1 ? 'rank-1' : ''}" style="border-left:4px solid ${r.zoneColor || 'transparent'}">
            <td><span class="pos-num ${r.pos <= 3 ? 'top' : ''}">${r.pos}</span></td>
            <td><div class="team-cell">${r.logo ? `<img src="${r.logo}" class="logo-sm">` : `<div class="logo-sm"></div>`}<span class="team-cell-name">${esc(r.name)}</span></div></td>
            <td class="num">${r.PTS}</td>
            <td class="num">${r.SG}</td>
            <td class="num">${r.DP >= 0 ? '+' : ''}${r.DP}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${legendItems.length > 0 ? `<div class="zone-legend">${legendItems.map(u => `<div class="zone-legend-item"><span class="zone-legend-dot" style="background:${u.color};color:${u.color}"></span>${u.label}</div>`).join('')}</div>` : ''}
    <div class="widget-footnote">PTS · Puntos | SG · Series ganadas | DP · Diferencia</div>
  `);
}

function widgetTopPlayers(players){
  return card('TOP PLAYERS', `
    <div class="table-wrap widget-scroll">
      <table class="ztable">
        <thead><tr><th>#</th><th>JUGADOR</th><th>EQUIPO</th><th class="num">PIG</th></tr></thead>
        <tbody>
        ${players.map((p, i) => `<tr><td><span class="pos-num ${i === 0 ? 'top' : ''}">${i+1}</span></td><td>${esc(p.name)}</td><td style="color:var(--muted)">${esc(p.teamName)}</td><td class="num" style="color:${i === 0 ? 'var(--gold)' : 'var(--silver-light)'};font-weight:600">${p.pig.toFixed(1)}</td></tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--muted)">Sin datos</td></tr>'}
        </tbody>
      </table>
    </div>
  `);
}

function widgetNextMatchdays(divisionId, limit){
  const db = getDB();
  const next = db.matches.filter(m => m.divisionId === divisionId && m.status !== 'finished').sort((a, b) => a.matchday - b.matchday).slice(0, limit);
  return card('PRÓXIMAS JORNADAS', `
    <div class="widget-scroll">
      ${next.map(m => {
        const A = db.teams.find(t => t.id === m.teamAId)?.name || 'TBD';
        const B = db.teams.find(t => t.id === m.teamBId)?.name || 'TBD';
        return `<div class="next-match-row"><span class="next-match-day">J${m.matchday}</span><span class="next-match-teams">${esc(A)} <span style="color:var(--muted)">vs</span> ${esc(B)}</span><span class="next-match-date">${m.date||'—'}</span></div>`;
      }).join('') || '<div style="color:var(--muted)">Sin partidos</div>'}
    </div>
  `);
}

function widgetBallonDor(top3){
  return `<div class="card">
    <div class="card-header"><div class="card-title" style="color:var(--gold)"><span class="dot" style="color:var(--gold)">◆</span>ZENITH BALLON D'OR</div><span class="card-sub">VER RANKING →</span></div>
    <div class="bdor-mini-grid">
      ${top3.slice(0,3).map((p, i) => `<div class="bdor-mini ${i === 0 ? 'bdor-mini-gold' : ''}"><div class="bdor-mini-rank">${i+1}°</div><div class="bdor-mini-name">${esc(p.name)}</div><div class="bdor-mini-team">${esc(p.teamName)}</div><div class="bdor-mini-pig">${p.pig.toFixed(1)}</div></div>`).join('') || '<div style="color:var(--muted);grid-column:1/-1;text-align:center">Sin datos</div>'}
    </div>
  </div>`;
}

function widgetNews(news){
  const sorted = [...news].sort((a, b) => {
    if(a.pinned && !b.pinned) return -1;
    if(!a.pinned && b.pinned) return 1;
    return (b.date || '').localeCompare(a.date || '');
  });
  return card('NOTICIAS', `
    <div class="news-grid">
      ${sorted.slice(0,4).map(n => `<div class="news-card ${n.pinned ? 'pinned' : ''} ${n.goldenFrame ? 'golden' : ''}" data-news-open="${n.id}"><div class="news-card-banner">${n.banner ? `<img src="${n.banner}">` : '<span class="news-banner-fallback">BANNER</span>'}</div><div class="news-card-body"><div class="news-card-title">${n.pinned ? '📌 ' : ''}${esc(n.title)}</div><div class="news-card-excerpt">${esc((n.body||'').slice(0,80))}${(n.body||'').length>80?'…':''}</div><div class="news-card-foot"><span class="news-card-date">${n.date||''}</span><span class="chip">${esc(n.category||'GENERAL')}</span></div></div></div>`).join('') || '<div style="color:var(--muted);grid-column:1/-1;text-align:center">Sin noticias</div>'}
    </div>
  `);
}

function widgetMvpCarousel(players){
  return card('MVP DEL MOMENTO', `
    <div class="mvp-carousel">
      ${players.slice(0,5).map((p, i) => `<div class="mvp-card"><div class="mvp-card-rank">${i+1}</div><div class="mvp-card-name">${esc(p.name)}</div><div class="mvp-card-team">${esc(p.teamName)}</div><div class="mvp-card-pig">${p.pig.toFixed(1)}</div></div>`).join('') || '<div style="color:var(--muted);padding:20px;text-align:center">Sin datos</div>'}
    </div>
  `);
}

function widgetTopScorers(players){
  const sorted = [...players].sort((a, b) => b.goals - a.goals).slice(0,5);
  return card('MÁXIMOS GOLEADORES', `<div class="widget-scroll">${sorted.map((p, i) => `<div class="scorer-row"><span class="scorer-rank">${i+1}</span><span class="scorer-name">${esc(p.name)}</span><span class="scorer-goals">${p.goals}</span></div>`).join('') || '<div style="color:var(--muted)">Sin datos</div>'}</div>`);
}

function widgetTopAssists(players){
  const sorted = [...players].sort((a, b) => b.assists - a.assists).slice(0,5);
  return card('MÁXIMOS ASISTENTES', `<div class="widget-scroll">${sorted.map((p, i) => `<div class="scorer-row"><span class="scorer-rank">${i+1}</span><span class="scorer-name">${esc(p.name)}</span><span class="scorer-goals" style="color:var(--accent)">${p.assists}</span></div>`).join('') || '<div style="color:var(--muted)">Sin datos</div>'}</div>`);
}

function widgetTopSaves(players){
  const sorted = [...players].sort((a, b) => b.saves - a.saves).slice(0,5);
  return card('MEJORES PORTEROS', `<div class="widget-scroll">${sorted.map((p, i) => `<div class="scorer-row"><span class="scorer-rank">${i+1}</span><span class="scorer-name">${esc(p.name)}</span><span class="scorer-goals" style="color:var(--gold)">${p.saves}</span></div>`).join('') || '<div style="color:var(--muted)">Sin datos</div>'}</div>`);
}

function widgetTopEfficiency(players){
  const sorted = [...players].filter(p => p.games >= 3).sort((a, b) => b.efficiency - a.efficiency).slice(0,5);
  return card('MEJOR EFICIENCIA', `<div class="widget-scroll">${sorted.map((p, i) => `<div class="scorer-row"><span class="scorer-rank">${i+1}</span><span class="scorer-name">${esc(p.name)}</span><span class="scorer-goals" style="color:var(--success)">${p.efficiency}%</span></div>`).join('') || '<div style="color:var(--muted)">Sin datos</div>'}</div>`);
}

function widgetPlayerSpotlight(players, db){
  const top = [...players].sort((a, b) => b.pig - a.pig)[0];
  if(!top) return card('JUGADOR DESTACADO', '<div style="color:var(--muted)">Sin datos</div>');
  const playerData = db.players.find(p => p.id === top.id) || {};
  const flag = playerData.nationalityCode ? getNationFlag(playerData.nationalityCode) : '';
  const avatar = playerData.profilePicture
    ? `<img src="${playerData.profilePicture}" class="spotlight-avatar">`
    : `<div class="spotlight-avatar spotlight-avatar-empty">${(top.name||'?').slice(0,2).toUpperCase()}</div>`;
  return card('JUGADOR DESTACADO', `
    <div class="spotlight-body">
      ${avatar}
      <div class="spotlight-name">${esc(top.name)} ${flag}</div>
      <div class="spotlight-team">${esc(top.teamName)}</div>
      <div class="spotlight-pig">${top.pig.toFixed(1)}</div>
      <div class="spotlight-pig-label">PIG ACTUAL</div>
      <div class="spotlight-stats">
        <div><span>${top.goals}</span><small>Goles</small></div>
        <div><span>${top.assists}</span><small>Asist.</small></div>
        <div><span>${top.saves}</span><small>Salv.</small></div>
      </div>
    </div>
  `);
}

// ============================================================
// HELPERS
// ============================================================
function card(title, body){
  return `<div class="card"><div class="card-header"><div class="card-title"><span class="dot">◆</span>${title}</div></div>${body}</div>`;
}

function cardHero(title, body){
  return `<div class="card card-hero">
    <div class="card-header"><div class="card-title"><span class="dot">◆</span>${title}</div></div>
    ${body}
  </div>`;
}

function logo(team){
  return team.logo
    ? `<img src="${team.logo}" class="hero-team-logo-img">`
    : `<span style="color:var(--accent);font-size:22px">◆</span>`;
}
function nextUpcoming(divisionId){
  const db = getDB();
  return db.matches.filter(m => m.divisionId === divisionId && m.status !== 'finished').sort((a, b) => a.matchday - b.matchday)[0];
}
function lastFinished(divisionId){
  const db = getDB();
  return [...db.matches].reverse().find(m => m.divisionId === divisionId && m.status === 'finished');
}
function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}