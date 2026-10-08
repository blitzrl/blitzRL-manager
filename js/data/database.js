export const SCHEMA_VERSION = 3;

export function uid(prefix = 'id'){
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
}

export const DEFAULT_ZONES = {
  hasTop1Highlight: true,
  zones: [
    { from:1,  to:1,  type:'champion',   color:'#E6C476' },
    { from:2,  to:4,  type:'playoff',    color:'#4ade80' },
    { from:5,  to:6,  type:'playin',     color:'#6FA8FF' },
    { from:7,  to:8,  type:'promotion',  color:'#facc15' },
    { from:9,  to:10, type:'relegation', color:'#f87171' }
  ]
};

export const DEFAULT_SYSTEM_PROMPT = `Eres un analizador experto de capturas de pantalla del marcador final de Rocket League.

Devuelve SIEMPRE JSON válido con esta estructura exacta:
{
  "teams": [
    {
      "name": "string",
      "score": number,
      "players": [
        { "name": "string",
          "goals": number, "assists": number, "saves": number, "shots": number,
          "confidence": { "goals": 0-1, "assists": 0-1, "saves": 0-1, "shots": 0-1, "name": 0-1 } }
      ]
    }
  ],
  "warnings": ["string"]
}

REGLAS CRÍTICAS SOBRE LOS EQUIPOS:
1. El scoreboard muestra DOS equipos, cada uno con su NOMBRE visible.
2. Extrae el nombre del equipo EXACTAMENTE como aparece en pantalla.
3. NO importa el orden (arriba/abajo) ni el color. Solo importa AGRUPAR correctamente.
4. Cada equipo tiene un marcador (número) junto a su nombre.
5. Cada equipo tiene 2-3 jugadores listados debajo de su nombre.

REGLAS CRÍTICAS SOBRE LOS JUGADORES:
1. Extrae el nombre SIN el prefijo del club. Ejemplos:
   - "[ØM] PepeEl248218" → "PepeEl248218"
   - "[KKCK] Sun_Rize_s" → "Sun_Rize_s"
2. Elimina espacios al inicio y al final.
3. NO cambies mayúsculas, guiones bajos ni números.

REGLAS DE LECTURA:
- Lee GOLES (goals), ASISTENCIAS (assists), PARADAS (saves) y DESPEJES (shots).
- Si no puedes leer un campo, pon valor 0 y confidence baja.

REGLAS GENERALES:
- No inventes datos.
- Devuelve SOLO el JSON, sin texto adicional.
- Si detectas algún problema, inclúyelo en warnings.`;

