-- Forward-only cutover infrastructure. Does not change saved records or emit
-- events at deployment. The manifest-bound owner is scripts/migrate-diagrams.ts.
-- Existing migration history must pass FULL Flyway validation before applying.
CREATE TABLE diagram_cutover_inventory (
  manifest_sha256 text PRIMARY KEY CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  migration_name text NOT NULL UNIQUE,
  manifest jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE diagram_cutover_receipts (
  manifest_sha256 text NOT NULL REFERENCES diagram_cutover_inventory(manifest_sha256),
  stage text NOT NULL,
  checkpoint_key text NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (manifest_sha256, stage, checkpoint_key)
);

CREATE TABLE diagram_cutover_aliases (
  source_kind text NOT NULL,
  source_key text NOT NULL,
  canonical_key text NOT NULL,
  manifest_sha256 text NOT NULL REFERENCES diagram_cutover_inventory(manifest_sha256),
  PRIMARY KEY (source_kind, source_key)
);

CREATE FUNCTION reject_diagram_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'Diagram cutover evidence is append-only; repair source/projections and record new verification evidence';
END
$function$;

CREATE TRIGGER diagram_inventory_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
ON diagram_cutover_inventory FOR EACH STATEMENT EXECUTE FUNCTION reject_diagram_evidence_mutation();
CREATE TRIGGER diagram_receipts_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
ON diagram_cutover_receipts FOR EACH STATEMENT EXECUTE FUNCTION reject_diagram_evidence_mutation();
CREATE TRIGGER diagram_aliases_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
ON diagram_cutover_aliases FOR EACH STATEMENT EXECUTE FUNCTION reject_diagram_evidence_mutation();
