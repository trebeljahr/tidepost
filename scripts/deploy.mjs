#!/usr/bin/env node
// Deploys the Worker. Optional custom domain: set TIDEPOST_DOMAIN (environment or a
// gitignored .deploy.env file, e.g. TIDEPOST_DOMAIN=posts.example.com). The domain's zone must
// be in the same Cloudflare account. Without it, the Worker answers on workers.dev only.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const env = { ...process.env };
if (existsSync(".deploy.env")) {
  for (const line of readFileSync(".deploy.env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in env)) env[m[1]] = m[2];
  }
}

const run = (args) => execFileSync("npx", ["wrangler", ...args], { stdio: "inherit", env });
const domain = (env.TIDEPOST_DOMAIN ?? "").trim();
let config = "wrangler.jsonc";

if (domain) {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new Error(`TIDEPOST_DOMAIN "${domain}" is not a host name.`);
  // wrangler.jsonc has only full-line comments, so dropping those lines leaves valid JSON.
  const base = JSON.parse(
    readFileSync("wrangler.jsonc", "utf8")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n"),
  );
  base.routes = [{ pattern: domain, custom_domain: true }];
  base.main = `../${base.main}`;
  base.assets.directory = `../${base.assets.directory.replace(/^\.\//, "")}`;
  base.d1_databases = base.d1_databases.map((d) => ({ ...d, migrations_dir: `../${d.migrations_dir}` }));
  mkdirSync(".wrangler", { recursive: true });
  config = ".wrangler/deploy.jsonc";
  writeFileSync(config, JSON.stringify(base, null, 2));
  console.log(`Deploying with custom domain ${domain}`);
}

run(["deploy", "--config", config]);
run(["d1", "migrations", "apply", "DB", "--remote", "--config", config]);
