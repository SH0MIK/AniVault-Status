# anivault-status

Status page for `anivault.co` and `api.anivault.co`, deployed at `status.anivault.co`.

Polls both services every 2 minutes via a Cron Trigger and stores results in
its own D1 database (**not** KV — writing to KV every 2 minutes would eat
into the same account-wide write quota that caused the original outage this
page exists to catch).

## What's new in this version

- Each health endpoint (`anivault.co/healthz`, `api.anivault.co/health`) now
  returns multiple **named sub-checks** (database, cache, episode scanner,
  dub-status refresh, AniList season cache, and — for the website —
  reachability checks for Jikan/MyAnimeList/TMDB) instead of one pass/fail.
- Each sub-check is tagged `critical: true|false`. Critical checks failing
  (database, cache) count as an **outage**. Non-critical checks failing
  (a background job running late, an external API erroring) count as
  **degraded** — same distinction your reference status page makes between
  "Down" and "Degraded".
- The 90-day grid now has three colors (green/amber/red) reflecting that,
  plus a "Refresh status" button that re-runs the checks on demand (rate
  limited to once per ~20s so it can't be used to hammer AniVault's APIs).

## \u26a0\ufe0f If you already deployed the previous version

Your D1 database is missing the `degraded` column and `snapshots` table this
version needs. Run the new migration once, then deploy:

```bash
npm install
npm run db:migrate2:remote
npm run deploy
```

You'll also need to redeploy the two backend repos (main site + scraper)
with the updated `/healthz` and `/health` routes \u2014 this status worker can't
show richer data until those endpoints actually return it.

## Fresh install

```bash
npm install
npx wrangler d1 create anivault-status        # copy database_id into wrangler.toml
npm run db:migrate:remote
npm run db:migrate2:remote
npm run deploy
```

Then attach the custom domain: **Cloudflare dashboard \u2192 Workers & Pages \u2192
anivault-status \u2192 Settings \u2192 Domains & Routes \u2192 Add \u2192 `status.anivault.co`**.

## Local dev

```bash
npm run db:migrate:local
npm run db:migrate2:local
npm run dev
```

## Notes

- **Debouncing:** a service only flips to a confirmed "down" (opens an
  incident) after **2 consecutive** failed checks (4 minutes) \u2014 a single
  network blip doesn't flip the page red or spam the incident log.
- **Retention:** `checks` rows older than 90 days are pruned automatically
  every tick. `incidents` and `snapshots` are kept indefinitely (tiny).
- **Adding more checks:** add a new sub-check object to the `checks` (or
  `external`) field returned by `/healthz` / `/health` in the backend repos \u2014
  the status page picks up any key in that object automatically, no status-
  worker code changes needed. Just set `critical: true` if failing it should
  count as an outage rather than "degraded".
- `GET /api/status.json` returns the same data as the page (for a future
  Discord bot, etc). `POST /api/refresh` re-runs checks on demand.
- Discord alerting still isn't wired up (by request) \u2014 the natural hook is
  in `recordCheck()` in `src/checks.ts`, right where an incident opens/closes.
