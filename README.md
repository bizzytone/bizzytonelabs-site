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
