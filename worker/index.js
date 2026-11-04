// Anonymous usage counting for The Sports app.
//
// What this stores, per event: a random install ID, the app version, the event type,
// a small validated payload, and the time we received it. It never reads or stores IP
// addresses, headers, cookies or anything else about the request. Everything outside the
// shapes below is dropped, not stored. See /privacy for the policy this implements.
//
// Routes (everything else is served from ./public):
//   POST /api/events  { id, v, events: [{ t, d }] }   record events
//   POST /api/delete  { id }                          delete everything for that ID
//   GET  /api/stats   Authorization: Bearer <STATS_TOKEN>   aggregate totals only
// A daily cron removes events older than RETENTION_MONTHS.

const RETENTION_MONTHS = 24;
const MAX_BODY = 8 * 1024;
const MAX_EVENTS = 10;
const SPORTS = ['nfl', 'mlb', 'nba', 'nhl'];
const TONES = ['Casual', 'Witty', 'Straight'];
const RATINGS = ['helpful', 'skip'];
const ID_RE = /^[a-f0-9]{32}$/;
const VERSION_RE = /^[0-9A-Za-z.\-]{1,20}$/;
const POINT_RE = /^[0-9A-Za-z:._\-]{1,80}$/;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
     id   TEXT NOT NULL,
     ts   INTEGER NOT NULL,
     type TEXT NOT NULL,
     data TEXT NOT NULL,
     v    TEXT NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS events_id ON events (id)',
  'CREATE INDEX IF NOT EXISTS events_ts ON events (ts)',
];
let schemaReady = false;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  schemaReady = true;
}

const isStr = (x, max) => typeof x === 'string' && x.length > 0 && x.length <= max;

