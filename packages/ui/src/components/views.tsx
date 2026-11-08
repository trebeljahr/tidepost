"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { type Grid, type Post, api, avatarUrl, photoUrl } from "../lib/api";
import { cn } from "../lib/cn";
import { dhashOfUrl } from "../lib/image";
import { dayKey, fmt, relative } from "../lib/time";
import { ProfileGrid } from "./preview";
import { Card, Chip, btn } from "./ui";

function Row({ post, onOpen }: { post: Post; onOpen: () => void }): ReactNode {
  const cover = post.items.find((i) => i.hasPhoto);
  const when = post.status === "published" ? post.publishedAt : post.scheduledAt;
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-zinc-900">
      {cover ? <img src={photoUrl(cover.id)} alt="" className="h-12 w-12 flex-none rounded object-cover" /> : <span className="h-12 w-12 flex-none rounded bg-zinc-800" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-zinc-100">{post.caption.split("\n")[0] || <span className="text-zinc-500">No caption</span>}</span>
        <span className="block text-xs text-zinc-500">
          {fmt(when)} {when ? `· ${relative(when)}` : ""} · {post.items.length} photo{post.items.length === 1 ? "" : "s"}
          {post.source === "api" ? " · from API" : ""}
        </span>
      </span>
      <Chip status={post.status} />
    </button>
  );
}

export function Queue({ posts, onOpen }: { posts: Post[]; onOpen: (id: string) => void }): ReactNode {
  const groups: { title: string; list: Post[] }[] = [
    { title: "Needs your attention", list: posts.filter((p) => p.status === "failed" || p.status === "needs_approval") },
    { title: "Scheduled", list: posts.filter((p) => p.status === "approved" || p.status === "publishing").sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0)) },
    { title: "Drafts", list: posts.filter((p) => p.status === "draft").sort((a, b) => b.updatedAt - a.updatedAt) },
    { title: "Published", list: posts.filter((p) => p.status === "published").sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)).slice(0, 30) },
  ];
  return (
    <div className="space-y-4">
      {groups.map(
        (g) =>
          g.list.length > 0 && (
            <Card key={g.title} className="p-2">
              <h2 className="px-2 pb-1 pt-1 text-sm font-medium text-zinc-400">{g.title}</h2>
              {g.list.map((p) => (
                <Row key={p.id} post={p} onOpen={() => onOpen(p.id)} />
              ))}
            </Card>
          ),
      )}
      {!posts.length && <p className="py-12 text-center text-sm text-zinc-500">No posts yet. Start with “New post”.</p>}
    </div>
  );
}

export function Calendar({ posts, onOpen }: { posts: Post[]; onOpen: (id: string) => void }): ReactNode {
  const [offset, setOffset] = useState(0);
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const today = dayKey(Math.floor(Date.now() / 1000));
  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const p of posts) {
      const t = p.status === "published" ? p.publishedAt : p.scheduledAt;
      if (t) map.set(dayKey(t), [...(map.get(dayKey(t)) ?? []), p]);
    }
    return map;
  }, [posts]);
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <button className={btn} onClick={() => setOffset(offset - 1)} aria-label="Previous month">
          ‹
        </button>
        <span className="flex-1 text-center text-zinc-200">{first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <button className={btn} onClick={() => setOffset(offset + 1)} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs text-zinc-500">
        {Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "short" })).map((d) => (
          <div key={d} className="text-center">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const key = dayKey(Math.floor(d.getTime() / 1000));
          const list = byDay.get(key) ?? [];
          return (
            <div key={key} className={cn("min-h-20 rounded border p-1", key === today ? "border-emerald-600" : "border-zinc-800", d.getMonth() !== first.getMonth() && "opacity-40")}>
              <span>{d.getDate()}</span>
              {list.map((p) => {
                const cover = p.items.find((i) => i.hasPhoto);
                return (
                  <button key={p.id} onClick={() => onOpen(p.id)} className="mt-1 flex w-full items-center gap-1 overflow-hidden rounded bg-zinc-900 text-left hover:bg-zinc-800" title={p.caption.slice(0, 80)}>
                    {cover ? <img src={photoUrl(cover.id)} alt="" className="h-6 w-6 flex-none object-cover" /> : <span className="h-6 w-6 flex-none bg-zinc-800" />}
                    <span className={cn("truncate text-[11px]", p.status === "draft" ? "text-zinc-500" : p.status === "failed" ? "text-rose-300" : "text-zinc-200")}>
                      {fmt(p.status === "published" ? p.publishedAt : p.scheduledAt, { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function GridView({ posts, grid, onOpen, onSynced }: { posts: Post[]; grid: Grid | null; onOpen: (id: string) => void; onSynced: () => void }): ReactNode {
  const [drafts, setDrafts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hash the account's own photos in the background so the duplicate check can compare against them.
  useEffect(() => {
    if (!grid) return;
    let stop = false;
    (async () => {
      for (const g of grid.items.filter((x) => !x.dhash)) {
        if (stop) return;
        try {
          const dhash = await dhashOfUrl(`/api/grid/${g.id}/image`);
          await api(`/api/grid/${g.id}/dhash`, { json: { dhash } });
        } catch {
          // Not important enough to bother anyone.
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [grid]);
  const planned = posts.filter((p) => p.status === "approved").length;
  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex items-center gap-4">
        {grid?.avatar ? <img src={avatarUrl()} alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-zinc-800" /> : <div className="h-16 w-16 rounded-full bg-zinc-800" />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-zinc-100">{grid?.username || "your profile"}</p>
          <p className="text-xs text-zinc-500">
            {planned} scheduled · mirrored {grid?.syncedAt ? relative(grid.syncedAt) : "never"}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input type="checkbox" checked={drafts} onChange={(e) => setDrafts(e.target.checked)} className="accent-emerald-400" />
          drafts
        </label>
        <button
          className={btn}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api("/api/grid/sync", { json: {} });
              onSynced();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "…" : "Refresh"}
        </button>
      </div>
      {error && <p className="mb-2 text-sm text-rose-300">{error}</p>}
      <ProfileGrid posts={posts} grid={grid} showDrafts={drafts} onOpen={onOpen} />
      <p className="mt-3 text-xs text-zinc-500">Tiles are 3:4 crops, as on the profile. Green dot: scheduled; grey: draft. Your real posts link to Instagram.</p>
    </div>
  );
}
