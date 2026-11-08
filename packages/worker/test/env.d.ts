declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    PHOTOS: KVNamespace;
    GRAPH_BASE: string;
    SETUP_CODE: string;
    TEST_MIGRATIONS: unknown[];
  }
}
