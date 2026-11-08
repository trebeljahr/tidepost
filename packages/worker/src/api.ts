import { MAX_ALT, MAX_BYTES, MAX_ITEMS, isAspect, postProblems } from "@starter/shared/limits";
import { type Principal, authenticate, requireScope, requireSession } from "./auth";
import type { Env } from "./env";
import { Graph, GraphError } from "./graph";
import { syncGrid } from "./maintenance";
import { photoResponse } from "./media";
import { deletePhotos, resetForRetry } from "./publisher";
import { getAccount, getSetting, setSetting } from "./settings";
import { HttpError, json, newId, nowSec, readJson } from "./util";

interface PostDb {
  id: string;
  status: string;
  caption: string;
  suggestion: string | null;
  aspect: string;
  scheduled_at: number | null;
  version: number;
  approved_version: number | null;
  permalink: string | null;
  error: string | null;
  source: string;
  created_at: number;
  updated_at: number;
  published_at: number | null;
}

interface ItemDb {
  id: string;
  post_id: string;
  position: number;
  kv_key: string | null;
  width: number;
  height: number;
  bytes: number;
  alt_text: string;
  dhash: string | null;
}

const EDITABLE = new Set(["draft", "approved", "failed", "needs_approval"]);

async function loadPost(env: Env, id: string): Promise<PostDb> {
  const post = await env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first<PostDb>();
  if (!post) throw new HttpError(404, "No such post.");
  return post;
}

async function itemsOf(env: Env, ids: string[]): Promise<Map<string, ItemDb[]>> {
  const map = new Map<string, ItemDb[]>();
  if (!ids.length) return map;
  const { results } = await env.DB.prepare(
    `SELECT id, post_id, position, kv_key, width, height, bytes, alt_text, dhash FROM items WHERE post_id IN (${ids.map(() => "?").join(",")}) ORDER BY position`,
  )
    .bind(...ids)
    .all<ItemDb>();
  for (const r of results) {
    const list = map.get(r.post_id) ?? [];
    list.push(r);
    map.set(r.post_id, list);
  }
  return map;
}

function present(p: PostDb, items: ItemDb[]) {
  return {
    id: p.id,
    status: p.status,
    caption: p.caption,
    suggestion: p.suggestion,
    aspect: p.aspect,
    scheduledAt: p.scheduled_at,
    version: p.version,
    approved: p.status === "approved" && p.approved_version === p.version,
    permalink: p.permalink,
    error: p.error,
    source: p.source,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    publishedAt: p.published_at,
    items: items.map((i) => ({
      id: i.id,
      position: i.position,
      width: i.width,
      height: i.height,
      bytes: i.bytes,
      altText: i.alt_text,
      dhash: i.dhash,
      hasPhoto: !!i.kv_key,
    })),
    problems: postProblems(p.caption, items),
  };
}

async function postResponse(env: Env, id: string): Promise<Response> {
  const p = await loadPost(env, id);
  return json(present(p, (await itemsOf(env, [id])).get(id) ?? []));
}

/** Read width and height from a baseline or progressive JPEG's SOF marker. */
export function jpegSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = (buf[i + 2] << 8) | buf[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (buf[i + 5] << 8) | buf[i + 6], width: (buf[i + 7] << 8) | buf[i + 8] };
    }
    i += 2 + len;
  }
  return null;
}

/** Any edit drops the approval: what was approved is no longer what would be published. */
async function bump(env: Env, id: string, now: number) {
  await env.DB.prepare(
    "UPDATE posts SET version = version + 1, approved_version = NULL, status = CASE WHEN status IN ('approved','failed','needs_approval') THEN 'draft' ELSE status END, updated_at = ? WHERE id = ?",
  )
    .bind(now, id)
    .run();
}

function assertEditable(p: PostDb) {
  if (!EDITABLE.has(p.status)) throw new HttpError(409, p.status === "publishing" ? "This post is being published right now." : "This post is already published.");
}

