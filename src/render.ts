import { ServiceStatus } from './aggregate';
import { IncidentRow } from './aggregate';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function fmtDuration(startIso: string, endIso: string | null): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const mins = Math.max(1, Math.round((end - start) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });
}

function dayCell(pct: number | null): string {
  let cls = 'cell cell-nodata';
  let title = 'No data';
  if (pct !== null) {
    if (pct >= 99.5) cls = 'cell cell-up';
    else if (pct >= 95) cls = 'cell cell-partial';
    else cls = 'cell cell-down';
    title = `${pct.toFixed(1)}% uptime`;
  }
  return `<div class="${cls}" title="${esc(title)}"></div>`;
}

function serviceCard(s: ServiceStatus): string {
  const statusLabel = s.current === 'operational' ? 'Operational' : s.current === 'down' ? 'Down' : 'No data yet';
  const statusClass = s.current === 'operational' ? 'up' : s.current === 'down' ? 'down' : 'nodata';
  const uptimeStr = s.uptimePct90d !== null ? `${s.uptimePct90d.toFixed(2)}% uptime / 90d` : 'Collecting data…';
  const incidentBanner = s.openIncidentSince
    ? `<div class="incident-banner">Ongoing outage since ${esc(fmtWhen(s.openIncidentSince))} (${fmtDuration(s.openIncidentSince, null)})</div>`
    : '';

  return `
  <section class="service-card">
    <div class="service-head">
      <div class="service-name-row">
        <span class="dot dot-${statusClass}"></span>
        <h2>${esc(s.service.name)}</h2>
      </div>
      <span class="status-pill status-pill-${statusClass}">${esc(statusLabel)}</span>
    </div>
    ${incidentBanner}
    <div class="meta-row">
      <span>${esc(uptimeStr)}</span>
      <span class="meta-sep">·</span>
      <span>Last checked ${esc(fmtWhen(s.lastCheckedAt))}</span>
      ${s.lastResponseMs !== null ? `<span class="meta-sep">·</span><span>${s.lastResponseMs}ms</span>` : ''}
    </div>
    <div class="daygrid" role="img" aria-label="90-day uptime history for ${esc(s.service.name)}">
      ${s.days.map((d) => dayCell(d.pct)).join('')}
    </div>
    <div class="daygrid-labels"><span>90 days ago</span><span>Today</span></div>
  </section>`;
}

function incidentRow(inc: IncidentRow, serviceName: string): string {
  const ongoing = !inc.ended_at;
  return `
  <li class="incident-item ${ongoing ? 'incident-ongoing' : ''}">
    <div class="incident-item-top">
      <span class="incident-service">${esc(serviceName)}</span>
      <span class="incident-duration">${ongoing ? 'Ongoing' : fmtDuration(inc.started_at, inc.ended_at)}</span>
    </div>
    <div class="incident-item-time">${esc(fmtWhen(inc.started_at))}${inc.ended_at ? ` → ${esc(fmtWhen(inc.ended_at))}` : ''}</div>
  </li>`;
}

