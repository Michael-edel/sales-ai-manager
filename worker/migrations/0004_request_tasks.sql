CREATE TABLE IF NOT EXISTS request_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  owner_name TEXT,
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_request_tasks_request_id ON request_tasks(request_id);
CREATE INDEX IF NOT EXISTS idx_request_tasks_status ON request_tasks(status);
CREATE INDEX IF NOT EXISTS idx_request_tasks_due_date ON request_tasks(due_date);
