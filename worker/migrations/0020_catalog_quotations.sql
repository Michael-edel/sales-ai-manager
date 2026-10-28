-- Imported catalog versions are immutable. Only a fully received version is activated.
CREATE TABLE catalog_imports (
  id TEXT PRIMARY KEY,
  source_system TEXT NOT NULL,
  exported_at TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('test','live','unknown')),
  expected_count INTEGER NOT NULL CHECK(expected_count BETWEEN 1 AND 100000),
  received_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','complete')),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE catalog_import_batches (
  import_id TEXT NOT NULL REFERENCES catalog_imports(id),
  batch_index INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  offer_count INTEGER NOT NULL,
  PRIMARY KEY(import_id,batch_index)
);
CREATE TABLE catalog_offers (
  snapshot_id TEXT NOT NULL REFERENCES catalog_imports(id),
  offer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  article_key TEXT NOT NULL,
  onec_code_key TEXT NOT NULL,
  search_text TEXT NOT NULL,
  source_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(snapshot_id,offer_id)
);
CREATE INDEX idx_catalog_article ON catalog_offers(snapshot_id,article_key);
CREATE INDEX idx_catalog_onec_code ON catalog_offers(snapshot_id,onec_code_key);
CREATE INDEX idx_catalog_product ON catalog_offers(snapshot_id,product_id);
CREATE TABLE catalog_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  active_snapshot_id TEXT NOT NULL REFERENCES catalog_imports(id)
);
CREATE TABLE request_quotations (
  request_id INTEGER PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  catalog_snapshot_id TEXT NOT NULL REFERENCES catalog_imports(id),
  draft_json TEXT NOT NULL,
  evaluation_json TEXT NOT NULL,
  write_token TEXT NOT NULL,
  updated_by INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
