"use client";

import { type ReactNode, useEffect, useState } from "react";
import { type Grid, type Post, avatarUrl, gridUrl, photoUrl } from "../lib/api";
import { fmt } from "../lib/time";
import { cn } from "../lib/cn";

const FOLD = 125;

/** The post as it will look in the Instagram feed: carousel, dots, caption fold. */
export function FeedPreview({ post, username, avatar }: { post: Post; username: string; avatar: boolean }): ReactNode {
  const [index, setIndex] = useState(0);
  const [more, setMore] = useState(false);
  const items = post.items.filter((i) => i.hasPhoto);
  useEffect(() => setIndex((i) => Math.min(i, Math.max(0, items.length - 1))), [items.length]);
  const first = items[0];
  const ratio = first ? first.width / first.height : 0.8;
  const caption = post.caption;
  const folded = [...caption].length > FOLD && !more;
  const shown = folded ? [...caption].slice(0, FOLD).join("").trimEnd() : caption;
  const parts = shown.split(/(#[\p{L}\p{N}_]+|@[A-Za-z0-9._]+)/gu);
  const mismatched = first && items.some((it) => Math.abs(it.width / it.height - ratio) > 0.02);
  return (
    <div className="mx-auto w-full max-w-[420px] overflow-hidden rounded-xl border border-zinc-800 bg-black">
      <div className="flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-zinc-100">
        <span className="h-7 w-7 rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-fuchsia-600 p-[2px]">
          {avatar ? <img src={avatarUrl()} alt="" className="block h-full w-full rounded-full object-cover" /> : <span className="block h-full w-full rounded-full bg-zinc-800" />}
        </span>
        {username || "you"}
      </div>
      <div className="relative bg-zinc-900" style={{ aspectRatio: String(ratio) }}>
        {items[index] ? (
          <img src={photoUrl(items[index].id)} alt={items[index].altText} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-600">No photos yet</div>
        )}
        {items.length > 1 && (
          <>
            <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
              {index + 1}/{items.length}
            </span>
            {index > 0 && (
              <button onClick={() => setIndex(index - 1)} className="absolute left-2 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full bg-white/80 text-black" aria-label="Previous photo">
                ‹
              </button>
            )}
            {index < items.length - 1 && (
              <button onClick={() => setIndex(index + 1)} className="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full bg-white/80 text-black" aria-label="Next photo">
                ›
              </button>
            )}
          </>
        )}
      </div>
      {items.length > 1 && (
        <div className="flex justify-center gap-1 pt-2">
          {items.map((it, i) => (
            <span key={it.id} className={cn("h-1.5 w-1.5 rounded-full", i === index ? "bg-sky-400" : "bg-zinc-600")} />
          ))}
        </div>
      )}
      <div className="px-3 pb-3 pt-2 text-sm leading-snug text-zinc-100">
        {caption ? (
          <p className="whitespace-pre-wrap break-words">
            <span className="font-semibold">{username || "you"}</span>{" "}
            {parts.map((part, i) => (/^[#@]/.test(part) ? <span key={i} className="text-sky-300">{part}</span> : part))}
            {folded && (
              <button onClick={() => setMore(true)} className="text-zinc-400">
                … more
              </button>
            )}
          </p>
        ) : (
          <p className="text-zinc-500">No caption yet.</p>
        )}
        {mismatched && <p className="mt-2 text-xs text-amber-300">Instagram crops every photo in a carousel to the first photo&apos;s shape.</p>}
      </div>
    </div>
  );
}

/** The profile grid: planned posts on top in posting order, then the account's real posts (3:4 tiles). */
export function ProfileGrid({
  posts,
  grid,
  highlight,
  compact = false,
  showDrafts = true,
  onOpen,
}: {
  posts: Post[];
  grid: Grid | null;
  highlight?: string;
  compact?: boolean;
  showDrafts?: boolean;
  onOpen?: (id: string) => void;
}): ReactNode {
  const planned = posts
    .filter((p) => p.items.some((i) => i.hasPhoto))
    .filter((p) => p.status === "approved" || p.status === "publishing" || (showDrafts && p.status === "draft") || p.id === highlight)
    .sort((a, b) => (b.scheduledAt ?? Number.MAX_SAFE_INTEGER) - (a.scheduledAt ?? Number.MAX_SAFE_INTEGER));
  type Tile = { key: string; src: string; planned: boolean; post?: Post; multi: boolean; href?: string | null };
  let tiles: Tile[] = [
    ...planned.map((p) => ({ key: p.id, src: photoUrl(p.items[0].id), planned: true, post: p, multi: p.items.length > 1 })),
    ...(grid?.items ?? []).map((g) => ({ key: g.id, src: gridUrl(g.id), planned: false, multi: g.mediaType === "CAROUSEL_ALBUM", href: g.permalink })),
  ];
  if (compact) tiles = tiles.slice(0, 9);
  return (
    <div className={cn("grid grid-cols-3", compact ? "gap-0.5" : "gap-1")}>
      {tiles.map((t) => {
        const body = (
          <>
            <img src={t.src} alt="" loading="lazy" className={cn("absolute inset-0 h-full w-full object-cover", t.post?.status === "draft" && "opacity-60")} />
            {t.multi && <span className="absolute right-1 top-1 text-xs text-white drop-shadow">▣</span>}
            {t.planned && t.post && (
              <>
                <span className={cn("absolute left-1 top-1 h-2 w-2 rounded-full", t.post.status === "draft" ? "bg-zinc-300" : "bg-emerald-400")} />
                {!compact && (
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-4 text-left text-[11px] text-white">
                    {t.post.status === "draft" ? "draft · " : ""}
                    {fmt(t.post.scheduledAt)}
                  </span>
                )}
              </>
            )}
          </>
        );
        const cls = cn("relative block overflow-hidden bg-zinc-900", t.key === highlight && "ring-2 ring-inset ring-emerald-400");
        return t.planned ? (
          <button key={t.key} className={cls} style={{ aspectRatio: "3 / 4" }} onClick={() => onOpen?.(t.key)} title="Open post">
            {body}
          </button>
        ) : (
          <a key={t.key} className={cls} style={{ aspectRatio: "3 / 4" }} href={t.href ?? undefined} target="_blank" rel="noreferrer" title="Open on Instagram">
            {body}
          </a>
        );
      })}
      {!tiles.length && <p className="col-span-3 py-8 text-center text-sm text-zinc-500">Nothing here yet.</p>}
    </div>
  );
}
