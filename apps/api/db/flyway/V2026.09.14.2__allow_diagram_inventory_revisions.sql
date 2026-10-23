-- A failed application may require corrected tooling and a fresh immutable
-- manifest. Keep every prior revision and receipt; uniqueness belongs to the
-- content digest, not the migration family name. No evidence payload is changed.
ALTER TABLE diagram_cutover_inventory
  DROP CONSTRAINT IF EXISTS diagram_cutover_inventory_migration_name_key;
CREATE INDEX IF NOT EXISTS diagram_cutover_inventory_migration_name_idx
  ON diagram_cutover_inventory (migration_name);
