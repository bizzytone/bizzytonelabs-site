# bizzytonelabs.com

Static site for Bizzytone Labs LLC: home, privacy policy, support. Plain HTML and CSS, no build step.

- Pages live in `public/`. Fonts are self-hosted in `public/fonts/` (Fraunces, Schibsted Grotesk, IBM Plex Mono, all SIL OFL).
- Hosted on Cloudflare Workers Static Assets. Config: `wrangler.jsonc`. Deploy command: `npx wrangler deploy`.
- When the app's data practices change (accounts, analytics, push notifications), update `public/privacy/index.html` and its effective date first.

## App content (The Sports)

The app downloads its talking points from `public/content/v1/`:

- `manifest.json` lists each sport's file, its `asOf` date (when the content was written) and its `version`.
- `nfl.json`, `mlb.json`, `nba.json`, `nhl.json` follow the content spec in the `the-sports` repo (`docs/content-spec.md`) and must pass its checker.
- **Kill switch:** set `"killSwitch": true` in `manifest.json` and deploy. Apps then drop downloaded content and show the content that shipped with the app. Set it back to `false` once fixed.
- **Versions:** each sport in `manifest.json` has a `version`. Phones download a sport whenever its `version` differs from the one they have, so change it every time a file is republished: `2026-11-09` for the weekly refresh, then `2026-11-09.2`, `2026-11-09.3` for same-day fixes.
- **Fixing a mistake:** correct the file, change that sport's `version` in `manifest.json`, and deploy. Rolling back works the same way: put the old file back and give it a new `version`.
- `_headers` keeps these files cached for at most 5 minutes and out of search results.

Weekly refreshes arrive as pull requests on this repo. Merging one deploys it.

## Anonymous usage counting (Worker + D1)

`worker/index.js` receives anonymous usage counts from The Sports app at `/api/*`; everything else is still static files from `public/`. It stores only a random install ID, app version, event type, a validated payload (sports, teams, tone, Helpful/Skip) and the time received. It never reads or stores IP addresses. Observability (request logs) is off for that reason.

- `POST /api/events` and `POST /api/delete` are used by the app. `GET /api/stats` returns totals only and needs `Authorization: Bearer <STATS_TOKEN>`.
- A daily cron deletes events older than 24 months.
- The app only sends data in builds where `EXPO_PUBLIC_ANALYTICS_URL=https://bizzytonelabs.com/api` is set (the public launch build). Until then this code is inert.

One-time setup:

1. Cloudflare dashboard, Storage & Databases, D1, create `the-sports-analytics`. Copy its Database ID.
2. The database ID is already in `wrangler.jsonc` (`d1_databases`).
3. Pick a long random token. Put its SHA-256 fingerprint (`printf '%s' 'TOKEN' | sha256sum`) in `wrangler.jsonc` as `vars.STATS_TOKEN_SHA256`. Never commit the token. (A dashboard secret named `STATS_TOKEN` also works if the dashboard shows it to the Worker.)
4. Read totals: `curl -H "Authorization: Bearer $STATS_TOKEN" https://bizzytonelabs.com/api/stats`
