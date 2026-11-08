# ── Stage 1: Install dependencies ────────────────────────────────────
FROM node:24-bookworm-slim AS deps
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY docs-site/package.json docs-site/
# Install all workspace deps (build stage is discarded)
RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ───────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/client packages/client
# The docs site and the step that builds it into the client's output.
COPY docs-site docs-site
COPY scripts/docs scripts/docs

# Next.js inlines NEXT_PUBLIC_* into the browser bundle at BUILD time —
# runtime env on the deployed container has no effect on browser code.
# CI passes these as --build-arg (see .github/workflows/build-and-deploy.yml).
# HATCHKIT_IMAGE_BUILD makes next.config.ts fail the build loudly when
# NEXT_PUBLIC_API_URL is missing, instead of baking a broken fallback.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_PLAUSIBLE_DOMAIN
ARG NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_PLAUSIBLE_DOMAIN=$NEXT_PUBLIC_PLAUSIBLE_DOMAIN \
    NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL=$NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    HATCHKIT_IMAGE_BUILD=1

# The git commit this image was built from. Written next to the export as
# version.json (below) so the deployed artefact can be asked what it is —
# the deploy job polls it until it reports the commit CI just pushed.
ARG COMMIT_SHA
ENV COMMIT_SHA=$COMMIT_SHA

RUN pnpm --filter @starter/shared run build
RUN pnpm --filter @starter/client run build

# The docs, published at https://tidepost.example.com/docs/. Built HERE, in the web
# image, and NEVER added to the client package's own build script: that
# script also produces the export the end-to-end suite serves and the bundle
# the native shells ship, and none of those should carry the docs. Only the
# web image wants them.
#
# This runs after the client build because it copies into the client's build
# output. It exits non-zero if any page would ship a noindex directive, if a
# canonical link or a sitemap entry points outside https://tidepost.example.com/docs/,
# or if the docs bring a robots file of their own — the failures that look
# exactly like a successful build.
#
# There is no git in this stage and no repository in the build context, so
# the docs sitemap carries no last-modified dates. The docs config must not
# reach for a git binary: one with no repository around it fails outright.
RUN node scripts/docs/build-into-client.mjs

# Stamp the commit and the baked API origin next to the export. `public/`
# is copied into the runtime stage verbatim, so Next serves this as
# /version.json like any other static file. Two facts, because a correct
# commit can still carry the wrong API URL: the pipeline asserts both.
RUN printf '{"commit":"%s","apiUrl":"%s"}\n' "$COMMIT_SHA" "$NEXT_PUBLIC_API_URL" \
      > packages/client/public/version.json

# ── Stage 3: Production runtime ─────────────────────────────────────
FROM node:24-bookworm-slim AS runtime
WORKDIR /app

# curl for Coolify's health check. Coolify probes the container by
# running `curl … || wget … || exit 1` INSIDE it, in place of the
# HEALTHCHECK below, and bookworm-slim ships neither. Without one the
# probe can never pass: every deploy would be rolled back and the old
# container kept. With it, a deploy is a rolling update — the old
# container serves until this one is healthy.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=6402
# Next's standalone server reads HOSTNAME. Docker otherwise supplies the
# container ID, binding only its bridge address and failing loopback probes.
ENV HOSTNAME=0.0.0.0

# Next.js standalone output
COPY --from=build /app/packages/client/.next/standalone ./
COPY --from=build /app/packages/client/.next/static ./packages/client/.next/static
COPY --from=build /app/packages/client/public ./packages/client/public

# Shutdown drain. Coolify deploys by starting the new container, waiting
# for it to turn healthy, then running `docker stop` on this one — and
# Traefik keeps routing here until the process has EXITED, so requests
# caught in between fail with a 502 or hang into a 504. drain.cjs, loaded
# ahead of server.js, fails the health probes on SIGTERM (so Traefik drops this
# container), keeps serving for
# SHUTDOWN_DRAIN_SECONDS, then lets Next.js shut down as usual. Its
# header has the details.
#
# SHUTDOWN_DRAIN_SECONDS is timed against the health checks hatchkit sets
# on the Coolify app and has to stay under the 30 s `docker stop` allows.
# 0 turns the drain off.
COPY --from=build /app/packages/client/drain.cjs ./packages/client/drain.cjs
ENV SHUTDOWN_DRAIN_SECONDS=20

USER node
EXPOSE 6402

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'6402')).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "--require", "./packages/client/drain.cjs", "packages/client/server.js"]
