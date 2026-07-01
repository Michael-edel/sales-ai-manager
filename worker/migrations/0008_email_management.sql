ALTER TABLE email_messages ADD COLUMN folder TEXT NOT NULL DEFAULT 'inbox';
ALTER TABLE email_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'received';
ALTER TABLE email_messages ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_messages ADD COLUMN read_at TEXT;
ALTER TABLE email_messages ADD COLUMN closed_at TEXT;
ALTER TABLE email_messages ADD COLUMN deleted_at TEXT;
ALTER TABLE email_messages ADD COLUMN updated_at TEXT;

UPDATE email_messages
SET
  folder = CASE
    WHEN processed_request_id IS NOT NULL THEN 'in_work'
    ELSE 'inbox'
  END,
  status = CASE
    WHEN processed_request_id IS NOT NULL THEN 'in_work'
    ELSE 'received'
  END,
  updated_at = COALESCE(created_at, datetime('now'));

CREATE INDEX IF NOT EXISTS idx_email_messages_folder_created_at ON email_messages(folder, created_at);
CREATE INDEX IF NOT EXISTS idx_email_messages_status ON email_messages(status);
CREATE INDEX IF NOT EXISTS idx_email_messages_is_read ON email_messages(is_read);
