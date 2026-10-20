import { getDB, mutate } from './storage.js';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_TEAM_PROMPT_IMAGE, DEFAULT_TEAM_PROMPT_TEXT, DEFAULT_LOGO_PROMPT } from '../data/database.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEBUG_MATCH = false;
const DEFAULT_THRESHOLDS = { high: 0.9, low: 0.5 };

export { DEFAULT_SYSTEM_PROMPT };

function getAIConfig(){
  const db = getDB();
  return db?.config?.ai || { provider:'gemini', apiKey:'', model:'gemini-2.0-flash', systemPrompt:'' };
}

function getThresholds(){
  const cfg = getAIConfig();
  const t = cfg.matchThresholds || {};
  return {
    high: typeof t.high === 'number' && t.high >= 0 && t.high <= 1 ? t.high : DEFAULT_THRESHOLDS.high,
    low:  typeof t.low  === 'number' && t.low  >= 0 && t.low  <= 1 ? t.low  : DEFAULT_THRESHOLDS.low
  };
}

function normalizeName(s){
  return String(s || '')
    .toLowerCase()
    .replace(/^\s*[\[\(\{\|][^\]\)\}\|]*[\]\)\}\|]\s*/, '')
    .replace(/[^a-z0-9]/g, '');
}

function similarity(a, b){
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if(!na || !nb) return 0;
  if(na === nb) return 1;

  if(na.includes(nb) || nb.includes(na)){
    const min = Math.min(na.length, nb.length);
    const max = Math.max(na.length, nb.length);
    return 0.7 + (min / max) * 0.25;
  }

  const bigramsA = new Set();
  for(let i = 0; i < na.length - 1; i++) bigramsA.add(na.slice(i, i + 2));
  const bigramsB = new Set();
  for(let i = 0; i < nb.length - 1; i++) bigramsB.add(nb.slice(i, i + 2));

  let common = 0;
  bigramsA.forEach(bg => { if(bigramsB.has(bg)) common++; });
  const total = bigramsA.size + bigramsB.size;
  return total === 0 ? 0 : (2 * common) / total;
}

function levelFromScore(score, thresholds){
  if(score >= thresholds.high) return 'high';
  if(score >= thresholds.low)  return 'medium';
  return 'low';
}

function cleanJSON(text){
  if(!text) return null;
  let cleaned = text.trim();
  if(cleaned.startsWith('```json')) cleaned = cleaned.substring(7);
  if(cleaned.startsWith('```')) cleaned = cleaned.substring(3);
  if(cleaned.endsWith('```')) cleaned = cleaned.substring(0, cleaned.length - 3);
  return cleaned.trim();
}

