import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { Env } from "./env";
import { deleteSetting, getSetting, secretSetting, setSetting } from "./settings";
import { HttpError, b64url, fromB64url, hmac, newId, nowSec, randomToken, readJson, safeEqual, sha256 } from "./util";

const COOKIE = "tp_session";
const SESSION_DAYS = 30;
const MIN_SETUP_CODE = 12;

export type Principal = { kind: "session" } | { kind: "token"; scopes: Set<string>; id: string };

function rp(req: Request) {
  const url = new URL(req.url);
  return { rpID: url.hostname, origin: url.origin };
}

// --- sessions -----------------------------------------------------------------

async function sessionCookie(env: Env, req: Request): Promise<string> {
  const exp = nowSec() + SESSION_DAYS * 86400;
  const sig = await hmac(await secretSetting(env, "session_secret"), `s.${exp}`);
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${exp}.${sig}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

async function hasSession(env: Env, req: Request): Promise<boolean> {
  const raw = (req.headers.get("cookie") ?? "")
    .split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!raw) return false;
  const [exp, sig] = raw.split(".");
  if (!exp || !sig || Number(exp) < nowSec()) return false;
  const want = await hmac(await secretSetting(env, "session_secret"), `s.${exp}`);
  return safeEqual(want, sig);
}

/** Who is calling: a signed-in browser or an API token. Throws 401 otherwise. */
export async function authenticate(env: Env, req: Request): Promise<Principal> {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const hash = await sha256(auth.slice(7).trim());
    const row = await env.DB.prepare("SELECT id, scopes FROM api_tokens WHERE token_hash = ?").bind(hash).first<{ id: string; scopes: string }>();
    if (!row) throw new HttpError(401, "Unknown API token.");
    await env.DB.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").bind(nowSec(), row.id).run();
    return { kind: "token", scopes: new Set(row.scopes.split(" ")), id: row.id };
  }
  if (await hasSession(env, req)) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      // SameSite=Strict already blocks cross-site cookies; check Origin as a second guard.
      const origin = req.headers.get("origin");
      if (origin && origin !== new URL(req.url).origin) throw new HttpError(403, "Cross-origin request refused.");
    }
    return { kind: "session" };
  }
  throw new HttpError(401, "Sign in first.");
}

export function requireSession(p: Principal) {
  if (p.kind !== "session") throw new HttpError(403, "This needs a signed-in browser, not an API token.");
}

export function requireScope(p: Principal, scope: "read" | "drafts") {
  if (p.kind === "session") return;
  if (!p.scopes.has(scope)) throw new HttpError(403, `API token lacks the "${scope}" scope.`);
}

// --- challenges -----------------------------------------------------------------

async function saveChallenge(env: Env, kind: string, challenge: string): Promise<string> {
  const id = newId();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM challenges WHERE expires_at < ?").bind(nowSec()),
    env.DB.prepare("INSERT INTO challenges (id, challenge, kind, expires_at) VALUES (?, ?, ?, ?)").bind(id, challenge, kind, nowSec() + 300),
  ]);
  return id;
}

async function takeChallenge(env: Env, id: unknown, kind: string): Promise<string> {
  if (typeof id !== "string") throw new HttpError(400, "Missing challengeId.");
  const row = await env.DB.prepare("DELETE FROM challenges WHERE id = ? AND kind = ? AND expires_at >= ? RETURNING challenge")
    .bind(id, kind, nowSec())
    .first<{ challenge: string }>();
  if (!row) throw new HttpError(400, "Sign-in attempt expired. Try again.");
  return row.challenge;
}

// --- setup ---------------------------------------------------------------------

async function passkeyCount(env: Env): Promise<number> {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM passkeys").first<{ n: number }>())?.n ?? 0;
}

/** Setup is open while no passkey exists, or after SETUP_CODE was changed since its last use. */
export async function setupState(env: Env): Promise<"open" | "closed" | "missing_code" | "weak_code"> {
  const code = env.SETUP_CODE ?? "";
  if (!code) return "missing_code";
  if (code.length < MIN_SETUP_CODE) return "weak_code";
  if ((await passkeyCount(env)) === 0) return "open";
  const used = await getSetting(env, "setup_code_used");
  return used && used === (await sha256(code)) ? "closed" : "open";
}

async function checkSetupCode(env: Env, code: unknown) {
  if ((await setupState(env)) !== "open") throw new HttpError(403, "Setup is closed. Change SETUP_CODE in Cloudflare to reopen it.");
  if (typeof code !== "string" || !(await safeEqual(code, env.SETUP_CODE!))) throw new HttpError(403, "Wrong setup code.");
}

