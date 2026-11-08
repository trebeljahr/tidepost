# tidepost

Self-hosted Instagram scheduler that runs on your own Cloudflare account.

## Hatchkit Context

This starter is normally generated and maintained by `hatchkit`.
If `.hatchkit.json` exists at the project root, treat the repo as a
Hatchkit-managed project.

Useful Hatchkit commands from inside a generated project:

```bash
hatchkit overview --json                 # inspect manifest/project state
hatchkit update                          # add supported features additively
hatchkit add <project> [services]        # provision GlitchTip/Plausible/Listmonk+SES/S3/email/search
hatchkit keys push <project>             # push dotenvx private key to Coolify/GitHub Actions
hatchkit sync                            # sync/deploy existing project state
hatchkit rename-domain                   # update domain-related deploy config
hatchkit regen-infra                     # regenerate infra/deploy files
hatchkit provision s3                    # create project buckets + env entries
hatchkit assets pull                     # mirror remote object storage assets locally
```

Before giving Hatchkit setup advice, run `hatchkit status --json` and
read `providers[]`, `nextStep`, and `suggestions[]`. For provider failures,
run `hatchkit doctor --json` and surface the failing `checks[].hint[]`
lines. Never print dotenvx private keys unless the user specifically asks.

If a Hatchkit command breaks in this project, report the failing command,
cwd, Hatchkit version, output, suspected source area, and safe undo path.
When asking another agent to fix it, include a repair prompt with those details
and tell it to preserve existing user setups, use `--dry-run` where possible,
and ask before provider/DNS/Coolify/Terraform/keychain mutations.

Do not run commands that may alter existing infrastructure unless the user
explicitly asks. Prefer giving the command to the user, or using preview modes
such as `hatchkit destroy <project> --recipe`, `hatchkit gh-pages --undo
--dry-run`, and other command-specific `--dry-run` options.

## Tech Stack

- **Worker:** `packages/worker` — Cloudflare Worker (API, passkeys via @simplewebauthn/server, cron publisher, token refresh, grid mirror), D1 migrations in `packages/worker/migrations`, KV for photos. Root `wrangler.jsonc` deploys it with the client export as static assets.
- **UI:** `packages/ui` — React components (`TidepostApp`, `setApiBase`) so other hosts (Rico's HQ) can embed the same UI. Tailwind classes; hosts add `@source` for `packages/ui/src`.
- **Frontend host:** `packages/client` — Next.js static export (`build:export`) that renders `TidepostApp`.
- **Shared:** `packages/shared` — Instagram limits used by UI and Worker.

Design and decisions: `~/projects/ai-work-notes/projects/tidepost/tidepost-design.md`.

Rules that keep the open-source version clean:
- No telemetry, analytics or update checks. The Worker talks only to graph.instagram.com and Instagram's image CDN.
- API tokens can never approve or publish; approval needs a passkey session.
- Nothing Rico-specific (his instance URL, account IDs, Eos, vault) goes into this repo. HQ integrates through the API and `packages/ui` slots.

## How to Run

```bash
pnpm install                          # install all dependencies
pnpm run preview                      # build, migrate local D1, wrangler dev (pick a high port: --port)
pnpm --filter @starter/worker test    # Worker tests in workerd with a fake Instagram API
pnpm run deploy                       # build, migrate remote D1, wrangler deploy
pnpm run dev                          # the pinned client port
pnpm run dev:auto                     # the same, with the port auto-picked
pnpm run dev:fixed                    # the pinned port, or fail — never a fallback
pnpm run build                        # production build
```

Three commands, because the two callers want opposite things.

- **`pnpm run dev`** pins the ports (`DEV_*_PORT` in `scripts/dev.mjs`). The
  origins never move, so password managers, saved logins and bookmarks keep
  working — and so does every client that bakes the API URL in at build time
  (the browser extension, the desktop and mobile shells), none of which can
  follow a port that changes per run.
- **`pnpm run dev:auto`** auto-picks every port from 49152-65535. Use it for
  agents and for any second instance, so nothing fights over the pinned ones.

`pnpm run dev` inside a git worktree behaves like `dev:auto` automatically, so
several agents can run side by side without stepping on the main checkout. A
worktree therefore does NOT serve the ports a baked-in client expects — point
it at the printed ports, or run `dev:fixed` there when the worktree is the
thing being tested.

`PORT`, `API_PORT` and `DOCS_PORT` pin individual ports, and `--fixed` wins
over all of it, worktree included. If a pinned port is busy, `dev` warns and
falls back to a random one for that run rather than refusing to start;
`dev:fixed` exits instead, because "these exact ports" was the point.
`node scripts/dev.mjs --dry-run` resolves and prints ports without starting
anything.

`dev` also hands the server the native shells' document origins and, when the
project has an extension package, its `chrome-extension://<id>` dev origin —
so no id is pasted by hand for local work. The id comes from
`scripts/extension-package.mjs id`, never derived a second time here: a dev
server that trusts a different id than Chrome assigns fails as a flat
`403 INVALID_ORIGIN` with nothing on either side saying the two disagreed.
Anything already in `TRUSTED_ORIGINS` in the environment is kept alongside it.

**Every route answering 404 while `public/` files still load** means `next dev`
could not open file watches (`EMFILE: too many open files, watch` in the client
log): with no watcher it never scans `app/`. The cause is dev watchers from
earlier runs that never died. `scripts/dev.mjs` leads its own process group and
stops it on SIGINT/SIGTERM/SIGHUP, on a broken pipe and when reparented, and
`scripts/lib/dev-reaper.mjs` stops it when `dev.mjs` dies any other way. `dev`
warns at start about orphaned watchers of this repo and prints a boxed
explanation on the first EMFILE/ENOSPC — but **it never kills them, and neither
should you**. Stop only what you started, or run
`WATCHPACK_POLLING=true pnpm run dev`.

## How to Test

```bash
pnpm run lint                         # every package, zero warnings tolerated
pnpm run lint:fix                     # the fixable subset
```

One root command, and the pre-push hook and the `lint` CI job both call it, so
there is a single definition of "lint passes". It runs at zero tolerance —
eslint with `--max-warnings 0` on the client, biome on the server and shared
packages — because a warning that never fails anything accumulates until the
real one scrolls past. `pnpm install` points git at `.githooks/` through the
root `prepare` script; `git push --no-verify` skips the hook, and CI catches
what the hook missed.

Keep the gate green. If a rule fires on code nobody intends to change, turn
that rule off in the config with a reason next to it — a gate that ships red is
switched off within a week.

```bash
pnpm run test:client                  # client unit tests (Vitest)
pnpm run build                        # build all packages
```

## Code Style

- TypeScript strict mode everywhere. No `any` — use `unknown` and narrow.
- Prefer `const` over `let`. Never use `var`.
- Named exports only (no default exports except Next.js pages which require them).
- Explicit return types on all public/exported functions.
- Use `@/` path alias for client-side imports within the client package.

## File Organization

```
packages/client/src/
  app/          — Next.js App Router pages
  lib/          — utilities
  components/   — React components
    ui/         — shadcn/ui components
  styles/       — global CSS
```

```
packages/shared/src/
  protocol.ts   — WebSocket message types (discriminated unions)
  types.ts      — shared domain types
  schemas.ts    — Zod validation schemas
```
