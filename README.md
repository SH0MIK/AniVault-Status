# anivault-status

Status page for `anivault.co` and `api.anivault.co`, meant to be deployed to `status.anivault.co`.

Polls both services every 2 minutes via a Cron Trigger and stores results in
its own D1 database (**not** KV — see comment in `wrangler.toml`: writing to
KV every 2 minutes would eat into the same account-wide write quota that
caused the original outage this page exists to catch).

## What it checks

- `https://anivault.co/healthz` — added to the main site repo, checks D1 + KV
  read-only, never touches the MalAPI/season code that caused the original crash.
- `https://api.anivault.co/api/health` — your scraper's existing health route.

To monitor other things later, just add entries to `SERVICES` in `src/checks.ts`.

## Deploy

```bash
npm install

# 1. Create the D1 database (one-time)
npx wrangler d1 create anivault-status
# → copy the returned database_id into wrangler.toml

# 2. Apply the schema
npm run db:migrate:remote

# 3. Deploy
npm run deploy
```

Then attach the custom domain: **Cloudflare dashboard → Workers & Pages →
anivault-status → Settings → Domains & Routes → Add → `status.anivault.co`**.

## Local dev

```bash
npm run db:migrate:local
npm run dev
```

The scheduled handler doesn't run automatically in `wrangler dev`. To trigger
it manually while testing: `curl "http://localhost:8787/__scheduled"` (wrangler
dev exposes this), or just hit `/` after running a check manually via the
Cloudflare dashboard's "Trigger Now" button once deployed.

## Notes

- Debouncing: a status flip to "down" only happens after **2 consecutive**
  failed checks (4 minutes), so a single network blip doesn't open an
  incident or flip the page red. The page's per-service dot follows the same
  logic — it reflects confirmed incidents, not every individual check.
- Retention: `checks` rows older than 90 days are pruned automatically on
  every tick. `incidents` rows are kept indefinitely (they're tiny).
- `GET /api/status.json` returns the same data as the page, if you want to
  pull it into a Discord bot or elsewhere later.
- Discord alerting isn't wired up yet (by request) — when you're ready, the
  natural hook is in `recordCheck()` in `src/checks.ts`: fire a webhook POST
  right where an incident is opened/closed.
