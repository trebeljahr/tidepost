/**
 * Deploy recovery — the rules, with no DOM and no timers in them.
 *
 * A tab that was open before a deploy is running code the server no
 * longer has. It keeps working until it lazily loads a route it has not
 * visited yet, and then that chunk 404s. Two answers live here:
 * comparing the built commit with the served one to OFFER a reload, and
 * taking one automatically — once — when a chunk has already failed.
 *
 * Generated and owned by hatchkit: regenerated on every hatchkit
 * update, so an edit here is lost. Everything in it is a pure function
 * so it can be unit-tested; the browser parts live in ./host.ts,
 * ./version-check.ts and ./chunk-reload.ts.
 */

/** How often, at most, a tab asks which build is live. */
export const VERSION_CHECK_INTERVAL_MS = 300000;

/** An automatic chunk reload within this long of the previous one is
 *  refused. Removing this guard turns a broken server into a reload
 *  loop the person cannot read their way out of. */
export const CHUNK_RELOAD_GUARD_MS = 60000;

/** Session storage on purpose: the guard is about THIS tab's last
 *  attempt, and it must not outlive the tab. */
export const CHUNK_RELOAD_STORAGE_KEY = "hatchkit:deploy-recovery:chunk-reload-at";

/** The shells that carry their own copy of the bundle. A deploy of the
 *  web image says nothing about them, and a reload there means
 *  something else entirely, so recovery is off in all of them. */
export const NATIVE_SHELLS = ["capacitor", "electron", "tauri"] as const;

export type ClientShell = "web" | (typeof NATIVE_SHELLS)[number];

export type RecoveryHost = {
  mode: string;
  shell: string;
  builtCommit: string;
};

export const isNativeShell = (shell: string): boolean =>
  (NATIVE_SHELLS as readonly string[]).includes(shell);

/**
 * Whether the version check may run at all. Off in development (the dev
 * server rebuilds in place and serves no build info), off in every
 * native shell, and off with no built commit — an unstamped build has
 * nothing to compare, so every answer would read as "different" and the
 * tab would offer a reload that changes nothing.
 */
export const isRecoveryEnabled = (host: RecoveryHost): boolean =>
  host.mode === "production" && !isNativeShell(host.shell) && host.builtCommit.trim() !== "";

/**
 * Whether the chunk-failure reload may run. Same host rules, minus the
 * commit: a chunk that failed to load is evidence in itself, so an image
 * that was never stamped still recovers — it just cannot be told about
 * the deploy in advance.
 */
export const isChunkRecoveryEnabled = (host: { mode: string; shell: string }): boolean =>
  host.mode === "production" && !isNativeShell(host.shell);

export type VersionCheckTrigger = "focus" | "visibility-change";

/**
 * Whether this trigger may turn into a request. Only the two named
 * triggers count, and a clock that moved backwards counts as due —
 * refusing would wedge the check until real time caught up with a stale
 * reading, which can be hours.
 */
export const shouldCheckVersion = (input: {
  now: number;
  lastCheckedAt: number;
  intervalMs: number;
  trigger: VersionCheckTrigger;
}): boolean => {
  if (input.trigger !== "focus" && input.trigger !== "visibility-change") return false;
  const elapsed = input.now - input.lastCheckedAt;
  if (elapsed < 0) return true;
  return elapsed >= input.intervalMs;
};

/** "unknown" is not a soft "same": offline, a captive portal, a proxy
 *  error page and an unstamped image all land here, and none of them is
 *  evidence of a deploy. */
export type VersionOutcome = "same" | "newer" | "unknown";

const MIN_ABBREVIATED_SHA = 7;

/**
 * Compare the running bundle's commit with the served one. "newer" is a
 * claim about DIFFERENCE — two shas cannot be ordered without the
 * repository — but the only thing that changes the served commit is a
 * new image, so different means newer.
 *
 * Prefix matching in both directions: the two facts travel by different
 * routes, and one of them being abbreviated is a configuration
 * difference rather than a deploy.
 */
export const evaluateVersion = (input: {
  builtCommit: string;
  servedCommit: string | null | undefined;
}): { outcome: VersionOutcome } => {
  const built = input.builtCommit.trim().toLowerCase();
  const served = (input.servedCommit ?? "").trim().toLowerCase();
  if (built === "" || served === "") return { outcome: "unknown" };
  if (built === served) return { outcome: "same" };
  const shorter = built.length < served.length ? built : served;
  const longer = built.length < served.length ? served : built;
  if (shorter.length >= MIN_ABBREVIATED_SHA && longer.startsWith(shorter)) {
    return { outcome: "same" };
  }
  return { outcome: "newer" };
};

