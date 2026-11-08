import type { Env } from "./env";
import { secretSetting } from "./settings";
import { hmac, nowSec, safeEqual } from "./util";

const TTL = 3600;

/** Public, expiring URL Meta's servers fetch the JPEG from. */
export async function signedMediaUrl(env: Env, origin: string, itemId: string, now = nowSec()): Promise<string> {
  const exp = now + TTL;
  const sig = await hmac(await secretSetting(env, "media_secret"), `m.${itemId}.${exp}`);
  return `${origin}/media/${itemId}?exp=${exp}&sig=${sig}`;
}

export async function serveMedia(env: Env, req: Request, itemId: string): Promise<Response> {
  const url = new URL(req.url);
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") ?? "";
  const notFound = () => new Response("Not found", { status: 404 });
  if (!exp || exp < nowSec() || !/^[\w-]+$/.test(itemId)) return notFound();
  const want = await hmac(await secretSetting(env, "media_secret"), `m.${itemId}.${exp}`);
  if (!(await safeEqual(want, sig))) return notFound();
  return photoResponse(env, itemId, "private, max-age=600");
}

export async function photoResponse(env: Env, itemId: string, cache: string): Promise<Response> {
  const row = await env.DB.prepare("SELECT kv_key FROM items WHERE id = ?").bind(itemId).first<{ kv_key: string | null }>();
  if (!row?.kv_key) return new Response("Not found", { status: 404 });
  const body = await env.PHOTOS.get(row.kv_key, "stream");
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(body, { headers: { "content-type": "image/jpeg", "cache-control": cache } });
}
