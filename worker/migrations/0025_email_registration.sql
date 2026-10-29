-- Email ownership is proved before a password or active account is created.
CREATE TABLE IF NOT EXISTS auth_email_registrations (
  email TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  token_hash TEXT UNIQUE,
  expires_at TEXT NOT NULL,
  last_sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  consumed_at TEXT,
  consumption_nonce TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS auth_registration_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_started_at TEXT NOT NULL DEFAULT (datetime('now'))
);
