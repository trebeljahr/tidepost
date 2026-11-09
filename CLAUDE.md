# tidepost

Self-hosted Instagram scheduler that runs on your own Cloudflare account.

## Layout

- **Worker:** `packages/worker` — Cloudflare Worker (API, passkeys via @simplewebauthn/server, cron publisher, token refresh, grid mirror), D1 migrations in `packages/worker/migrations`, KV for photos. Root `wrangler.jsonc` deploys it with the client export as static assets.
- **UI:** `packages/ui` — React components (`TidepostApp`, `setApiBase`) so other apps can embed the same UI. Tailwind classes; hosts add `@source` for `packages/ui/src`.
- **Frontend host:** `packages/client` — Next.js static export (`packages/client/out`) that renders `TidepostApp`.
- **Shared:** `packages/shared` — Instagram limits used by UI and Worker (`src/limits.ts`).
- **Scripts:** `scripts/deploy.mjs` (deploy, then remote D1 migrations; optional custom domain from `TIDEPOST_DOMAIN` / `.deploy.env`), `scripts/write-version-json.mjs` (build info for the stale-tab check).

The repo started from a `hatchkit` scaffold (`.hatchkit.json`); everything that is not Cloudflare-only has been removed.

Rules that keep the open-source version clean:
- No telemetry, analytics or update checks. The Worker talks only to graph.instagram.com and Instagram's image CDN.
- Tokens approve or publish only with the opt-in `approve` scope, which only a passkey session can create. No token can change Instagram settings, passkeys or tokens.
- Nothing specific to one person's instance (its URL, account IDs, private tools or notes) goes into this repo. Other apps integrate through the API and `packages/ui` slots.

## How to Run

```bash
pnpm install
cp .dev.vars.example .dev.vars        # set SETUP_CODE
pnpm run preview                      # build, migrate local D1, wrangler dev (add --port for a high port)
pnpm run deploy                       # build, wrangler deploy, migrate remote D1
```

There is no separate dev server: the UI calls `/api` on the Worker, so run it through `wrangler dev` (`preview`) and rebuild after UI changes.

## How to Test

```bash
pnpm run lint                         # biome (worker, shared) + eslint (client), zero warnings
pnpm run typecheck                    # builds shared first, then tsc in every package
pnpm test                             # Worker tests in workerd with a fake Instagram API, client unit tests
pnpm run build                        # static export into packages/client/out
```

CI (`.github/workflows/ci.yml`) runs all four on pushes to main and on pull requests. `pnpm install` points git at `.githooks/`, whose pre-push hook runs lint.

## Code Style

- TypeScript strict mode everywhere. No `any` — use `unknown` and narrow.
- Prefer `const` over `let`. Never use `var`.
- Named exports only (no default exports except Next.js pages which require them).
- Explicit return types on all public/exported functions.
- Use `@/` path alias for client-side imports within the client package.
