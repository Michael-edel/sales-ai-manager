CREATE TABLE IF NOT EXISTS request_onec_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  onec_product_ref TEXT,
  onec_product_code TEXT,
  onec_product_article TEXT,
  onec_product_name TEXT,
  onec_product_full_name TEXT,
  onec_product_unit TEXT,
  onec_product_vat_rate TEXT,
  onec_product_payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_request_onec_products_request_id
  ON request_onec_products(request_id);

CREATE INDEX IF NOT EXISTS idx_request_onec_products_code
  ON request_onec_products(onec_product_code);

CREATE INDEX IF NOT EXISTS idx_request_onec_products_article
  ON request_onec_products(onec_product_article);
