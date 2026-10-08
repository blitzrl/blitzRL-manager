// ============================================================
// SUPABASE SERVICE — CRUD + Realtime
// ============================================================
let _client = null;
let _channel = null;

export function getSupabase() {
  if (!_client) {
    const cfg = window.ZENITH_SUPABASE_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      throw new Error('Falta configuración de Supabase en config.supabase.js');
    }
    if (!window.supabase) {
      throw new Error('SDK de Supabase no cargado. Revisa index.html.');
    }
    _client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {
        storageKey: 'BLITZ_AUTH_SESSION',
        persistSession: true,
        autoRefreshToken: true
      }
    });
  }
  return _client;
}

// ============================================================
// DESCARGAR — Trae toda la DB de Supabase en formato local
// ============================================================
export async function downloadAll() {
  const sb = getSupabase();

  const [seasons, divisions, teams, players, matches, playoffs, news, config, archived] = await Promise.all([
    sb.from('seasons').select('*'),
    sb.from('divisions').select('*'),
    sb.from('teams').select('*'),
    sb.from('players').select('*'),
    sb.from('matches').select('*'),
    sb.from('playoffs').select('*'),
    sb.from('news').select('*'),
    sb.from('config').select('*').maybeSingle(),
    sb.from('archived_seasons').select('*')
  ]);

  const errors = [seasons, divisions, teams, players, matches, playoffs, news, config, archived]
    .map(r => r.error).filter(Boolean);
  if (errors.length) throw new Error('Supabase download: ' + errors[0].message);

  const configData = config?.data?.data || {};

  return {
    seasons: (seasons.data || []).map(r => ({
      id: r.id,
      name: r.name,
      year: r.year,
      active: r.active
    })),
    divisions: (divisions.data || []).map(r => ({
      id: r.id,
      seasonId: r.season_id,
      name: r.name,
      tier: r.tier,
      visible: r.visible,
      config: r.data?.config || {}
    })),
    teams: (teams.data || []).map(r => ({
      id: r.id,
      divisionId: r.division_id,
      seasonId: r.season_id,
      name: r.name,
      tag: r.data?.tag || '',
      logo: r.data?.logo || '',
      coach: r.data?.coach || '',
      roster: r.data?.roster || [],
      trophies: r.data?.trophies || []
    })),
    players: (players.data || []).map(r => ({
      id: r.id,
      divisionId: r.division_id,
      name: r.name,
      platform: r.data?.platform || 'Steam',
      nationalityCode: r.data?.nationalityCode || '',
      rank: r.data?.rank || '',
      rankLevel: r.data?.rankLevel ?? 2,
      rankDivision: r.data?.rankDivision || 'II',
      rlTracker: r.data?.rlTracker || '',
      profilePicture: r.data?.profilePicture || '',
      history: r.data?.history || [],
      sanctions: r.data?.sanctions || [],
      pigHistory: r.data?.pigHistory || [],
      pigTrend: r.data?.pigTrend || '—',
      careerSnapshots: r.data?.careerSnapshots || [],
      trophies: r.data?.trophies || [],
      status: r.data?.status || 'owned',
      pendingTeamId: r.data?.pendingTeamId || null,
      seasonStats: r.data?.seasonStats || {
        goals:0, assists:0, saves:0, shots:0, pig:0,
        matchesPlayed:0, mvps:0, pigHistory:[], avgLast5PIG:0, avgPIGPerMatch:0
      }
    })),
    matches: (matches.data || []).map(r => ({
      id: r.id,
      divisionId: r.division_id,
      seasonId: r.season_id,
      matchday: r.matchday,
      status: r.status,
      teamAId: r.data?.teamAId || null,
      teamBId: r.data?.teamBId || null,
      format: r.data?.format || 'BO3',
      date: r.data?.date || '',
      time: r.data?.time || '',
      locked: !!r.data?.locked,
      games: r.data?.games || []
    })),
    playoffs: (playoffs.data || []).map(r => ({
      divisionId: r.division_id,
      seasonId: r.season_id,
      status: r.data?.status || 'pending',
      bracket: r.data?.bracket || null,
      championId: r.data?.championId || null
    })),
    news: (news.data || []).map(r => ({
      id: r.id,
      date: r.date,
      published: r.published,
      pinned: r.pinned,
      title: r.data?.title || '',
      body: r.data?.body || '',
      category: r.data?.category || 'GENERAL',
      customCategory: r.data?.customCategory || '',
      banner: r.data?.banner || '',
      featured: !!r.data?.featured,
      goldenFrame: !!r.data?.goldenFrame,
      blocks: r.data?.blocks || []
    })),
    archivedSeasons: (archived.data || []).map(r => ({
      id: r.id,
      name: r.name,
      year: r.year,
      archivedAt: r.archived_at,
      championByDivision: r.data?.championByDivision || {},
      movements: r.data?.movements || [],
      snapshot: r.data?.snapshot || null
    })),
    config: {
      rosterRules: configData.rosterRules || { starters:3, substitutes:1, max:4 },
      pigWeights: configData.pigWeights || { goal:2, assist:1.5, save:1, missDivisor:5 },
      badStreak: configData.badStreak || { enabled:true, minGames:5, consecutiveLosses:3, penalty:0.1 },
      seasonEnd: configData.seasonEnd || { autoAssignTrophies:true, requireAllDivisions:true },
      ai: configData.ai || null,
      theme: configData.theme || null
    },
    widgets: configData.widgets || null,
    trophies: configData.trophies || {},
    transferLog: configData.transferLog || [],
    transferBannerBg: configData.transferBannerBg || ''
  };
}

