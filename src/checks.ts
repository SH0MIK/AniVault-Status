export interface Env {
  DB: D1Database;
}

export interface ServiceDef {
  id: string;
  name: string;
  url: string;
}

// AniVault's web healthz deliberately avoids the MalAPI/season code path —
// see anivault (main site repo) src/routes/health.ts. Scraper's /api/health
// already existed and is similarly cheap/read-only.
export const SERVICES: ServiceDef[] = [
  { id: 'web', name: 'AniVault Website', url: 'https://anivault.co/healthz' },
  { id: 'api', name: 'AniVault API', url: 'https://api.anivault.co/api/health' },
];

const CHECK_TIMEOUT_MS = 8000;
const RETENTION_DAYS = 90;

export interface CheckResult {
  ok: boolean;
  statusCode: number | null;
  responseMs: number;
  error: string | null;
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
    return { ok: res.ok, statusCode: res.status, responseMs: Date.now() - start, error: null };
  } catch (err: any) {
    clearTimeout(t);
    const reason = err?.name === 'AbortError' ? `timed out after ${CHECK_TIMEOUT_MS}ms` : String(err?.message ?? err);
    return { ok: false, statusCode: null, responseMs: Date.now() - start, error: reason };
  }
}

/** Records one check, and opens/closes an incident once 2 consecutive checks
 *  agree — a single blip (network hiccup, cold start) shouldn't flip the
 *  page to "down" and shouldn't spam an incident log. */
export async function recordCheck(db: D1Database, service: ServiceDef, result: CheckResult): Promise<void> {
  const now = new Date().toISOString();

  await db
    .prepare('INSERT INTO checks (service, checked_at, ok, status_code, response_ms, error) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(service.id, now, result.ok ? 1 : 0, result.statusCode, result.responseMs, result.error)
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
  // retention window without needing a separate cron/cleanup job.
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare('DELETE FROM checks WHERE service = ? AND checked_at < ?').bind(service.id, cutoff).run();
}

export async function runAllChecks(env: Env): Promise<void> {
  for (const service of SERVICES) {
    const result = await probe(service);
    await recordCheck(env.DB, service, result);
  }
}
