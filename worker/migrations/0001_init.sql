CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  client_company TEXT,
  client_contact_name TEXT,
  michael_manager TEXT,
  communication_channel TEXT,
  original_text TEXT NOT NULL,
  uploaded_file_name TEXT,
  ai_result TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mailbox_name TEXT,
  mailbox_email TEXT,
  michael_manager TEXT,
  message_uid TEXT NOT NULL,
  from_address TEXT,
  to_address TEXT,
  subject TEXT,
  body_text TEXT NOT NULL DEFAULT '',
  attachment_names TEXT,
  attachment_text TEXT,
  processed_request_id INTEGER,
  received_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(mailbox_email, message_uid)
);

CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at);
CREATE INDEX IF NOT EXISTS idx_email_messages_created_at ON email_messages(created_at);
