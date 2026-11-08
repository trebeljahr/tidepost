"use client";

import type { ReactNode } from "react";
import type { Status } from "../lib/api";
import { cn } from "../lib/cn";

export const btn =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40";
export const btnDanger =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-rose-800 px-3 py-1.5 text-sm text-rose-300 hover:border-rose-500 disabled:opacity-40";
export const input =
  "w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-400 focus:outline-none [color-scheme:dark]";

export const STATUS: Record<Status, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-zinc-800 text-zinc-300" },
  approved: { label: "Scheduled", cls: "bg-emerald-950 text-emerald-300" },
  publishing: { label: "Publishing", cls: "bg-sky-950 text-sky-300" },
  published: { label: "Published", cls: "bg-zinc-800 text-zinc-400" },
  failed: { label: "Failed", cls: "bg-rose-950 text-rose-300" },
  needs_approval: { label: "Needs approval", cls: "bg-amber-950 text-amber-300" },
};

export function Chip({ status }: { status: Status }): ReactNode {
  const s = STATUS[status];
  return <span className={cn("rounded-full px-2 py-0.5 text-xs", s.cls)}>{s.label}</span>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error"; children: ReactNode }): ReactNode {
  const cls = tone === "error" ? "border-rose-900 bg-rose-950/40 text-rose-200" : tone === "warn" ? "border-amber-900 bg-amber-950/30 text-amber-200" : "border-zinc-800 bg-zinc-900/60 text-zinc-300";
  return <div className={cn("rounded-md border px-3 py-2 text-sm", cls)}>{children}</div>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  return <section className={cn("rounded-xl border border-zinc-800 bg-zinc-950 p-4", className)}>{children}</section>;
}
