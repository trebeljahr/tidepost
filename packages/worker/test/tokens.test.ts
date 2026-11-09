import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { secretSetting } from "../src/settings";
import { hmac, sha256 } from "../src/util";

const E = env as unknown as Env;
const SELF = (exports as unknown as { default: Fetcher }).default;
const BASE = "https://tp.example";

async function makeToken(scopes: string): Promise<string> {
  const token = `tp_test_${scopes.replace(/ /g, "_")}_${Math.random().toString(36).slice(2)}`;
  await E.DB.prepare("INSERT INTO api_tokens (id, name, token_hash, scopes, created_at) VALUES (?, ?, ?, ?, 0)")
    .bind(crypto.randomUUID(), "test", await sha256(token), scopes)
    .run();
  return token;
}

/** A session cookie as the passkey sign-in would set it. */
async function sessionCookie(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `tp_session=${exp}.${await hmac(await secretSetting(E, "session_secret"), `s.${exp}`)}`;
}

function call(token: string, path: string, init: { method?: string; json?: unknown } = {}) {
  return SELF.fetch(`${BASE}${path}`, {
    method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
}

async function newDraft(token: string): Promise<{ id: string; version: number }> {
  const res = await call(token, "/api/posts", { json: { caption: "hello" } });
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; version: number };
}

describe("API token scopes", () => {
  it("read tokens list posts but cannot create, edit or approve", async () => {
    const read = await makeToken("read");
    const drafts = await makeToken("drafts");
    const post = await newDraft(drafts);
    expect((await call(read, "/api/posts")).status).toBe(200);
    expect((await call(read, "/api/due")).status).toBe(200);
    expect((await call(read, "/api/posts", { json: {} })).status).toBe(403);
    expect((await call(read, `/api/posts/${post.id}`, { method: "PATCH", json: { caption: "x" } })).status).toBe(403);
    expect((await call(read, `/api/posts/${post.id}/approve`, { json: { version: post.version } })).status).toBe(403);
  });

  it("drafts tokens write suggestions but never the caption, and cannot approve", async () => {
    const drafts = await makeToken("drafts");
    const post = await newDraft(drafts);
    const sug = await call(drafts, `/api/posts/${post.id}/suggestion`, { method: "PUT", json: { suggestion: "Hello there." } });
    expect(sug.status).toBe(200);
    expect(await sug.json()).toMatchObject({ caption: "hello", suggestion: "Hello there." });
    expect((await call(drafts, `/api/posts/${post.id}`, { method: "PATCH", json: { caption: "x" } })).status).toBe(403);
    expect((await call(drafts, `/api/posts/${post.id}/approve`, { json: { version: post.version } })).status).toBe(403);
    expect((await call(drafts, `/api/posts/${post.id}/publish-now`, { json: { version: post.version } })).status).toBe(403);
    expect((await call(drafts, `/api/posts/${post.id}`, { method: "DELETE" })).status).toBe(403);
  });

  it("approve tokens edit and approve posts, and imply read and drafts", async () => {
    const approve = await makeToken("approve");
    const post = await newDraft(approve);
    expect((await call(approve, "/api/posts")).status).toBe(200);
    const patched = await call(approve, `/api/posts/${post.id}`, { method: "PATCH", json: { caption: "edited" } });
    expect(patched.status).toBe(200);
    const p = (await patched.json()) as { caption: string; version: number };
    expect(p.caption).toBe("edited");
    // Past the scope check: refused for content reasons, not for lack of rights.
    const res = await call(approve, `/api/posts/${post.id}/approve`, { json: { version: p.version } });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/Add at least one photo/);
    expect((await call(approve, `/api/posts/${post.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("approve tokens cannot touch Instagram settings, passkeys or tokens", async () => {
    const approve = await makeToken("approve");
    expect((await call(approve, "/api/settings/instagram", { json: { token: "x".repeat(30) } })).status).toBe(403);
    expect((await call(approve, "/api/settings/instagram", { method: "DELETE" })).status).toBe(403);
    expect((await call(approve, "/api/tokens")).status).toBe(403);
    expect((await call(approve, "/api/tokens", { json: { scopes: ["approve"] } })).status).toBe(403);
    expect((await call(approve, "/api/passkeys")).status).toBe(403);
    expect((await call(approve, "/api/auth/signout-everywhere", { json: {} })).status).toBe(403);
  });

  it("only a signed-in person creates tokens; approve is opt-in", async () => {
    const cookie = await sessionCookie();
    const create = (scopes?: string[]) =>
      SELF.fetch(`${BASE}/api/tokens`, { method: "POST", headers: { cookie, origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ name: "t", scopes }) });

    const plain = (await (await create()).json()) as { token: string };
    expect((await call(plain.token, "/api/posts")).status).toBe(200);
    expect((await call(plain.token, "/api/posts", { json: {} })).status).toBe(403);

    const res = await create(["approve", "admin", "approve"]);
    expect(res.status).toBe(200);
    const after = (await (await SELF.fetch(`${BASE}/api/tokens`, { headers: { cookie } })).json()) as { tokens: { scopes: string }[] };
    expect(after.tokens.map((t) => t.scopes)).toContain("approve");
    expect(after.tokens.map((t) => t.scopes)).not.toContain("approve admin");

    expect((await create(["admin"])).status).toBe(400);
  });
});
