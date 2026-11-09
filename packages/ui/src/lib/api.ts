export interface Item {
  id: string;
  position: number;
  width: number;
  height: number;
  bytes: number;
  altText: string;
  dhash: string | null;
  hasPhoto: boolean;
}

export type Status = "draft" | "approved" | "publishing" | "published" | "failed" | "needs_approval";

export interface Post {
  id: string;
  status: Status;
  caption: string;
  suggestion: string | null;
  aspect: "4:5" | "1:1" | "1.91:1";
  scheduledAt: number | null;
  version: number;
  approved: boolean;
  permalink: string | null;
  error: string | null;
  source: string;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
  items: Item[];
  problems: string[];
}

export interface AppState {
  kind: "session" | "token";
  instagram: { username: string; daysLeft: number; refreshedAt: number; refreshError: string | null } | null;
  cronSeenAt: number;
  now: number;
}

export interface GridItem {
  id: string;
  position: number;
  mediaType: string;
  permalink: string | null;
  timestamp: string | null;
  dhash: string | null;
}

export interface Grid {
  username: string;
  avatar: boolean;
  syncedAt: number;
  items: GridItem[];
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let BASE = "";
/** Hosts that proxy tidepost under another path (HQ) set this once, e.g. "/api/tidepost". Default: same origin. */
export function setApiBase(base: string): void {
  BASE = base.replace(/\/$/, "");
}
let HEADERS: Record<string, string> = {};
/** Extra headers on every API call, for a host's own checks, such as a CSRF token. */
export function setApiHeaders(headers: Record<string, string>): void {
  HEADERS = { ...headers };
}

let HASH = "#";
/** Hosts that route by hash themselves mount tidepost under a prefix, e.g. "#/posts". Default: "#". */
export function setHashBase(base: string): void {
  HASH = base.replace(/\/$/, "") || "#";
}
/** A link inside tidepost: `href("/settings")` → "#/settings", or "#/posts/settings" under a host prefix. */
export const href = (path: string): string => HASH + path;
/** The tidepost part of `location.hash`: "/post/abc", or "" when the hash is outside tidepost. */
export const routePath = (hash: string): string => (hash.startsWith(HASH) ? hash.slice(HASH.length) : "");

const url = (path: string): string => (BASE ? BASE + path.replace(/^\/api/, "") : path);

export async function api<T>(path: string, init: { method?: string; json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { ...HEADERS, ...init.headers };
  let body = init.body;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(url(path), { method: init.method ?? (body ? "POST" : "GET"), headers, body, credentials: "same-origin" });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const photoUrl = (itemId: string): string => url(`/api/items/${itemId}/image`);
export const gridUrl = (id: string): string => url(`/api/grid/${id}/image`);
export const avatarUrl = (): string => url("/api/grid/avatar");
