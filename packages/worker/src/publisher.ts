// Publishes approved posts. Runs from the every-minute cron. Each tick moves each due post
// at most a few steps and saves state after every Graph call, so a crash or a free-plan
// limit never publishes a post twice.
import type { Env } from "./env";
import { Graph, GraphError, type FetchLike } from "./graph";
import { signedMediaUrl } from "./media";
import { getAccount, getSetting, setSetting } from "./settings";

/** Graph calls one tick may make (Workers free plan: 50 external subrequests per invocation). */
export const CALL_BUDGET = 40;
/** A photo must be this old before Meta fetches it (KV reaches other locations within ~60 s). */
export const PHOTO_SETTLE_S = 120;
/** Posts later than this go back to "needs approval" instead of going out at a surprising time. */
export const MAX_LATE_S = 6 * 3600;
/** Give up on a container that is still processing after this long. */
export const POLL_LIMIT_S = 5 * 60;
const MAX_ATTEMPTS = 5;

export interface PostRow {
  id: string;
  status: string;
  caption: string;
  scheduled_at: number | null;
  step: string | null;
  container_id: string | null;
  started_at: number | null;
  attempts: number;
  next_try_at: number | null;
}

export interface ItemRow {
  id: string;
  position: number;
  kv_key: string | null;
  alt_text: string;
  container_id: string | null;
  child_ready: number;
  uploaded_at: number;
}

export interface TickResult {
  published: string[];
  failed: string[];
  waiting: string[];
  calls: number;
}

class OutOfBudget extends Error {}

export async function publishDue(env: Env, now: number, fetcher?: FetchLike): Promise<TickResult> {
  const result: TickResult = { published: [], failed: [], waiting: [], calls: 0 };
  const { results: posts } = await env.DB.prepare(
    `SELECT id, status, caption, scheduled_at, step, container_id, started_at, attempts, next_try_at FROM posts
     WHERE (status = 'approved' AND scheduled_at <= ?1) OR status = 'publishing'
     ORDER BY scheduled_at`,
  )
    .bind(now)
    .all<PostRow>();
  if (!posts.length) return result;

  const account = await getAccount(env);
  const origin = await getSetting(env, "public_origin");
  if (!account || !origin) {
    for (const p of posts) {
      if (p.status === "approved" && now - (p.scheduled_at ?? now) > MAX_LATE_S) await needsApproval(env, p, now, "Not published: Instagram was not connected in time.");
      else result.waiting.push(p.id);
    }
    return result;
  }

  const graph = new Graph(account.token, env.GRAPH_BASE, fetcher);
  for (const post of posts) {
    if (post.next_try_at && post.next_try_at > now) {
      result.waiting.push(post.id);
      continue;
    }
    try {
      const outcome = await advance(env, graph, account.userId, origin, post, now);
      result[outcome].push(post.id);
    } catch (e) {
      if (e instanceof OutOfBudget) {
        result.waiting.push(post.id);
        break;
      }
      const err = e instanceof GraphError ? e : new GraphError(String((e as Error)?.message ?? e), false);
      const attempts = post.attempts + 1;
      if (err.retryable && attempts < MAX_ATTEMPTS) {
        await env.DB.prepare("UPDATE posts SET attempts = ?, next_try_at = ?, error = ?, updated_at = ? WHERE id = ?")
          .bind(attempts, now + 60 * attempts, `Will retry: ${err.message}`, now, post.id)
          .run();
        result.waiting.push(post.id);
      } else {
        const msg = err.auth ? `Instagram refused the token. Paste a new one in Settings, then retry. (${err.message})` : err.message;
        await fail(env, post.id, now, msg);
        result.failed.push(post.id);
      }
    }
  }
  result.calls = graph.calls;
  return result;
}

