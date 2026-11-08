#!/usr/bin/env node
// Writes the build-info file that an open tab compares itself against:
// which commit this bundle was built from, and which API origin was
// baked into it. The image build stamps the same file from COMMIT_SHA
// (see the client Dockerfile); this covers a local build, where there is
// no build arg and the file would otherwise 404.
//
// Usage: node scripts/write-version-json.mjs [out-file]
// Reads COMMIT_SHA and NEXT_PUBLIC_API_URL from the environment, and
// falls back to the working tree's HEAD when COMMIT_SHA is unset.
//
// Generated and owned by hatchkit: regenerated on every hatchkit
// update, so an edit here is lost.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_TARGET = "packages/client/public/version.json";

const headCommit = () => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // Not a repository, or no git — an empty commit is the honest
    // answer, and it disables the version check rather than faking one.
    return "";
  }
};

const target = resolve(process.cwd(), process.argv[2] ?? DEFAULT_TARGET);
const body = {
  commit: (process.env.COMMIT_SHA ?? "").trim() || headCommit(),
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "",
};

mkdirSync(dirname(target), { recursive: true });
// JSON.stringify rather than a printf, so no value can break the quoting.
writeFileSync(target, JSON.stringify(body) + "\n");
console.log("wrote " + target);
