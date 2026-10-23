ALTER TABLE tracking_cleanup_operations
  RENAME COLUMN source_type_key TO target_type_key;

ALTER TABLE tracking_cleanup_operations
  RENAME COLUMN revoked_target_type_keys TO revoked_source_type_keys;
