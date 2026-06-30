ALTER TABLE requests ADD COLUMN invoice_number TEXT;
ALTER TABLE requests ADD COLUMN invoice_date TEXT;
ALTER TABLE requests ADD COLUMN invoice_status TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE requests ADD COLUMN contract_appendix_status TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE requests ADD COLUMN contract_appendix_note TEXT;
ALTER TABLE requests ADD COLUMN customer_sent_at TEXT;

UPDATE requests
SET contract_appendix_status = 'required'
WHERE requires_contract_appendix = 1
  AND (contract_appendix_status IS NULL OR contract_appendix_status = 'not_required');

CREATE INDEX IF NOT EXISTS idx_requests_invoice_status ON requests(invoice_status);
CREATE INDEX IF NOT EXISTS idx_requests_appendix_status ON requests(contract_appendix_status);