/** Returns a clean payload for the event type, or null to drop the event. */
export function cleanEvent(type, d) {
  d = d && typeof d === 'object' ? d : {};
  switch (type) {
    case 'app_open':
      return {};
    case 'sports_selected': {
      if (!Array.isArray(d.sports)) return null;
      return { sports: [...new Set(d.sports.filter((s) => SPORTS.includes(s)))] };
    }
    case 'teams_selected': {
      if (!d.teams || typeof d.teams !== 'object' || Array.isArray(d.teams)) return null;
      const teams = {};
      for (const s of SPORTS) {
        const t = d.teams[s];
        if (t === null) teams[s] = null;
        else if (isStr(t, 60)) teams[s] = t;
      }
      return { teams };
    }
    case 'tone_selected':
      return TONES.includes(d.tone) ? { tone: d.tone } : null;
    case 'rating':
      return POINT_RE.test(String(d.id)) && RATINGS.includes(d.value)
        ? { id: d.id, value: d.value }
        : null;
    default:
      return null;
  }
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

async function recordEvents(request, db) {
  const body = await readBody(request);
  if (!body || !ID_RE.test(String(body.id)) || !Array.isArray(body.events)) {
    return json({ error: 'bad request' }, 400);
  }
  const v = VERSION_RE.test(String(body.v)) ? body.v : 'unknown';
  const now = Date.now();
  const rows = [];
  for (const e of body.events.slice(0, MAX_EVENTS)) {
    const data = cleanEvent(e?.t, e?.d);
    if (data) rows.push([body.id, now, e.t, JSON.stringify(data), v]);
  }
  if (rows.length > 0) {
    await db.batch(
      rows.map((r) =>
        db.prepare('INSERT INTO events (id, ts, type, data, v) VALUES (?, ?, ?, ?, ?)').bind(...r),
      ),
    );
  }
  return json({ ok: true, stored: rows.length });
}

async function deleteInstall(request, db) {
  const body = await readBody(request);
  if (!body || !ID_RE.test(String(body.id))) return json({ error: 'bad request' }, 400);
  await db.prepare('DELETE FROM events WHERE id = ?').bind(body.id).run();
  return json({ ok: true });
}

function authorized(request, env) {
  const token = typeof env.STATS_TOKEN === 'string' ? env.STATS_TOKEN.trim() : '';
  if (!token) return false;
  const given = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (given.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= given.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

/** Totals only. Nothing in the response identifies an install. */
async function stats(db) {
  const day = 86_400_000;
  const now = Date.now();
  const one = async (sql, ...args) => (await db.prepare(sql).bind(...args).first()) ?? {};

  const installs = (await one('SELECT COUNT(DISTINCT id) AS n FROM events')).n ?? 0;
  const active7 = (await one('SELECT COUNT(DISTINCT id) AS n FROM events WHERE type = ? AND ts > ?', 'app_open', now - 7 * day)).n ?? 0;
  const active30 = (await one('SELECT COUNT(DISTINCT id) AS n FROM events WHERE type = ? AND ts > ?', 'app_open', now - 30 * day)).n ?? 0;
  const opens7 = (await one('SELECT COUNT(*) AS n FROM events WHERE type = ? AND ts > ?', 'app_open', now - 7 * day)).n ?? 0;

  // Each install's most recent selection of each kind, counted once.
  const latest = async (type) =>
    (
      await db
        .prepare(
          `SELECT e.data FROM events e
           JOIN (SELECT id, MAX(ts) AS ts FROM events WHERE type = ? GROUP BY id) m
             ON e.id = m.id AND e.ts = m.ts AND e.type = ?`,
        )
        .bind(type, type)
        .all()
    ).results.map((r) => JSON.parse(r.data));

  const sportRows = await latest('sports_selected');
  const teamRows = await latest('teams_selected');
  const toneRows = await latest('tone_selected');

  const sports = Object.fromEntries(SPORTS.map((s) => [s, 0]));
  for (const r of sportRows) for (const s of r.sports ?? []) sports[s]++;
  const teams = {};
  for (const r of teamRows) {
    for (const [s, t] of Object.entries(r.teams ?? {})) {
      if (t) teams[`${s}:${t}`] = (teams[`${s}:${t}`] ?? 0) + 1;
    }
  }
  const tones = Object.fromEntries(TONES.map((t) => [t, 0]));
  for (const r of toneRows) if (r.tone in tones) tones[r.tone]++;

  const ratingRows = (
    await db.prepare('SELECT data FROM events WHERE type = ?').bind('rating').all()
  ).results.map((r) => JSON.parse(r.data));
  const ratings = { helpful: 0, skip: 0 };
  for (const r of ratingRows) if (r.value in ratings) ratings[r.value]++;

  const pct = (n, of) => (of > 0 ? Math.round((n / of) * 100) : 0);
  return {
    generatedAt: new Date(now).toISOString(),
    installs,
    activeLast7Days: active7,
    activeLast30Days: active30,
    opensLast7Days: opens7,
    followersBySport: sports,
    percentFollowingSport: Object.fromEntries(
      SPORTS.map((s) => [s, pct(sports[s], sportRows.length)]),
    ),
    installsWithSportChoice: sportRows.length,
    topTeams: Object.entries(teams).sort((a, b) => b[1] - a[1]).slice(0, 25),
    tones,
    ratings,
    percentHelpful: pct(ratings.helpful, ratings.helpful + ratings.skip),
  };
}

export async function purgeOld(db, now = Date.now()) {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
  await db.prepare('DELETE FROM events WHERE ts < ?').bind(cutoff.getTime()).run();
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.DB) return json({ error: 'not configured' }, 503);

    try {
      await ensureSchema(env.DB);
      if (pathname === '/api/events' && request.method === 'POST') return await recordEvents(request, env.DB);
      if (pathname === '/api/delete' && request.method === 'POST') return await deleteInstall(request, env.DB);
      if (pathname === '/api/stats' && request.method === 'GET') {
        if (authorized(request, env)) return json(await stats(env.DB));
        // TEMPORARY diagnostic (remove after setup): never reveals the value.
        const t = typeof env.STATS_TOKEN === 'string' ? env.STATS_TOKEN.trim() : '';
        const g = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
        return json({ error: 'unauthorized', secretSeen: t.length > 0, lengthMatches: t.length > 0 && t.length === g.length }, 401);
      }
      return json({ error: 'not found' }, 404);
    } catch {
      // Never echo internals, and never log request contents.
      return json({ error: 'server error' }, 500);
    }
  },

  async scheduled(_event, env) {
    if (!env.DB) return;
    await ensureSchema(env.DB);
    await purgeOld(env.DB);
  },
};
