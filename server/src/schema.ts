export const MIGRATION_001 = `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'restricted')),
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  disabled_at TEXT
);

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_color TEXT,
  simple_mode INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE INDEX profiles_user_id_idx ON profiles(user_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE server_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE profile_settings (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (profile_id, key)
);

CREATE TABLE credential_secrets (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('server', 'profile')),
  profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((scope = 'server' AND profile_id IS NULL) OR (scope = 'profile' AND profile_id IS NOT NULL))
);

CREATE INDEX credential_lookup_idx
  ON credential_secrets(provider, scope, profile_id, is_active, priority);

CREATE TABLE watchlist (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  added_at TEXT NOT NULL,
  preview_json TEXT NOT NULL,
  PRIMARY KEY (profile_id, media_id)
);

CREATE INDEX watchlist_added_at_idx ON watchlist(profile_id, added_at);

CREATE TABLE watch_history (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  episode_key TEXT NOT NULL DEFAULT '',
  episode_id TEXT,
  progress_seconds REAL NOT NULL DEFAULT 0,
  duration_seconds REAL,
  completed INTEGER NOT NULL DEFAULT 0,
  last_watched TEXT NOT NULL,
  stream_quality TEXT,
  preview_json TEXT NOT NULL,
  PRIMARY KEY (profile_id, media_id, episode_key)
);

CREATE INDEX watch_history_last_watched_idx
  ON watch_history(profile_id, last_watched);

CREATE TABLE library_folders (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_id TEXT,
  list_type TEXT NOT NULL,
  folder_kind TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES library_folders(id) ON DELETE SET NULL
);

CREATE INDEX library_folders_profile_idx ON library_folders(profile_id, list_type);

CREATE TABLE user_library (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  folder_id TEXT,
  list_type TEXT NOT NULL,
  added_at TEXT NOT NULL,
  custom_list_name TEXT,
  release_date_hint TEXT,
  renewal_status TEXT,
  preview_json TEXT NOT NULL,
  UNIQUE (profile_id, media_id, folder_id),
  FOREIGN KEY (folder_id) REFERENCES library_folders(id) ON DELETE SET NULL
);

CREATE INDEX user_library_profile_idx ON user_library(profile_id, list_type, added_at);

CREATE TABLE stream_sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  encrypted_upstream_url TEXT NOT NULL,
  content_type TEXT,
  title TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX stream_sessions_profile_idx ON stream_sessions(profile_id, expires_at);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX audit_log_created_at_idx ON audit_log(created_at);
`;

export const MIGRATION_002 = `
ALTER TABLE stream_sessions ADD COLUMN bytes_served INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stream_sessions ADD COLUMN last_accessed_at TEXT;
ALTER TABLE stream_sessions ADD COLUMN completed_at TEXT;
ALTER TABLE stream_sessions ADD COLUMN last_status INTEGER;
ALTER TABLE stream_sessions ADD COLUMN last_error TEXT;
CREATE INDEX stream_sessions_created_idx ON stream_sessions(profile_id, created_at);
`;

export const MIGRATION_003 = `
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  label TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'restricted')),
  simple_mode INTEGER NOT NULL DEFAULT 1,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX invites_active_idx ON invites(expires_at, revoked_at);
`;
