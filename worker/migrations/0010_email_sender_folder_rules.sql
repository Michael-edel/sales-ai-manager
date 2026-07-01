CREATE TABLE IF NOT EXISTS email_sender_folder_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_email TEXT NOT NULL UNIQUE,
  sender_label TEXT,
  target_folder TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_sender_folder_rules_folder ON email_sender_folder_rules(target_folder);

INSERT INTO email_sender_folder_rules (sender_email, sender_label, target_folder, updated_at)
SELECT
  lower(trim(from_address)) AS sender_email,
  lower(trim(from_address)) AS sender_label,
  CASE
    WHEN SUM(CASE WHEN folder = 'suppliers' THEN 1 ELSE 0 END) > 0 THEN 'suppliers'
    ELSE 'buyers'
  END AS target_folder,
  datetime('now') AS updated_at
FROM email_messages
WHERE folder IN ('suppliers', 'buyers')
  AND from_address IS NOT NULL
  AND trim(from_address) <> ''
GROUP BY lower(trim(from_address))
ON CONFLICT(sender_email) DO UPDATE SET
  sender_label = excluded.sender_label,
  target_folder = excluded.target_folder,
  updated_at = datetime('now');
