// ============================================================
// WIDGET CAROUSEL — Reutilizable, autoplay, dots, prev/next
// ============================================================

export function renderCarousel({ items, renderItem, instanceId, interval = 5, prefix = 'wc' }) {
  if(!items || items.length === 0) return '';
  if(items.length === 1) return renderItem(items[0], 0);

  return `
    <div class="${prefix}" data-instance="${instanceId}" data-interval="${interval}">
      <div class="${prefix}-viewport">
        <div class="${prefix}-track">
          ${items.map((item, i) => `<div class="${prefix}-slide">${renderItem(item, i)}</div>`).join('')}
        </div>
      </div>
      <button class="${prefix}-nav ${prefix}-prev" data-carousel-prev="${instanceId}" aria-label="Anterior">‹</button>
      <button class="${prefix}-nav ${prefix}-next" data-carousel-next="${instanceId}" aria-label="Siguiente">›</button>
      <div class="${prefix}-dots">
        ${items.map((_, i) => `<button class="${prefix}-dot ${i === 0 ? 'active' : ''}" data-carousel-dot="${i}" data-carousel-instance="${instanceId}" aria-label="Ir a ${i+1}"></button>`).join('')}
      </div>
    </div>
  `;
}

export function bindCarouselEvents(root = document){
  root.querySelectorAll('[data-instance]').forEach(wc => {
    if(!wc.classList.contains('wc')) return;
    if(wc.dataset.bound === '1') return;
    wc.dataset.bound = '1';

    const instanceId = wc.dataset.instance;
    const interval = Math.max(2, +wc.dataset.interval || 5) * 1000;
    const track = wc.querySelector('.wc-track');
    const slides = track?.querySelectorAll('.wc-slide') || [];
    const dots = wc.querySelectorAll('.wc-dot');
    if(!track || slides.length <= 1) return;

    let current = 0;
    let timerId = null;
    let paused = false;

    function goTo(idx){
      current = ((idx % slides.length) + slides.length) % slides.length;
      track.style.transform = `translateX(-${current * 100}%)`;
      dots.forEach((d, i) => d.classList.toggle('active', i === current));
    }
    function next(){ goTo(current + 1); }
    function prev(){ goTo(current - 1); }

    function startTimer(){
      if(timerId) clearInterval(timerId);
      if(slides.length <= 1) return;
      timerId = setInterval(() => { if(!paused) next(); }, interval);
    }
    function stopTimer(){
      if(timerId){ clearInterval(timerId); timerId = null; }
    }

    wc.querySelector(`[data-carousel-prev="${instanceId}"]`)?.addEventListener('click', (e) => {
      e.stopPropagation();
      prev(); startTimer();
    });
    wc.querySelector(`[data-carousel-next="${instanceId}"]`)?.addEventListener('click', (e) => {
      e.stopPropagation();
      next(); startTimer();
    });
    dots.forEach((d) => {
      d.addEventListener('click', (e) => {
        e.stopPropagation();
        goTo(+d.dataset.carouselDot);
        startTimer();
      });
    });

    wc.addEventListener('mouseenter', () => { paused = true; });
    wc.addEventListener('mouseleave', () => { paused = false; });

    startTimer();
  });
}

export function destroyCarousels(root = document){
  root.querySelectorAll('.wc[data-bound="1"]').forEach(wc => {
    // El timer se limpia solo cuando el DOM se reemplaza; no hace falta más.
    wc.dataset.bound = '0';
  });
}