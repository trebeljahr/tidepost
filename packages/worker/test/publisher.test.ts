import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { refreshTokenIfDue } from "../src/maintenance";
import { PHOTO_SETTLE_S, publishDue } from "../src/publisher";

const E = env as unknown as Env;
const NOW = 1_800_000_000;

interface Call {
  method: string;
  path: string;
  params: Record<string, string>;
}

/** Fake graph.instagram.com: answers from a handler and records every call. */
function fakeGraph(handler: (c: Call) => unknown | Response) {
  const calls: Call[] = [];
  const fetcher = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const params: Record<string, string> = Object.fromEntries(url.searchParams);
    if (init?.body instanceof URLSearchParams) Object.assign(params, Object.fromEntries(init.body));
    const call = { method, path: url.pathname.replace(/^\/v27\.0\//, "/"), params };
    calls.push(call);
    const out = handler(call);
    return out instanceof Response ? out : Response.json(out);
  };
  return { calls, fetcher };
}

async function seedAccount() {
  const rows = { ig_token: "IGTOKEN-abcdefghijklmnop", ig_user_id: "17841400000", ig_username: "rico", ig_refreshed_at: String(NOW - 3600), ig_expires_at: String(NOW + 50 * 86400), public_origin: "https://tp.example" };
  for (const [k, v] of Object.entries(rows)) await E.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(k, v).run();
}

async function seedPost(opts: { id?: string; photos?: number; scheduledAt?: number; uploadedAt?: number; status?: string; step?: string | null; container?: string | null; attempts?: number } = {}) {
  const id = opts.id ?? "p1";
  await E.DB.prepare(
    "INSERT INTO posts (id, status, caption, scheduled_at, version, approved_version, step, container_id, attempts, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, opts.status ?? "approved", "Hello #tide", opts.scheduledAt ?? NOW - 30, opts.step ?? null, opts.container ?? null, opts.attempts ?? 0, NOW - 60, NOW - 3600, NOW - 3600)
    .run();
  for (let i = 0; i < (opts.photos ?? 1); i++) {
    const itemId = `${id}-i${i}`;
    await E.PHOTOS.put(`photo/${itemId}`, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    await E.DB.prepare("INSERT INTO items (id, post_id, position, kv_key, width, height, bytes, alt_text, uploaded_at) VALUES (?, ?, ?, ?, 1080, 1350, 4, ?, ?)")
      .bind(itemId, id, i, `photo/${itemId}`, `alt ${i}`, opts.uploadedAt ?? NOW - 600)
      .run();
  }
  return id;
}

const post = (id = "p1") => E.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first<Record<string, unknown>>();

function happyGraph() {
  let n = 0;
  return fakeGraph((c) => {
    if (c.path.endsWith("/content_publishing_limit")) return { data: [{ quota_usage: 3, config: { quota_total: 50 } }] };
    if (c.method === "POST" && c.path.endsWith("/media")) return { id: `c${++n}` };
    if (c.method === "POST" && c.path.endsWith("/media_publish")) return { id: "m1" };
    if (c.params.fields === "status_code,status") return { status_code: "FINISHED" };
    if (c.params.fields === "permalink") return { permalink: "https://www.instagram.com/p/abc/" };
    throw new Error(`unexpected call ${c.method} ${c.path}`);
  });
}

beforeEach(async () => {
  await E.DB.exec("DELETE FROM items; DELETE FROM posts; DELETE FROM settings;");
  await seedAccount();
});

describe("publisher", () => {
  it("publishes a single photo in two ticks and deletes the photo", async () => {
    await seedPost();
    const g = happyGraph();
    const t1 = await publishDue(E, NOW, g.fetcher);
    expect(t1.waiting).toEqual(["p1"]);
    expect(await post()).toMatchObject({ status: "publishing", step: "poll", container_id: "c1" });
    const create = g.calls.find((c) => c.method === "POST")!;
    expect(create.params).toMatchObject({ caption: "Hello #tide", alt_text: "alt 0", image_url: expect.stringMatching(/^https:\/\/tp\.example\/media\/p1-i0\?exp=\d+&sig=/) });
    expect(create.params.is_carousel_item).toBeUndefined();

    const t2 = await publishDue(E, NOW + 60, g.fetcher);
    expect(t2.published).toEqual(["p1"]);
    expect(await post()).toMatchObject({ status: "published", ig_media_id: "m1", permalink: "https://www.instagram.com/p/abc/" });
    expect(await E.PHOTOS.get("photo/p1-i0")).toBeNull();
    expect(g.calls.filter((c) => c.path.endsWith("/media_publish"))).toHaveLength(1);
  });

  it("builds a carousel: children, child check, container with caption, publish", async () => {
    await seedPost({ photos: 3 });
    const g = happyGraph();
    await publishDue(E, NOW, g.fetcher);
    expect(await post()).toMatchObject({ step: "children_poll" });
    const children = g.calls.filter((c) => c.method === "POST");
    expect(children).toHaveLength(3);
    for (const c of children) {
      expect(c.params.is_carousel_item).toBe("true");
      expect(c.params.caption).toBeUndefined();
    }

    await publishDue(E, NOW + 60, g.fetcher);
    const carousel = g.calls.filter((c) => c.method === "POST").at(-1)!;
    expect(carousel.params).toMatchObject({ media_type: "CAROUSEL", children: "c1,c2,c3", caption: "Hello #tide" });
    expect(await post()).toMatchObject({ step: "poll", container_id: "c4" });

    const t3 = await publishDue(E, NOW + 120, g.fetcher);
    expect(t3.published).toEqual(["p1"]);
  });

  it("waits while a photo is younger than the settle time", async () => {
    await seedPost({ uploadedAt: NOW - PHOTO_SETTLE_S + 10 });
    const g = happyGraph();
    const t = await publishDue(E, NOW, g.fetcher);
    expect(t.waiting).toEqual(["p1"]);
    expect(g.calls).toHaveLength(0);
    expect(await post()).toMatchObject({ status: "approved" });
  });

  it("sends a post more than 6 hours late back for approval instead of publishing", async () => {
    await seedPost({ scheduledAt: NOW - 7 * 3600 });
    const g = happyGraph();
    await publishDue(E, NOW, g.fetcher);
    expect(g.calls).toHaveLength(0);
    expect(await post()).toMatchObject({ status: "needs_approval", approved_version: null });
  });

  it("does not touch drafts or future posts", async () => {
    await seedPost({ id: "draft", status: "draft" });
    await seedPost({ id: "future", scheduledAt: NOW + 3600 });
    const g = happyGraph();
    const t = await publishDue(E, NOW, g.fetcher);
    expect(t).toMatchObject({ published: [], failed: [], waiting: [] });
    expect(g.calls).toHaveLength(0);
  });

  it("retries transient errors with backoff, then fails after five attempts", async () => {
    await seedPost();
    const g = fakeGraph(() => new Response(JSON.stringify({ error: { message: "busy", code: 2, is_transient: true } }), { status: 500 }));
    let now = NOW;
    for (let i = 1; i <= 4; i++) {
      await publishDue(E, now, g.fetcher);
      const p = await post();
      expect(p).toMatchObject({ status: "approved", attempts: i });
      now = Number(p!.next_try_at);
    }
    await publishDue(E, now, g.fetcher);
    expect(await post()).toMatchObject({ status: "failed" });
  });

  it("fails with a clear message when Instagram rejects the token", async () => {
    await seedPost();
    const g = fakeGraph(() => new Response(JSON.stringify({ error: { message: "Error validating access token", code: 190 } }), { status: 400 }));
    await publishDue(E, NOW, g.fetcher);
    const p = await post();
    expect(p!.status).toBe("failed");
    expect(String(p!.error)).toMatch(/Paste a new one in Settings/);
    expect(String(p!.error)).not.toContain("IGTOKEN");
  });

  it("does not publish twice when a tick died during media_publish", async () => {
    await seedPost({ status: "publishing", step: "publish_call", container: "c9", attempts: 1 });
    const g = fakeGraph((c) => {
      if (c.params.fields === "status_code,status") return { status_code: "PUBLISHED" };
      throw new Error(`unexpected ${c.method} ${c.path}`);
    });
    const t = await publishDue(E, NOW, g.fetcher);
    expect(t.published).toEqual(["p1"]);
    expect(g.calls.some((c) => c.path.endsWith("/media_publish"))).toBe(false);
  });

  it("waits when the 24-hour publishing quota is used up", async () => {
    await seedPost();
    const g = fakeGraph(() => ({ data: [{ quota_usage: 50, config: { quota_total: 50 } }] }));
    await publishDue(E, NOW, g.fetcher);
    const p = await post();
    expect(p).toMatchObject({ status: "approved", next_try_at: NOW + 900 });
    expect(g.calls).toHaveLength(1);
  });

  it("fails a post whose container processing errors", async () => {
    await seedPost({ status: "publishing", step: "poll", container: "c1" });
    const g = fakeGraph(() => ({ status_code: "ERROR", status: "Unsupported image" }));
    await publishDue(E, NOW, g.fetcher);
    expect(await post()).toMatchObject({ status: "failed", error: "Instagram could not process the post: Unsupported image" });
  });
});

describe("token refresh", () => {
  it("refreshes a token older than a day and stores the new expiry", async () => {
    await E.DB.prepare("UPDATE settings SET value = ? WHERE key = 'ig_refreshed_at'").bind(String(NOW - 2 * 86400)).run();
    const g = fakeGraph((c) => {
      expect(c.path).toBe("/refresh_access_token");
      expect(c.params).toMatchObject({ grant_type: "ig_refresh_token", access_token: "IGTOKEN-abcdefghijklmnop" });
      return { access_token: "NEWTOKEN-1234567890", expires_in: 5184000 };
    });
    expect(await refreshTokenIfDue(E, NOW, g.fetcher)).toBe("refreshed");
    const tok = await E.DB.prepare("SELECT value FROM settings WHERE key = 'ig_token'").first<{ value: string }>();
    expect(tok!.value).toBe("NEWTOKEN-1234567890");
    const exp = await E.DB.prepare("SELECT value FROM settings WHERE key = 'ig_expires_at'").first<{ value: string }>();
    expect(Number(exp!.value)).toBe(NOW + 5184000);
  });

  it("skips a token refreshed less than a day ago", async () => {
    const g = fakeGraph(() => {
      throw new Error("should not call");
    });
    expect(await refreshTokenIfDue(E, NOW, g.fetcher)).toBe("skipped");
  });
});
