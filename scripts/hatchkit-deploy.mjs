#!/usr/bin/env node
/**
 * Promote, deploy, gate and — when the gate fails — roll back tidepost.
 *
 *   node scripts/hatchkit-deploy.mjs deploy --sha <sha> [--which both|client]
 *        [--rollback] [--guard-server-downgrade] [--force-server]
 *   node scripts/hatchkit-deploy.mjs verify --sha <sha>
 *
 * The deploy workflow runs 'deploy --rollback' on every push to the
 * default branch. The manual rollback workflow runs 'deploy' with
 * '--guard-server-downgrade', and adds '--rollback' only when the
 * operator asked for the images that were live before the run to be put
 * back — after a manual rollback those are usually the build being
 * escaped, so restoring them would promote it again.
 *
 * Generated and OWNED by hatchkit: every 'hatchkit update' regenerates
 * this file from the project manifest, so an edit made here is lost on
 * the next run.
 *
 * All the logic, and all of its tests, live in
 * scripts/lib/hatchkit-deploy.mjs; this file only supplies the network, the
 * clock and git.
 *
 * The migration guard reads the registry at two commits with git, so the
 * checkout needs the full history (fetch-depth: 0). A shallow checkout
 * is the usual reason a rollback is refused as 'unknown'.
 *
 * Environment: COOLIFY_BASE_URL; per application its uuid, deploy
 * secret, repository and branch (COOLIFY_RESOURCE_UUID,
 * COOLIFY_DEPLOY_SECRET, COOLIFY_DEPLOY_REPOSITORY, COOLIFY_DEPLOY_BRANCH
 * for a single application, or the same names with SERVER_ / CLIENT_
 * after COOLIFY_ for two); GITHUB_TOKEN with packages: write, which moves
 * the live tag; and optionally HATCHKIT_WEB_URL / HATCHKIT_API_URL to
 * override the origins this project was generated with. There is no
 * platform API token: each deploy secret deploys one application.
 */
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

import {
  APPS,
  IMAGE_BASE,
  MIGRATIONS,
  ORIGINS,
  parseWhich,
  runDeploy,
  runVerify,
} from "./lib/hatchkit-deploy.mjs";

const inActions = process.env.GITHUB_ACTIONS === "true";
const fail = (message) =>
  console.error(inActions ? "::error::" + message.replace(/\n/g, "%0A") : "ERROR: " + message);
const notice = (message) => console.log(inActions ? "::notice::" + message : message);

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const haveCommit = (sha) => {
  try {
    git("cat-file", "-e", sha + "^{commit}");
    return true;
  } catch (caught) {
    return false;
  }
};

const numericField = (text, field) => {
  const match = new RegExp('\\b"?' + field + '"?\\s*[:=]\\s*(\\d+)').exec(text);
  return match ? Number(match[1]) : null;
};

const registries = new Map();

/**
 * The migration registry at a commit, out of git.
 *
 * A directory that is not there is an empty registry — a project with no
 * migrations cannot have one that blocks a rollback. Anything else that
 * cannot be read is an error, which the guard treats as unsafe.
 */
const readRegistry = (sha) => {
  const cached = registries.get(sha);
  if (cached) return cached;
  const read = (() => {
    if (!haveCommit(sha)) {
      try {
        git("fetch", "--no-tags", "--quiet", "origin", sha);
      } catch (caught) {
        // Reported below as a commit missing from the checkout.
      }
      if (!haveCommit(sha)) {
        return { ok: false, error: "commit " + sha + " is not in this checkout (fetch-depth: 0?)" };
      }
    }
    let names;
    try {
      names = git("ls-tree", "--name-only", sha + ":" + MIGRATIONS.dir)
        .split("\n")
        .filter(Boolean);
    } catch (caught) {
      // git exits non-zero for a path that does not exist at that commit,
      // which is a project without migrations, not an unreadable one.
      return { ok: true, registry: { migrations: [], schemaVersion: 0 } };
    }
    const migrations = [];
    for (const name of names) {
      if (!/\.(ts|js|mjs|cjs|sql)$/.test(name) || /^index\./.test(name)) continue;
      let text;
      try {
        text = git("show", sha + ":" + MIGRATIONS.dir + "/" + name);
      } catch (caught) {
        return { ok: false, error: MIGRATIONS.dir + "/" + name + " could not be read at " + sha };
      }
      const id = numericField(text, MIGRATIONS.idField);
      const minReader = numericField(text, MIGRATIONS.minReaderField);
      if (id === null || minReader === null) {
        return {
          ok: false,
          error: MIGRATIONS.dir + "/" + name + " has no literal " + MIGRATIONS.idField + " and " + MIGRATIONS.minReaderField,
        };
      }
      migrations.push({ id: id, file: name, minReader: minReader });
    }
    migrations.sort((a, b) => a.id - b.id);
    return {
      ok: true,
      registry: {
        migrations: migrations,
        schemaVersion: migrations.length === 0 ? 0 : migrations[migrations.length - 1].id,
      },
    };
  })();
  registries.set(sha, read);
  return read;
};

