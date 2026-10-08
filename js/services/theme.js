// ============================================================
// THEME SERVICE — Aplica temas dinámicos al DOM
// ============================================================

export const DEFAULT_THEME = {
  name: 'Zenith Default',
  brandName: 'ZENITH',
  brandMotto: 'YOUR LEVEL IS NOT YOUR LIMIT',
  logo: '',
  background: {
    type: 'gradient',
    solidColor: '#050505',
    gradientColors: ['#050505', '#0A0A0C', '#121316'],
    gradientAngle: 135
  },
  colors: {
    accent: '#6FA8FF',
    gold: '#E6C476',
    danger: '#E25C5C',
    success: '#63C28A'
  }
};

// Deep merge para asegurar que siempre haya todas las claves
function deepMerge(defaults, overrides){
  if (!overrides) return JSON.parse(JSON.stringify(defaults));
  const result = JSON.parse(JSON.stringify(defaults));
  Object.keys(overrides).forEach(key => {
    const val = overrides[key];
    if (val === null || val === undefined) return;
    if (Array.isArray(val)) {
      result[key] = val.slice();
    } else if (typeof val === 'object') {
      result[key] = deepMerge(result[key] || {}, val);
    } else {
      result[key] = val;
    }
  });
  return result;
}

// Construye el background CSS completo (con el glow radial de acento)
function buildBackground(theme){
  const bg = theme.background || DEFAULT_THEME.background;
  const accent = theme.colors?.accent || DEFAULT_THEME.colors.accent;
  const accentRgba = hexToRgba(accent, 0.05);
  const glow = `radial-gradient(1200px 600px at 80% -10%, ${accentRgba}, transparent 60%)`;

  if (bg.type === 'solid') {
    return `${glow}, ${bg.solidColor}`;
  }
  const colors = (bg.gradientColors && bg.gradientColors.length >= 2)
    ? bg.gradientColors
    : DEFAULT_THEME.background.gradientColors;
  const angle = (typeof bg.gradientAngle === 'number') ? bg.gradientAngle : 135;
  return `${glow}, linear-gradient(${angle}deg, ${colors.join(', ')})`;
}

function hexToRgba(hex, alpha){
  if (!hex || typeof hex !== 'string') return `rgba(111,168,255,${alpha})`;
  const h = hex.replace('#', '');
  const full = h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function applyTheme(theme){
  const t = deepMerge(DEFAULT_THEME, theme || {});
  const root = document.documentElement;

  // 1. Colores como variables CSS
  root.style.setProperty('--accent', t.colors.accent);
  root.style.setProperty('--gold', t.colors.gold);
  root.style.setProperty('--danger', t.colors.danger);
  root.style.setProperty('--success', t.colors.success);

  // 2. Fondo (body + .app-shell para cubrir el layout)
  const bg = buildBackground(t);
  document.body.style.background = bg;
  document.querySelectorAll('.app-shell').forEach(el => {
    el.style.background = bg;
  });

  // 3. Branding del topbar/sidebar
  const nameEl = document.getElementById('brandName');
  if (nameEl) nameEl.textContent = t.brandName || 'ZENITH';

  const mottoEl = document.getElementById('brandMotto');
  if (mottoEl) mottoEl.textContent = t.brandMotto || '';

  const logoEl = document.getElementById('brandLogo');
  const logoDefaultEl = document.getElementById('brandLogoDefault');
  if (logoEl && logoDefaultEl) {
    if (t.logo) {
      logoEl.src = t.logo;
      logoEl.style.display = '';
      logoDefaultEl.style.display = 'none';
    } else {
      logoEl.style.display = 'none';
      logoDefaultEl.style.display = '';
    }
  }

  // 4. Título de la pestaña del navegador
  if (t.brandName) {
    document.title = `${t.brandName} MANAGER — Rise to the Zenith`;
  }
}

export function resetTheme(){
  applyTheme(DEFAULT_THEME);
}

export function exportTheme(theme){
  const data = {
    meta: {
      exportedAt: new Date().toISOString(),
      version: '1',
      kind: 'zenith-theme'
    },
    theme: JSON.parse(JSON.stringify(theme))
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const name = (theme.name || 'custom').replace(/\s+/g, '_');
  a.href = url;
  a.download = `ZENITH_THEME_${name}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importTheme(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        // Acepta {theme:{...}} o el tema plano directamente
        const theme = parsed.theme || parsed;
        if (!theme.colors || !theme.background) {
          throw new Error('El archivo no parece un tema válido de ZENITH.');
        }
        resolve(deepMerge(DEFAULT_THEME, theme));
      } catch(err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsText(file);
  });
}

// Helper para el preview de presets
export function themePreviewBg(theme){
  if (!theme || !theme.background) return '#050505';
  if (theme.background.type === 'solid') return theme.background.solidColor;
  const colors = theme.background.gradientColors || [];
  if (colors.length < 2) return '#050505';
  const angle = theme.background.gradientAngle || 135;
  return `linear-gradient(${angle}deg, ${colors.join(', ')})`;
}