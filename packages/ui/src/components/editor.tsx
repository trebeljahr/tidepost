"use client";

import { type Aspect, DUPLICATE_DISTANCE, MAX_ALT, MAX_CAPTION, MAX_HASHTAGS, MAX_ITEMS, MAX_MENTIONS, captionStats, hamming } from "@starter/shared/limits";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type Grid, type Post, api, photoUrl } from "../lib/api";
import { type Pending, cropBox, exportJpeg, readFile } from "../lib/image";
import { fmt, fromLocalInput, relative, toLocalInput } from "../lib/time";
import { cn } from "../lib/cn";
import { FeedPreview, ProfileGrid } from "./preview";
import { Card, Chip, Notice, btn, btnDanger, btnPrimary, input } from "./ui";

interface Hashes {
  own: { postId: string; itemId: string; dhash: string; status: string }[];
  grid: { id: string; dhash: string; permalink: string | null }[];
}

/** The photo with the crop box on top; drag slides the box along the long side. */
function CropView({ p, aspect, onChange }: { p: Pending; aspect: Aspect; onChange: (p: Pending) => void }): ReactNode {
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; offset: number } | null>(null);
  const box = cropBox(p, aspect);
  const freeX = 1 - box.w / p.w;
  const freeY = 1 - box.h / p.h;
  const move = (e: React.PointerEvent) => {
    if (!drag.current || !frame.current) return;
    const rect = frame.current.getBoundingClientRect();
    const delta = freeX > 0.001 ? (e.clientX - drag.current.x) / (rect.width * freeX) : freeY > 0.001 ? (e.clientY - drag.current.y) / (rect.height * freeY) : 0;
    onChange({ ...p, offset: Math.min(1, Math.max(0, drag.current.offset + delta)) });
  };
  return (
    <div
      ref={frame}
      className="relative mx-auto select-none overflow-hidden rounded-lg bg-black"
      style={{ aspectRatio: `${p.w} / ${p.h}`, width: `min(100%, calc(55vh * ${p.w / p.h}))` }}
    >
      <img src={p.src} alt="" draggable={false} className="absolute inset-0 h-full w-full" />
      <div
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, offset: p.offset };
        }}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        className={cn("absolute touch-none ring-2 ring-emerald-400", freeX > 0.001 ? "cursor-ew-resize" : freeY > 0.001 ? "cursor-ns-resize" : "")}
        style={{
          left: `${(box.x / p.w) * 100}%`,
          top: `${(box.y / p.h) * 100}%`,
          width: `${(box.w / p.w) * 100}%`,
          height: `${(box.h / p.h) * 100}%`,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
        }}
      >
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="border border-white/15" />
          ))}
        </div>
      </div>
    </div>
  );
}

