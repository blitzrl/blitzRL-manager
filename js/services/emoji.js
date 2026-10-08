// Wrapper de Twemoji. Parsea emojis en todo el DOM (y en subárboles).
// Se llama automáticamente tras cada render gracias a un MutationObserver.

let _ready = false;

export function initEmoji(){
  if(_ready) return;
  if(typeof twemoji === 'undefined'){
    // Twemoji no cargó (offline) → no hacemos nada
    console.warn('[ZENITH] Twemoji no disponible');
    _ready = true;
    return;
  }
  _ready = true;

  // Parsear lo ya existente
  twemoji.parse(document.body, {
    folder: 'svg',
    ext: '.svg',
    base: 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.0.3/assets/',
    className: 'zenith-emoji'
  });

  // Observar cambios futuros
  const target = document.body;
  const observer = new MutationObserver((mutations) => {
    // Debounce: agrupar varios cambios en un solo parse
    if(observer._scheduled) return;
    observer._scheduled = true;
    requestAnimationFrame(() => {
      observer._scheduled = false;
      twemoji.parse(document.body, {
        folder: 'svg',
        ext: '.svg',
        base: 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.0.3/assets/',
        className: 'zenith-emoji'
      });
    });
  });
  observer.observe(target, { childList: true, subtree: true });
}

// Forzar re-parse manual (por si acaso)
export function refreshEmoji(){
  if(typeof twemoji === 'undefined') return;
  twemoji.parse(document.body, {
    folder: 'svg',
    ext: '.svg',
    base: 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.0.3/assets/',
    className: 'zenith-emoji'
  });
}