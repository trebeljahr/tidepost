import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./src/index.ts",
      miniflare: {
        compatibilityDate: "2026-11-01",
        d1Databases: ["DB"],
        kvNamespaces: ["PHOTOS"],
        bindings: {
          GRAPH_BASE: "https://graph.test/v27.0",
          SETUP_CODE: "correct horse battery staple",
          TEST_MIGRATIONS: await readD1Migrations(path.join(__dirname, "migrations")),
        },
      },
    })),
  ],
  test: { setupFiles: ["./test/apply-migrations.ts"] },
});