function Uploader({ post, hashes, onUploaded }: { post: Post; hashes: Hashes | null; onUploaded: (p: Post) => void }): ReactNode {
  const [pending, setPending] = useState<Pending[]>([]);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const room = MAX_ITEMS - post.items.length;
  const aspect = post.aspect;

  const add = async (files: FileList | File[]) => {
    setError(null);
    const list = [...files].filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|avif)$/i.test(f.name));
    const out: Pending[] = [];
    for (const f of list.slice(0, Math.max(0, room - pending.length))) {
      try {
        out.push(await readFile(f));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    if (list.length > room - pending.length) setError(`A post holds ${MAX_ITEMS} photos; the extra ones were left out.`);
    setPending((p) => [...p, ...out]);
  };

  const remove = (i: number) => {
    URL.revokeObjectURL(pending[i].src);
    setPending((p) => p.filter((_, j) => j !== i));
    setSel((s) => Math.max(0, Math.min(s, pending.length - 2)));
  };

  const upload = async () => {
    setBusy("Preparing…");
    setError(null);
    let latest: Post | null = null;
    try {
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        setBusy(`Uploading ${i + 1} of ${pending.length}…`);
        const { blob, dhash } = await exportJpeg(p, aspect);
        latest = await api<Post>(`/api/posts/${post.id}/items`, {
          method: "POST",
          body: blob,
          headers: { "content-type": "image/jpeg", "x-dhash": dhash, "x-alt-text": encodeURIComponent(p.alt.slice(0, MAX_ALT)) },
        });
      }
      for (const p of pending) URL.revokeObjectURL(p.src);
      setPending([]);
      setSel(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      if (latest) onUploaded(latest);
    }
  };

  // Duplicate check on the cropped result, against queued and published photos and the grid.
  const current = pending[sel];
  useEffect(() => {
    if (!current || current.dhash || !hashes) return;
    let stop = false;
    exportJpeg(current, aspect).then(({ dhash }) => {
      if (stop) return;
      const own = hashes.own.find((h) => h.postId !== post.id && hamming(h.dhash, dhash) <= DUPLICATE_DISTANCE);
      const grid = hashes.grid.find((h) => hamming(h.dhash, dhash) <= DUPLICATE_DISTANCE);
      const duplicateOf = own ? (own.status === "published" ? "a photo you already published with tidepost" : "a photo in another planned post") : grid ? "a photo already on your profile" : undefined;
      setPending((ps) => ps.map((x) => (x.key === current.key ? { ...x, dhash, duplicateOf } : x)));
    });
    return () => {
      stop = true;
    };
  }, [current, aspect, hashes, post.id]);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void add(e.dataTransfer.files);
      }}
      className={cn("rounded-lg border border-dashed p-3", over ? "border-emerald-400 bg-emerald-950/20" : "border-zinc-700")}
    >
      {!pending.length ? (
        <label className="flex cursor-pointer flex-col items-center gap-1 py-6 text-sm text-zinc-400">
          <span className="text-zinc-200">Drop photos here or click to choose</span>
          <span className="text-xs">
            Cropped to {aspect} in your browser, saved as JPEG, 1080 px wide. {room} of {MAX_ITEMS} slots left.
          </span>
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && void add(e.target.files)} disabled={room <= 0} />
        </label>
      ) : (
        <div className="space-y-3">
          {current && <CropView p={current} aspect={aspect} onChange={(np) => setPending((ps) => ps.map((x) => (x.key === np.key ? { ...np, dhash: undefined, duplicateOf: undefined } : x)))} />}
          {current?.duplicateOf && <Notice tone="warn">This looks like {current.duplicateOf}. You can still add it.</Notice>}
          {current && (
            <input className={input} placeholder="Alt text: describe the photo for people who can't see it" maxLength={MAX_ALT} value={current.alt} onChange={(e) => setPending((ps) => ps.map((x) => (x.key === current.key ? { ...x, alt: e.target.value } : x)))} />
          )}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {pending.map((p, i) => {
              const box = cropBox(p, aspect);
              return (
                <div key={p.key} className="w-16 flex-none">
                  <button
                    onClick={() => setSel(i)}
                    className={cn("relative block w-16 overflow-hidden rounded bg-zinc-900", i === sel ? "ring-2 ring-emerald-400" : "ring-1 ring-zinc-700")}
                    style={{ aspectRatio: `${box.w} / ${box.h}`, maxHeight: "5rem" }}
                    aria-label={`Photo ${i + 1}`}
                  >
                    <img src={p.src} alt="" className="absolute max-w-none" style={{ width: `${(p.w / box.w) * 100}%`, left: `${(-box.x / box.w) * 100}%`, top: `${(-box.y / box.h) * 100}%` }} />
                    {p.duplicateOf && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400" />}
                  </button>
                  <button className="mt-1 w-full text-xs text-zinc-500 hover:text-rose-300" onClick={() => remove(i)}>
                    remove
                  </button>
                </div>
              );
            })}
            {pending.length < room && (
              <label className="flex w-16 flex-none cursor-pointer items-center justify-center rounded border border-dashed border-zinc-700 text-xl text-zinc-500 hover:text-zinc-200" style={{ height: "5rem" }}>
                +
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && void add(e.target.files)} />
              </label>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button className={btnPrimary} onClick={upload} disabled={!!busy}>
              {busy ?? `Add ${pending.length} photo${pending.length === 1 ? "" : "s"}`}
            </button>
            <button className={btn} onClick={() => (pending.forEach((p) => URL.revokeObjectURL(p.src)), setPending([]))} disabled={!!busy}>
              Cancel
            </button>
            <span className="text-xs text-zinc-500">Drag the green box to choose what stays.</span>
          </div>
        </div>
      )}
      {error && (
        <div className="mt-2">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </div>
  );
}

function Counter({ value, max, label }: { value: number; max: number; label: string }): ReactNode {
  return (
    <span className={cn(value > max ? "font-medium text-rose-400" : value > max * 0.9 ? "text-amber-300" : "text-zinc-500")}>
      {value}/{max} {label}
    </span>
  );
}

export function Editor({
  id,
  username,
  avatar,
  grid,
  posts,
  onChanged,
  onClose,
  onOpen,
  captionSlot,
}: {
  id: string;
  username: string;
  avatar: boolean;
  grid: Grid | null;
  posts: Post[];
  onChanged: () => void;
  onClose: () => void;
  onOpen: (id: string) => void;
  /** Host extension below the caption (HQ puts its review panel here). Gets the post and a setter for the editor text. */
  captionSlot?: (post: Post, setCaption: (text: string) => void) => ReactNode;
}): ReactNode {
  const [post, setPost] = useState<Post | null>(null);
  const [caption, setCaption] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hashes, setHashes] = useState<Hashes | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const accept = useCallback(
    (p: Post) => {
      setPost(p);
      setCaption(p.caption);
      setWhen(toLocalInput(p.scheduledAt));
      onChanged();
    },
    [onChanged],
  );

  useEffect(() => {
    api<Post>(`/api/posts/${id}`).then(
      (p) => {
        setPost(p);
        setCaption(p.caption);
        setWhen(toLocalInput(p.scheduledAt));
      },
      (e) => setError(String(e.message ?? e)),
    );
    api<Hashes>("/api/hashes").then(setHashes, () => setHashes({ own: [], grid: [] }));
  }, [id]);

  if (!post) return <p className="p-6 text-sm text-zinc-400">{error ?? "Loading…"}</p>;

  const editable = ["draft", "approved", "failed", "needs_approval"].includes(post.status);
  const stats = captionStats(caption);
  const dirty = caption !== post.caption || fromLocalInput(when) !== post.scheduledAt;

  const run = async (label: string, fn: () => Promise<Post | null>) => {
    setBusy(label);
    setError(null);
    try {
      const p = await fn();
      if (p) accept(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const save = (): Promise<Post> => api<Post>(`/api/posts/${post.id}`, { method: "PATCH", json: { caption, scheduledAt: fromLocalInput(when) } });
  const patch = (body: Record<string, unknown>) => run("Saving…", () => api<Post>(`/api/posts/${post.id}`, { method: "PATCH", json: body }));

  const move = (from: number, to: number) => {
    const order = post.items.map((i) => i.id);
    order.splice(to, 0, order.splice(from, 1)[0]);
    void patch({ order });
  };

  const approve = (now: boolean) =>
    run(now ? "Publishing…" : "Approving…", async () => {
      const saved = dirty ? await save() : post;
      return api<Post>(`/api/posts/${post.id}/${now ? "publish-now" : "approve"}`, { json: { version: saved.version } });
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button className={btn} onClick={onClose}>
            ← Back
          </button>
          <Chip status={post.status} />
          {post.approved && <span className="text-sm text-emerald-300">Goes out {fmt(post.scheduledAt)} ({relative(post.scheduledAt)})</span>}
          {post.permalink && (
            <a className="text-sm text-sky-300 hover:underline" href={post.permalink} target="_blank" rel="noreferrer">
              View on Instagram ↗
            </a>
          )}
        </div>

        {post.error && <Notice tone={post.status === "failed" ? "error" : "warn"}>{post.error}</Notice>}

        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-medium text-zinc-100">Photos</h2>
            <span className="text-xs text-zinc-500">Shape</span>
            {(["4:5", "1:1", "1.91:1"] as const).map((a) => (
              <button key={a} className={cn(btn, "px-2 py-1 text-xs", post.aspect === a && "border-emerald-500 text-emerald-300")} disabled={!editable || !!busy} onClick={() => patch({ aspect: a })}>
                {a}
              </button>
            ))}
          </div>
          {post.items.length > 0 && (
            <div className="mb-3 space-y-2">
              {post.items.map((it, i) => (
                <div key={it.id} className="flex items-start gap-3">
                  <img src={photoUrl(it.id)} alt={it.altText} className="h-16 w-16 flex-none rounded object-cover" />
                  <div className="min-w-0 flex-1">
                    <input
                      className={cn(input, "py-1.5")}
                      placeholder="Alt text"
                      maxLength={MAX_ALT}
                      defaultValue={it.altText}
                      disabled={!editable}
                      onBlur={(e) => e.target.value !== it.altText && patch({ alt: { [it.id]: e.target.value } })}
                    />
                    <p className="mt-1 text-xs text-zinc-500">
                      {i + 1}. {it.width}×{it.height} · {(it.bytes / 1024).toFixed(0)} KB
                    </p>
                  </div>
                  {editable && (
                    <div className="flex flex-none gap-1 text-sm">
                      <button className="px-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30" disabled={i === 0 || !!busy} onClick={() => move(i, i - 1)} aria-label="Move earlier">
                        ↑
                      </button>
                      <button className="px-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30" disabled={i === post.items.length - 1 || !!busy} onClick={() => move(i, i + 1)} aria-label="Move later">
                        ↓
                      </button>
                      <button className="px-1 text-zinc-500 hover:text-rose-300" disabled={!!busy} onClick={() => run("Removing…", () => api<Post>(`/api/items/${it.id}`, { method: "DELETE" }))} aria-label="Remove photo">
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {editable && post.items.length < MAX_ITEMS && <Uploader post={post} hashes={hashes} onUploaded={accept} />}
        </Card>

        <Card>
          <div className="mb-2 flex items-center gap-3 text-xs">
            <h2 className="mr-auto text-base font-medium text-zinc-100">Caption</h2>
            <Counter value={stats.chars} max={MAX_CAPTION} label="characters" />
            <Counter value={stats.hashtags} max={MAX_HASHTAGS} label="#" />
            <Counter value={stats.mentions} max={MAX_MENTIONS} label="@" />
          </div>
          <textarea className={cn(input, "min-h-40 font-[inherit]")} value={caption} disabled={!editable} onChange={(e) => setCaption(e.target.value)} placeholder="Write your caption." />
          {post.suggestion && editable && (
            <div className="mt-3 rounded-md border border-sky-900 bg-sky-950/30 p-3 text-sm">
              <p className="mb-1 text-xs text-sky-300">Suggested caption (from an API client). It is only used if you take it.</p>
              <p className="whitespace-pre-wrap text-zinc-200">{post.suggestion}</p>
              <div className="mt-2 flex gap-2">
                <button className={btn} onClick={() => setCaption(post.suggestion ?? "")}>
                  Put into the editor
                </button>
                <button className={btn} onClick={() => patch({ clearSuggestion: true })}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </Card>

        {captionSlot?.(post, setCaption)}

        <Card>
          <h2 className="mb-2 font-medium text-zinc-100">When</h2>
          <input type="datetime-local" className={cn(input, "max-w-xs")} value={when} disabled={!editable} onChange={(e) => setWhen(e.target.value)} />
          <p className="mt-1 text-xs text-zinc-500">Your browser&apos;s time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). The publisher checks once a minute.</p>
        </Card>

        {post.problems.length > 0 && editable && (
          <Notice tone="warn">
            <ul className="list-disc pl-4">
              {post.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}

        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <button className={btn} disabled={!dirty || !!busy} onClick={() => run("Saving…", save)}>
              Save
            </button>
          )}
          {editable && !post.approved && post.status !== "failed" && (
            <button className={btnPrimary} disabled={!!busy || !when} onClick={() => approve(false)} title="Nothing is published without this">
              Approve for {when ? fmt(fromLocalInput(when)) : "…"}
            </button>
          )}
          {post.approved && (
            <button className={btn} disabled={!!busy} onClick={() => run("…", () => api<Post>(`/api/posts/${post.id}/unapprove`, { json: {} }))}>
              Unapprove
            </button>
          )}
          {editable && post.status !== "failed" && (
            <button className={btn} disabled={!!busy} onClick={() => approve(true)}>
              Publish now
            </button>
          )}
          {post.status === "failed" && (
            <button className={btnPrimary} disabled={!!busy} onClick={() => run("Retrying…", () => api<Post>(`/api/posts/${post.id}/retry`, { json: {} }))}>
              Retry now
            </button>
          )}
          {busy && <span className="text-sm text-zinc-400">{busy}</span>}
          <span className="ml-auto" />
          {post.status !== "publishing" &&
            (confirmDelete ? (
              <>
                <span className="text-sm text-zinc-400">{post.status === "published" ? "Removes it from tidepost only, not from Instagram." : "Delete this post and its photos?"}</span>
                <button className={btnDanger} onClick={() => run("Deleting…", async () => (await api(`/api/posts/${post.id}`, { method: "DELETE" }), onChanged(), onClose(), null))}>
                  Delete
                </button>
                <button className={btn} onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </>
            ) : (
              <button className={btnDanger} onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            ))}
        </div>
        {dirty && post.approved && <p className="text-xs text-amber-300">Saving these changes removes the approval. Approve again afterwards.</p>}
      </div>

      <div className="space-y-4">
        <FeedPreview post={{ ...post, caption }} username={username} avatar={avatar} />
        <Card>
          <h3 className="mb-2 text-sm font-medium text-zinc-300">On your profile</h3>
          <ProfileGrid posts={posts.map((p) => (p.id === post.id ? { ...post, scheduledAt: fromLocalInput(when) } : p))} grid={grid} highlight={post.id} compact onOpen={onOpen} />
        </Card>
      </div>
    </div>
  );
}
