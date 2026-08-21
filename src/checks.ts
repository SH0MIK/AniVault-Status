export interface Env {
  DB: D1Database;
}

export interface ServiceDef {
  id: string;
  name: string;
  url: string;
  openUrl: string; // the human-facing site, for the "Open X" link
}

// Both anivault.co (src/routes/health.ts) and api.anivault.co
// (src/routes.ts /health) return the same shape:
//   { status: 'ok'|'degraded'|'down', checks: {...}, external?: {...}, meta?: {...} }
export const SERVICES: ServiceDef[] = [
  { id: 'web', name: 'AniVault Website', url: 'https://anivault.co/healthz', openUrl: 'https://anivault.co' },
  { id: 'api', name: 'AniVault API', url: 'https://api.anivault.co/health', openUrl: 'https://api.anivault.co' },
];

const CHECK_TIMEOUT_MS = 8000;
const RETENTION_DAYS = 90;

export interface CheckResult {
  ok: boolean;
  degraded: boolean;
  statusCode: number | null;
  responseMs: number;
  error: string | null;
  body: string | null;
}

export async function probe(service: ServiceDef): Promise<CheckResult> {
  const start = Date.now();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(service.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AniVault-Status/1.0' },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    clearTimeout(t);
    const responseMs = Date.now() - start;
    const text = await res.text();

    // HTTP failure (5xx/network-level) always means down, regardless of body.
    if (!res.ok) {
      return { ok: false, degraded: false, statusCode: res.status, responseMs, error: `HTTP ${res.status}`, body: text || null };
    }

    // HTTP 200 but body reports its own degraded/down state (e.g. DB up but
    // an external API failing) — still "reachable" but not fully healthy.
    try {
      const parsed = JSON.parse(text);
      const bodyStatus = parsed?.status;
      return {
        ok: bodyStatus !== 'down',
        degraded: bodyStatus === 'degraded',
        statusCode: res.status,
        responseMs,
        error: bodyStatus === 'down' ? 'Service reported status: down' : null,
        body: text,
      };
    } catch {
      // 200 with an unparseable body still counts as reachable.
      return { ok: true, degraded: false, statusCode: res.status, responseMs, error: null, body: text || null };
    }
  } catch (err: any) {
    clearTimeout(t);
    const reason = err?.name === 'AbortError' ? `timed out after ${CHECK_TIMEOUT_MS}ms` : String(err?.message ?? err);
    return { ok: false, degraded: false, statusCode: null, responseMs: Date.now() - start, error: reason, body: null };
  }
}

/** Records one check, updates the latest-snapshot row, and opens/closes an
 *  incident once 2 consecutive checks agree the service is fully down — a
 *  single blip (network hiccup, cold start) shouldn't flip the page red or
 *  spam the incident log. Degraded states don't open incidents, only full
 *  outages do; degraded is still visible on the page and in day coloring. */
export async function recordCheck(db: D1Database, service: ServiceDef, result: CheckResult): Promise<void> {
  const now = new Date().toISOString();

  await db
    .prepare('INSERT INTO checks (service, checked_at, ok, degraded, status_code, response_ms, error) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(service.id, now, result.ok ? 1 : 0, result.degraded ? 1 : 0, result.statusCode, result.responseMs, result.error)
    .run();

  await db
    .prepare(
      `INSERT INTO snapshots (service, payload, ok, degraded, http_status, response_ms, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(service) DO UPDATE SET payload=excluded.payload, ok=excluded.ok, degraded=excluded.degraded,
         http_status=excluded.http_status, response_ms=excluded.response_ms, fetched_at=excluded.fetched_at`
    )
    .bind(service.id, result.body ?? '', result.ok ? 1 : 0, result.degraded ? 1 : 0, result.statusCode, result.responseMs, now)
    .run();

  const last2 = await db
    .prepare('SELECT ok FROM checks WHERE service = ? ORDER BY checked_at DESC LIMIT 2')
    .bind(service.id)
    .all<{ ok: number }>();
  const rows = last2.results ?? [];
  const bothDown = rows.length === 2 && rows.every((r) => r.ok === 0);

  const openIncident = await db
    .prepare('SELECT id FROM incidents WHERE service = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1')
    .bind(service.id)
    .first<{ id: number }>();

  if (bothDown && !openIncident) {
    await db.prepare('INSERT INTO incidents (service, started_at) VALUES (?, ?)').bind(service.id, now).run();
  } else if (result.ok && openIncident) {
    await db.prepare('UPDATE incidents SET ended_at = ? WHERE id = ?').bind(now, openIncident.id).run();
  }

  // Cheap enough to run every tick — keeps the checks table bounded to the
  // retention window without a separate cron/cleanup job.
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare('DELETE FROM checks WHERE service = ? AND checked_at < ?').bind(service.id, cutoff).run();
}

export async function runAllChecks(env: Env): Promise<void> {
  for (const service of SERVICES) {
    const result = await probe(service);
    await recordCheck(env.DB, service, result);
  }
}

/** Basic guard for the manual "Refresh status" button — only re-runs checks
 *  if the most recent one is at least this old, so the endpoint can't be
 *  hammered into spamming AniVault's own APIs and Jikan/MAL/TMDB. */
const MIN_MANUAL_REFRESH_GAP_MS = 20_000;

export async function maybeRunManualRefresh(env: Env): Promise<boolean> {
  const latest = await env.DB.prepare('SELECT checked_at FROM checks ORDER BY checked_at DESC LIMIT 1').first<{ checked_at: string }>();
  const lastMs = latest ? new Date(latest.checked_at).getTime() : 0;
  if (Date.now() - lastMs < MIN_MANUAL_REFRESH_GAP_MS) return false;
  await runAllChecks(env);
  return true;
}
