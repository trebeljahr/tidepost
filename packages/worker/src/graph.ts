// Instagram API with Instagram Login (graph.instagram.com). Token goes in a Bearer header.
import { redact } from "./util";

// Graph error codes worth another attempt later (throttling, transient, media not ready).
const RETRYABLE = new Set([1, 2, 4, 17, 32, 341, 613, 9004, 9007, 2207001, 2207003, 2207020, 2207032]);
// Token expired, revoked or missing permission.
const AUTH_CODES = new Set([102, 190, 10, 200]);

export class GraphError extends Error {
  constructor(message: string, public retryable: boolean, public code?: number, public auth = false) {
    super(message);
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class Graph {
  calls = 0;
  constructor(private token: string, private base: string, private fetcher: FetchLike = fetch) {}

  async call<T = Record<string, unknown>>(method: "GET" | "POST", path: string, params: Record<string, string | undefined> = {}): Promise<T> {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>;
    let url = `${this.base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
    const init: RequestInit = { method, headers: { authorization: `Bearer ${this.token}` } };
    if (method === "GET") {
      const q = new URLSearchParams(clean).toString();
      if (q) url += `?${q}`;
    } else {
      init.body = new URLSearchParams(clean);
    }
    const what = `${method} ${path.split("?")[0]}`;
    this.calls++;
    let res: Response;
    try {
      res = await this.fetcher(url, init);
    } catch (e) {
      throw new GraphError(redact(`${what}: network error: ${String(e)}`, [this.token]), true);
    }
    const text = await res.text();
    let body: any = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    const err = body?.error;
    if (res.status >= 400 || err) {
      const code: number | undefined = err?.code;
      const sub: number | undefined = err?.error_subcode;
      const msg = err?.error_user_msg || err?.message || text.slice(0, 300);
      const retryable = res.status >= 500 || res.status === 429 || !!err?.is_transient || RETRYABLE.has(code!) || RETRYABLE.has(sub!);
      const auth = !retryable && AUTH_CODES.has(code!);
      throw new GraphError(redact(`${what}: HTTP ${res.status}, code ${code ?? "-"}/${sub ?? "-"}: ${msg}`, [this.token]), retryable, code, auth);
    }
    return body as T;
  }

  me() {
    return this.call<{ user_id: string; username: string; id: string }>("GET", "me", { fields: "user_id,username" });
  }

  profile() {
    return this.call<{ user_id: string; username: string; profile_picture_url?: string }>("GET", "me", {
      fields: "user_id,username,profile_picture_url",
    });
  }

  async createImage(igId: string, imageUrl: string, opts: { caption?: string; altText?: string; carouselItem?: boolean }) {
    const params: Record<string, string | undefined> = { image_url: imageUrl, alt_text: opts.altText || undefined };
    if (opts.carouselItem) params.is_carousel_item = "true";
    else params.caption = opts.caption ?? "";
    const body = await this.call<{ id: string }>("POST", `${igId}/media`, params);
    return String(body.id);
  }

  async createCarousel(igId: string, children: string[], caption: string) {
    const body = await this.call<{ id: string }>("POST", `${igId}/media`, {
      media_type: "CAROUSEL",
      children: children.join(","),
      caption,
    });
    return String(body.id);
  }

  async status(containerId: string) {
    const body = await this.call<{ status_code?: string; status?: string }>("GET", containerId, { fields: "status_code,status" });
    return { code: String(body.status_code ?? ""), detail: String(body.status ?? "") };
  }

  async publishingLimit(igId: string) {
    const body = await this.call<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(
      "GET",
      `${igId}/content_publishing_limit`,
      { fields: "config,quota_usage" },
    );
    const row = body.data?.[0] ?? {};
    return { usage: Number(row.quota_usage ?? 0), total: Number(row.config?.quota_total ?? 0) };
  }

  async publish(igId: string, containerId: string) {
    const body = await this.call<{ id: string }>("POST", `${igId}/media_publish`, { creation_id: containerId });
    return String(body.id);
  }

  async permalink(mediaId: string) {
    const body = await this.call<{ permalink?: string }>("GET", mediaId, { fields: "permalink" });
    return body.permalink ?? null;
  }

  async recentMedia(igId: string, limit: number) {
    const body = await this.call<{
      data?: { id: string; media_type: string; media_url?: string; thumbnail_url?: string; permalink?: string; timestamp?: string }[];
    }>("GET", `${igId}/media`, { fields: "id,media_type,media_url,thumbnail_url,permalink,timestamp", limit: String(limit) });
    return body.data ?? [];
  }

  /** New 60-day token. refresh_access_token lives outside the versioned path and takes the token as a query param. */
  async refresh() {
    const root = this.base.replace(/\/v\d+\.\d+\/?$/, "");
    const url = `${root}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(this.token)}`;
    this.calls++;
    let res: Response;
    try {
      res = await this.fetcher(url, { method: "GET" });
    } catch (e) {
      throw new GraphError(redact(`token refresh: network error: ${String(e)}`, [this.token]), true);
    }
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body?.access_token) {
      const err = body?.error ?? {};
      const retryable = res.status >= 500 || res.status === 429;
      throw new GraphError(redact(`token refresh: HTTP ${res.status}: ${err.message ?? "no token in response"}`, [this.token]), retryable, err.code, !retryable);
    }
    return { accessToken: String(body.access_token), expiresIn: Number(body.expires_in ?? 60 * 86400) };
  }
}
