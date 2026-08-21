import { Env, runAllChecks, maybeRunManualRefresh } from './checks';
import { getOverallStatus, getRecentIncidents } from './aggregate';
import { renderPage } from './render';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/api/refresh' && req.method === 'POST') {
      const ran = await maybeRunManualRefresh(env);
      return new Response(JSON.stringify({ ran }), { headers: { 'content-type': 'application/json' } });
    }

    if (url.pathname === '/api/status.json') {
      const [overall, incidents] = await Promise.all([getOverallStatus(env.DB), getRecentIncidents(env.DB, 20)]);
      return new Response(JSON.stringify({ overall, incidents, generatedAt: new Date().toISOString() }, null, 2), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }

    const [overall, incidents] = await Promise.all([getOverallStatus(env.DB), getRecentIncidents(env.DB, 20)]);
    return new Response(renderPage(overall, incidents), {
      headers: { 'content-type': 'text/html; charset=UTF-8', 'cache-control': 'no-store' },
    });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runAllChecks(env));
  },
};
