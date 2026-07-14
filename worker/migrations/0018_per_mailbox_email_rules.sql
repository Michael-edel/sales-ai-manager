CREATE TABLE email_sender_filters_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mailbox_email TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  sender_label TEXT,
  is_hidden INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(mailbox_email, sender_email)
);

INSERT INTO email_sender_filters_v2 (
  id, mailbox_email, sender_email, sender_label, is_hidden, created_at, updated_at
)
SELECT
  filters.id,
  COALESCE((
    SELECT lower(trim(COALESCE(messages.mailbox_email, messages.to_address)))
    FROM email_messages messages
    WHERE lower(trim(messages.from_address)) = filters.sender_email
      AND COALESCE(messages.mailbox_email, messages.to_address) IS NOT NULL
    ORDER BY messages.id DESC
    LIMIT 1
  ), ''),
  filters.sender_email,
  filters.sender_label,
  filters.is_hidden,
  filters.created_at,
  filters.updated_at
FROM email_sender_filters filters;

DROP TABLE email_sender_filters;
ALTER TABLE email_sender_filters_v2 RENAME TO email_sender_filters;
CREATE INDEX idx_email_sender_filters_hidden_email
  ON email_sender_filters(mailbox_email, is_hidden, sender_email);

CREATE TABLE email_sender_folder_rules_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mailbox_email TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  sender_label TEXT,
  target_folder TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(mailbox_email, sender_email)
);

INSERT INTO email_sender_folder_rules_v2 (
  id, mailbox_email, sender_email, sender_label, target_folder, created_at, updated_at
)
SELECT
  rules.id,
  COALESCE((
    SELECT lower(trim(COALESCE(messages.mailbox_email, messages.to_address)))
    FROM email_messages messages
    WHERE lower(trim(messages.from_address)) = rules.sender_email
      AND COALESCE(messages.mailbox_email, messages.to_address) IS NOT NULL
    ORDER BY messages.id DESC
    LIMIT 1
  ), ''),
  rules.sender_email,
  rules.sender_label,
  rules.target_folder,
  rules.created_at,
  rules.updated_at
FROM email_sender_folder_rules rules;

DROP TABLE email_sender_folder_rules;
ALTER TABLE email_sender_folder_rules_v2 RENAME TO email_sender_folder_rules;
CREATE INDEX idx_email_sender_folder_rules_folder
  ON email_sender_folder_rules(mailbox_email, target_folder);
