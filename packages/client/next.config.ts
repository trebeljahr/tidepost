import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  // The commit this bundle was built from, inlined so an open tab can compare
  // itself with /version.json after a deploy. Empty unless COMMIT_SHA is set at
  // build time, which turns the check off.
  env: { NEXT_PUBLIC_BUILD_COMMIT: process.env.COMMIT_SHA ?? "" },
  // Static export: the Worker serves packages/client/out as its assets.
  ...(isDev ? {} : { output: "export" as const }),
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@starter/shared", "@tidepost/ui"],
};

export default nextConfig;