// ============================================================
// SUBIR — Reemplaza tablas específicas
// ============================================================
export async function pushTables(tables) {
  const sb = getSupabase();
  const db = window.__zenithGetRawDB ? window.__zenithGetRawDB() : null;
  if (!db) throw new Error('No hay DB local para subir');

  const results = { ok: true, stats: {} };

  for (const tableName of tables) {
    try {
      if (tableName === 'seasons') {
        await replaceTable(sb, 'seasons', db.seasons || [], s => ({
          id: s.id, name: s.name || '', year: s.year || 2026, active: !!s.active, data: {}
        }));
        results.stats.seasons = (db.seasons || []).length;
      }
      else if (tableName === 'divisions') {
        await replaceTable(sb, 'divisions', db.divisions || [], d => ({
          id: d.id, season_id: d.seasonId || null, name: d.name || '',
          tier: d.tier || 1, visible: d.visible !== false, data: { config: d.config || {} }
        }));
        results.stats.divisions = (db.divisions || []).length;
      }
      else if (tableName === 'teams') {
        await replaceTable(sb, 'teams', db.teams || [], t => ({
          id: t.id, division_id: t.divisionId || null, season_id: t.seasonId || null, name: t.name || '',
          data: { tag: t.tag || '', logo: t.logo || '', coach: t.coach || '', roster: t.roster || [], trophies: t.trophies || [] }
        }));
        results.stats.teams = (db.teams || []).length;
      }
      else if (tableName === 'players') {
        // Reconstruir division_id desde el roster del equipo
        const teamByPlayerId = new Map();
        (db.teams || []).forEach(t => {
          (t.roster || []).forEach(r => teamByPlayerId.set(r.playerId, t.divisionId || null));
        });
        await replaceTable(sb, 'players', db.players || [], p => ({
          id: p.id,
          division_id: p.divisionId || teamByPlayerId.get(p.id) || null,
          name: p.name || '',
          data: {
            platform: p.platform || 'Steam',
            nationalityCode: p.nationalityCode || '',
            rank: p.rank || '',
            rankLevel: p.rankLevel ?? 2,
            rankDivision: p.rankDivision || 'II',
            rlTracker: p.rlTracker || '',
            profilePicture: p.profilePicture || '',
            history: p.history || [],
            sanctions: p.sanctions || [],
            pigHistory: p.pigHistory || [],
            pigTrend: p.pigTrend || '—',
            careerSnapshots: p.careerSnapshots || [],
            trophies: p.trophies || [],
            status: p.status || 'owned',
            pendingTeamId: p.pendingTeamId || null,
            seasonStats: p.seasonStats || {}
          }
        }));
        results.stats.players = (db.players || []).length;
      }
      else if (tableName === 'matches') {
        await replaceTable(sb, 'matches', db.matches || [], m => ({
          id: m.id, division_id: m.divisionId || null, season_id: m.seasonId || null,
          matchday: m.matchday || 0, status: m.status || 'pending',
          data: {
            teamAId: m.teamAId || null, teamBId: m.teamBId || null,
            format: m.format || 'BO3', date: m.date || '', time: m.time || '',
            locked: !!m.locked, games: m.games || []
          }
        }));
        results.stats.matches = (db.matches || []).length;
      }
      else if (tableName === 'playoffs') {
        const rows = (db.playoffs || []).map((p, i) => ({
          id: `playoff_${p.divisionId || i}`,
          division_id: p.divisionId || null,
          season_id: p.seasonId || null,
          data: { status: p.status || 'pending', bracket: p.bracket || null, championId: p.championId || null }
        }));
        await replaceTable(sb, 'playoffs', rows, r => r);
        results.stats.playoffs = rows.length;
      }
      else if (tableName === 'news') {
        await replaceTable(sb, 'news', db.news || [], n => ({
          id: n.id, date: n.date || '', published: n.published !== false, pinned: !!n.pinned,
          data: {
            title: n.title || '', body: n.body || '', category: n.category || 'GENERAL',
            customCategory: n.customCategory || '', banner: n.banner || '',
            featured: !!n.featured, goldenFrame: !!n.goldenFrame, blocks: n.blocks || []
          }
        }));
        results.stats.news = (db.news || []).length;
      }
      else if (tableName === 'archived_seasons') {
        await replaceTable(sb, 'archived_seasons', db.archivedSeasons || [], a => ({
          id: a.id, name: a.name || '', year: a.year || 2026,
          archived_at: a.archivedAt || new Date().toISOString(),
          data: { championByDivision: a.championByDivision || {}, movements: a.movements || [], snapshot: a.snapshot || null }
        }));
        results.stats.archived_seasons = (db.archivedSeasons || []).length;
      }
      else if (tableName === 'config') {
        const cfgData = {
          rosterRules: db.config?.rosterRules || {},
          pigWeights: db.config?.pigWeights || {},
          badStreak: db.config?.badStreak || {},
          seasonEnd: db.config?.seasonEnd || {},
          ai: db.config?.ai || {},
          widgets: db.widgets || [],
          trophies: db.trophies || {},
          transferLog: db.transferLog || [],
          transferBannerBg: db.transferBannerBg || '',
          theme: db.config?.theme || null
        };
        const { error: cfgErr } = await sb.from('config').upsert({ id: 1, data: cfgData });
        if (cfgErr) throw new Error('config: ' + cfgErr.message);
        results.stats.config = 1;
      }
    } catch(e) {
      results.ok = false;
      results.error = `${tableName}: ${e.message}`;
      return results;
    }
  }

  return results;
}

