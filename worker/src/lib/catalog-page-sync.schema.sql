-- Local prototype only. Not registered as a deployment migration.
CREATE TABLE catalog_sync_runs(id TEXT PRIMARY KEY,base_snapshot_id TEXT NOT NULL,device_id TEXT NOT NULL,expected_pages INTEGER NOT NULL,added_count INTEGER NOT NULL DEFAULT 0,applied_pages INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL CHECK(status IN ('staging','complete')));
CREATE TABLE catalog_page_refs(snapshot_id TEXT NOT NULL,batch_index INTEGER NOT NULL,content_snapshot_id TEXT NOT NULL,PRIMARY KEY(snapshot_id,batch_index),FOREIGN KEY(content_snapshot_id,batch_index) REFERENCES catalog_pages(snapshot_id,batch_index));
CREATE TABLE catalog_sync_pages(sync_id TEXT NOT NULL,batch_index INTEGER NOT NULL,checksum TEXT NOT NULL,added_count INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(sync_id,batch_index));

-- Device tokens are generated and protected on the local computer. Only SHA-256
-- fingerprints are stored here; they do not grant an administrator session.
CREATE TABLE catalog_sync_devices (id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,created_by INTEGER NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT,last_started_at TEXT,rate_claim TEXT);
CREATE TABLE catalog_sync_budget (id INTEGER PRIMARY KEY CHECK(id=1),used_bytes INTEGER NOT NULL CHECK(used_bytes>=0));
INSERT INTO catalog_sync_budget(id,used_bytes) VALUES(1,0);
