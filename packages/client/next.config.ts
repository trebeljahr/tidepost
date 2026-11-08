import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const isExport = process.env.NEXT_FILE_EXPORT === "1";
// Each native shell gets its OWN export directory, named by the build
// script that writes it:
//
//   out          web / Playwright (Playwright bakes a throwaway loopback
//                API port into its build)
//   out-desktop  scripts/build-desktop.mjs  (Electron)
//   out-mobile   scripts/build-mobile.mjs   (Capacitor)
//
// A shared directory means a test run can silently be installed as the
// app — `cap run` syncs implicitly, so nothing would say so.
//
// Under `output: "export"` Next treats `distDir` as the OUT directory and
// forces the build directory back to `.next`. That is also why a dev
// server holding `.next` blocks a production export: build-mobile.mjs
// refuses to run while one is live rather than racing it.
const exportDir = process.env.NEXT_EXPORT_DIR || "out";

const nextConfig: NextConfig = {
  // The commit this bundle was built from, inlined so an open tab
  // can compare itself with the deployed build info. The image build
  // already sets COMMIT_SHA; this is the step that gets it into
  // BROWSER code, because NEXT_PUBLIC_* values are inlined at build
  // time and runtime container env never reaches the bundle. Empty
  // outside an image build, which disables the check — which is what
  // a local build should do.
  env: { NEXT_PUBLIC_BUILD_COMMIT: process.env.COMMIT_SHA ?? "" },
  // /version.json must never be cached. A tab that outlived a
  // deploy fetches it to find out, and a cached copy answers with the
  // commit that tab already has: no error, no offer, and the stale tab
  // stays stale. Every other asset is hashed and may be cached for
  // ever. (A static export serves files directly and ignores this —
  // set the rule on the file server there instead.)
  async headers() {
    return [
      {
        source: "/version.json",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
  ...(isDev
    ? {}
    : isExport
      ? {
          // Static export for the native shells.
          output: "export" as const,
          distDir: exportDir,
          // No `assetPrefix`, for either shell. A relative prefix rewrites
          // every `/_next/...` reference to `./_next/...`, which resolves
          // against the CURRENT path: it works for a single-page load and
          // breaks every nested route the moment the WebView sits at
          // `/app/settings/`. Electron is not exempt — `app://-` has a real
          // root and `electron/src/resolve-app-path.ts` resolves a request
          // path literally, so `./_next/...` from a nested route would be
          // looked up under that route's own folder and 404. Both build
          // scripts refuse any emitted HTML containing `"./_next`.
        }
      : {
          // Standalone build for the web server image (Coolify Dockerfile).
          // Trace from the monorepo root so the standalone bundle includes
          // workspace deps (@starter/shared).
          // process.cwd() is `<repo>/packages/client` during `next build`.
          output: "standalone" as const,
          outputFileTracingRoot: path.join(process.cwd(), "..", ".."),
        }),
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@starter/shared"],
  // Android live reload: Next 16 blocks cross-origin requests for /_next
  // dev resources, and under `pnpm dev:android` the document is served
  // from the emulator's view of the host (http://10.0.2.2:<port>), which
  // is cross-origin to the dev server. Without this the document loads,
  // every chunk is blocked, and the app sits on a splash that
  // `launchAutoHide: false` never hides. scripts/android-dev.sh exports
  // NEXT_DEV_ORIGINS.
  allowedDevOrigins: (process.env.NEXT_DEV_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

export default nextConfig;
