import { handleApi } from "./api";
import { handleAuth } from "./auth";
import type { Env } from "./env";
import { cleanup, refreshTokenIfDue, syncGrid } from "./maintenance";
import { serveMedia } from "./media";
import { publishDue } from "./publisher";
import { setSetting } from "./settings";
import { HttpError, json, nowSec } from "./util";

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "SAMEORIGIN",
};

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const media = path.match(/^\/media\/([\w-]+)$/);
  if (media && req.method === "GET") return serveMedia(env, req, media[1]);
  if (path.startsWith("/api/")) {
    const auth = await handleAuth(env, req, path);
    if (auth) return auth;
    return handleApi(env, req, path);
  }
  return env.ASSETS.fetch(req);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    let res: Response;
    try {
      res = await route(req, env);
    } catch (e) {
      if (e instanceof HttpError) res = json({ error: e.message }, e.status);
      else {
        console.error("unhandled", e);
        res = json({ error: "Something went wrong on the server. Check the Worker logs in Cloudflare." }, 500);
      }
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
    return out;
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = nowSec();
    await setSetting(env, "cron_seen_at", String(now));
    const tick = await publishDue(env, now);
    if (tick.published.length || tick.failed.length) console.log("publish tick", JSON.stringify(tick));
    // Housekeeping only when publishing left room in this invocation's subrequest budget.
    if (tick.calls < 30) {
      ctx.waitUntil(
        (async () => {
          try {
            await refreshTokenIfDue(env, now);
            await syncGrid(env, now);
            await cleanup(env, now);
          } catch (e) {
            console.error("maintenance", e);
          }
        })(),
      );
    }
  },
} satisfies ExportedHandler<Env>;
