ALTER TABLE app_users ADD COLUMN email_address TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email_address ON app_users(email_address);
