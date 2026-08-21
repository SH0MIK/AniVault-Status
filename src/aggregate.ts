import { SERVICES, ServiceDef } from './checks';

const HISTORY_DAYS = 90;

export interface DayBucket { date: string; total: number; up: number; pct: number | null }
export interface ServiceStatus {
  service: ServiceDef;
  current: 'operational' | 'down' | 'unknown';
  lastCheckedAt: string | null;
  lastResponseMs: number | null;
  uptimePct90d: number | null;
  days: DayBucket[]; // oldest → newest, always HISTORY_DAYS entries
  openIncidentSince: string | null;
}

export interface IncidentRow { id: number; service: string; started_at: string; ended_at: string | null }

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getServiceStatus(db: D1Database, service: ServiceDef): Promise<ServiceStatus> {
  const latest = await db
    .prepare('SELECT ok, checked_at, response_ms FROM checks WHERE service = ? ORDER BY checked_at DESC LIMIT 1')
    .bind(service.id)
    .first<{ ok: number; checked_at: string; response_ms: number }>();

  const openIncident = await db
    .prepare('SELECT started_at FROM incidents WHERE service = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1')
    .bind(service.id)
    .first<{ started_at: string }>();

  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db
    .prepare(
      `SELECT substr(checked_at, 1, 10) AS day, COUNT(*) AS total, SUM(ok) AS up
       FROM checks WHERE service = ? AND checked_at >= ? GROUP BY day`
    )
    .bind(service.id, since)
    .all<{ day: string; total: number; up: number }>();

  const byDay = new Map<string, { total: number; up: number }>();
  for (const r of rows.results ?? []) byDay.set(r.day, { total: r.total, up: r.up });

  const days: DayBucket[] = [];
  let totalChecks = 0;
  let totalUp = 0;
  const today = new Date();
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = isoDate(d);
    const bucket = byDay.get(key);
    if (bucket) {
      totalChecks += bucket.total;
      totalUp += bucket.up;
      days.push({ date: key, total: bucket.total, up: bucket.up, pct: bucket.total ? (bucket.up / bucket.total) * 100 : null });
    } else {
      days.push({ date: key, total: 0, up: 0, pct: null });
    }
  }

  return {
    service,
    current: openIncident ? 'down' : latest ? 'operational' : 'unknown',
    lastCheckedAt: latest?.checked_at ?? null,
    lastResponseMs: latest?.response_ms ?? null,
    uptimePct90d: totalChecks ? (totalUp / totalChecks) * 100 : null,
    days,
    openIncidentSince: openIncident?.started_at ?? null,
  };
}

export async function getAllStatuses(db: D1Database): Promise<ServiceStatus[]> {
  return Promise.all(SERVICES.map((s) => getServiceStatus(db, s)));
}

export async function getRecentIncidents(db: D1Database, limit = 20): Promise<IncidentRow[]> {
  const res = await db
    .prepare('SELECT id, service, started_at, ended_at FROM incidents ORDER BY started_at DESC LIMIT ?')
    .bind(limit)
    .all<IncidentRow>();
  return res.results ?? [];
}
