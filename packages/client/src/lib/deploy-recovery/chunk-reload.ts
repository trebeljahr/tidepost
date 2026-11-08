"use client";

/**
 * Deploy recovery — reloading a tab whose chunks were removed by a
 * deploy.
 *
 * Hashed chunk names change with every image, so a tab opened before a
 * deploy asks for a name the server no longer has the first time it
 * lazily loads a route. The cure is a reload, which fetches the current
 * document and the current chunk names.
 *
 * It happens automatically at most ONCE per guard window. Keep that
 * guard. When the reload does not help — the server really is broken,
 * the device is offline, a proxy is answering HTML for a script — a
 * second automatic reload starts a loop that never ends, and the person
 * cannot even read the error screen well enough to report it. After the
 * first attempt the error screen's own button, pressed deliberately, is
 * the way out.
 *
 * Generated and owned by hatchkit: regenerated on every hatchkit
 * update, so an edit here is lost. Change the app around it instead.
 */

import { claimChunkReload, isChunkLoadFailure } from "./policy";
import type { GuardStore } from "./policy";
import { sessionGuardStore } from "./host";

/**
 * Reload, unless this tab already did so for a chunk failure inside the
 * guard window. Returns whether it reloaded, so a caller can report the
 * refusal — a chunk still missing after one reload is a broken deploy,
 * not a stale tab, and that is worth knowing about.
 */
export const reloadOnceForChunkError = (
  reload: () => void = () => {
    window.location.reload();
  },
  store: GuardStore | null = sessionGuardStore(),
  now: number = Date.now(),
): boolean => {
  if (!claimChunkReload(store, { now })) return false;
  reload();
  return true;
};

/**
 * Catch the chunk failures nothing else will: a rejected dynamic import
 * and an error thrown outside the component tree. Failures the framework
 * catches reach the error boundaries in app/error.tsx and
 * app/global-error.tsx, which call reloadOnceForChunkError themselves.
 */
export const watchChunkErrors = (
  onChunkError: (error: unknown) => void = () => {
    reloadOnceForChunkError();
  },
): (() => void) => {
  const onError = (event: ErrorEvent): void => {
    const error: unknown = event.error ?? event.message;
    if (isChunkLoadFailure(error)) onChunkError(error);
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    if (isChunkLoadFailure(event.reason)) onChunkError(event.reason);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
};
