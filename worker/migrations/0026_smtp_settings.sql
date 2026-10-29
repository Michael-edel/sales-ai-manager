-- Only authenticated, encrypted configuration is retained. The AES key is a Worker secret.
CREATE TABLE smtp_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  updated_by INTEGER NOT NULL REFERENCES app_users(id),
  updated_at TEXT NOT NULL,
  auth_verified_at TEXT NOT NULL
);
