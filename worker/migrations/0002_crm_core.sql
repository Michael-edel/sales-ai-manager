ALTER TABLE requests ADD COLUMN status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE requests ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE requests ADD COLUMN client_type TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE requests ADD COLUMN requires_contract_appendix INTEGER NOT NULL DEFAULT 0;
ALTER TABLE requests ADD COLUMN next_action TEXT;
ALTER TABLE requests ADD COLUMN client_id INTEGER;
ALTER TABLE requests ADD COLUMN contact_id INTEGER;
ALTER TABLE requests ADD COLUMN michael_manager_id INTEGER;
ALTER TABLE requests ADD COLUMN updated_at TEXT;

UPDATE requests
SET updated_at = COALESCE(updated_at, created_at, datetime('now'));

CREATE TABLE IF NOT EXISTS crm_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  client_type TEXT NOT NULL DEFAULT 'standard',
  is_vip INTEGER NOT NULL DEFAULT 0,
  contract_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crm_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  channel_hint TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(client_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS michael_managers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_priority ON requests(priority);
CREATE INDEX IF NOT EXISTS idx_requests_client_id ON requests(client_id);
CREATE INDEX IF NOT EXISTS idx_crm_clients_type ON crm_clients(client_type);
CREATE INDEX IF NOT EXISTS idx_request_events_request_id ON request_events(request_id);
CREATE INDEX IF NOT EXISTS idx_request_events_created_at ON request_events(created_at);
