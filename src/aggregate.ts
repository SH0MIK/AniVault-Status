import { SERVICES, ServiceDef } from './checks';

const HISTORY_DAYS = 90;

export interface SubCheck {
  ok: boolean;
  label: string;
  detail: string;
  ms?: number;
  badges?: { label: string; value: string }[];
  critical?: boolean; // failing = outage (red) vs degraded (amber); missing = treated as non-critical
}
export interface ExternalCheck extends SubCheck {
  configured: boolean;
}

export interface SystemCard {
  key: string;
  serviceName: string; // category shown on the card, e.g. "AniVault Website"
  check: SubCheck;
}

export interface DayBucket { date: string; total: number; up: number; degraded: number; down: number }

export interface ServiceSnapshot {
  service: ServiceDef;
  reachable: boolean; // last probe succeeded at all (HTTP-level)
  degraded: boolean;
  lastCheckedAt: string | null;
  lastResponseMs: number | null;
  openIncidentSince: string | null;
  checks: SystemCard[];
  external: (ExternalCheck & { key: string; serviceName: string })[];
}

export interface IncidentRow { id: number; service: string; started_at: string; ended_at: string | null }

export interface OverallStatus {
  services: ServiceSnapshot[];
  allCards: SystemCard[];
  allExternal: (ExternalCheck & { key: string; serviceName: string })[];
  operationalCount: number;
  degradedCount: number;
  outageCount: number;
  overall: 'operational' | 'degraded' | 'down' | 'unknown';
  days: DayBucket[]; // combined across services, oldest → newest
  uptimePct90d: number | null;
  monitoringSinceDays: number;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseSnapshotPayload(payload: string | null): { checks: Record<string, SubCheck>; external: Record<string, ExternalCheck> } {
  if (!payload) return { checks: {}, external: {} };
  try {
    const parsed = JSON.parse(payload);
    return { checks: parsed?.checks ?? {}, external: parsed?.external ?? {} };
  } catch {
    return { checks: {}, external: {} };
  }
}

async function getServiceSnapshot(db: D1Database, service: ServiceDef): Promise<ServiceSnapshot> {
  const snap = await db
    .prepare('SELECT payload, ok, degraded, response_ms, fetched_at FROM snapshots WHERE service = ?')
    .bind(service.id)
    .first<{ payload: string; ok: number; degraded: number; response_ms: number; fetched_at: string }>();

  const openIncident = await db
    .prepare('SELECT started_at FROM incidents WHERE service = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1')
    .bind(service.id)
    .first<{ started_at: string }>();

  const { checks: rawChecks, external: rawExternal } = parseSnapshotPayload(snap?.payload ?? null);

  const checks: SystemCard[] = Object.entries(rawChecks).map(([key, check]) => ({
    key: `${service.id}:${key}`,
    serviceName: service.name,
    check,
  }));
  const external = Object.entries(rawExternal).map(([key, ext]) => ({
    ...ext,
    key: `${service.id}:${key}`,
    serviceName: service.name,
  }));

  return {
    service,
    reachable: snap ? snap.ok === 1 : false,
    degraded: snap ? snap.degraded === 1 : false,
    lastCheckedAt: snap?.fetched_at ?? null,
    lastResponseMs: snap?.response_ms ?? null,
    openIncidentSince: openIncident?.started_at ?? null,
    checks,
    external,
  };
}

async function getCombinedDays(db: D1Database): Promise<{ days: DayBucket[]; uptimePct90d: number | null }> {
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db
    .prepare(
      `SELECT substr(checked_at, 1, 10) AS day,
              SUM(CASE WHEN ok = 1 AND degraded = 0 THEN 1 ELSE 0 END) AS up,
              SUM(CASE WHEN ok = 1 AND degraded = 1 THEN 1 ELSE 0 END) AS degraded,
              SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS down,
              COUNT(*) AS total
       FROM checks WHERE checked_at >= ? GROUP BY day`
    )
    .bind(since)
    .all<{ day: string; up: number; degraded: number; down: number; total: number }>();

  const byDay = new Map<string, { up: number; degraded: number; down: number; total: number }>();
  for (const r of rows.results ?? []) byDay.set(r.day, r);

  const days: DayBucket[] = [];
  let totalChecks = 0;
  let totalUp = 0;
  const today = new Date();
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = isoDate(d);
    const b = byDay.get(key);
    if (b) {
      totalChecks += b.total;
      totalUp += b.up;
      days.push({ date: key, total: b.total, up: b.up, degraded: b.degraded, down: b.down });
    } else {
      days.push({ date: key, total: 0, up: 0, degraded: 0, down: 0 });
    }
  }

  return { days, uptimePct90d: totalChecks ? (totalUp / totalChecks) * 100 : null };
}

export async function getOverallStatus(db: D1Database): Promise<OverallStatus> {
  const services = await Promise.all(SERVICES.map((s) => getServiceSnapshot(db, s)));
  const { days, uptimePct90d } = await getCombinedDays(db);

  const allCards = services.flatMap((s) => s.checks);
  const allExternal = services.flatMap((s) => s.external).filter((e) => e.configured);

  const configuredCards = [...allCards.map((c) => c.check), ...allExternal];
  const operationalCount = configuredCards.filter((c) => c.ok).length;
  const outageCount = configuredCards.filter((c) => !c.ok && c.critical).length;
  const degradedCount = configuredCards.filter((c) => !c.ok && !c.critical).length;

  const anyServiceDown = services.some((s) => !s.reachable || s.openIncidentSince);
  const anyDegraded = services.some((s) => s.degraded) || degradedCount > 0;
  const overall: OverallStatus['overall'] = services.every((s) => s.lastCheckedAt === null)
    ? 'unknown'
    : anyServiceDown || outageCount > 0
    ? 'down'
    : anyDegraded
    ? 'degraded'
    : 'operational';

  const firstDayWithData = days.find((d) => d.total > 0);
  const monitoringSinceDays = firstDayWithData ? HISTORY_DAYS - days.indexOf(firstDayWithData) : 0;

  return {
    services,
    allCards,
    allExternal,
    operationalCount,
    degradedCount,
    outageCount,
    overall,
    days,
    uptimePct90d,
    monitoringSinceDays,
  };
}

export async function getRecentIncidents(db: D1Database, limit = 20): Promise<IncidentRow[]> {
  const res = await db
    .prepare('SELECT id, service, started_at, ended_at FROM incidents ORDER BY started_at DESC LIMIT ?')
    .bind(limit)
    .all<IncidentRow>();
  return res.results ?? [];
}