async function advance(env: Env, graph: Graph, igId: string, origin: string, post: PostRow, now: number): Promise<"published" | "failed" | "waiting"> {
  const budget = (n: number) => {
    if (graph.calls + n > CALL_BUDGET) throw new OutOfBudget();
  };
  const { results: items } = await env.DB.prepare(
    "SELECT id, position, kv_key, alt_text, container_id, child_ready, uploaded_at FROM items WHERE post_id = ? ORDER BY position",
  )
    .bind(post.id)
    .all<ItemRow>();

  if (post.status === "approved") {
    if (now - (post.scheduled_at ?? now) > MAX_LATE_S) {
      await needsApproval(env, post, now, "Not published: it was more than 6 hours late. Pick a new time and approve again.");
      return "waiting";
    }
    if (!items.length || items.some((i) => !i.kv_key)) {
      await fail(env, post.id, now, "A photo of this post is missing.");
      return "failed";
    }
    if (items.some((i) => now - i.uploaded_at < PHOTO_SETTLE_S)) return "waiting";
    budget(1);
    const limit = await graph.publishingLimit(igId);
    if (limit.total > 0 && limit.usage >= limit.total) {
      await env.DB.prepare("UPDATE posts SET next_try_at = ?, error = ?, updated_at = ? WHERE id = ?")
        .bind(now + 15 * 60, `Instagram's limit of ${limit.total} posts per 24 hours is used up. Trying again in 15 minutes.`, now, post.id)
        .run();
      return "waiting";
    }
    post.status = "publishing";
    post.step = "children";
    await env.DB.prepare("UPDATE posts SET status = 'publishing', step = 'children', container_id = NULL, started_at = NULL, error = NULL, updated_at = ? WHERE id = ?")
      .bind(now, post.id)
      .run();
  }

  const single = items.length === 1;

  if (post.step === "children" && single) {
    budget(1);
    const url = await signedMediaUrl(env, origin, items[0].id, now);
    const cid = await graph.createImage(igId, url, { caption: post.caption, altText: items[0].alt_text });
    await setStep(env, post, now, "poll", cid);
    return "waiting"; // poll next tick (Meta asks for at most one status call per minute)
  }

  if (post.step === "children") {
    for (const it of items) {
      if (it.container_id) continue;
      budget(1);
      const url = await signedMediaUrl(env, origin, it.id, now);
      it.container_id = await graph.createImage(igId, url, { altText: it.alt_text, carouselItem: true });
      await env.DB.prepare("UPDATE items SET container_id = ? WHERE id = ?").bind(it.container_id, it.id).run();
    }
    await setStep(env, post, now, "children_poll", null);
    return "waiting"; // check the children next tick
  }

  if (post.step === "children_poll") {
    for (const it of items) {
      if (it.child_ready) continue;
      budget(1);
      const st = await graph.status(it.container_id!);
      if (st.code === "FINISHED") {
        it.child_ready = 1;
        await env.DB.prepare("UPDATE items SET child_ready = 1 WHERE id = ?").bind(it.id).run();
      } else if (st.code === "ERROR" || st.code === "EXPIRED") {
        await fail(env, post.id, now, `Instagram could not process photo ${it.position + 1}: ${st.detail || st.code}`);
        return "failed";
      } else if (now - (post.started_at ?? now) > POLL_LIMIT_S) {
        await fail(env, post.id, now, `Instagram was still processing photo ${it.position + 1} after 5 minutes.`);
        return "failed";
      }
      if (st.code !== "FINISHED") return "waiting";
    }
    budget(1);
    const cid = await graph.createCarousel(igId, items.map((i) => i.container_id!), post.caption);
    await setStep(env, post, now, "poll", cid);
    return "waiting"; // poll next tick (Meta asks for at most one status call per minute)
  }

  if (post.step === "poll") {
    budget(1);
    const st = await graph.status(post.container_id!);
    if (st.code === "PUBLISHED") return finish(env, graph, post, now, null);
    if (st.code === "ERROR" || st.code === "EXPIRED") {
      await fail(env, post.id, now, `Instagram could not process the post: ${st.detail || st.code}`);
      return "failed";
    }
    if (st.code !== "FINISHED") {
      if (now - (post.started_at ?? now) > POLL_LIMIT_S) {
        await fail(env, post.id, now, "Instagram was still processing the post after 5 minutes.");
        return "failed";
      }
      return "waiting";
    }
    await setStep(env, post, now, "publish_call", post.container_id, false);
  }

  if (post.step === "publish_call") {
    // If a previous tick died during media_publish, the container tells us whether it went out.
    budget(3);
    if (post.attempts > 0) {
      const st = await graph.status(post.container_id!);
      if (st.code === "PUBLISHED") return finish(env, graph, post, now, null);
    }
    const mediaId = await graph.publish(igId, post.container_id!);
    return finish(env, graph, post, now, mediaId);
  }

  return "waiting";
}

async function setStep(env: Env, post: PostRow, now: number, step: string, containerId: string | null, restartClock = true) {
  post.step = step;
  if (containerId !== null) post.container_id = containerId;
  if (restartClock) post.started_at = now;
  await env.DB.prepare("UPDATE posts SET step = ?, container_id = ?, started_at = ?, updated_at = ? WHERE id = ?")
    .bind(step, post.container_id, post.started_at, now, post.id)
    .run();
}

async function finish(env: Env, graph: Graph, post: PostRow, now: number, mediaId: string | null): Promise<"published"> {
  let permalink: string | null = null;
  if (mediaId) {
    try {
      permalink = await graph.permalink(mediaId);
    } catch {
      // The post is live; the link is a nice-to-have.
    }
  }
  await env.DB.prepare(
    "UPDATE posts SET status = 'published', step = NULL, ig_media_id = ?, permalink = ?, published_at = ?, error = NULL, next_try_at = NULL, updated_at = ? WHERE id = ?",
  )
    .bind(mediaId, permalink, now, now, post.id)
    .run();
  await deletePhotos(env, post.id);
  await setSetting(env, "grid_dirty", "1");
  return "published";
}

export async function deletePhotos(env: Env, postId: string) {
  const { results } = await env.DB.prepare("SELECT id, kv_key FROM items WHERE post_id = ? AND kv_key IS NOT NULL").bind(postId).all<{
    id: string;
    kv_key: string;
  }>();
  for (const r of results) await env.PHOTOS.delete(r.kv_key);
  await env.DB.prepare("UPDATE items SET kv_key = NULL WHERE post_id = ?").bind(postId).run();
}

async function fail(env: Env, id: string, now: number, error: string) {
  await env.DB.prepare("UPDATE posts SET status = 'failed', step = NULL, error = ?, next_try_at = NULL, updated_at = ? WHERE id = ?").bind(error, now, id).run();
}

async function needsApproval(env: Env, post: PostRow, now: number, error: string) {
  await env.DB.prepare("UPDATE posts SET status = 'needs_approval', approved_version = NULL, error = ?, updated_at = ? WHERE id = ?")
    .bind(error, now, post.id)
    .run();
}

/** Reset a failed post so the next tick tries again from the start. */
export async function resetForRetry(env: Env, id: string, now: number) {
  await env.DB.batch([
    env.DB.prepare("UPDATE items SET container_id = NULL, child_ready = 0 WHERE post_id = ?").bind(id),
    env.DB.prepare(
      "UPDATE posts SET status = 'approved', step = NULL, container_id = NULL, started_at = NULL, attempts = 0, next_try_at = NULL, error = NULL, scheduled_at = ?, updated_at = ? WHERE id = ?",
    ).bind(now, now, id),
  ]);
}