/**
 * Whether to put the reload offer on screen. Deferred while writes are
 * in flight and re-evaluated once they drain: a reload during a write
 * aborts the request, and an offline queue cannot reliably catch a write
 * that fails while the document unloads.
 *
 * Note what this returns — an OFFER, never a reload. Someone is in the
 * middle of something, and a page that reloads itself under a half-typed
 * form is worse than a stale tab.
 */
export const shouldOfferReload = (input: {
  versionOutcome: VersionOutcome;
  writesInFlight: number;
  alreadyOffered: boolean;
}): boolean => {
  if (input.versionOutcome !== "newer") return false;
  if (input.alreadyOffered) return false;
  return input.writesInFlight === 0;
};

/**
 * Whether an automatic reload is allowed for a chunk that failed to
 * load. A reload cures a stale tab; it cures nothing when the server is
 * broken, the device is offline, or a proxy answers HTML for a script.
 * In those cases a second automatic reload loops forever, so the guard
 * stops after one and the error screen's own button takes over.
 */
export const shouldChunkReload = (input: {
  now: number;
  lastReloadAt: number | null;
  guardMs: number;
}): boolean => {
  const last = input.lastReloadAt;
  if (last === null || !Number.isFinite(last) || last <= 0) return true;
  const elapsed = input.now - last;
  if (elapsed < 0) return true;
  return elapsed >= input.guardMs;
};

/** The value to persist after taking a chunk reload. */
export const recordChunkReload = (now: number): string => String(now);

/** Anything that is not a positive finite number reads as "never
 *  reloaded" — refusing on garbage would leave a genuinely stale tab
 *  with no way out. */
export const readChunkReloadAt = (raw: string | null | undefined): number | null => {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
};

/** The two storage operations the guard needs, as a plain pair, so the
 *  decision can be tested without a browser. */
export type GuardStore = {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
};

/**
 * Read the guard, decide, write it back. With no working storage the
 * answer is always no: a browser that cannot remember it is looping is
 * the worst place to start a loop.
 */
export const claimChunkReload = (
  store: GuardStore | null,
  input: { now: number; guardMs?: number; key?: string },
): boolean => {
  if (store === null) return false;
  const key = input.key ?? CHUNK_RELOAD_STORAGE_KEY;
  const guardMs = input.guardMs ?? CHUNK_RELOAD_GUARD_MS;
  try {
    const lastReloadAt = readChunkReloadAt(store.get(key));
    if (!shouldChunkReload({ now: input.now, lastReloadAt, guardMs })) return false;
    store.set(key, recordChunkReload(input.now));
    return true;
  } catch {
    return false;
  }
};

/** Message shapes a failed chunk or dynamic import actually produces,
 *  across bundlers — matching one bundler's string is how this check
 *  silently stops working the day the project moves to another one.
 *
 *    webpack / Next.js : "Loading chunk 42 failed", "Loading CSS chunk"
 *    Vite / Rollup     : "Failed to fetch dynamically imported module",
 *                        "Unable to preload CSS for"
 *    Firefox           : "error loading dynamically imported module"
 *    Safari            : "Importing a module script failed"
 *    any bundler, when a 404 is answered with the index document:
 *                        "Failed to load module script" */
const CHUNK_ERROR_PATTERNS: readonly RegExp[] = [
  /Loading (CSS )?chunk [\w/.-]+ failed/i,
  /Failed to load chunk/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Failed to load module script/i,
  /Unable to preload CSS for/i,
];

/**
 * Whether a thrown value is a chunk or dynamic-import load failure.
 * Takes unknown because every source hands over something different: an
 * ErrorEvent carries an Error or a bare string, a rejection carries
 * whatever was rejected, and an error boundary carries a re-thrown error
 * whose cause holds the real one. One level of cause is unwrapped.
 */
export const isChunkLoadFailure = (error: unknown, depth = 1): boolean => {
  if (typeof error === "string") return CHUNK_ERROR_PATTERNS.some((re) => re.test(error));
  if (typeof error !== "object" || error === null) return false;
  const { name, message, cause } = error as {
    name?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  if (typeof name === "string" && ["ChunkLoadError"].includes(name)) return true;
  if (typeof message === "string" && CHUNK_ERROR_PATTERNS.some((re) => re.test(message))) {
    return true;
  }
  if (depth > 0 && cause !== undefined && cause !== null) {
    return isChunkLoadFailure(cause, depth - 1);
  }
  return false;
};
