"use client";

/**
 * Deploy recovery — noticing that a newer build is live.
 *
 * On focus and on becoming visible again (the two moments a stale tab is
 * about to be used, and both free while it sits in the background), and
 * at most once per interval, the tab fetches the build-info file and
 * compares the commit in it with the one baked into this bundle. A
 * difference produces an OFFER. Nothing in this module reloads the page:
 * the decision belongs to the person, and the component holds the only
 * call that acts on it.
 *
 * Generated and owned by hatchkit: regenerated on every hatchkit
 * update, so an edit here is lost. Change the app around it instead.
 */

import {
  VERSION_CHECK_INTERVAL_MS,
  evaluateVersion,
  shouldCheckVersion,
  shouldOfferReload,
} from "./policy";
import type { VersionCheckTrigger } from "./policy";
import { BUILD_INFO_PATH } from "./host";

/** The commit from a build-info body, or null when the answer is not
 *  one. An unstamped image writes an empty commit, which says nothing
 *  about whether this tab is current. */
export const readServedCommit = (body: unknown): string | null => {
  if (typeof body !== "object" || body === null) return null;
  const commit = (body as { commit?: unknown }).commit;
  if (typeof commit !== "string") return null;
  const trimmed = commit.trim();
  return trimmed === "" ? null : trimmed;
};

/** Fetch the build info, bypassing every cache on the way. The server
 *  sends it with no caching too; this is the half of that agreement the
 *  tab controls. */
export const fetchServedCommit = async (): Promise<string | null> => {
  const response = await fetch(BUILD_INFO_PATH, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) return null;
  return readServedCommit(await response.json());
};

export type WriteActivity = {
  /** How many writes are in flight right now. */
  count: () => number;
  /** Called back whenever that number changes. Returns an unsubscribe. */
  subscribe: (listener: () => void) => () => void;
};

/** No app state to consult: every check behaves as if nothing is in
 *  flight. Used when the component is mounted outside whatever holds the
 *  app's mutations. */
export const noWriteActivity: WriteActivity = {
  count: () => 0,
  subscribe: () => () => undefined,
};

export type VersionWatcherOptions = {
  builtCommit: string;
  fetchCommit?: () => Promise<string | null>;
  /** Called at most once per newer build. Shows the offer — it must not
   *  reload. */
  onOffer: (commit: string) => void;
  writes?: WriteActivity;
  now?: () => number;
  intervalMs?: number;
};

export type VersionWatcher = {
  check: (trigger: VersionCheckTrigger) => Promise<void>;
  /** Drop the deferred offer and any write subscription. */
  stop: () => void;
};

/**
 * The throttled comparison, free of the DOM so it can be driven
 * directly.
 *
 * The clock starts at creation: the tab has just loaded its bundle, so
 * asking immediately would only confirm what it already knows. A failed
 * request — offline, a proxy error page, a server with no build info —
 * counts as an ask and is otherwise ignored, because it is not evidence
 * of a deploy.
 *
 * An offer that arrives while writes are in flight is held, not dropped:
 * the watcher subscribes and makes it as soon as they drain.
 */
export const createVersionWatcher = (options: VersionWatcherOptions): VersionWatcher => {
  const now = options.now ?? ((): number => Date.now());
  const intervalMs = options.intervalMs ?? VERSION_CHECK_INTERVAL_MS;
  const writes = options.writes ?? noWriteActivity;
  const fetchCommit = options.fetchCommit ?? fetchServedCommit;
  let lastCheckedAt = now();
  let inFlight = false;
  let offered: string | null = null;
  let pending: string | null = null;
  let unsubscribe: (() => void) | null = null;

  const clearPending = (): void => {
    pending = null;
    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  const offer = (commit: string): void => {
    if (
      !shouldOfferReload({
        versionOutcome: "newer",
        writesInFlight: writes.count(),
        alreadyOffered: offered === commit,
      })
    ) {
      return;
    }
    clearPending();
    offered = commit;
    options.onOffer(commit);
  };

  const defer = (commit: string): void => {
    pending = commit;
    if (unsubscribe !== null) return;
    unsubscribe = writes.subscribe(() => {
      const held = pending;
      if (held !== null && writes.count() === 0) offer(held);
    });
  };

  return {
    check: async (trigger) => {
      if (inFlight) return;
      if (!shouldCheckVersion({ now: now(), lastCheckedAt, intervalMs, trigger })) return;
      inFlight = true;
      lastCheckedAt = now();
      try {
        const servedCommit = await fetchCommit();
        const { outcome } = evaluateVersion({ builtCommit: options.builtCommit, servedCommit });
        if (outcome !== "newer" || servedCommit === null) return;
        if (writes.count() === 0) offer(servedCommit);
        else defer(servedCommit);
      } catch {
        /* offline, or not JSON — ask again after the next interval */
      } finally {
        inFlight = false;
      }
    },
    stop: clearPending,
  };
};

/** Wire the watcher to the two triggers. Returns an unsubscribe. */
export const watchForVersionChange = (watcher: VersionWatcher): (() => void) => {
  const onFocus = (): void => {
    void watcher.check("focus");
  };
  const onVisibility = (): void => {
    if (document.visibilityState === "visible") void watcher.check("visibility-change");
  };
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    watcher.stop();
  };
};

/**
 * Run the action once no write is in flight, or after the timeout
 * regardless. Takes the action as an argument and never reloads by
 * itself — the component passes the reload in, which keeps every call
 * that can navigate away from the page in one file.
 *
 * The click that asks for the reload also blurs whatever field was
 * focused, and a field that commits on blur starts exactly such a write.
 */
export const runWhenIdle = (
  writes: WriteActivity,
  act: () => void,
  timeoutMs = 10_000,
): (() => void) => {
  if (writes.count() === 0) {
    act();
    return () => undefined;
  }
  let done = false;
  const stop = (): void => {
    done = true;
    unsubscribe();
    clearTimeout(timer);
  };
  const finish = (): void => {
    if (done) return;
    stop();
    act();
  };
  const unsubscribe = writes.subscribe(() => {
    if (writes.count() === 0) finish();
  });
  const timer = setTimeout(finish, timeoutMs);
  return stop;
};
