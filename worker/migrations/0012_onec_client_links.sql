ALTER TABLE crm_clients ADD COLUMN onec_counterparty_ref TEXT;
ALTER TABLE crm_clients ADD COLUMN onec_counterparty_name TEXT;
ALTER TABLE crm_clients ADD COLUMN onec_counterparty_full_name TEXT;
ALTER TABLE crm_clients ADD COLUMN onec_counterparty_bin TEXT;
ALTER TABLE crm_clients ADD COLUMN onec_counterparty_partner TEXT;
ALTER TABLE crm_clients ADD COLUMN onec_counterparty_payload_json TEXT;
ALTER TABLE crm_clients ADD COLUMN onec_counterparty_linked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_crm_clients_onec_counterparty_ref
  ON crm_clients(onec_counterparty_ref);
