-- Key/value settings: Instagram token, account, secrets generated on first run.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,            -- credential id, base64url
  public_key TEXT NOT NULL,       -- base64url COSE key
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,                -- JSON array
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  kind TEXT NOT NULL,             -- setup | add | login
  expires_at INTEGER NOT NULL
);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,           -- space separated: read drafts
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

-- status: draft | approved | publishing | published | failed | needs_approval
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft',
  caption TEXT NOT NULL DEFAULT '',
  suggestion TEXT,                -- caption suggestion from an API client; never published as is
  aspect TEXT NOT NULL DEFAULT '4:5',
  scheduled_at INTEGER,           -- unix seconds, UTC
  version INTEGER NOT NULL DEFAULT 1,
  approved_version INTEGER,
  step TEXT,                      -- publisher step: children | carousel | poll | publish_call
  container_id TEXT,
  started_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_try_at INTEGER,
  ig_media_id TEXT,
  permalink TEXT,
  error TEXT,
  source TEXT NOT NULL DEFAULT 'ui',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER
);
CREATE INDEX posts_status ON posts(status, scheduled_at);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kv_key TEXT,                    -- NULL once deleted after publishing
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  alt_text TEXT NOT NULL DEFAULT '',
  dhash TEXT,                     -- 16 hex chars
  container_id TEXT,              -- carousel child container
  child_ready INTEGER NOT NULL DEFAULT 0,
  uploaded_at INTEGER NOT NULL
);
CREATE INDEX items_post ON items(post_id, position);

-- Mirror of the account's latest posts for the grid preview. Images only, no counts.
CREATE TABLE grid (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  media_type TEXT NOT NULL,
  image_url TEXT,
  permalink TEXT,
  timestamp TEXT,
  dhash TEXT
);
