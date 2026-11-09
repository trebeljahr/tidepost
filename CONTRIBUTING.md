# Contributing

Bug reports and pull requests are welcome. For a larger change, open an issue first so we can agree on the approach.

## Run it locally

You need Node 24 and pnpm (`corepack enable`).

```bash
pnpm install
cp .dev.vars.example .dev.vars          # set SETUP_CODE
pnpm run preview                        # build, migrate the local D1, wrangler dev
```

Passkeys need `localhost` or HTTPS, so open the address wrangler prints on `localhost`.

## Before you open a pull request

```bash
pnpm run lint
pnpm run typecheck
pnpm test
```

CI runs the same commands. Lint fails on warnings.

## Ground rules

- No telemetry, analytics or update checks. The Worker talks only to Instagram's API and image servers.
- API tokens never approve or publish. Approval needs a signed-in passkey session.
- tidepost must keep running on Cloudflare's free plan. Say in the pull request if a change adds requests, cron triggers, D1 rows or KV writes.
- A schema change is a new file in `packages/worker/migrations`. Never edit a migration that has shipped.

By contributing you agree that your contribution is licensed under [AGPL-3.0-or-later](LICENSE).
