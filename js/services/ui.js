// ============================================================
// UI KERNEL — utilidades sin dependencias
// Se puede importar desde cualquier vista SIN ciclos.
// ============================================================

const modalStack = [];

/**
 * Abre un modal apilable.
 * Si `id` se pasa y ya existe un modal con ese id abierto, NO abre otro.
 */
export function openModal({ id=null, title, body, footer, onMount, wide=false, onClose }){
  // Dedup por ID
  if(id && modalStack.some(m => m.id === id)) return null;

  const root = document.getElementById('modalRoot');
  const wrapper = document.createElement('div');
  wrapper.className = 'modal-back';
  wrapper.style.zIndex = 100 + modalStack.length;
  wrapper.innerHTML = `
    <div class="modal ${wide?'modal-wide':''}">
      <div class="modal-head">
        <h3>${title}</h3>
        <button class="modal-close" data-close>✕</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer?`<div class="modal-foot">${footer}</div>`:''}
    </div>`;
  root.appendChild(wrapper);

  const entry = {
    id,
    wrapper,
    close: () => {
      wrapper.remove();
      const i = modalStack.indexOf(entry);
      if(i !== -1) modalStack.splice(i, 1);
      try{ onClose?.(); }catch(e){ console.error(e); }
    }
  };
  modalStack.push(entry);

  wrapper.querySelectorAll('[data-close], .modal-close').forEach(b =>
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      entry.close();
    }));
  wrapper.addEventListener('click', ev => {
    if(ev.target === wrapper) entry.close();
  });

  try{ onMount?.(wrapper.querySelector('.modal')); }
  catch(e){ console.error('[ZENITH] Modal onMount error:', e); }

  return entry;
}

export function closeTopModal(){
  const top = modalStack[modalStack.length - 1];
  if(top) top.close();
}

export function closeAllModals(){
  while(modalStack.length) modalStack[modalStack.length-1].close();
}

export function hasModal(id){
  return modalStack.some(m => m.id === id);
}

export function toast(msg, type='info'){
  const root = document.getElementById('toastRoot');
  if(!root) return;
  const el = document.createElement('div');
  el.className = 'toast';
  if(type === 'error')   el.style.borderLeftColor = 'var(--danger)';
  if(type === 'success') el.style.borderLeftColor = 'var(--success)';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(()=>el.remove(), 3200);
}

export function confirmDialog(msg, onYes){
  if(confirm(msg)) onYes();
}