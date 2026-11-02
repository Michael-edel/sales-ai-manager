-- Optional compare-and-swap guard for a catalog built from an active snapshot.
-- Existing imports remain unchanged and have no base guard.
ALTER TABLE catalog_imports ADD COLUMN base_snapshot_id TEXT REFERENCES catalog_imports(id);