export const AIService = {
  DEFAULT_MODEL: 'gemini-2.0-flash',
  DEFAULT_THRESHOLDS,

  async analyzeMatchScreenshot(file){
    const cfg = getAIConfig();
    if(!cfg.apiKey) throw new Error('Falta la API key de Gemini. Configura en SISTEMA → Configuración → IA.');
    const base64 = await fileToBase64(file);
    const prompt = cfg.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const body = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: file.type, data: base64 } }
        ]
      }],
      generationConfig: { response_mime_type: 'application/json', temperature: 0.1 }
    };
    const model = cfg.model || AIService.DEFAULT_MODEL;
    const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if(!res.ok){
      const errTxt = await res.text().catch(()=>'');
      throw new Error(`Gemini error ${res.status}: ${errTxt.slice(0,180)}`);
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if(!text) throw new Error('La IA no devolvió contenido');
    try{ return JSON.parse(cleanJSON(text)); }
    catch{
      const match = text.match(/\{[\s\S]*\}/);
      if(match) return JSON.parse(cleanJSON(match[0]));
      throw new Error('La IA no devolvió JSON válido');
    }
  },

  async listModels(){
    const cfg = getAIConfig();
    if(!cfg.apiKey) throw new Error('Introduce una API key primero.');
    const res = await fetch(`${GEMINI_BASE}/models?key=${encodeURIComponent(cfg.apiKey)}`);
    if(!res.ok){
      const txt = await res.text().catch(()=>'');
      throw new Error(`HTTP ${res.status}: ${txt.slice(0,180)}`);
    }
    const list = await res.json();
    const models = (list.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .filter(m => (m.name || '').includes('gemini'))
      .map(m => (m.name || '').replace('models/',''))
      .sort();
    if(models.length === 0) throw new Error('La API key no tiene acceso a ningún modelo Gemini válido.');
    return models;
  },

  async testConnection(){
    const models = await AIService.listModels();
    return { ok:true, models };
  },

  matchWithRoster(iaData, matchTeamA, matchTeamB){
    const db = getDB();
    const thresholds = getThresholds();
    const warnings = [...(iaData.warnings || [])];

    let legacy = false;
    if(!Array.isArray(iaData.teams)){
      if(iaData.teamA || iaData.teamB) legacy = true;
    }

    const candidates = [];
    if(matchTeamA) candidates.push({ id: matchTeamA.id, name: matchTeamA.name, side: 'A' });
    if(matchTeamB) candidates.push({ id: matchTeamB.id, name: matchTeamB.name, side: 'B' });

    let detectedTeamsRaw = iaData.teams;
    if(legacy){
      detectedTeamsRaw = [];
      if(iaData.teamA){
        detectedTeamsRaw.push({
          name: iaData.teamA.name || 'Team A',
          score: iaData.teamA.score ?? 0,
          players: (iaData.players || []).filter(p => p.team === 'A')
        });
      }
      if(iaData.teamB){
        detectedTeamsRaw.push({
          name: iaData.teamB.name || 'Team B',
          score: iaData.teamB.score ?? 0,
          players: (iaData.players || []).filter(p => p.team === 'B')
        });
      }
      warnings.push('⚠️ El prompt de la IA usa el formato antiguo (teamA/teamB). Actualízalo en Configuración → IA → "Restaurar prompt por defecto".');
    }

    const usedTeams = new Set();

    const detectedTeams = (detectedTeamsRaw || []).map(team => {
      let bestCand = null;
      let bestScore = 0;
      candidates.forEach(c => {
        if(usedTeams.has(c.id)) return;
        const sc = similarity(c.name, team.name);
        if(sc > bestScore){ bestScore = sc; bestCand = c; }
      });

      let assignedTeam = null;
      let teamLevel = 'low';
      if(bestCand && bestScore >= thresholds.low){
        assignedTeam = bestCand;
        usedTeams.add(bestCand.id);
        teamLevel = levelFromScore(bestScore, thresholds);
      }

      let roster = [];
      if(assignedTeam){
        const dbTeam = db.teams.find(t => t.id === assignedTeam.id);
        roster = (dbTeam?.roster || []).map(r => {
          const p = db.players.find(x => x.id === r.playerId);
          return p ? { id: p.id, name: p.name } : null;
        }).filter(Boolean);
      }

      const players = (team.players || []).map(p => {
        let bestP = null;
        let bestPS = 0;
        roster.forEach(r => {
          const sc = similarity(r.name, p.name);
          if(sc > bestPS){ bestPS = sc; bestP = r; }
        });

        const pLevel = levelFromScore(bestPS, thresholds);
        const shouldMatch = bestP && bestPS >= thresholds.low;

        if(DEBUG_MATCH){
          console.log(`[MATCH] Team: "${team.name}" → "${assignedTeam?.name || '?'}" (${(bestScore*100).toFixed(0)}%)`);
          console.log(`[MATCH]   Player: "${p.name}" → "${shouldMatch ? bestP.name : '—'}" (${(bestPS*100).toFixed(0)}%)`);
        }

        return {
          ...p,
          matchedPlayerId: shouldMatch ? bestP.id : null,
          matchedName: shouldMatch ? bestP.name : null,
          matchScore: +bestPS.toFixed(3),
          matchLevel: pLevel,
          needsApproval: pLevel === 'low' || !shouldMatch
        };
      });

      return {
        detectedName: team.name,
        detectedScore: team.score ?? 0,
        assignedTeamId: assignedTeam?.id || null,
        assignedTeamName: assignedTeam?.name || null,
        matchScore: +bestScore.toFixed(3),
        matchLevel: teamLevel,
        needsApproval: teamLevel === 'low',
        players
      };
    });

    return {
      detectedTeams,
      candidates: candidates.map(c => ({ id: c.id, name: c.name })),
      thresholds,
      warnings
    };
  },

  // ============================================================
  // GENERADOR DE TORNEOS — EQUIPOS DESDE IMAGEN
  // ============================================================
  async generateTeamsFromImage(file){
    const cfg = getAIConfig();
    if(!cfg.apiKey) throw new Error('Falta la API key de Gemini. Configura en SISTEMA → Configuración → IA.');
    const base64 = await fileToBase64(file);
    const prompt = cfg.tournamentPrompts?.image || DEFAULT_TEAM_PROMPT_IMAGE;
    const model = cfg.model || AIService.DEFAULT_MODEL;
    
    const body = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: file.type, data: base64 } }
        ]
      }],
      generationConfig: { response_mime_type: 'application/json', temperature: 0.1 }
    };

    const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    if(!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if(!text) throw new Error('La IA no devolvió contenido');
    return JSON.parse(cleanJSON(text));
  },

  // ============================================================
  // GENERADOR DE TORNEOS — EQUIPOS DESDE TEXTO
  // ============================================================
  async generateTeamsFromText(text){
    const cfg = getAIConfig();
    if(!cfg.apiKey) throw new Error('Falta la API key de Gemini. Configura en SISTEMA → Configuración → IA.');
    const prompt = cfg.tournamentPrompts?.text || DEFAULT_TEAM_PROMPT_TEXT;
    const model = cfg.model || AIService.DEFAULT_MODEL;
    
    const body = {
      contents: [{
        parts: [
          { text: `${prompt}\n\nTexto del usuario:\n${text}` }
        ]
      }],
      generationConfig: { response_mime_type: 'application/json', temperature: 0.1 }
    };

    const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    if(!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const textOut = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if(!textOut) throw new Error('La IA no devolvió contenido');
    return JSON.parse(cleanJSON(textOut));
  },

  // ============================================================
  // GENERADOR DE TORNEOS — ASIGNAR LOGOS A EQUIPOS
  // ============================================================
  async assignLogosToTeams(teams, logos){
    const cfg = getAIConfig();
    if(!cfg.apiKey) throw new Error('Falta la API key de Gemini.');
    const prompt = cfg.tournamentPrompts?.logos || DEFAULT_LOGO_PROMPT;
    const model = cfg.model || AIService.DEFAULT_MODEL;
    
    const BATCH_SIZE = 20;
    let allAssignments = [];
    let allWarnings = [];

    for(let i = 0; i < logos.length; i += BATCH_SIZE){
      const batch = logos.slice(i, i + BATCH_SIZE);
      
      const parts = [{ text: prompt + `\n\nEquipos:\n${JSON.stringify(teams.map(t => ({ name: t.name, tag: t.tag })))}\n\nAnaliza estas imágenes (índices del 0 al ${batch.length - 1} en este lote):\n` }];
      
      batch.forEach(logo => {
        parts.push({ text: `[Índice ${logo.index}] Archivo: ${logo.filename}` });
        parts.push({ inline_data: { mime_type: logo.type || 'image/png', data: logo.base64 } });
      });

      const body = {
        contents: [{ parts }],
        generationConfig: { response_mime_type: 'application/json', temperature: 0.1 }
      };

      const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if(!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if(text){
        const parsed = JSON.parse(cleanJSON(text));
        if(parsed.assignments) {
          parsed.assignments.forEach(a => {
            a.logoIndex += i;
            allAssignments.push(a);
          });
        }
        if(parsed.warnings) allWarnings.push(...parsed.warnings);
      }
    }

    return { assignments: allAssignments, warnings: allWarnings };
  },

  // ============================================================
  // NUEVO: SIMULADOR / PREDICTOR DE PARTIDOS CON IA
  // ============================================================
  async predictMatch(contextData) {
    const cfg = getAIConfig();
    if (!cfg.apiKey) throw new Error('Falta la API key de Gemini. Configura en SISTEMA → Configuración → IA.');
    const model = cfg.model || AIService.DEFAULT_MODEL;

    const systemPrompt = `Eres un analista experto de esports de Rocket League y estadístico de datos.
Recibirás un JSON con el contexto de dos equipos (TeamA y TeamB) que se van a enfrentar en un partido de liga o playoffs.
El contexto incluye:
- El formato del partido (BO3, BO5, BO7).
- La posición actual en la tabla, puntos, victorias, derrotas, goles a favor (GF), goles en contra (GC) y los últimos 5 resultados (racha).
- El roster actual de cada equipo, con el Rango, PIG (rendimiento), Racha individual (buena, mala o neutra) y Eficiencia (tiros a gol) de cada jugador.
- El contexto de la liga (puntos de playoff, equipos a los que persigue, etc.).

TU TRABAJO SE DIVIDE EN 4 PROCESOS INTERNOS (NO los expliques en la respuesta, solo úsalos para calcular):

PROCESO 1 (Equipos): Analiza el rendimiento histórico de esta temporada de los equipos. Si tienen racha positiva, si meten muchos goles, si su defensa es débil.
PROCESO 2 (Jugadores): Analiza a cada jugador activo del roster actual. Su PIG indica qué tan bueno es. Su rango indica su nivel base. Su racha indica si está en un buen momento o en un bache.
PROCESO 3 (Análisis): Basándote en los procesos 1 y 2, define las probabilidades de victoria (sumando 100%), los pros y contras de cada equipo, y el análisis de playoffs.
PROCESO 4 (Predicción): Simula el resultado del partido respetando el formato (BO3 = el que llegue a 2 gana la serie, BO5 = a 3, BO7 = a 4). Asigna los goles y asistencias a los jugadores del roster actual. Los goles DEBEN ser proporcionales a su PIG, Eficiencia y Racha. Un jugador con mala racha o bajo PIG tiene menos probabilidades de meter goles que uno con alto PIG y buena racha. Elige un MVP del partido basándote en las estadísticas simuladas.

Debes devolver ESTRICTAMENTE un JSON válido con la siguiente estructura (NO agregues markdown, SOLO el JSON):

{
  "teamA": {
    "name": "Nombre exacto del equipo A",
    "winProbability": 55, 
    "pros": ["Pro 1", "Pro 2"],
    "cons": ["Contra 1", "Contra 2"]
  },
  "teamB": {
    "name": "Nombre exacto del equipo B",
    "winProbability": 45,
    "pros": ["Pro 1", "Pro 2"],
    "cons": ["Contra 1", "Contra 2"]
  },
  "predictedSeriesScore": "2-1",
  "predictedWinner": "Nombre del equipo ganador",
  "mvp": {
    "name": "Nombre del jugador MVP",
    "team": "Nombre del equipo del MVP",
    "reason": "Razón breve de por qué fue MVP (ej. 3 goles y 2 asistencias)"
  },
  "scorers": [
    { "name": "Jugador 1", "team": "Team A", "goals": 4, "assists": 2 },
    { "name": "Jugador 2", "team": "Team A", "goals": 2, "assists": 3 },
    { "name": "Jugador 3", "team": "Team B", "goals": 3, "assists": 1 }
  ],
  "playoffScenarios": "Análisis de cómo afecta este resultado a las chances de cada equipo de mantenerse en zona de Playoffs o Play-In. Si se quedan o si los sacan. Sé específico con los puntos.",
  "reportText": "Un texto largo y detallado con todo el informe analítico para copiar y pegar. Debe incluir el análisis del partido, pros y contras, y la predicción final."
}`;

    const body = {
      contents: [{
        parts: [
          { text: systemPrompt },
          { text: `Aquí están los datos del partido:\n${JSON.stringify(contextData, null, 2)}` }
        ]
      }],
      generationConfig: { 
        response_mime_type: 'application/json', 
        temperature: 0.7 
      }
    };

    const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(() => '');
      throw new Error(`Gemini error ${res.status}: ${errTxt.slice(0, 180)}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('La IA no devolvió contenido');

    try {
      return JSON.parse(cleanJSON(text));
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(cleanJSON(match[0]));
      throw new Error('La IA no devolvió un JSON válido para la simulación.');
    }
  }
};

function fileToBase64(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
