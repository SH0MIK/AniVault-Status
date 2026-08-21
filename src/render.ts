import { OverallStatus, IncidentRow, SubCheck, ExternalCheck, DayBucket } from './aggregate';

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

function dayCell(d: DayBucket): string {
  let cls = 'cell cell-nodata';
  let title = 'No data';
  if (d.total > 0) {
    if (d.down > 0) { cls = 'cell cell-down'; title = `${d.down} failed check${d.down === 1 ? '' : 's'} of ${d.total}`; }
    else if (d.degraded > 0) { cls = 'cell cell-partial'; title = `${d.degraded} degraded check${d.degraded === 1 ? '' : 's'} of ${d.total}`; }
    else { cls = 'cell cell-up'; title = `${d.total}/${d.total} checks passed`; }
  }
  return `<div class="${cls}" title="${esc(title)}"></div>`;
}

function badgeRow(badges?: { label: string; value: string }[]): string {
  if (!badges || !badges.length) return '';
  return `<div class="badges">${badges.map((b) => `<span class="badge"><span class="badge-label">${esc(b.label)}</span> ${esc(b.value)}</span>`).join('')}</div>`;
}

function checkCard(title: string, categoryLabel: string, check: SubCheck | ExternalCheck): string {
  const cls = check.ok ? 'up' : check.critical === false ? 'partial' : 'down';
  const pillText = check.ok ? 'Operational' : check.critical === false ? 'Degraded' : 'Down';
  const ms = check.ms !== undefined ? `<div class="badges"><span class="badge">${check.ms}ms</span></div>` : '';
  return `
  <div class="check-card">
    <div class="check-head">
      <div>
        <div class="check-name">${esc(title)}</div>
        <div class="check-category">${esc(categoryLabel)}</div>
      </div>
      <span class="status-pill status-pill-${cls}">${esc(pillText)}</span>
    </div>
    <p class="check-detail">${esc(check.detail)}</p>
    ${badgeRow(check.badges)}
    ${ms}
  </div>`;
}

function incidentRow(inc: IncidentRow, serviceName: string): string {
  const ongoing = !inc.ended_at;
  return `
  <li class="incident-item ${ongoing ? 'incident-ongoing' : ''}">
    <div class="incident-item-top">
      <span class="incident-service">${esc(serviceName)}</span>
      <span class="incident-duration">${ongoing ? 'Ongoing' : fmtDuration(inc.started_at, inc.ended_at)}</span>
    </div>
    <div class="incident-item-time">${esc(fmtWhen(inc.started_at))}${inc.ended_at ? ` \u2192 ${esc(fmtWhen(inc.ended_at))}` : ''}</div>
  </li>`;
}

