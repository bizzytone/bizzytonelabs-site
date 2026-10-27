# bizzytonelabs.com

Static site for Bizzytone Labs LLC: home, privacy policy, support. Plain HTML and CSS, no build step.

- Pages live in `public/`. Fonts are self-hosted in `public/fonts/` (Fraunces, Schibsted Grotesk, IBM Plex Mono, all SIL OFL).
- Hosted on Cloudflare Workers Static Assets. Config: `wrangler.jsonc`. Deploy command: `npx wrangler deploy`.
- When the app's data practices change (accounts, analytics, push notifications), update `public/privacy/index.html` and its effective date first.
