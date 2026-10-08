const routes = {};

export function registerRoute(name, viewFn){ routes[name] = viewFn; }

export function navigate(name){ location.hash = '#/' + name; }

export function startRouter(onRender){
  function handle(){
    const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const [name, ...params] = hash.split('/');
    const view = routes[name];
    if(view) onRender(view, params);
    else onRender(() => `<div class="card">Vista "${name}" no encontrada.</div>`, []);
  }
  window.addEventListener('hashchange', handle);
  // Ejecutar en el siguiente tick para que el DOM esté listo
  setTimeout(handle, 0);
}