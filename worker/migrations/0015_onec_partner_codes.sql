ALTER TABLE crm_clients ADD COLUMN onec_partner_code TEXT;
ALTER TABLE crm_clients ADD COLUMN onec_counterparty_code TEXT;

CREATE INDEX IF NOT EXISTS idx_crm_clients_onec_partner_code
  ON crm_clients(onec_partner_code);

CREATE INDEX IF NOT EXISTS idx_crm_clients_onec_counterparty_code
  ON crm_clients(onec_counterparty_code);
