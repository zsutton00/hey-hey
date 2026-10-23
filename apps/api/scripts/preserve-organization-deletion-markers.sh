#!/bin/bash

set -euo pipefail

MODE="${1-}"
DATABASE_CONNECTION="${2-}"
TARGET_SCHEMA="${3-public}"
PRESERVED_SCHEMA="heyhey_closure_restore"

if [[ "$MODE" != "capture" && "$MODE" != "apply" ]]; then
  echo "Usage: $0 <capture|apply> <database-url> [target-schema]" >&2
  exit 1
fi
if [[ -z "$DATABASE_CONNECTION" ]]; then
  echo "Database URL is required" >&2
  exit 1
fi
if [[ ! "$TARGET_SCHEMA" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "Unsafe target schema name" >&2
  exit 1
fi

if [[ "$MODE" == "capture" ]]; then
  psql "$DATABASE_CONNECTION" -v ON_ERROR_STOP=1 <<SQL
CREATE SCHEMA IF NOT EXISTS "$PRESERVED_SCHEMA";
CREATE TABLE IF NOT EXISTS "$PRESERVED_SCHEMA".retained_rows (
  kind TEXT NOT NULL,
  identity TEXT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (kind, identity)
);
TRUNCATE "$PRESERVED_SCHEMA".retained_rows;

DO \$preserve\$
BEGIN
  IF to_regclass('"$TARGET_SCHEMA".organization_deletion_markers') IS NOT NULL THEN
    INSERT INTO "$PRESERVED_SCHEMA".retained_rows(kind, identity, payload)
    SELECT 'marker', organization_id, to_jsonb(marker)
    FROM "$TARGET_SCHEMA".organization_deletion_markers marker;

    INSERT INTO "$PRESERVED_SCHEMA".retained_rows(kind, identity, payload)
    SELECT 'execution', organization_id, to_jsonb(execution)
    FROM "$TARGET_SCHEMA".organization_closure_executions execution;

    INSERT INTO "$PRESERVED_SCHEMA".retained_rows(kind, identity, payload)
    SELECT 'event', id, to_jsonb(event)
    FROM "$TARGET_SCHEMA".outbox_events event
    WHERE event_type = 'organization.closed';
  END IF;
END
\$preserve\$;
SQL
  exit 0
fi

psql "$DATABASE_CONNECTION" -v ON_ERROR_STOP=1 <<SQL
DELETE FROM "$TARGET_SCHEMA".organization_closure_executions
WHERE organization_id IN (
  SELECT identity FROM "$PRESERVED_SCHEMA".retained_rows WHERE kind = 'marker'
);
DELETE FROM "$TARGET_SCHEMA".organization_deletion_markers
WHERE organization_id IN (
  SELECT identity FROM "$PRESERVED_SCHEMA".retained_rows WHERE kind = 'marker'
);
DELETE FROM "$TARGET_SCHEMA".outbox_events
WHERE event_type = 'organization.closed'
  AND organization_id IN (
    SELECT identity FROM "$PRESERVED_SCHEMA".retained_rows WHERE kind = 'marker'
  );

INSERT INTO "$TARGET_SCHEMA".organization_deletion_markers
SELECT (jsonb_populate_record(NULL::"$TARGET_SCHEMA".organization_deletion_markers, payload)).*
FROM "$PRESERVED_SCHEMA".retained_rows
WHERE kind = 'marker'
ON CONFLICT DO NOTHING;

INSERT INTO "$TARGET_SCHEMA".organization_closure_executions
SELECT (jsonb_populate_record(NULL::"$TARGET_SCHEMA".organization_closure_executions, payload)).*
FROM "$PRESERVED_SCHEMA".retained_rows
WHERE kind = 'execution'
ON CONFLICT DO NOTHING;

INSERT INTO "$TARGET_SCHEMA".outbox_events
SELECT (jsonb_populate_record(NULL::"$TARGET_SCHEMA".outbox_events, payload)).*
FROM "$PRESERVED_SCHEMA".retained_rows
WHERE kind = 'event'
ON CONFLICT DO NOTHING;

-- A backup may predate an effective closure and therefore contain the closed
-- organization's aggregate and operational rows. The retained markers are the
-- authoritative fence: re-apply the same bounded tenant deletion used by the
-- live closure path so restore cannot resurrect that data.
DELETE FROM "$TARGET_SCHEMA".outbox_events
WHERE organization_id IN (
  SELECT identity FROM "$PRESERVED_SCHEMA".retained_rows WHERE kind = 'marker'
)
AND event_type <> 'organization.closed';

DELETE FROM "$TARGET_SCHEMA".organizations
WHERE id IN (
  SELECT identity FROM "$PRESERVED_SCHEMA".retained_rows WHERE kind = 'marker'
);

DO \$purge\$
DECLARE
  scoped_table TEXT;
BEGIN
  FOR scoped_table IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = '$TARGET_SCHEMA'
      AND column_name = 'organization_id'
      AND table_name NOT IN (
        'organizations',
        'organization_deletion_markers',
        'organization_closure_executions',
        'outbox_events'
      )
    ORDER BY table_name
  LOOP
    EXECUTE format(
      'DELETE FROM %I.%I WHERE organization_id IN (SELECT identity FROM %I.retained_rows WHERE kind = %L)',
      '$TARGET_SCHEMA',
      scoped_table,
      '$PRESERVED_SCHEMA',
      'marker'
    );
  END LOOP;
END
\$purge\$;

DROP SCHEMA "$PRESERVED_SCHEMA" CASCADE;
SQL
