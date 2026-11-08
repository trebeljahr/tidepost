"use client";

/**
 * Deploy recovery — the browser facts the rules need.
 *
 * Kept apart from ./policy.ts so the rules stay testable without a DOM,
 * and small enough to read in one go, because every line of it is a
 * guess about a host that cannot be verified from here.
 *
 * Generated and owned by hatchkit: regenerated on every hatchkit
 * update, so an edit here is lost. Change the app around it instead.
 */

import type { ClientShell, GuardStore } from "./policy";

/** The commit the running bundle was built from, inlined at build time.
 *  Empty for any build that was not stamped — a local build, or a native
 *  shell build — which disables the version check on its own. */
export const BUILT_COMMIT: string = process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "";

/** Where the deployed build announces itself. The image build writes
 *  this file next to the export, and the static server sends it with no
 *  caching — otherwise the tab would be comparing itself against a
 *  cached copy of its own build. */
export const BUILD_INFO_PATH = "/version.json";

/**
 * Which host this bundle is running in.
 *
 * Capacitor first, and by its injected global rather than by the URL:
 * Android serves the bundle from https://localhost, which is
 * indistinguishable from an ordinary web origin by protocol alone. iOS
 * uses capacitor://, Electron the app:// protocol registered by its main
 * process, and Tauri tauri:// on macOS and Linux with
 * http://tauri.localhost on Windows.
 */
export const detectShell = (): ClientShell => {
  if (typeof window === "undefined") return "web";
  const w = window as unknown as Record<string, unknown>;
  if (w.Capacitor !== undefined || window.location.protocol === "capacitor:") return "capacitor";
  if (w.__TAURI__ !== undefined || w.__TAURI_INTERNALS__ !== undefined) return "tauri";
  if (window.location.protocol === "tauri:" || window.location.hostname === "tauri.localhost") {
    return "tauri";
  }
  if (window.location.protocol === "app:") return "electron";
  if (typeof navigator !== "undefined" && / Electron\//.test(navigator.userAgent)) {
    return "electron";
  }
  return "web";
};

/** Everything the enable/disable rules read, gathered in one place. */
export const currentHost = (): { mode: string; shell: ClientShell; builtCommit: string } => ({
  mode: process.env.NODE_ENV ?? "production",
  shell: detectShell(),
  builtCommit: BUILT_COMMIT,
});

/** Session storage, or null when it cannot be used. Private mode and
 *  blocked site data throw on the first access rather than returning
 *  null, so the access itself has to be wrapped. */
export const sessionGuardStore = (): GuardStore | null => {
  try {
    const storage = window.sessionStorage;
    return {
      get: (key) => storage.getItem(key),
      set: (key, value) => storage.setItem(key, value),
    };
  } catch {
    return null;
  }
};
