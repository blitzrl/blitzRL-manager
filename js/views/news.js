import { getDB, mutate } from '../services/storage.js';
import { uid } from '../data/database.js';
import { openModal, toast, closeTopModal } from '../services/ui.js';
import { logChange } from '../services/history.js';
import { renderBlocksHTML } from './dashboard.js';

// ============================================================
// UTILIDADES
// ============================================================
function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

function compressImage(file, maxW, maxH){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const ratio = Math.min(maxW / width, maxH / height, 1);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/webp', 0.85));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function isViewMode(){
  return !!getDB().viewSeasonId;
}

const KNOWN_CATEGORIES = ['GENERAL','COMPETICIÓN','STATS','TRANSFERENCIAS'];

const BLOCK_TYPES = [
  { id: 'text',         label: 'Texto',            icon: '📝' },
  { id: 'title',        label: 'Título',           icon: '🔤' },
  { id: 'image',        label: 'Imagen',           icon: '🖼' },
  { id: 'team-logo',    label: 'Logo de equipo',   icon: '🛡' },
  { id: 'player-card',  label: 'Card de jugador',  icon: '👤' },
  { id: 'divider',      label: 'Divisor',          icon: '➖' }
];

// ============================================================
// VISTA PRINCIPAL
// ============================================================
export function newsView(){
  const db = getDB();
  const viewMode = !!db.viewSeasonId;

  const sorted = [...db.news].sort((a,b)=>{
    if(a.pinned && !b.pinned) return -1;
    if(!a.pinned && b.pinned) return 1;
    return (b.date || '').localeCompare(a.date || '');
  });

  return `
    <div class="page-head">
      <h1 class="page-title">NOTICIAS</h1>
      ${!viewMode ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" id="btnNewAdvancedNews">✨ CREAR NOTICIA AVANZADA</button>
          <button class="btn" id="btnNewNews">+ NOTICIA SIMPLE</button>
        </div>
      ` : `
        <span class="chip chip-readonly">📖 MODO LECTURA</span>
      `}
    </div>
    <div class="news-list-grid">
      ${sorted.map(n => `
        <div class="news-list-card ${n.pinned ? 'pinned' : ''} ${n.goldenFrame ? 'golden' : ''}" data-news-open="${n.id}">
          ${n.banner ? `<div class="news-list-banner"><img src="${n.banner}"></div>` : ''}
          <div class="news-list-body">
            <div class="news-list-cat">
              ${n.pinned ? '📌 ' : ''}${esc(n.category||'GENERAL')} · ${n.date||''}
              ${n.goldenFrame ? ' · 🏆 DESTACADA' : ''}
            </div>
            <div class="news-list-title">${esc(n.title)}</div>
            <div class="news-list-excerpt">${esc((n.body||'').slice(0,140))}${(n.body||'').length>140?'…':''}</div>
            ${!viewMode ? `
              <div class="news-list-actions">
                <button class="btn btn-sm" data-edit-news="${n.id}">✏ EDITAR</button>
                <button class="btn btn-sm btn-danger" data-del-news="${n.id}">🗑 ELIMINAR</button>
              </div>
            ` : ''}
          </div>
        </div>`).join('') || '<div class="card">Sin noticias</div>'}
    </div>
  `;
}

// ============================================================
// BINDING
// ============================================================
export function bindNewsEvents(){
  document.getElementById('btnNewNews')?.addEventListener('click', ()=>{
    if(isViewMode()) return toast('📖 Estás en modo lectura.', 'error');
    openNewsForm();
  });
  document.getElementById('btnNewAdvancedNews')?.addEventListener('click', ()=>{
    if(isViewMode()) return toast('📖 Estás en modo lectura.', 'error');
    openAdvancedNewsEditor();
  });

  document.querySelectorAll('[data-edit-news]').forEach(b => {
    b.addEventListener('click', (e)=>{
      e.stopPropagation();
      if(isViewMode()) return toast('📖 Estás en modo lectura.', 'error');
      openAdvancedNewsEditor(b.dataset.editNews);
    });
  });

  document.querySelectorAll('[data-del-news]').forEach(b => b.addEventListener('click', (e)=>{
    e.stopPropagation();
    if(isViewMode()) return toast('📖 Estás en modo lectura.', 'error');
    if(!confirm('¿Eliminar noticia?')) return;
    const id = b.dataset.delNews;
    const title = getDB().news.find(n=>n.id===id)?.title;
    try {
      mutate(d=>{ d.news = d.news.filter(n=>n.id!==id); });
      logChange('delete','news', id, `Noticia "${title}" eliminada`);
      toast('Noticia eliminada','success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch(e){
      toast('Error: ' + e.message, 'error');
    }
  }));

  document.querySelectorAll('[data-news-open]').forEach(card => {
    card.addEventListener('click', () => {
      if(event.target.closest('button')) return;
      openNewsModal(card.dataset.newsOpen);
    });
  });
}

// ============================================================
// MODAL DE VISTA
// ============================================================
function openNewsModal(id){
  const db = getDB();
  const n = db.news.find(x => x.id === id);
  if(!n) return;

  const body = (n.blocks && n.blocks.length > 0)
    ? renderBlocksHTML(n.blocks, db)
    : `<div class="news-modal-body">${esc((n.body || '')).replace(/\n/g,'<br>')}</div>`;

  openModal({
    id: 'news-view-' + id,
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

// ============================================================
// NOTICIA SIMPLE
// ============================================================
function openNewsForm(){
  openModal({
    id: 'news-form',
    title:'NUEVA NOTICIA',
    wide: true,
    body:`
      <div class="field">
        <label>Banner de la noticia</label>
        <div class="dropzone" id="newsBannerDrop">
          <span class="dropzone-hint">Arrastra o haz click para subir una imagen (recomendado 1200×500)</span>
        </div>
        <input type="file" id="newsBannerInput" accept="image/*" hidden>
      </div>
      <div class="field"><label>Título</label><input class="input" id="nTitle"></div>
      <div class="row">
        <div class="field">
          <label>Categoría</label>
          <select class="select" id="nCat">
            <option>GENERAL</option><option>COMPETICIÓN</option>
            <option>STATS</option><option>TRANSFERENCIAS</option>
          </select>
        </div>
        <div class="field">
          <label>Fecha</label>
          <input class="input" type="date" id="nDate" value="${new Date().toISOString().slice(0,10)}">
        </div>
      </div>
      <div class="field"><label>Contenido</label><textarea class="textarea" id="nBody" rows="8"></textarea></div>
      <div class="field"><label><input type="checkbox" id="nFeat"> Destacar noticia</label></div>
    `,
    footer:`<button class="btn btn-ghost" data-close>CANCELAR</button><button class="btn btn-primary" id="saveNews">PUBLICAR</button>`,
    onMount:(root)=>{
      let bannerData = '';
      const drop = root.querySelector('#newsBannerDrop');
      const input = root.querySelector('#newsBannerInput');
      drop.addEventListener('click', ()=>input.click());
      drop.addEventListener('dragover', e=>{e.preventDefault(); drop.classList.add('dragover');});
      drop.addEventListener('dragleave', ()=>drop.classList.remove('dragover'));
      drop.addEventListener('drop', e=>{e.preventDefault(); drop.classList.remove('dragover'); handle(e.dataTransfer.files[0]);});
      input.addEventListener('change', ()=>handle(input.files[0]));
      async function handle(f){
        if(!f) return;
        try{
          const res = await compressImage(f, 1200, 500);
          bannerData = res;
          drop.innerHTML = `<img src="${res}" style="max-height:160px;border-radius:6px">`;
        }catch(e){ toast('Error procesando imagen','error'); }
      }

      root.querySelector('#saveNews').addEventListener('click', ()=>{
        const title = root.querySelector('#nTitle').value.trim();
        if(!title) return toast('Falta el título','error');
        const id = uid('news');
        try {
          mutate(d=>d.news.push({
            id, title,
            body: root.querySelector('#nBody').value,
            category: root.querySelector('#nCat').value,
            featured: root.querySelector('#nFeat').checked,
            banner: bannerData,
            date: root.querySelector('#nDate').value || new Date().toISOString().slice(0,10),
            published: true,
            blocks: [],
            pinned: false,
            goldenFrame: false,
            customCategory: ''
          }));
          logChange('create','news', id, `Noticia "${title}" publicada`);
          toast('Noticia publicada','success');
          closeTopModal();
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        } catch(e){
          toast('Error: ' + e.message, 'error');
        }
      });
    }
  });
}

// ============================================================
// NOTICIA AVANZADA
// ============================================================
function openAdvancedNewsEditor(newsId = null){
  const db = getDB();
  const existing = newsId ? db.news.find(n => n.id === newsId) : null;

  let initialCategory = 'GENERAL';
  let initialCustomCategory = '';
  if(existing){
    if(KNOWN_CATEGORIES.includes(existing.category)){
      initialCategory = existing.category;
    } else if(existing.category){
      initialCategory = '__custom';
      initialCustomCategory = existing.customCategory || existing.category;
    }
  }

  const state = {
    id: existing?.id || null,
    title: existing?.title || '',
    category: initialCategory,
    customCategory: initialCustomCategory,
    banner: existing?.banner || '',
    date: existing?.date || new Date().toISOString().slice(0,10),
    goldenFrame: !!existing?.goldenFrame,
    pinned: !!existing?.pinned,
    featured: !!existing?.featured,
    blocks: existing ? JSON.parse(JSON.stringify(existing.blocks || [])) : []
  };

  // ==========================================================
  // RENDER PRINCIPAL
  // ==========================================================
  function renderEditor(container){
    const isCustomCat = state.category === '__custom';

    container.innerHTML = `
      <div class="adv-editor">
        <div class="card adv-meta-card">
          <div class="card-header"><div class="card-title"><span class="dot">◆</span>DATOS DE LA NOTICIA</div></div>

          <div class="field">
            <label>Banner</label>
            <div class="dropzone" id="advBannerDrop">
              ${state.banner
                ? `<img src="${state.banner}" style="max-height:160px;border-radius:6px">`
                : 'Arrastra o haz click para subir banner (1200×500)'}
            </div>
            <input type="file" id="advBannerInput" accept="image/*" hidden>
          </div>

          <div class="field">
            <label>Título</label>
            <input class="input" id="advTitle" value="${esc(state.title)}" placeholder="Titular de la noticia">
          </div>

          <div class="row">
            <div class="field">
              <label>Categoría</label>
              <select class="select" id="advCat">
                ${KNOWN_CATEGORIES.map(c => `<option value="${c}" ${!isCustomCat && state.category===c ? 'selected':''}>${c}</option>`).join('')}
                <option value="__custom" ${isCustomCat ? 'selected':''}>— Personalizada —</option>
              </select>
            </div>
            <div class="field">
              <label>Fecha</label>
              <input class="input" type="date" id="advDate" value="${state.date}">
            </div>
          </div>

          <div class="field" id="advCustomCatWrap" style="${isCustomCat ? '' : 'display:none'}">
            <label>Categoría personalizada</label>
            <input class="input" id="advCustomCat" value="${esc(state.customCategory)}" placeholder="Ej: RUMORES">
          </div>

          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:6px">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--silver-light);cursor:pointer">
              <input type="checkbox" id="advPinned" ${state.pinned?'checked':''}>
              📌 Fijar noticia (aparece primero)
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--silver-light);cursor:pointer">
              <input type="checkbox" id="advGolden" ${state.goldenFrame?'checked':''}>
              🏆 Marco dorado (destacar)
            </label>
          </div>
        </div>

        <div class="card adv-blocks-card">
          <div class="card-header">
            <div class="card-title"><span class="dot">◆</span>BLOQUES DE CONTENIDO</div>
            <button class="btn btn-sm btn-primary" id="advAddBlock" type="button">+ AÑADIR BLOQUE</button>
          </div>
          <p class="field-hint" style="margin-bottom:12px">
            Arma tu noticia combinando bloques. Usa ⬆ ⬇ para reordenar y 🗑 para eliminar.
          </p>
          <div id="advBlocksList"></div>
        </div>

        <div class="card adv-preview-card">
          <div class="card-header"><div class="card-title"><span class="dot">◆</span>PREVIEW EN VIVO</div></div>
          <div id="advPreview" class="adv-preview"></div>
        </div>
      </div>
    `;

    bindMeta(container);
    renderBlocksList(container);
    renderPreview(container);
  }

  function bindMeta(container){
    const titleInp = container.querySelector('#advTitle');
    titleInp?.addEventListener('input', ()=> {
      state.title = titleInp.value;
      renderPreview(container);
    });

    const dateInp = container.querySelector('#advDate');
    dateInp?.addEventListener('input', ()=> { state.date = dateInp.value; });

    const catSel = container.querySelector('#advCat');
    const customWrap = container.querySelector('#advCustomCatWrap');
    const customInp = container.querySelector('#advCustomCat');

    catSel?.addEventListener('change', ()=>{
      if(catSel.value === '__custom'){
        state.category = '__custom';
        if(customWrap) customWrap.style.display = '';
        customInp?.focus();
      } else {
        state.category = catSel.value;
        state.customCategory = '';
        if(customWrap) customWrap.style.display = 'none';
        if(customInp) customInp.value = '';
      }
      renderPreview(container);
    });

    customInp?.addEventListener('input', ()=>{
      state.customCategory = customInp.value;
      renderPreview(container);
    });

    const pinnedCb = container.querySelector('#advPinned');
    pinnedCb?.addEventListener('change', ()=> { state.pinned = pinnedCb.checked; });

    const goldenCb = container.querySelector('#advGolden');
    goldenCb?.addEventListener('change', ()=> {
      state.goldenFrame = goldenCb.checked;
      renderPreview(container);
    });

    const drop = container.querySelector('#advBannerDrop');
    const input = container.querySelector('#advBannerInput');
    drop?.addEventListener('click', ()=> input.click());
    drop?.addEventListener('dragover', e=>{e.preventDefault(); drop.classList.add('dragover');});
    drop?.addEventListener('dragleave', ()=> drop.classList.remove('dragover'));
    drop?.addEventListener('drop', e=>{
      e.preventDefault();
      drop.classList.remove('dragover');
      handleBanner(e.dataTransfer.files[0]);
    });
    input?.addEventListener('change', ()=> handleBanner(input.files[0]));

    async function handleBanner(f){
      if(!f) return;
      try {
        const res = await compressImage(f, 1200, 500);
        state.banner = res;
        drop.innerHTML = `<img src="${res}" style="max-height:160px;border-radius:6px">`;
        renderPreview(container);
      } catch(e){
        toast('Error procesando banner','error');
      }
    }

    container.querySelector('#advAddBlock')?.addEventListener('click', ()=> openAddBlockMenu(container));
  }

  function renderBlocksList(container){
    const list = container.querySelector('#advBlocksList');
    if(!list) return;

    if(state.blocks.length === 0){
      list.innerHTML = `<div class="roster-empty">Sin bloques. Añade el primero con el botón de arriba.</div>`;
      return;
    }

    list.innerHTML = state.blocks.map((b, i) => renderBlockEditorCard(b, i)).join('');
    bindBlockEvents(container, list);
  }

  function renderBlockEditorCard(b, i){
    const t = BLOCK_TYPES.find(x => x.id === b.type);
    const header = `
      <div class="adv-block-head">
        <span class="adv-block-type">${t?.icon || '◆'} ${t?.label || b.type}</span>
        <div class="adv-block-actions">
          <button class="widget-action-btn" data-block-up="${i}" type="button" title="Subir">⬆</button>
          <button class="widget-action-btn" data-block-down="${i}" type="button" title="Bajar">⬇</button>
          <button class="widget-action-btn danger" data-block-del="${i}" type="button" title="Eliminar">🗑</button>
        </div>
      </div>`;

    let body = '';
    switch(b.type){
      case 'text':
        body = `<textarea class="textarea" rows="4" data-block-text="${i}" placeholder="Texto del párrafo...">${esc(b.content||'')}</textarea>`;
        break;
      case 'title':
        body = `<input class="input" data-block-text="${i}" value="${esc(b.content||'')}" placeholder="Título del bloque">`;
        break;
      case 'image':
        body = `
          ${b.src ? `<img src="${b.src}" style="max-height:120px;border-radius:6px;margin-bottom:6px">` : ''}
          <input type="file" accept="image/*" hidden data-block-image-file="${i}">
          <button class="btn btn-sm" type="button" data-block-image-upload="${i}">📤 SUBIR IMAGEN</button>
          <input class="input" style="margin-top:6px" data-block-alt="${i}" value="${esc(b.alt||'')}" placeholder="Texto alternativo (opcional)">
        `;
        break;
      case 'team-logo':
        body = `
          <select class="select" data-block-team="${i}">
            <option value="">— Seleccionar equipo —</option>
            ${getDB().teams.map(tm => `<option value="${tm.id}" ${b.teamId===tm.id?'selected':''}>${esc(tm.name)}</option>`).join('')}
          </select>
          <input class="input" style="margin-top:6px" data-block-caption="${i}" value="${esc(b.caption||'')}" placeholder="Texto debajo del escudo (opcional)">
        `;
        break;
      case 'player-card':
        body = `
          <select class="select" data-block-player="${i}">
            <option value="">— Seleccionar jugador —</option>
            ${getDB().players.map(p => `<option value="${p.id}" ${b.playerId===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}
          </select>
          <input class="input" style="margin-top:6px" data-block-caption="${i}" value="${esc(b.caption||'')}" placeholder="Texto debajo de la card (opcional)">
        `;
        break;
      case 'divider':
        body = `<div style="color:var(--muted);font-size:11px;text-align:center;padding:6px">— Línea divisoria —</div>`;
        break;
    }

    return `
      <div class="adv-block-card">
        ${header}
        <div class="adv-block-body">${body}</div>
      </div>`;
  }

  function bindBlockEvents(container, list){
    list.querySelectorAll('[data-block-up]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.blockUp;
        if(i > 0){
          [state.blocks[i-1], state.blocks[i]] = [state.blocks[i], state.blocks[i-1]];
          reRenderBlocks(container);
        }
      });
    });
    list.querySelectorAll('[data-block-down]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.blockDown;
        if(i < state.blocks.length - 1){
          [state.blocks[i+1], state.blocks[i]] = [state.blocks[i], state.blocks[i+1]];
          reRenderBlocks(container);
        }
      });
    });
    list.querySelectorAll('[data-block-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.blockDel;
        if(!confirm('¿Eliminar este bloque?')) return;
        state.blocks.splice(i, 1);
        reRenderBlocks(container);
      });
    });

    list.querySelectorAll('[data-block-text]').forEach(inp => {
      inp.addEventListener('input', ()=>{
        const i = +inp.dataset.blockText;
        state.blocks[i].content = inp.value;
        renderPreview(container);
      });
    });

    list.querySelectorAll('[data-block-image-upload]').forEach(btn => {
      btn.addEventListener('click', ()=>{
        const i = +btn.dataset.blockImageUpload;
        const fileInput = list.querySelector(`[data-block-image-file="${i}"]`);
        fileInput?.click();
      });
    });

    list.querySelectorAll('[data-block-image-file]').forEach(inp => {
      inp.addEventListener('change', async ()=>{
        const i = +inp.dataset.blockImageFile;
        const f = inp.files[0];
        if(!f) return;
        try {
          const res = await compressImage(f, 1000, 800);
          state.blocks[i].src = res;
          reRenderBlocks(container);
        } catch(e){ toast('Error procesando imagen','error'); }
      });
    });

    list.querySelectorAll('[data-block-team]').forEach(sel => {
      sel.addEventListener('change', ()=>{
        const i = +sel.dataset.blockTeam;
        state.blocks[i].teamId = sel.value;
        renderPreview(container);
      });
    });

    list.querySelectorAll('[data-block-player]').forEach(sel => {
      sel.addEventListener('change', ()=>{
        const i = +sel.dataset.blockPlayer;
        state.blocks[i].playerId = sel.value;
        renderPreview(container);
      });
    });

    list.querySelectorAll('[data-block-caption]').forEach(inp => {
      inp.addEventListener('input', ()=>{
        const i = +inp.dataset.blockCaption;
        state.blocks[i].caption = inp.value;
        renderPreview(container);
      });
    });

    list.querySelectorAll('[data-block-alt]').forEach(inp => {
      inp.addEventListener('input', ()=>{
        const i = +inp.dataset.blockAlt;
        state.blocks[i].alt = inp.value;
      });
    });
  }

  function reRenderBlocks(container){
    renderBlocksList(container);
    renderPreview(container);
  }

  function openAddBlockMenu(container){
    openModal({
      id: 'add-block-menu',
      title: 'AÑADIR BLOQUE',
      body: `
        <div style="display:flex;flex-direction:column;gap:8px">
          ${BLOCK_TYPES.map(bt => `
            <button type="button" class="btn" data-add-block="${bt.id}" style="justify-content:flex-start">
              <span style="font-size:16px">${bt.icon}</span> ${bt.label}
            </button>`).join('')}
        </div>
      `,
      footer: `<button class="btn btn-ghost" data-close>CANCELAR</button>`,
      onMount: root => {
        root.querySelectorAll('[data-add-block]').forEach(btn => {
          btn.addEventListener('click', ()=>{
            const type = btn.dataset.addBlock;
            const newBlock = { type };
            if(type === 'text')         newBlock.content = '';
            if(type === 'title')        newBlock.content = '';
            if(type === 'image'){       newBlock.src = ''; newBlock.alt = ''; }
            if(type === 'team-logo'){   newBlock.teamId = ''; newBlock.caption = ''; }
            if(type === 'player-card'){ newBlock.playerId = ''; newBlock.caption = ''; }
            state.blocks.push(newBlock);
            closeTopModal();
            reRenderBlocks(container);
          });
        });
      }
    });
  }

  function renderPreview(container){
    const preview = container.querySelector('#advPreview');
    if(!preview) return;
    const currentDB = getDB();

    const bodyHTML = state.blocks.length > 0
      ? renderBlocksHTML(state.blocks, currentDB)
      : '<div style="color:var(--muted);font-size:12px;text-align:center;padding:20px">Sin bloques todavía. Añade uno para ver la preview.</div>';

    const displayCategory = state.category === '__custom'
      ? (state.customCategory || 'PERSONALIZADA')
      : state.category;

    preview.innerHTML = `
      <div class="news-modal ${state.goldenFrame ? 'golden-frame' : ''}" style="background:var(--bg-graphite);padding:16px;border-radius:8px">
        ${state.banner ? `<div class="news-modal-banner"><img src="${state.banner}" alt=""></div>` : ''}
        <h2 class="news-modal-title">${state.goldenFrame ? '🏆 ' : ''}${esc(state.title || '(sin título)')}</h2>
        <div class="news-modal-meta">
          <span>${state.date}</span>
          <span class="chip">${esc(displayCategory)}</span>
          ${state.pinned ? `<span class="chip chip-gold">📌 FIJADA</span>` : ''}
        </div>
        ${bodyHTML}
      </div>
    `;
  }

  openModal({
    id: 'news-advanced-' + (newsId || 'new'),
    title: existing ? 'EDITAR NOTICIA AVANZADA' : 'NUEVA NOTICIA AVANZADA',
    wide: true,
    body: `<div id="advEditorRoot"></div>`,
    footer: `
      <button class="btn btn-ghost" data-close>CANCELAR</button>
      <button class="btn btn-primary" id="advSave">${existing ? 'GUARDAR CAMBIOS' : 'PUBLICAR'}</button>
    `,
    onMount: root => {
      const container = root.querySelector('#advEditorRoot');
      renderEditor(container);

      root.querySelector('#advSave').addEventListener('click', ()=>{
        const titleInp = container.querySelector('#advTitle');
        if(titleInp) state.title = titleInp.value.trim();

        if(!state.title) return toast('Falta el título','error');

        const finalCategory = state.category === '__custom'
          ? (state.customCategory.trim() || 'GENERAL')
          : state.category;

        try {
          if(existing){
            mutate(d => {
              const n = d.news.find(x => x.id === existing.id);
              if(!n) throw new Error('Noticia no encontrada');
              Object.assign(n, {
                title: state.title,
                category: finalCategory,
                customCategory: state.category === '__custom' ? state.customCategory.trim() : '',
                banner: state.banner,
                date: state.date,
                goldenFrame: state.goldenFrame,
                pinned: state.pinned,
                featured: state.featured,
                blocks: state.blocks,
                body: ''
              });
            });
            logChange('edit','news', existing.id, `Noticia "${state.title}" editada`);
            toast('Noticia guardada','success');
          } else {
            const id = uid('news');
            mutate(d => {
              d.news.push({
                id,
                title: state.title,
                body: '',
                category: finalCategory,
                customCategory: state.category === '__custom' ? state.customCategory.trim() : '',
                featured: state.featured,
                banner: state.banner,
                date: state.date,
                published: true,
                blocks: state.blocks,
                pinned: state.pinned,
                goldenFrame: state.goldenFrame
              });
            });
            logChange('create','news', id, `Noticia avanzada "${state.title}" publicada`);
            toast('Noticia publicada','success');
          }
          closeTopModal();
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        } catch(e){
          console.error(e);
          toast('Error: ' + e.message, 'error');
        }
      });
    }
  });
}