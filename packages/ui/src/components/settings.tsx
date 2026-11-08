"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { type AppState, api } from "../lib/api";
import { fmt, relative } from "../lib/time";
import { Card, Notice, btn, btnDanger, btnPrimary, input } from "./ui";

interface Passkey {
  id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}
interface Token {
  id: string;
  name: string;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
}

export function Settings({ state, onChanged }: { state: AppState | null; onChanged: () => void }): ReactNode {
  const [token, setToken] = useState("");
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [newToken, setNewToken] = useState<{ name: string; read: boolean; drafts: boolean }>({ name: "", read: true, drafts: false });
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const load = useCallback(() => {
    api<{ passkeys: Passkey[] }>("/api/passkeys").then((r) => setPasskeys(r.passkeys), () => undefined);
    api<{ tokens: Token[] }>("/api/tokens").then((r) => setTokens(r.tokens), () => undefined);
  }, []);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ tone: "info", text });
      load();
      onChanged();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const ig = state?.instagram;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Card>
        <h2 className="mb-1 font-medium text-zinc-100">Instagram</h2>
        {ig ? (
          <div className="space-y-2 text-sm text-zinc-300">
            <p>
              Connected as <span className="font-medium text-white">@{ig.username}</span>. The token is valid for {ig.daysLeft} more days and renews itself daily (last renewed {relative(ig.refreshedAt)}).
            </p>
            {ig.refreshError && <Notice tone="warn">Last renewal failed: {ig.refreshError}</Notice>}
          </div>
        ) : (
          <p className="text-sm text-zinc-400">
            Not connected. Create a token in your Meta app (steps in the{" "}
            <a className="text-sky-300 hover:underline" href="#/guide">
              setup guide
            </a>
            ), then paste it here.
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <input className={input} type="password" placeholder={ig ? "Paste a new token to replace the current one" : "Instagram access token"} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
          <button
            className={btnPrimary}
            disabled={busy || token.trim().length < 20}
            onClick={() =>
              run(async () => {
                const r = await api<{ username: string }>("/api/settings/instagram", { json: { token } });
                setToken("");
                return `Connected as @${r.username}.`;
              })
            }
          >
            Connect
          </button>
        </div>
        {ig && (
          <button className="mt-3 text-xs text-zinc-500 hover:text-rose-300" disabled={busy} onClick={() => run(async () => (await api("/api/settings/instagram", { method: "DELETE" }), "Disconnected. Scheduled posts wait until you connect again."))}>
            Disconnect and forget the token
          </button>
        )}
        {state && (
          <p className="mt-3 text-xs text-zinc-500">
            Publisher last ran {state.cronSeenAt ? relative(state.cronSeenAt, state.now) : "never"}
            {state.cronSeenAt && state.now - state.cronSeenAt > 600 ? " — check the Cron Trigger in Cloudflare." : "."}
          </p>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-medium text-zinc-100">Passkeys</h2>
        <ul className="mb-3 space-y-1 text-sm">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-zinc-300">
              <span className="flex-1">
                {p.name} <span className="text-xs text-zinc-500">added {fmt(p.created_at, { day: "numeric", month: "short", year: "numeric" })}, used {p.last_used_at ? relative(p.last_used_at) : "never"}</span>
              </span>
              {passkeys.length > 1 && (
                <button className="text-xs text-zinc-500 hover:text-rose-300" onClick={() => run(async () => void (await api(`/api/passkeys/${p.id}`, { method: "DELETE" })))}>
                  remove
                </button>
              )}
            </li>
          ))}
        </ul>
        <button
          className={btn}
          disabled={busy}
          onClick={() =>
            run(async () => {
              const { challengeId, options } = await api<{ challengeId: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("/api/passkeys/options", { json: {} });
              const response = await startRegistration({ optionsJSON: options });
              await api("/api/passkeys/verify", { json: { challengeId, response, name: navigator.platform || "Passkey" } });
              return "Passkey added.";
            })
          }
        >
          Add a passkey on this device
        </button>
      </Card>

      <Card>
        <h2 className="mb-1 font-medium text-zinc-100">API tokens</h2>
        <p className="mb-3 text-sm text-zinc-400">
          For scripts and helpers you run yourself. <b>read</b> lists posts; <b>drafts</b> creates drafts, adds photos and attaches caption suggestions. No token can approve or publish.
        </p>
        <ul className="mb-3 space-y-1 text-sm">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-zinc-300">
              <span className="flex-1">
                {t.name} <span className="text-xs text-zinc-500">({t.scopes}) used {t.last_used_at ? relative(t.last_used_at) : "never"}</span>
              </span>
              <button className="text-xs text-zinc-500 hover:text-rose-300" onClick={() => run(async () => void (await api(`/api/tokens/${t.id}`, { method: "DELETE" })))}>
                revoke
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${input} max-w-xs`} placeholder="Name, e.g. phone shortcut" value={newToken.name} onChange={(e) => setNewToken({ ...newToken, name: e.target.value })} />
          <label className="flex items-center gap-1 text-sm text-zinc-300">
            <input type="checkbox" checked={newToken.read} onChange={(e) => setNewToken({ ...newToken, read: e.target.checked })} /> read
          </label>
          <label className="flex items-center gap-1 text-sm text-zinc-300">
            <input type="checkbox" checked={newToken.drafts} onChange={(e) => setNewToken({ ...newToken, drafts: e.target.checked })} /> drafts
          </label>
          <button
            className={btn}
            disabled={busy || (!newToken.read && !newToken.drafts)}
            onClick={() =>
              run(async () => {
                const scopes = [newToken.read && "read", newToken.drafts && "drafts"].filter(Boolean);
                const r = await api<{ token: string }>("/api/tokens", { json: { name: newToken.name || "API token", scopes } });
                setShown(r.token);
                setNewToken({ name: "", read: true, drafts: false });
              })
            }
          >
            Create
          </button>
        </div>
        {shown && (
          <div className="mt-3">
            <Notice>
              Copy it now; it is not shown again: <code className="break-all text-emerald-300">{shown}</code>
            </Notice>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-medium text-zinc-100">Session</h2>
        <div className="flex gap-2">
          <button className={btn} onClick={() => run(async () => (await api("/api/auth/logout", { json: {} }), location.reload()))}>
            Sign out
          </button>
          <button className={btnDanger} onClick={() => run(async () => (await api("/api/auth/signout-everywhere", { json: {} }), location.reload()))}>
            Sign out on all devices
          </button>
        </div>
      </Card>
    </div>
  );
}