export function renderPage(statuses: ServiceStatus[], incidents: IncidentRow[]): string {
  const allUp = statuses.every((s) => s.current === 'operational');
  const anyDown = statuses.some((s) => s.current === 'down');
  const overallLabel = anyDown ? 'Some systems are down' : allUp ? 'All systems operational' : 'Status unknown';
  const overallClass = anyDown ? 'down' : allUp ? 'up' : 'nodata';

  const nameById = new Map(statuses.map((s) => [s.service.id, s.service.name]));
  const incidentsHtml = incidents.length
    ? `<ul class="incident-list">${incidents.map((i) => incidentRow(i, nameById.get(i.service) ?? i.service)).join('')}</ul>`
    : `<p class="empty-state">No incidents in the recorded history. Quiet skies.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AniVault Status</title>
<meta name="robots" content="index,follow">
<style>
  :root {
    --bg: #0a0a0d;
    --panel: #131318;
    --panel-border: #232430;
    --text: #e7e7ec;
    --text-dim: #8b8b98;
    --up: #3ecf8e;
    --partial: #e0b84a;
    --down: #ef5757;
    --nodata: #2a2a34;
    --accent: #8b7fff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 48px 20px 80px; }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 32px; }
  .brand-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
  .brand-name { font-size: 14px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-dim); font-weight: 600; }

  .overall {
    display: flex; align-items: center; gap: 12px;
    padding: 20px 22px; border-radius: 14px;
    background: var(--panel); border: 1px solid var(--panel-border);
    margin-bottom: 28px;
  }
  .overall .dot { width: 12px; height: 12px; }
  .overall h1 { font-size: 19px; font-weight: 600; margin: 0; }

  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .dot-up { background: var(--up); box-shadow: 0 0 8px rgba(62,207,142,0.5); }
  .dot-down { background: var(--down); box-shadow: 0 0 8px rgba(239,87,87,0.5); }
  .dot-nodata { background: var(--nodata); }

  .service-card {
    background: var(--panel); border: 1px solid var(--panel-border);
    border-radius: 14px; padding: 22px; margin-bottom: 16px;
  }
  .service-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .service-name-row { display: flex; align-items: center; gap: 10px; }
  .service-card h2 { font-size: 16px; font-weight: 600; margin: 0; }

  .status-pill { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
  .status-pill-up { background: rgba(62,207,142,0.12); color: var(--up); }
  .status-pill-down { background: rgba(239,87,87,0.12); color: var(--down); }
  .status-pill-nodata { background: rgba(139,139,152,0.12); color: var(--text-dim); }

  .incident-banner {
    margin-top: 12px; padding: 10px 12px; border-radius: 8px;
    background: rgba(239,87,87,0.1); border: 1px solid rgba(239,87,87,0.25);
    color: var(--down); font-size: 13px; font-weight: 500;
  }

  .meta-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; font-size: 12.5px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
  .meta-sep { opacity: 0.5; }

  .daygrid {
    display: grid; grid-template-columns: repeat(90, 1fr); gap: 2px;
    margin-top: 16px;
  }
  .cell { height: 26px; border-radius: 2px; }
  .cell-up { background: var(--up); opacity: 0.85; }
  .cell-partial { background: var(--partial); }
  .cell-down { background: var(--down); }
  .cell-nodata { background: var(--nodata); }
  .daygrid-labels { display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; color: var(--text-dim); }

  .section-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); margin: 36px 0 14px; }
  .incident-list { list-style: none; margin: 0; padding: 0; }
  .incident-item {
    padding: 12px 16px; border-radius: 10px; background: var(--panel); border: 1px solid var(--panel-border);
    margin-bottom: 8px;
  }
  .incident-ongoing { border-color: rgba(239,87,87,0.4); }
  .incident-item-top { display: flex; justify-content: space-between; font-size: 13.5px; font-weight: 600; }
  .incident-item-time { margin-top: 4px; font-size: 12.5px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
  .incident-duration { color: var(--text-dim); font-weight: 500; }
  .incident-ongoing .incident-duration { color: var(--down); }

  .empty-state { color: var(--text-dim); font-size: 13.5px; padding: 12px 2px; }
  .footer { margin-top: 40px; font-size: 12px; color: var(--text-dim); text-align: center; }
  .footer a { color: var(--accent); text-decoration: none; }

  @media (max-width: 480px) {
    .daygrid { grid-template-columns: repeat(45, 1fr); }
  }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand"><span class="brand-dot"></span><span class="brand-name">AniVault Status</span></div>

    <div class="overall">
      <span class="dot dot-${overallClass}"></span>
      <h1>${esc(overallLabel)}</h1>
    </div>

    ${statuses.map(serviceCard).join('')}

    <div class="section-title">Recent incidents</div>
    ${incidentsHtml}

    <div class="footer">Checked automatically every 2 minutes · <a href="/api/status.json">JSON API</a></div>
  </div>
</body>
</html>`;
}
