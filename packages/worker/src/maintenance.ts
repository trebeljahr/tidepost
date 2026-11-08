// Daily token refresh and the profile-grid mirror. Both run from the same cron as the publisher.
import type { Env } from "./env";
import { Graph, GraphError, type FetchLike } from "./graph";
import { deleteSetting, getAccount, getSetting, setSetting } from "./settings";

const DAY = 86400;
/** Refresh once a day after the token is a day old (Meta: refreshable after 24 h, lives 60 days). */
export const REFRESH_EVERY_S = DAY;
const GRID_EVERY_S = 6 * 3600;
const GRID_SIZE = 30;

export async function refreshTokenIfDue(env: Env, now: number, fetcher?: FetchLike): Promise<"refreshed" | "skipped" | "failed"> {
  const account = await getAccount(env);
  if (!account) return "skipped";
  if (now - account.refreshedAt < REFRESH_EVERY_S) return "skipped";
  const lastTry = Number((await getSetting(env, "ig_refresh_tried_at")) ?? 0);
  if (now - lastTry < 3600) return "skipped"; // at most one attempt per hour after a failure
  await setSetting(env, "ig_refresh_tried_at", String(now));
  try {
    const { accessToken, expiresIn } = await new Graph(account.token, env.GRAPH_BASE, fetcher).refresh();
    await env.DB.batch([
      env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ig_token', ?)").bind(accessToken),
      env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ig_refreshed_at', ?)").bind(String(now)),
      env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ig_expires_at', ?)").bind(String(now + expiresIn)),
    ]);
    await deleteSetting(env, "ig_refresh_error");
    return "refreshed";
  } catch (e) {
    await setSetting(env, "ig_refresh_error", e instanceof GraphError ? e.message : String(e));
    return "failed";
  }
}

/** Mirror avatar and the latest posts' images (no captions, no counts) for the grid preview. */
export async function syncGrid(env: Env, now: number, fetcher?: FetchLike, force = false): Promise<boolean> {
  const account = await getAccount(env);
  if (!account) return false;
  const last = Number((await getSetting(env, "grid_synced_at")) ?? 0);
  const dirty = (await getSetting(env, "grid_dirty")) === "1";
  if (!force && !dirty && now - last < GRID_EVERY_S) return false;
  const graph = new Graph(account.token, env.GRAPH_BASE, fetcher);
  const [profile, media] = await Promise.all([graph.profile(), graph.recentMedia(account.userId, GRID_SIZE)]);
  const { results: oldRows } = await env.DB.prepare("SELECT id, dhash FROM grid").all<{ id: string; dhash: string | null }>();
  const hashes = new Map(oldRows.map((r) => [r.id, r.dhash]));
  const stmts = [env.DB.prepare("DELETE FROM grid")];
  media.forEach((m, i) => {
    stmts.push(
      env.DB.prepare("INSERT INTO grid (id, position, media_type, image_url, permalink, timestamp, dhash) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
        m.id,
        i,
        m.media_type,
        m.media_type === "VIDEO" ? (m.thumbnail_url ?? null) : (m.media_url ?? null),
        m.permalink ?? null,
        m.timestamp ?? null,
        hashes.get(m.id) ?? null,
      ),
    );
  });
  stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('grid_synced_at', ?)").bind(String(now)));
  stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('grid_dirty', '0')"));
  stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ig_avatar', ?)").bind(profile.profile_picture_url ?? ""));
  if (profile.username) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ig_username', ?)").bind(profile.username));
  await env.DB.batch(stmts);
  return true;
}

/** Drop sign-in challenges nobody finished. */
export async function cleanup(env: Env, now: number): Promise<void> {
  await env.DB.prepare("DELETE FROM challenges WHERE expires_at < ?").bind(now).run();
}
