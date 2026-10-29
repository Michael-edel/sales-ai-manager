-- Additive: existing PBKDF2 credentials and sessions keep their original version.
ALTER TABLE app_users ADD COLUMN password_scheme TEXT NOT NULL DEFAULT 'pbkdf2-sha256' CHECK(password_scheme IN ('pbkdf2-sha256','scrypt-v1'));
ALTER TABLE app_users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1 CHECK(auth_version >= 1);
ALTER TABLE auth_sessions ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1 CHECK(auth_version >= 1);
