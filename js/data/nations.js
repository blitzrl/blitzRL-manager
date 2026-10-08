export const NATIONS = [
  { code:'CA', name:'Canadá', flag:'🇨🇦' },
  { code:'US', name:'Estados Unidos', flag:'🇺🇸' },
  { code:'MX', name:'México', flag:'🇲🇽' },
  { code:'GT', name:'Guatemala', flag:'🇬🇹' },
  { code:'BZ', name:'Belice', flag:'🇧🇿' },
  { code:'SV', name:'El Salvador', flag:'🇸🇻' },
  { code:'HN', name:'Honduras', flag:'🇭🇳' },
  { code:'NI', name:'Nicaragua', flag:'🇳🇮' },
  { code:'CR', name:'Costa Rica', flag:'🇨🇷' },
  { code:'PA', name:'Panamá', flag:'🇵🇦' },
  { code:'CU', name:'Cuba', flag:'🇨🇺' },
  { code:'JM', name:'Jamaica', flag:'🇯🇲' },
  { code:'HT', name:'Haití', flag:'🇭🇹' },
  { code:'DO', name:'República Dominicana', flag:'🇩🇴' },
  { code:'BS', name:'Bahamas', flag:'🇧🇸' },
  { code:'TT', name:'Trinidad y Tobago', flag:'🇹🇹' },
  { code:'BB', name:'Barbados', flag:'🇧🇧' },
  { code:'LC', name:'Santa Lucía', flag:'🇱🇨' },
  { code:'GD', name:'Granada', flag:'🇬🇩' },
  { code:'VC', name:'San Vicente y las Granadinas', flag:'🇻🇨' },
  { code:'AG', name:'Antigua y Barbuda', flag:'🇦🇬' },
  { code:'DM', name:'Dominica', flag:'🇩🇲' },
  { code:'KN', name:'San Cristóbal y Nieves', flag:'🇰🇳' },
  { code:'CO', name:'Colombia', flag:'🇨🇴' },
  { code:'VE', name:'Venezuela', flag:'🇻🇪' },
  { code:'EC', name:'Ecuador', flag:'🇪🇨' },
  { code:'PE', name:'Perú', flag:'🇵🇪' },
  { code:'BO', name:'Bolivia', flag:'🇧🇴' },
  { code:'BR', name:'Brasil', flag:'🇧🇷' },
  { code:'PY', name:'Paraguay', flag:'🇵🇾' },
  { code:'UY', name:'Uruguay', flag:'🇺🇾' },
  { code:'AR', name:'Argentina', flag:'🇦🇷' },
  { code:'CL', name:'Chile', flag:'🇨🇱' },
  { code:'GY', name:'Guyana', flag:'🇬🇾' },
  { code:'SR', name:'Surinam', flag:'🇸🇷' },
  { code:'ES', name:'España', flag:'🇪🇸' },
  { code:'PT', name:'Portugal', flag:'🇵🇹' }
];

export const NATION_BY_CODE = Object.fromEntries(NATIONS.map(n => [n.code, n]));
export function getNationFlag(code){ return NATION_BY_CODE[code]?.flag || '🏳️'; }
export function getNationName(code){ return NATION_BY_CODE[code]?.name || '—'; }
export function getNationLabel(code){ const n = NATION_BY_CODE[code]; return n ? `${n.flag} ${n.name}` : '—'; }

export const RANKS = ['Bronze','Silver','Gold','Platinum','Diamond','Champion','Grand Champion','SSL'];
export const RANK_LEVELS = [1,2,3];
export const RANK_DIVISIONS = ['I','II','III','IV'];

export const PLATFORMS = [
  { id:'Steam',           label:'Steam',           icon:'fa-brands fa-steam' },
  { id:'Epic Games',      label:'Epic Games',      icon:'fa-solid fa-gamepad' },
  { id:'PlayStation',     label:'PlayStation',     icon:'fa-brands fa-playstation' },
  { id:'Xbox',            label:'Xbox',            icon:'fa-brands fa-xbox' },
  { id:'Nintendo Switch', label:'Nintendo Switch', icon:'fa-solid fa-gamepad' }
];
export function platformIcon(platform){
  return PLATFORMS.find(p => p.id === platform)?.icon || 'fa-solid fa-gamepad';
}

// ============================================================
// COLORES DE RANGO (oficiales)
// ============================================================
export const RANK_COLORS = {
  'SSL':            '#debbff',
  'Grand Champion': { 3:'#b30000', 2:'#b92b2b', 1:'#db4343' },
  'Champion':       { 3:'#831eff', 2:'#824fc0', 1:'#9a0dff' },
  'Diamond':        { 3:'#0d81ff', 2:'#51a4fd', 1:'#80b7f1' },
  'Platinum':       { 3:'#2363db', 2:'#5a91f6', 1:'#6b9fdd' },
  'Gold':           { 3:'#d4a53a', 2:'#e0b852', 1:'#ecd070' },
  'Silver':         { 3:'#a0a8b0', 2:'#b8c0c8', 1:'#d0d7de' },
  'Bronze':         { 3:'#a0653a', 2:'#b57748', 1:'#c98956' }
};

export function getRankColor(rank, level){
  const c = RANK_COLORS[rank];
  if(!c) return '#8D929A';
  if(typeof c === 'string') return c;
  return c[level] || c[1] || '#8D929A';
}

export function getRankLabel(rank, level, division){
  if(!rank) return '—';
  if(rank === 'SSL') return 'SSL';
  const parts = [rank];
  if(level) parts.push(level);
  if(division) parts.push(division);
  return parts.join(' ');
}

// ============================================================
// ZONAS DE CLASIFICACIÓN (colores por defecto)
// ============================================================
export const ZONE_TYPES = [
  { id:'champion',   label:'Campeón',   color:'#E6C476' },
  { id:'playoff',    label:'Play-Offs', color:'#4ade80' },
  { id:'playin',     label:'Play-In',   color:'#6FA8FF' },
  { id:'promotion',  label:'Ascenso',   color:'#facc15' },
  { id:'relegation', label:'Descenso',  color:'#f87171' },
  { id:'none',       label:'Sin zona',  color:'transparent' }
];

export function getZoneColor(type){
  return ZONE_TYPES.find(z => z.id === type)?.color || 'transparent';
}