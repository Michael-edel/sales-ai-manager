-- Existing snapshots and quotations remain intact. New imports use bounded JSON
-- pages, avoiding a separate table row and several index writes per offer.
ALTER TABLE catalog_imports ADD COLUMN storage_version INTEGER NOT NULL DEFAULT 1 CHECK(storage_version IN (1,2));
ALTER TABLE catalog_imports ADD COLUMN source_hash TEXT;
CREATE TABLE catalog_pages (
  snapshot_id TEXT NOT NULL REFERENCES catalog_imports(id),
  batch_index INTEGER NOT NULL,
  offer_count INTEGER NOT NULL CHECK(offer_count BETWEEN 1 AND 100),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND json_array_length(payload_json)=offer_count),
  search_text TEXT NOT NULL,
  exact_keys TEXT NOT NULL CHECK(json_valid(exact_keys)),
  offer_keys TEXT NOT NULL CHECK(json_valid(offer_keys) AND json_array_length(offer_keys)=offer_count),
  product_keys TEXT NOT NULL CHECK(json_valid(product_keys)),
  PRIMARY KEY(snapshot_id,batch_index)
);
-- Cross-page offer uniqueness is checked once, atomically at activation. Doing
-- JSON joins against all preceding pages on every upload would spend the read
-- quota while staging; an invalid staging snapshot never replaces the active one.
