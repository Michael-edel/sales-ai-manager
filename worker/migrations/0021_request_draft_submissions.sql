-- A user-scoped submission key prevents duplicate draft requests after retries.
-- Keep request_id after deletion as a tombstone; the same key must not recreate it.
CREATE TABLE IF NOT EXISTS request_draft_submissions (
  user_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  request_id INTEGER,
  claim_token TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, idempotency_key)
);
