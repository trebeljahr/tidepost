import type { Env } from "./env";
import { randomToken } from "./util";

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

export async function deleteSetting(env: Env, key: string): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(key).run();
}

/** A random secret generated on first use and kept in D1 (session and media signing keys). */
export async function secretSetting(env: Env, key: string): Promise<string> {
  const existing = await getSetting(env, key);
  if (existing) return existing;
  const fresh = randomToken(32);
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").bind(key, fresh).run();
  return (await getSetting(env, key))!;
}

export interface Account {
  token: string;
  userId: string;
  username: string;
  refreshedAt: number;
  expiresAt: number;
}

export async function getAccount(env: Env): Promise<Account | null> {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'ig_%'").all<{
    key: string;
    value: string;
  }>();
  const m = Object.fromEntries(results.map((r) => [r.key, r.value]));
  if (!m.ig_token || !m.ig_user_id) return null;
  return {
    token: m.ig_token,
    userId: m.ig_user_id,
    username: m.ig_username ?? "",
    refreshedAt: Number(m.ig_refreshed_at ?? 0),
    expiresAt: Number(m.ig_expires_at ?? 0),
  };
}