// ============================================================
// TEMA POR DEFECTO
// ============================================================
export function getDefaultTheme(){
  return {
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
}

// ============================================================
// WIDGETS POR DEFECTO
// ============================================================
export function getDefaultWidgets(){
  return [
    { id:'upcoming',        instanceId:'upcoming_default',         name:'Próximo Partido',       enabled:true,  order:1,  span:2, rowSpan:1, config:{ itemIds:[], interval:5 } },
    { id:'standings',       instanceId:'standings_default',        name:'Tabla General',         enabled:true,  order:2,  span:1, rowSpan:1, config:{} },
    { id:'topPlayers',      instanceId:'topPlayers_default',       name:'Top Players',           enabled:true,  order:3,  span:1, rowSpan:1, config:{} },
    { id:'lastResult',      instanceId:'lastResult_default',       name:'Último Resultado',      enabled:true,  order:4,  span:1, rowSpan:1, config:{ itemIds:[], interval:5 } },
    { id:'nextMatchdays',   instanceId:'nextMatchdays_default',    name:'Próximas Jornadas',     enabled:true,  order:5,  span:1, rowSpan:1, config:{} },
    { id:'ballonDor',       instanceId:'ballonDor_default',        name:"Zenith Ballon d'Or",    enabled:true,  order:6,  span:1, rowSpan:1, config:{} },
    { id:'news',            instanceId:'news_default',             name:'Noticias',              enabled:true,  order:7,  span:3, rowSpan:1, config:{} },
    { id:'mvpCarousel',     instanceId:'mvpCarousel_default',      name:'MVP del Momento',       enabled:true,  order:8,  span:1, rowSpan:1, config:{} },
    { id:'topScorers',      instanceId:'topScorers_default',       name:'Máximos Goleadores',    enabled:true,  order:9,  span:1, rowSpan:1, config:{} },
    { id:'topAssists',      instanceId:'topAssists_default',       name:'Máximos Asistentes',    enabled:true,  order:10, span:1, rowSpan:1, config:{} },
    { id:'topSaves',        instanceId:'topSaves_default',         name:'Mejores Porteros',      enabled:true,  order:11, span:1, rowSpan:1, config:{} },
    { id:'topEfficiency',   instanceId:'topEfficiency_default',    name:'Mejor Eficiencia',      enabled:true,  order:12, span:1, rowSpan:1, config:{} },
    { id:'playerSpotlight', instanceId:'playerSpotlight_default',  name:'Jugador Destacado',     enabled:true,  order:13, span:1, rowSpan:1, config:{} },
    // NUEVOS — Fase Playoffs
    { id:'playInUpcoming',  instanceId:'playInUpcoming_default',   name:'Próximo Play-In',       enabled:false, order:14, span:1, rowSpan:1, config:{ itemIds:[], interval:5 } },
    { id:'playoffUpcoming', instanceId:'playoffUpcoming_default',  name:'Próximo Play-Off',      enabled:false, order:15, span:1, rowSpan:1, config:{ itemIds:[], interval:5 } },
    { id:'playoffBracket',  instanceId:'playoffBracket_default',   name:'Llave Play-Offs',       enabled:false, order:16, span:2, rowSpan:1, config:{} }
  ];
}

// Tipos de widget con metadata
export const WIDGET_TYPES = [
  { id:'upcoming',        label:'Próximo Partido',       configurable:true  },
  { id:'standings',       label:'Tabla General',         configurable:false },
  { id:'topPlayers',      label:'Top Players',           configurable:false },
  { id:'lastResult',      label:'Último Resultado',      configurable:true  },
  { id:'nextMatchdays',   label:'Próximas Jornadas',     configurable:false },
  { id:'ballonDor',       label:"Zenith Ballon d'Or",    configurable:false },
  { id:'news',            label:'Noticias',              configurable:false },
  { id:'mvpCarousel',     label:'MVP del Momento',       configurable:false },
  { id:'topScorers',      label:'Máximos Goleadores',    configurable:false },
  { id:'topAssists',      label:'Máximos Asistentes',    configurable:false },
  { id:'topSaves',        label:'Mejores Porteros',      configurable:false },
  { id:'topEfficiency',   label:'Mejor Eficiencia',      configurable:false },
  { id:'playerSpotlight', label:'Jugador Destacado',     configurable:false },
  { id:'playInUpcoming',  label:'Próximo Play-In',       configurable:true  },
  { id:'playoffUpcoming', label:'Próximo Play-Off',      configurable:true  },
  { id:'playoffBracket',  label:'Llave Play-Offs',       configurable:false }
];

export function getWidgetType(id){
  return WIDGET_TYPES.find(w => w.id === id) || null;
}

export function defaultDatabase(){
  const seasonId   = uid('sea');
  const divisionId = uid('div');

  return {
    meta: { version: SCHEMA_VERSION, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },

    seasons: [{ id: seasonId, name: 'SEASON 1', year: new Date().getFullYear(), active: true }],

    divisions: [{
      id: divisionId, seasonId, name: 'ZENITH I', tier: 1, active: true, visible: true,
      config: {
        teamsCount: 10, matchdays: 9, regularFormat: 'BO3', pointsPerGameWin: 1,
        playInEnabled: true, playoffSpots: 4, playInSpots: 2,
        playInFormat: 'BO5', semiFormat: 'BO5', finalFormat: 'BO7',
        promotion: { enabled: true, spots: 2, playIn: false, promotionSeries: false },
        relegation: { enabled: true, spots: 2 },
        tiebreakers: ['PTS','SG','DP','H2H','BO1'],
        zones: JSON.parse(JSON.stringify(DEFAULT_ZONES))
      }
    }],

    teams: [],
    players: [],
    matches: [],
    playoffs: [],
    news: [],
    awards: [],
    history: [],
    transferQueue: [],
    transferLog: [],
    trophyHistory: [],
    trophies: {},
    transferBannerBg: '',

    archivedSeasons: [],
    viewSeasonId: null,

    config: {
      rosterRules: { starters: 3, substitutes: 1, max: 4 },
      pigWeights: { goal: 2.0, assist: 1.5, save: 1.0, missDivisor: 5 },
      badStreak: { enabled: true, minGames: 5, consecutiveLosses: 3, penalty: 0.10 },
      seasonEnd: { autoAssignTrophies: true, requireAllDivisions: true },
      ai: {
        provider: 'gemini',
        apiKey: '',
        model: 'gemini-2.0-flash',
        matchThresholds: { high: 0.9, low: 0.5 },
        systemPrompt: DEFAULT_SYSTEM_PROMPT
      },
      theme: {
        active: getDefaultTheme(),
        presets: []
      }
    },

    widgets: getDefaultWidgets()
  };
}