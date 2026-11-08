"use client";

/**
 * Keeps a long-open tab usable across a deploy: offers a reload when a
 * newer build is live, and reloads once when a removed chunk fails to
 * load. See lib/deploy-recovery/version-check.ts and
 * lib/deploy-recovery/chunk-reload.ts.
 *
 * Decides everything in an effect rather than during render, for two
 * reasons: the host is only known after mount, and the prerendered HTML
 * has to be identical whichever host ends up running it.
 *
 * Mount it inside whatever holds the app's writes and pass them in, so
 * the offer can wait for a write in flight. Without that it still works;
 * it just cannot tell a quiet tab from a busy one.
 *
 * Generated and owned by hatchkit: regenerated on every hatchkit
 * update, so an edit here is lost. Change the app around it instead.
 */

import * as React from "react";

import { currentHost } from "../lib/deploy-recovery/host";
import { watchChunkErrors } from "../lib/deploy-recovery/chunk-reload";
import { isChunkRecoveryEnabled, isRecoveryEnabled } from "../lib/deploy-recovery/policy";
import {
  createVersionWatcher,
  noWriteActivity,
  runWhenIdle,
  watchForVersionChange,
} from "../lib/deploy-recovery/version-check";
import type { WriteActivity } from "../lib/deploy-recovery/version-check";

export type DeployRecoveryProps = {
  /** The app's writes in flight. Defaults to "none, ever". */
  writes?: WriteActivity;
  /** Override the check interval. Tests and demos only. */
  intervalMs?: number;
};

export function DeployRecovery({
  writes = noWriteActivity,
  intervalMs,
}: DeployRecoveryProps): React.ReactElement | null {
  const [offered, setOffered] = React.useState(false);
  const cancelPendingReload = React.useRef<() => void>(() => undefined);

  React.useEffect(() => {
    const host = currentHost();
    const stops: Array<() => void> = [];

    if (isChunkRecoveryEnabled(host)) stops.push(watchChunkErrors());

    if (isRecoveryEnabled(host)) {
      const watcher = createVersionWatcher({
        builtCommit: host.builtCommit,
        writes,
        intervalMs,
        // A newer build only ever raises the offer. Reloading here would
        // take the page out from under whoever is using it, which is a
        // worse outcome than the stale tab this is trying to fix.
        onOffer: () => setOffered(true),
      });
      stops.push(watchForVersionChange(watcher));
    }

    return () => {
      for (const stop of stops) stop();
      cancelPendingReload.current();
    };
  }, [writes, intervalMs]);

  // The only reload in this file, and it is reachable only from the
  // button below. It still waits for writes to drain, because the click
  // that pressed it also blurred whatever field was focused.
  const handleReloadClick = React.useCallback(() => {
    cancelPendingReload.current();
    cancelPendingReload.current = runWhenIdle(writes, () => {
      window.location.reload();
    });
  }, [writes]);

  if (!offered) return null;

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        insetInline: 0,
        bottom: 0,
        zIndex: 9999,
        display: "flex",
        gap: "0.75rem",
        alignItems: "center",
        justifyContent: "center",
        padding: "0.75rem 1rem",
        background: "#111827",
        color: "#f9fafb",
        fontSize: "0.875rem",
      }}
    >
      <span>A new version of this app is available.</span>
      <button
        type="button"
        onClick={handleReloadClick}
        style={{
          padding: "0.25rem 0.75rem",
          borderRadius: "0.375rem",
          border: "1px solid currentColor",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
        }}
      >
        Reload
      </button>
      <button
        type="button"
        onClick={() => setOffered(false)}
        aria-label="Dismiss"
        style={{
          background: "transparent",
          border: "none",
          color: "inherit",
          cursor: "pointer",
        }}
      >
        Not now
      </button>
    </div>
  );
}
