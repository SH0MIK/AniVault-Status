import { Env, runAllChecks } from './checks';
import { getAllStatuses, getRecentIncidents } from './aggregate';
import { renderPage } from './render';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/api/status.json') {
      const [statuses, incidents] = await Promise.all([getAllStatuses(env.DB), getRecentIncidents(env.DB, 20)]);
      return new Response(JSON.stringify({ statuses, incidents, generatedAt: new Date().toISOString() }, null, 2), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }

    const [statuses, incidents] = await Promise.all([getAllStatuses(env.DB), getRecentIncidents(env.DB, 20)]);
    return new Response(renderPage(statuses, incidents), {
      headers: { 'content-type': 'text/html; charset=UTF-8', 'cache-control': 'no-store' },
    });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runAllChecks(env));
  },
};
