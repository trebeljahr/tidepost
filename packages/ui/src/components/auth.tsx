"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { type ReactNode, useState } from "react";
import { api } from "../lib/api";
import { Card, Notice, btnPrimary, input } from "./ui";

export type SetupState = "open" | "closed" | "missing_code" | "weak_code";

export function SignIn({ setup, onDone }: { setup: SetupState; onDone: () => void }): ReactNode {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const register = () =>
    run(async () => {
      const { challengeId, options } = await api<{ challengeId: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("/api/auth/setup/options", { json: { code } });
      const response = await startRegistration({ optionsJSON: options });
      await api("/api/auth/setup/verify", { json: { code, challengeId, response, name: name || "First passkey" } });
    });

  const login = () =>
    run(async () => {
      const { challengeId, options } = await api<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("/api/auth/login/options", { json: {} });
      const response = await startAuthentication({ optionsJSON: options });
      await api("/api/auth/login/verify", { json: { challengeId, response } });
    });

  return (
    <div className="mx-auto mt-16 max-w-md px-4">
      <h1 className="mb-1 text-2xl font-semibold text-zinc-100">tidepost</h1>
      <p className="mb-6 text-sm text-zinc-400">Your own Instagram scheduler.</p>
      {setup === "missing_code" || setup === "weak_code" ? (
        <Notice tone="warn">
          {setup === "missing_code" ? "This deploy has no SETUP_CODE secret yet." : "SETUP_CODE is shorter than 12 characters."} Set it in Cloudflare: Workers &amp; Pages → tidepost → Settings → Variables and Secrets. Then reload this page.
        </Notice>
      ) : setup === "open" ? (
        <Card>
          <h2 className="mb-2 font-medium text-zinc-100">Set up your passkey</h2>
          <p className="mb-4 text-sm text-zinc-400">Type the SETUP_CODE you chose when you deployed. Your device then creates a passkey for this site. After that, you sign in with the passkey only.</p>
          <label className="mb-1 block text-xs text-zinc-400" htmlFor="code">Setup code</label>
          <input id="code" type="password" autoComplete="off" className={input} value={code} onChange={(e) => setCode(e.target.value)} />
          <label className="mb-1 mt-3 block text-xs text-zinc-400" htmlFor="pkname">Name for this passkey (optional)</label>
          <input id="pkname" className={input} placeholder="MacBook" value={name} onChange={(e) => setName(e.target.value)} />
          <button className={`${btnPrimary} mt-4 w-full`} disabled={busy || code.length < 12} onClick={register}>
            {busy ? "Waiting for your device…" : "Create passkey"}
          </button>
          <button className="mt-3 w-full text-center text-xs text-zinc-500 hover:text-zinc-300" onClick={login} disabled={busy}>
            I already have a passkey for this site
          </button>
        </Card>
      ) : (
        <Card>
          <button className={`${btnPrimary} w-full`} disabled={busy} onClick={login}>
            {busy ? "Waiting for your device…" : "Sign in with passkey"}
          </button>
          <p className="mt-3 text-xs text-zinc-500">Lost your passkeys? Change SETUP_CODE in Cloudflare; this page then lets you register a new one.</p>
        </Card>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </div>
  );
}
