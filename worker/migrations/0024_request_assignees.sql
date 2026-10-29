-- CRM employee IDs and display names are not authenticated app user IDs.
-- Keep all historical rows intact and unassigned until an admin confirms ownership.
ALTER TABLE requests ADD COLUMN assigned_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL;
CREATE INDEX idx_requests_assigned_created ON requests(assigned_user_id, created_at DESC, id DESC);