async function replaceTable(sb, tableName, rows, mapFn) {
  const { error: delErr } = await sb.from(tableName).delete().neq('id', '__never__');
  if (delErr) throw new Error(`delete: ${delErr.message}`);
  if (rows.length === 0) return;
  const mapped = rows.map(mapFn);
  const { error: insErr } = await sb.from(tableName).insert(mapped);
  if (insErr) throw new Error(`insert: ${insErr.message}`);
}

// ============================================================
// REALTIME — Suscripción a cambios
// ============================================================
export function subscribeRealtime(onChange) {
  const sb = getSupabase();
  if (_channel) sb.removeChannel(_channel);

  _channel = sb.channel('zenith-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => onChange('teams'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => onChange('players'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => onChange('matches'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'news' }, () => onChange('news'))
    .subscribe((status) => {
      console.log('[REALTIME]', status);
      window.dispatchEvent(new CustomEvent('zenith:realtime-status', { detail: status }));
    });

  return _channel;
}

export function unsubscribeRealtime() {
  const sb = getSupabase();
  if (_channel) { sb.removeChannel(_channel); _channel = null; }
}

// ============================================================
// TEST
// ============================================================
export async function testConnection() {
  const sb = getSupabase();
  const { error } = await sb.from('seasons').select('id').limit(1);
  if (error) throw new Error(error.message);
  return true;
}
