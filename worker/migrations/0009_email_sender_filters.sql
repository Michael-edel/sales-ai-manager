CREATE TABLE IF NOT EXISTS email_sender_filters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_email TEXT NOT NULL UNIQUE,
  sender_label TEXT,
  is_hidden INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_sender_filters_hidden_email ON email_sender_filters(is_hidden, sender_email);
