ALTER TABLE app_users ADD COLUMN password_iterations INTEGER NOT NULL DEFAULT 100000;

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  attempt_key TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_updated_at
  ON auth_login_attempts(updated_at);

