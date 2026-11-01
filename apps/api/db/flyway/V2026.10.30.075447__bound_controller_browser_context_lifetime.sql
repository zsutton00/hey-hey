ALTER TABLE controller_browser_contexts
  ADD COLUMN expires_at timestamp(3),
  ADD COLUMN revoked_at timestamp(3);
UPDATE controller_browser_contexts SET expires_at = created_at + INTERVAL '30 days';
ALTER TABLE controller_browser_contexts ALTER COLUMN expires_at SET NOT NULL;