export async function handleApi(env: Env, req: Request, path: string): Promise<Response> {
  const principal = await authenticate(env, req);
  const now = nowSec();
  const m = req.method;

  // Remember the public origin; the cron needs it to build image URLs for Meta.
  if (principal.kind === "session") {
    const origin = new URL(req.url).origin;
    if ((await getSetting(env, "public_origin")) !== origin && !origin.startsWith("http://localhost") && !origin.startsWith("http://127.")) {
      await setSetting(env, "public_origin", origin);
    }
  }

  if (path === "/api/state" && m === "GET") return state(env, principal, now);
  if (path === "/api/due" && m === "GET") {
    requireScope(principal, "read");
    return due(env, now);
  }

  if (path === "/api/posts" && m === "GET") {
    requireScope(principal, "read");
    const { results } = await env.DB.prepare("SELECT * FROM posts ORDER BY COALESCE(scheduled_at, created_at) DESC LIMIT 500").all<PostDb>();
    const items = await itemsOf(env, results.map((r) => r.id));
    return json({ posts: results.map((p) => present(p, items.get(p.id) ?? [])) });
  }

  if (path === "/api/posts" && m === "POST") {
    requireScope(principal, "drafts");
    const body = await readJson<{ caption?: string; aspect?: string; scheduledAt?: number | null; suggestion?: string }>(req);
    const id = newId();
    const aspect = isAspect(body.aspect) ? body.aspect : "4:5";
    await env.DB.prepare(
      "INSERT INTO posts (id, caption, suggestion, aspect, scheduled_at, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(id, String(body.caption ?? ""), body.suggestion ?? null, aspect, body.scheduledAt ?? null, principal.kind === "token" ? "api" : "ui", now, now)
      .run();
    return postResponse(env, id);
  }

  if (path === "/api/hashes" && m === "GET") {
    requireSession(principal);
    const { results: own } = await env.DB.prepare(
      "SELECT items.post_id AS postId, items.id AS itemId, items.dhash AS dhash, posts.status AS status FROM items JOIN posts ON posts.id = items.post_id WHERE items.dhash IS NOT NULL",
    ).all();
    const { results: grid } = await env.DB.prepare("SELECT id, dhash, permalink FROM grid WHERE dhash IS NOT NULL").all();
    return json({ own, grid });
  }

  if (path === "/api/grid" && m === "GET") {
    requireSession(principal);
    const { results } = await env.DB.prepare("SELECT id, position, media_type AS mediaType, permalink, timestamp, dhash FROM grid ORDER BY position").all();
    return json({
      username: (await getSetting(env, "ig_username")) ?? "",
      avatar: !!(await getSetting(env, "ig_avatar")),
      syncedAt: Number((await getSetting(env, "grid_synced_at")) ?? 0),
      items: results,
    });
  }
  if (path === "/api/grid/sync" && m === "POST") {
    requireSession(principal);
    try {
      await syncGrid(env, now, undefined, true);
    } catch (e) {
      throw new HttpError(502, e instanceof GraphError ? e.message : String(e));
    }
    return json({ ok: true });
  }
  if (path === "/api/grid/avatar" && m === "GET") {
    requireSession(principal);
    return proxyImage(await getSetting(env, "ig_avatar"));
  }
  const gi = path.match(/^\/api\/grid\/([\w-]+)\/(image|dhash)$/);
  if (gi) {
    requireSession(principal);
    if (gi[2] === "image" && m === "GET") {
      const row = await env.DB.prepare("SELECT image_url FROM grid WHERE id = ?").bind(gi[1]).first<{ image_url: string | null }>();
      return proxyImage(row?.image_url ?? null);
    }
    if (gi[2] === "dhash" && m === "POST") {
      const { dhash } = await readJson<{ dhash?: string }>(req);
      if (!dhash || !/^[0-9a-f]{16}$/.test(dhash)) throw new HttpError(400, "dhash must be 16 hex characters.");
      await env.DB.prepare("UPDATE grid SET dhash = ? WHERE id = ?").bind(dhash, gi[1]).run();
      return json({ ok: true });
    }
  }

  if (path === "/api/settings/instagram" && m === "POST") {
    requireSession(principal);
    const { token } = await readJson<{ token?: string }>(req);
    const t = String(token ?? "").trim();
    if (t.length < 20) throw new HttpError(400, "That does not look like an Instagram access token.");
    let me: { user_id: string; username: string };
    try {
      me = await new Graph(t, env.GRAPH_BASE).me();
    } catch (e) {
      throw new HttpError(400, `Instagram did not accept this token: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!me.user_id) throw new HttpError(400, "Instagram returned no account id for this token.");
    await env.DB.batch(
      Object.entries({
        ig_token: t,
        ig_user_id: String(me.user_id),
        ig_username: me.username ?? "",
        ig_refreshed_at: String(now),
        ig_expires_at: String(now + 60 * 86400),
        grid_dirty: "1",
      }).map(([k, v]) => env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(k, v)),
    );
    await env.DB.prepare("DELETE FROM settings WHERE key IN ('ig_refresh_error','ig_refresh_tried_at')").run();
    try {
      await syncGrid(env, now, undefined, true);
    } catch {
      // The grid fills on the next cron run.
    }
    return json({ ok: true, username: me.username });
  }
  if (path === "/api/settings/instagram" && m === "DELETE") {
    requireSession(principal);
    await env.DB.prepare("DELETE FROM settings WHERE key LIKE 'ig_%'").run();
    await env.DB.prepare("DELETE FROM grid").run();
    return json({ ok: true });
  }

  const pm = path.match(/^\/api\/posts\/([\w-]+)(?:\/([a-z-]+))?$/);
  if (pm) {
    const [, id, action] = pm;
    if (!action) {
      if (m === "GET") {
        requireScope(principal, "read");
        return postResponse(env, id);
      }
      if (m === "PATCH") {
        requireSession(principal);
        return patchPost(env, req, id, now);
      }
      if (m === "DELETE") {
        requireSession(principal);
        const p = await loadPost(env, id);
        if (p.status === "publishing") throw new HttpError(409, "This post is being published right now.");
        await deletePhotos(env, id);
        await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id).run();
        return json({ ok: true });
      }
    }
    if (action === "items" && m === "POST") {
      requireScope(principal, "drafts");
      return addItem(env, req, id, principal, now);
    }
    if (action === "suggestion" && m === "PUT") {
      requireScope(principal, "drafts");
      const { suggestion } = await readJson<{ suggestion?: string | null }>(req);
      await loadPost(env, id);
      await env.DB.prepare("UPDATE posts SET suggestion = ?, updated_at = ? WHERE id = ?").bind(suggestion ? String(suggestion).slice(0, 5000) : null, now, id).run();
      return postResponse(env, id);
    }
    // Approving and publishing always need a person in a signed-in browser.
    requireSession(principal);
    if (action === "approve" && m === "POST") return approve(env, req, id, now, false);
    if (action === "publish-now" && m === "POST") return approve(env, req, id, now, true);
    if (action === "unapprove" && m === "POST") {
      const p = await loadPost(env, id);
      if (p.status !== "approved") throw new HttpError(409, "This post is not approved.");
      await env.DB.prepare("UPDATE posts SET status = 'draft', approved_version = NULL, updated_at = ? WHERE id = ?").bind(now, id).run();
      return postResponse(env, id);
    }
    if (action === "retry" && m === "POST") {
      const p = await loadPost(env, id);
      if (p.status !== "failed") throw new HttpError(409, "Only failed posts can be retried.");
      const items = (await itemsOf(env, [id])).get(id) ?? [];
      if (items.some((i) => !i.kv_key)) throw new HttpError(409, "The photos of this post are gone; create it again.");
      await resetForRetry(env, id, now);
      await env.DB.prepare("UPDATE posts SET approved_version = version WHERE id = ?").bind(id).run();
      return postResponse(env, id);
    }
  }

  const im = path.match(/^\/api\/items\/([\w-]+)(\/image)?$/);
  if (im) {
    requireSession(principal);
    if (im[2] && m === "GET") return photoResponse(env, im[1], "private, max-age=3600");
    if (!im[2] && m === "DELETE") {
      const it = await env.DB.prepare("SELECT post_id, kv_key FROM items WHERE id = ?").bind(im[1]).first<{ post_id: string; kv_key: string | null }>();
      if (!it) throw new HttpError(404, "No such photo.");
      assertEditable(await loadPost(env, it.post_id));
      if (it.kv_key) await env.PHOTOS.delete(it.kv_key);
      await env.DB.prepare("DELETE FROM items WHERE id = ?").bind(im[1]).run();
      await renumber(env, it.post_id);
      await bump(env, it.post_id, now);
      return postResponse(env, it.post_id);
    }
  }

  throw new HttpError(404, "Not found.");
}

async function renumber(env: Env, postId: string) {
  const { results } = await env.DB.prepare("SELECT id FROM items WHERE post_id = ? ORDER BY position").bind(postId).all<{ id: string }>();
  await env.DB.batch(results.map((r, i) => env.DB.prepare("UPDATE items SET position = ? WHERE id = ?").bind(i, r.id)));
}

async function patchPost(env: Env, req: Request, id: string, now: number): Promise<Response> {
  const p = await loadPost(env, id);
  assertEditable(p);
  const body = await readJson<{
    caption?: string;
    aspect?: string;
    scheduledAt?: number | null;
    order?: string[];
    alt?: Record<string, string>;
    clearSuggestion?: boolean;
  }>(req);
  const stmts: D1PreparedStatement[] = [];
  if (typeof body.caption === "string") stmts.push(env.DB.prepare("UPDATE posts SET caption = ? WHERE id = ?").bind(body.caption, id));
  if (body.aspect !== undefined) {
    if (!isAspect(body.aspect)) throw new HttpError(400, "aspect must be 4:5, 1:1 or 1.91:1.");
    stmts.push(env.DB.prepare("UPDATE posts SET aspect = ? WHERE id = ?").bind(body.aspect, id));
  }
  if (body.scheduledAt !== undefined) {
    if (body.scheduledAt !== null && !Number.isFinite(body.scheduledAt)) throw new HttpError(400, "scheduledAt must be unix seconds or null.");
    stmts.push(env.DB.prepare("UPDATE posts SET scheduled_at = ? WHERE id = ?").bind(body.scheduledAt, id));
  }
  if (body.clearSuggestion) stmts.push(env.DB.prepare("UPDATE posts SET suggestion = NULL WHERE id = ?").bind(id));
  if (Array.isArray(body.order)) {
    body.order.forEach((itemId, i) => {
      stmts.push(env.DB.prepare("UPDATE items SET position = ? WHERE id = ? AND post_id = ?").bind(i, itemId, id));
    });
  }
  if (body.alt && typeof body.alt === "object") {
    for (const [itemId, text] of Object.entries(body.alt)) {
      stmts.push(env.DB.prepare("UPDATE items SET alt_text = ? WHERE id = ? AND post_id = ?").bind(String(text).slice(0, MAX_ALT), itemId, id));
    }
  }
  if (stmts.length) {
    await env.DB.batch(stmts);
    if (body.order) await renumber(env, id);
    // A suggestion dismissal alone is not a content edit.
    const contentChanged = stmts.length > (body.clearSuggestion ? 1 : 0);
    if (contentChanged) await bump(env, id, now);
  }
  return postResponse(env, id);
}

async function addItem(env: Env, req: Request, postId: string, principal: Principal, now: number): Promise<Response> {
  const p = await loadPost(env, postId);
  assertEditable(p);
  if (principal.kind === "token" && p.status !== "draft") throw new HttpError(403, "API tokens can only add photos to drafts.");
  const count = (await env.DB.prepare("SELECT COUNT(*) AS n FROM items WHERE post_id = ?").bind(postId).first<{ n: number }>())?.n ?? 0;
  if (count >= MAX_ITEMS) throw new HttpError(400, `A post can have ${MAX_ITEMS} photos at most.`);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new HttpError(413, "Photos must be 8 MB or smaller.");
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new HttpError(413, "Photos must be 8 MB or smaller.");
  const size = jpegSize(buf);
  if (!size) throw new HttpError(415, "Only JPEG photos are accepted. The editor converts other formats for you.");
  const dhash = req.headers.get("x-dhash");
  const alt = (req.headers.get("x-alt-text") ? decodeURIComponent(req.headers.get("x-alt-text")!) : "").slice(0, MAX_ALT);
  const id = newId();
  const kvKey = `photo/${id}`;
  await env.PHOTOS.put(kvKey, buf, { metadata: { postId } });
  await env.DB.prepare(
    "INSERT INTO items (id, post_id, position, kv_key, width, height, bytes, alt_text, dhash, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, postId, count, kvKey, size.width, size.height, buf.byteLength, alt, dhash && /^[0-9a-f]{16}$/.test(dhash) ? dhash : null, now)
    .run();
  await bump(env, postId, now);
  return postResponse(env, postId);
}

async function approve(env: Env, req: Request, id: string, now: number, immediately: boolean): Promise<Response> {
  const p = await loadPost(env, id);
  assertEditable(p);
  const { version } = await readJson<{ version?: number }>(req);
  if (version !== p.version) throw new HttpError(409, "This post changed since you looked at it. Review it again before approving.");
  const items = (await itemsOf(env, [id])).get(id) ?? [];
  const problems = postProblems(p.caption, items);
  if (items.some((i) => !i.kv_key)) problems.push("A photo of this post is missing.");
  if (!(await getAccount(env))) problems.push("Connect your Instagram account in Settings first.");
  const when = immediately ? now : p.scheduled_at;
  if (!when) problems.push("Pick a date and time.");
  else if (!immediately && when < now - 300) problems.push("The scheduled time is in the past.");
  if (problems.length) throw new HttpError(422, problems.join(" "));
  await env.DB.prepare(
    "UPDATE posts SET status = 'approved', approved_version = version, scheduled_at = ?, error = NULL, attempts = 0, next_try_at = NULL, updated_at = ? WHERE id = ?",
  )
    .bind(when, now, id)
    .run();
  return postResponse(env, id);
}

async function state(env: Env, principal: Principal, now: number): Promise<Response> {
  const account = await getAccount(env);
  return json({
    kind: principal.kind,
    instagram: account
      ? {
          username: account.username,
          daysLeft: Math.max(0, Math.floor((account.expiresAt - now) / 86400)),
          refreshedAt: account.refreshedAt,
          refreshError: await getSetting(env, "ig_refresh_error"),
        }
      : null,
    cronSeenAt: Number((await getSetting(env, "cron_seen_at")) ?? 0),
    now,
  });
}

async function due(env: Env, now: number): Promise<Response> {
  const rows = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM posts GROUP BY status").all<{ status: string; n: number }>();
  const by = Object.fromEntries(rows.results.map((r) => [r.status, r.n]));
  const account = await getAccount(env);
  const daysLeft = account ? Math.floor((account.expiresAt - now) / 86400) : null;
  return json({
    drafts: by.draft ?? 0,
    approved: by.approved ?? 0,
    failed: by.failed ?? 0,
    needsApproval: by.needs_approval ?? 0,
    instagramConnected: !!account,
    tokenDaysLeft: daysLeft,
  });
}

const IMAGE_HOSTS = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/;

async function proxyImage(url: string | null): Promise<Response> {
  if (!url) return new Response("Not found", { status: 404 });
  const u = new URL(url);
  if (u.protocol !== "https:" || !IMAGE_HOSTS.test(u.hostname)) return new Response("Not found", { status: 404 });
  const res = await fetch(u.toString());
  if (!res.ok || !res.body) return new Response("Not found", { status: 404 });
  return new Response(res.body, {
    headers: { "content-type": res.headers.get("content-type") ?? "image/jpeg", "cache-control": "private, max-age=3600" },
  });
}