async function registrationOptions(env: Env, req: Request, kind: string) {
  const { results } = await env.DB.prepare("SELECT id, transports FROM passkeys").all<{ id: string; transports: string | null }>();
  const userId = await secretSetting(env, "webauthn_user_id");
  const options = await generateRegistrationOptions({
    rpName: "tidepost",
    rpID: rp(req).rpID,
    userName: "owner",
    userDisplayName: "tidepost owner",
    userID: fromB64url(userId),
    attestationType: "none",
    excludeCredentials: results.map((r) => ({ id: r.id, transports: r.transports ? JSON.parse(r.transports) : undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  const challengeId = await saveChallenge(env, kind, options.challenge);
  return { challengeId, options };
}

async function storeRegistration(env: Env, req: Request, kind: string, body: any) {
  const expectedChallenge = await takeChallenge(env, body.challengeId, kind);
  const { rpID, origin } = rp(req);
  let v: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    v = await verifyRegistrationResponse({ response: body.response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID });
  } catch (e) {
    throw new HttpError(400, `Passkey not accepted: ${(e as Error).message}`);
  }
  if (!v.verified || !v.registrationInfo) throw new HttpError(400, "Passkey not accepted.");
  const c = v.registrationInfo.credential;
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : "Passkey";
  await env.DB.prepare("INSERT INTO passkeys (id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(c.id, b64url(c.publicKey), c.counter, JSON.stringify(c.transports ?? []), name, nowSec())
    .run();
}

// --- routes --------------------------------------------------------------------

export async function handleAuth(env: Env, req: Request, path: string): Promise<Response | null> {
  const ok = (data: unknown, cookie?: string) =>
    new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json", "cache-control": "no-store", ...(cookie ? { "set-cookie": cookie } : {}) },
    });

  if (path === "/api/auth/state" && req.method === "GET") {
    return ok({ signedIn: await hasSession(env, req), setup: await setupState(env) });
  }

  if (path === "/api/auth/setup/options" && req.method === "POST") {
    const body = await readJson<{ code?: string }>(req);
    await checkSetupCode(env, body.code);
    return ok(await registrationOptions(env, req, "setup"));
  }

  if (path === "/api/auth/setup/verify" && req.method === "POST") {
    const body = await readJson<any>(req);
    await checkSetupCode(env, body.code);
    await storeRegistration(env, req, "setup", body);
    await setSetting(env, "setup_code_used", await sha256(env.SETUP_CODE!));
    return ok({ ok: true }, await sessionCookie(env, req));
  }

  if (path === "/api/auth/login/options" && req.method === "POST") {
    const options = await generateAuthenticationOptions({ rpID: rp(req).rpID, userVerification: "preferred" });
    return ok({ challengeId: await saveChallenge(env, "login", options.challenge), options });
  }

  if (path === "/api/auth/login/verify" && req.method === "POST") {
    const body = await readJson<any>(req);
    const expectedChallenge = await takeChallenge(env, body.challengeId, "login");
    const credId = body.response?.id;
    const row = await env.DB.prepare("SELECT * FROM passkeys WHERE id = ?").bind(credId).first<{
      id: string;
      public_key: string;
      counter: number;
      transports: string | null;
    }>();
    if (!row) throw new HttpError(401, "This passkey is not registered here.");
    const { rpID, origin } = rp(req);
    let v: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      v = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: { id: row.id, publicKey: fromB64url(row.public_key), counter: row.counter, transports: row.transports ? JSON.parse(row.transports) : undefined },
      });
    } catch (e) {
      throw new HttpError(401, `Sign-in failed: ${(e as Error).message}`);
    }
    if (!v.verified) throw new HttpError(401, "Sign-in failed.");
    await env.DB.prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?").bind(v.authenticationInfo.newCounter, nowSec(), row.id).run();
    return ok({ ok: true }, await sessionCookie(env, req));
  }

  if (path === "/api/auth/logout" && req.method === "POST") {
    return ok({ ok: true }, clearCookie());
  }

  // Everything below needs a signed-in browser.
  if (!path.startsWith("/api/auth/") && !path.startsWith("/api/passkeys") && !path.startsWith("/api/tokens")) return null;
  const p = await authenticate(env, req);
  requireSession(p);

  if (path === "/api/passkeys" && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, name, created_at, last_used_at FROM passkeys ORDER BY created_at").all();
    return ok({ passkeys: results });
  }
  if (path === "/api/passkeys/options" && req.method === "POST") return ok(await registrationOptions(env, req, "add"));
  if (path === "/api/passkeys/verify" && req.method === "POST") {
    await storeRegistration(env, req, "add", await readJson(req));
    return ok({ ok: true });
  }
  const pk = path.match(/^\/api\/passkeys\/([\w-]+)$/);
  if (pk && req.method === "DELETE") {
    if ((await passkeyCount(env)) <= 1) throw new HttpError(400, "This is your only passkey. Add another one first.");
    await env.DB.prepare("DELETE FROM passkeys WHERE id = ?").bind(pk[1]).run();
    return ok({ ok: true });
  }
  if (path === "/api/auth/signout-everywhere" && req.method === "POST") {
    await deleteSetting(env, "session_secret");
    return ok({ ok: true }, clearCookie());
  }

  if (path === "/api/tokens" && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, name, scopes, created_at, last_used_at FROM api_tokens ORDER BY created_at").all();
    return ok({ tokens: results });
  }
  if (path === "/api/tokens" && req.method === "POST") {
    const body = await readJson<{ name?: string; scopes?: string[] }>(req);
    const scopes = (body.scopes ?? ["read"]).filter((s) => s === "read" || s === "drafts");
    if (!scopes.length) throw new HttpError(400, "Pick at least one scope: read, drafts.");
    const token = `tp_${randomToken(24)}`;
    const id = newId();
    await env.DB.prepare("INSERT INTO api_tokens (id, name, token_hash, scopes, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, (body.name ?? "API token").slice(0, 60), await sha256(token), scopes.join(" "), nowSec())
      .run();
    return ok({ id, token });
  }
  const tk = path.match(/^\/api\/tokens\/([\w-]+)$/);
  if (tk && req.method === "DELETE") {
    await env.DB.prepare("DELETE FROM api_tokens WHERE id = ?").bind(tk[1]).run();
    return ok({ ok: true });
  }
  return null;
}