export function renderPage(overall: OverallStatus, incidents: IncidentRow[]): string {
  const overallLabel =
    overall.overall === 'down' ? 'Some Systems Down' : overall.overall === 'degraded' ? 'Some Systems Degraded' : overall.overall === 'operational' ? 'All Systems Operational' : 'Awaiting First Check';
  const overallClass = overall.overall === 'down' ? 'down' : overall.overall === 'degraded' ? 'partial' : overall.overall === 'operational' ? 'up' : 'nodata';

  const nameById = new Map(overall.services.map((s) => [s.service.id, s.service.name]));
  const incidentsHtml = incidents.length
    ? `<ul class="incident-list">${incidents.map((i) => incidentRow(i, nameById.get(i.service) ?? i.service)).join('')}</ul>`
    : `<p class="empty-state">No incidents in the recorded history. Quiet skies.</p>`;

  const latestChecked = overall.services
    .map((s) => s.lastCheckedAt)
    .filter((v): v is string => !!v)
    .sort()
    .reverse()[0];

  const systemsHtml = overall.allCards
    .map((c) => checkCard(c.check.label, c.serviceName, c.check))
    .join('');

  const externalSummary = `
    <div class="ext-summary">
      <span class="ext-summary-item"><span class="dot dot-up"></span>${overall.allExternal.filter((e) => e.ok).length} operational</span>
      <span class="ext-summary-item"><span class="dot dot-partial"></span>${overall.allExternal.filter((e) => !e.ok).length} degraded</span>
    </div>`;

  const externalHtml = overall.allExternal.length
    ? overall.allExternal.map((e) => checkCard(e.label, e.serviceName, e)).join('')
    : `<p class="empty-state">No external services configured for monitoring yet.</p>`;

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
  .wrap { max-width: 760px; margin: 0 auto; padding: 40px 20px 80px; }

  .brand-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
  .brand-name { font-size: 14px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-dim); font-weight: 600; }
  .open-link {
    font-size: 13px; font-weight: 600; color: var(--text); text-decoration: none;
    padding: 7px 14px; border-radius: 8px; border: 1px solid var(--panel-border); background: var(--panel);
  }

  .overall {
    display: flex; align-items: center; gap: 16px;
    padding: 22px; border-radius: 14px;
    background: var(--panel); border: 1px solid var(--panel-border);
    margin-bottom: 20px;
  }
  .overall-icon {
    width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center; font-size: 18px;
  }
  .overall-icon-up { background: rgba(62,207,142,0.14); color: var(--up); }
  .overall-icon-partial { background: rgba(224,184,74,0.14); color: var(--partial); }
  .overall-icon-down { background: rgba(239,87,87,0.14); color: var(--down); }
  .overall-icon-nodata { background: rgba(139,139,152,0.14); color: var(--text-dim); }
  .overall h1 { font-size: 19px; font-weight: 700; margin: 0 0 4px; }
  .overall p { font-size: 13px; color: var(--text-dim); margin: 0; }
  .refresh-btn {
    margin-left: auto; flex-shrink: 0; border: none; cursor: pointer;
    background: var(--accent); color: #fff; font-weight: 600; font-size: 13px;
    padding: 9px 16px; border-radius: 999px;
  }
  .refresh-btn:active { opacity: 0.8; }
  .refresh-btn:disabled { opacity: 0.5; cursor: default; }

  .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
  .stat-card { background: var(--panel); border: 1px solid var(--panel-border); border-radius: 12px; padding: 14px; }
  .stat-label { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
  .stat-value { font-size: 22px; font-weight: 700; }

  .avail-card { background: var(--panel); border: 1px solid var(--panel-border); border-radius: 14px; padding: 20px; margin-bottom: 28px; }
  .avail-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 2px; }
  .avail-title { font-size: 15px; font-weight: 700; }
  .avail-pct { font-size: 22px; font-weight: 800; color: var(--up); }
  .avail-sub { font-size: 12px; color: var(--text-dim); margin-bottom: 14px; }

  .daygrid { display: grid; grid-template-columns: repeat(90, 1fr); gap: 2px; }
  .cell { height: 24px; border-radius: 2px; }
  .cell-up { background: var(--up); opacity: 0.85; }
  .cell-partial { background: var(--partial); }
  .cell-down { background: var(--down); }
  .cell-nodata { background: var(--nodata); }
  .daygrid-labels { display: flex; justify-content: space-between; margin-top: 8px; font-size: 11px; color: var(--text-dim); }
  .legend { display: flex; gap: 14px; justify-content: center; margin-top: 12px; font-size: 11.5px; color: var(--text-dim); flex-wrap: wrap; }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .legend .cell { width: 10px; height: 10px; display: inline-block; }

  .section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text); margin: 0 0 3px; }
  .section-sub { font-size: 12.5px; color: var(--text-dim); margin: 0 0 14px; }
  .section-head-row { display: flex; align-items: baseline; justify-content: space-between; margin-top: 36px; margin-bottom: 14px; }
  .section-updated { font-size: 11.5px; color: var(--text-dim); }

  .check-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .check-card { background: var(--panel); border: 1px solid var(--panel-border); border-radius: 12px; padding: 16px; }
  .check-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .check-name { font-size: 14.5px; font-weight: 700; }
  .check-category { font-size: 11.5px; color: var(--text-dim); margin-top: 1px; }
  .check-detail { font-size: 12.5px; color: var(--text-dim); margin: 8px 0 0; line-height: 1.4; }

  .status-pill { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; white-space: nowrap; flex-shrink: 0; }
  .status-pill-up { background: rgba(62,207,142,0.12); color: var(--up); }
  .status-pill-partial { background: rgba(224,184,74,0.12); color: var(--partial); }
  .status-pill-down { background: rgba(239,87,87,0.12); color: var(--down); }
  .status-pill-nodata { background: rgba(139,139,152,0.12); color: var(--text-dim); }

  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
  .dot-up { background: var(--up); }
  .dot-partial { background: var(--partial); }
  .dot-down { background: var(--down); }
  .dot-nodata { background: var(--nodata); }

  .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .badge { font-size: 11px; color: var(--text); background: rgba(255,255,255,0.05); border: 1px solid var(--panel-border); border-radius: 6px; padding: 3px 8px; font-variant-numeric: tabular-nums; }
  .badge-label { color: var(--text-dim); }

  .ext-summary { display: flex; gap: 16px; font-size: 12.5px; color: var(--text-dim); margin-bottom: 14px; }
  .ext-summary-item { display: flex; align-items: center; gap: 6px; }

  .incident-list { list-style: none; margin: 0; padding: 0; }
  .incident-item { padding: 12px 16px; border-radius: 10px; background: var(--panel); border: 1px solid var(--panel-border); margin-bottom: 8px; }
  .incident-ongoing { border-color: rgba(239,87,87,0.4); }
  .incident-item-top { display: flex; justify-content: space-between; font-size: 13.5px; font-weight: 600; }
  .incident-item-time { margin-top: 4px; font-size: 12.5px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
  .incident-duration { color: var(--text-dim); font-weight: 500; }
  .incident-ongoing .incident-duration { color: var(--down); }

  .empty-state { color: var(--text-dim); font-size: 13.5px; padding: 12px 2px; }
  .footer { margin-top: 40px; font-size: 12px; color: var(--text-dim); text-align: center; }
  .footer a { color: var(--accent); text-decoration: none; }

  @media (max-width: 560px) {
    .stat-grid { grid-template-columns: repeat(2, 1fr); }
    .check-grid { grid-template-columns: 1fr; }
    .daygrid { grid-template-columns: repeat(45, 1fr); }
    .overall { flex-wrap: wrap; }
    .refresh-btn { margin-left: 0; }
  }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand-row">
      <div class="brand"><span class="brand-dot"></span><span class="brand-name">AniVault Status</span></div>
      <a class="open-link" href="https://anivault.co" target="_blank" rel="noopener">Open AniVault</a>
    </div>

    <div class="overall">
      <div class="overall-icon overall-icon-${overallClass}">${overallClass === 'up' ? '\u2713' : overallClass === 'down' ? '\u2715' : '!'}</div>
      <div>
        <h1>${esc(overallLabel)}</h1>
        <p>Live health for AniVault systems and the external APIs used for catalog data, episodes, and images.</p>
      </div>
      <button class="refresh-btn" id="refreshBtn" onclick="doRefresh()">Refresh status</button>
    </div>

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label"><span class="dot dot-up"></span>Operational</div><div class="stat-value">${overall.operationalCount}</div></div>
      <div class="stat-card"><div class="stat-label"><span class="dot dot-partial"></span>Degraded</div><div class="stat-value">${overall.degradedCount}</div></div>
      <div class="stat-card"><div class="stat-label"><span class="dot dot-down"></span>Outages</div><div class="stat-value">${overall.outageCount}</div></div>
      <div class="stat-card"><div class="stat-label">90d Uptime</div><div class="stat-value">${overall.uptimePct90d !== null ? overall.uptimePct90d.toFixed(2) + '%' : '\u2014'}</div></div>
    </div>

    <div class="avail-card">
      <div class="avail-head">
        <span class="avail-title">Recent Availability</span>
        <span class="avail-pct">${overall.uptimePct90d !== null ? overall.uptimePct90d.toFixed(2) + '%' : '\u2014'}</span>
      </div>
      <div class="avail-sub">Monitoring since ${overall.monitoringSinceDays > 0 ? `${overall.monitoringSinceDays} day${overall.monitoringSinceDays === 1 ? '' : 's'} ago` : 'today'}</div>
      <div class="daygrid">${overall.days.map(dayCell).join('')}</div>
      <div class="daygrid-labels"><span>90 days ago</span><span>Today</span></div>
      <div class="legend">
        <span><span class="cell cell-up"></span>Operational</span>
        <span><span class="cell cell-partial"></span>Degraded</span>
        <span><span class="cell cell-down"></span>Outage</span>
        <span><span class="cell cell-nodata"></span>No data</span>
      </div>
    </div>

    <div class="section-head-row">
      <div>
        <div class="section-title">Systems</div>
        <div class="section-sub">Each check runs against the live AniVault website and API.</div>
      </div>
      <span class="section-updated">Updated ${esc(fmtWhen(latestChecked ?? null))}</span>
    </div>
    <div class="check-grid">${systemsHtml || `<p class="empty-state">Awaiting first check.</p>`}</div>

    <div class="section-head-row">
      <div>
        <div class="section-title">External Services</div>
        <div class="section-sub">Third-party APIs AniVault depends on for catalog data and images.</div>
      </div>
    </div>
    ${externalSummary}
    <div class="check-grid">${externalHtml}</div>

    <div class="section-title" style="margin-top:36px;">Recent Incidents</div>
    ${incidentsHtml}

    <div class="footer">Checked automatically every 2 minutes \u00b7 <a href="/api/status.json">JSON API</a></div>
  </div>

  <script>
    async function doRefresh() {
      const btn = document.getElementById('refreshBtn');
      btn.disabled = true;
      btn.textContent = 'Refreshing\u2026';
      try {
        await fetch('/api/refresh', { method: 'POST' });
      } catch (e) {}
      location.reload();
    }
  </script>
</body>
</html>`;
}
