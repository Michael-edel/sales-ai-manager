ALTER TABLE crm_clients ADD COLUMN onec_partner_ref TEXT;
ALTER TABLE crm_clients ADD COLUMN onec_partner_name TEXT;
ALTER TABLE crm_clients ADD COLUMN onec_partner_full_name TEXT;
ALTER TABLE crm_clients ADD COLUMN onec_partner_bin TEXT;
ALTER TABLE crm_clients ADD COLUMN onec_partner_payload_json TEXT;
ALTER TABLE crm_clients ADD COLUMN onec_partner_linked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_crm_clients_onec_partner_ref
  ON crm_clients(onec_partner_ref);