const deps = {
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (line) => console.log(line),
  readRegistry: readRegistry,
};

const env = (name) => (process.env[name] || "").trim();
const trimSlash = (value) => value.replace(/\/+$/, "");

const main = async () => {
  const parsed = parseArgs({
    allowPositionals: true,
    options: {
      sha: { type: "string" },
      which: { type: "string", default: "both" },
      rollback: { type: "boolean", default: false },
      "guard-server-downgrade": { type: "boolean", default: false },
      "force-server": { type: "boolean", default: false },
    },
  });
  const command = parsed.positionals[0];
  const sha = (parsed.values.sha || "").trim().toLowerCase();
  if ((command !== "deploy" && command !== "verify") || sha === "") {
    fail("usage: node scripts/hatchkit-deploy.mjs deploy|verify --sha <sha> [--which both|" + APPS.join("|") + "] [--rollback]");
    return 2;
  }

  const webOrigin = trimSlash(env("HATCHKIT_WEB_URL") || ORIGINS.web);
  const apiOrigin = trimSlash(env("HATCHKIT_API_URL") || ORIGINS.api);
  if (webOrigin === "" && apiOrigin === "") {
    fail("neither a web nor an API origin is set, so nothing could be verified.");
    return 2;
  }

  if (command === "verify") {
    const result = await runVerify(deps, { webOrigin: webOrigin, apiOrigin: apiOrigin }, sha);
    if (result.ok) return 0;
    fail(result.errors.join("\n"));
    return 1;
  }

  const apps = parseWhich(parsed.values.which);
  const baseUrl = trimSlash(env("COOLIFY_BASE_URL"));
  // A single application carries the unprefixed names; a split project
  // one set per half. Each half falls back to the unprefixed set, which
  // is how a single-origin project's two halves share one application.
  const hookName = (app, key) =>
    env("COOLIFY_" + app.toUpperCase() + "_" + key) !== ""
      ? "COOLIFY_" + app.toUpperCase() + "_" + key
      : "COOLIFY_" + key;
  const hooks = {};
  const needed = [["COOLIFY_BASE_URL", baseUrl]];
  for (const app of apps) {
    hooks[app] = {};
    for (const [field, key] of [
      ["uuid", "RESOURCE_UUID"],
      ["secret", "DEPLOY_SECRET"],
      ["repository", "DEPLOY_REPOSITORY"],
      ["branch", "DEPLOY_BRANCH"],
    ]) {
      const name = hookName(app, key);
      hooks[app][field] = env(name);
      needed.push([name, hooks[app][field]]);
    }
  }
  const registryPassword = env("GITHUB_TOKEN");
  needed.push(["GITHUB_TOKEN", registryPassword]);

  const unique = needed.filter((pair, index) => needed.findIndex((other) => other[0] === pair[0]) === index);
  const missing = unique.filter((pair) => pair[1] === "").map((pair) => pair[0]);
  // Nothing configured is a project that does not deploy from CI yet.
  // SOME of it configured is a half-built deploy, which is worse than
  // none, so it fails rather than doing part of the work. GITHUB_TOKEN is
  // not counted: it is always there in Actions.
  const platformNames = unique.filter((pair) => pair[0] !== "GITHUB_TOKEN");
  if (platformNames.every((pair) => pair[1] === "")) {
    notice("No platform deploy secrets are set — nothing was deployed.");
    return 0;
  }
  if (missing.length > 0) {
    fail(missing.join(", ") + " not set, while the other deploy secrets are. Set all of them (hatchkit sync) or none.");
    return 1;
  }

  const imageBase = Object.assign({}, IMAGE_BASE);
  const ownerRepo = env("IMAGE_OWNER_REPO");
  for (const app of apps) {
    if (!imageBase[app] && ownerRepo !== "") imageBase[app] = "ghcr.io/" + ownerRepo + "-" + app;
    if (!imageBase[app]) {
      fail("no image reference is known for the " + app + " half: set IMAGE_OWNER_REPO, or run hatchkit regen-infra.");
      return 2;
    }
  }

  const result = await runDeploy(
    deps,
    {
      baseUrl: baseUrl,
      hooks: hooks,
      registryAuth: { username: env("GITHUB_ACTOR") || "x-access-token", password: registryPassword },
      imageBase: imageBase,
      webOrigin: webOrigin,
      apiOrigin: apiOrigin,
    },
    {
      targetSha: sha,
      apps: apps,
      rollback: parsed.values.rollback,
      guardServerDowngrade: parsed.values["guard-server-downgrade"],
      forceServer: parsed.values["force-server"],
    },
  );
  if (result.ok) {
    notice(apps.join(" and ") + " at " + sha + " passed the deploy gate.");
    return 0;
  }
  // One annotation, so the run summary shows the headline — the failed
  // check, the new commit and what was restored — with its details under
  // it.
  fail(result.errors.join("\n"));
  return 1;
};

main().then(
  (code) => process.exit(code),
  (caught) => {
    fail(caught instanceof Error ? caught.message : String(caught));
    process.exit(1);
  },
);
