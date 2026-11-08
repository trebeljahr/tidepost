"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { type AppState, type Grid, type Post, ApiError, api } from "../lib/api";
import { cn } from "../lib/cn";
import { type SetupState, SignIn } from "./auth";
import { Editor } from "./editor";
import { Guide } from "./guide";
import { Settings } from "./settings";
import { Notice, btnPrimary } from "./ui";
import { Calendar, GridView, Queue } from "./views";

type Route = { view: "queue" | "calendar" | "grid" | "settings" | "guide" } | { view: "post"; id: string };

function parse(hash: string): Route {
  const [, a, b] = hash.replace(/^#/, "").split("/");
  if (a === "post" && b) return { view: "post", id: b };
  if (a === "calendar" || a === "grid" || a === "settings" || a === "guide") return { view: a };
  return { view: "queue" };
}

const TABS = [
  ["queue", "Queue"],
  ["calendar", "Calendar"],
  ["grid", "Grid"],
  ["settings", "Settings"],
] as const;

export interface TidepostAppProps {
  /** Host extension under the caption editor (HQ adds its review panel). */
  captionSlot?: Parameters<typeof Editor>[0]["captionSlot"];
  /** Skip the passkey screen when the host already authenticates requests (HQ's proxy). */
  hostAuthenticated?: boolean;
}

export function TidepostApp({ captionSlot, hostAuthenticated = false }: TidepostAppProps): ReactNode {
  const [auth, setAuth] = useState<{ signedIn: boolean; setup: SetupState } | null>(hostAuthenticated ? { signedIn: true, setup: "closed" } : null);
  const [route, setRoute] = useState<Route>({ view: "queue" });
  const [state, setState] = useState<AppState | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    on();
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const checkAuth = useCallback(() => {
    if (hostAuthenticated) return;
    api<{ signedIn: boolean; setup: SetupState }>("/api/auth/state").then(setAuth, (e) => setError(String(e.message ?? e)));
  }, [hostAuthenticated]);
  useEffect(checkAuth, [checkAuth]);

  const refresh = useCallback(() => {
    const fail = (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) checkAuth();
      else setError(e instanceof Error ? e.message : String(e));
    };
    api<AppState>("/api/state").then(setState, fail);
    api<{ posts: Post[] }>("/api/posts").then((r) => setPosts(r.posts), fail);
    api<Grid>("/api/grid").then(setGrid, () => undefined);
  }, [checkAuth]);

  useEffect(() => {
    if (!auth?.signedIn) return;
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [auth?.signedIn, refresh]);

  if (!auth) return <p className="p-6 text-sm text-zinc-500">{error ?? "Loading…"}</p>;
  if (!auth.signedIn) return <SignIn setup={auth.setup} onDone={checkAuth} />;

  const go = (hash: string) => {
    location.hash = hash;
  };
  const open = (id: string) => go(`#/post/${id}`);
  const newPost = async () => {
    try {
      const p = await api<Post>("/api/posts", { json: {} });
      open(p.id);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const ig = state?.instagram;
  const attention = posts.filter((p) => p.status === "failed" || p.status === "needs_approval").length;
  const username = ig?.username ?? grid?.username ?? "";

  return (
    <div className="mx-auto max-w-6xl px-4 py-4">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <a href="#/" className="mr-3 text-lg font-semibold text-zinc-100">
          tidepost
        </a>
        <nav className="flex gap-1">
          {TABS.map(([v, label]) => (
            <a key={v} href={`#/${v}`} className={cn("rounded-md px-3 py-1.5 text-sm", route.view === v ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-100")}>
              {label}
              {v === "queue" && attention > 0 && <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 text-xs text-white">{attention}</span>}
            </a>
          ))}
        </nav>
        <span className="flex-1" />
        <button className={btnPrimary} onClick={newPost}>
          New post
        </button>
      </header>

      <div className="mb-4 space-y-2">
        {state && !ig && route.view !== "guide" && (
          <Notice tone="warn">
            Instagram is not connected yet. Follow the <a className="underline" href="#/guide">setup guide</a>, then paste your token in <a className="underline" href="#/settings">Settings</a>.
          </Notice>
        )}
        {ig && ig.daysLeft < 14 && <Notice tone="warn">Your Instagram token expires in {ig.daysLeft} days and could not be renewed. Paste a new one in Settings.</Notice>}
        {state && state.cronSeenAt > 0 && state.now - state.cronSeenAt > 600 && <Notice tone="warn">The publisher has not run for over 10 minutes. Check the Cron Trigger of this Worker in Cloudflare.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
      </div>

      {route.view === "queue" && <Queue posts={posts} onOpen={open} />}
      {route.view === "calendar" && <Calendar posts={posts} onOpen={open} />}
      {route.view === "grid" && <GridView posts={posts} grid={grid} onOpen={open} onSynced={refresh} />}
      {route.view === "settings" && <Settings state={state} onChanged={refresh} />}
      {route.view === "guide" && <Guide />}
      {route.view === "post" && (
        <Editor key={route.id} id={route.id} username={username} avatar={!!grid?.avatar} grid={grid} posts={posts} onChanged={refresh} onClose={() => go("#/")} onOpen={open} captionSlot={captionSlot} />
      )}
    </div>
  );
}
