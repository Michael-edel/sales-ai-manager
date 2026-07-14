CREATE TABLE IF NOT EXISTS email_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_message_id INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  parsed_text TEXT,
  parse_status TEXT NOT NULL DEFAULT 'stored',
  parse_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  UNIQUE(email_message_id, ordinal),
  UNIQUE(r2_key),
  FOREIGN KEY(email_message_id) REFERENCES email_messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_attachments_message ON email_attachments(email_message_id, ordinal);
