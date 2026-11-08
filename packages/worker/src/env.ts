export interface Env {
  DB: D1Database;
  PHOTOS: KVNamespace;
  ASSETS: Fetcher;
  SETUP_CODE?: string;
  GRAPH_BASE: string;
}
