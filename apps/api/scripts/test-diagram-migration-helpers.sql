-- Run with psql -v ON_ERROR_STOP=1 -f scripts/test-diagram-migration-helpers.sql.
-- All test objects are session-local; no application data is read or written.
\ir ../db/flyway/beforeEachMigrate__clear_diagram_helpers.sql

CREATE FUNCTION pg_temp.diagram_semantics_guidance() RETURNS text
LANGUAGE sql AS $$ SELECT 'earlier guidance'::text $$;
CREATE FUNCTION pg_temp.diagram_writing_standards(type_key text) RETURNS jsonb
LANGUAGE sql AS $$ SELECT jsonb_build_object('guidance', pg_temp.diagram_semantics_guidance(), 'type', type_key) $$;

\ir ../db/flyway/beforeEachMigrate__clear_diagram_helpers.sql

CREATE FUNCTION pg_temp.diagram_semantics_guidance() RETURNS text
LANGUAGE sql AS $$ SELECT 'latest guidance'::text $$;
CREATE FUNCTION pg_temp.diagram_writing_standards(type_key text) RETURNS jsonb
LANGUAGE sql AS $$ SELECT jsonb_build_object('guidance', pg_temp.diagram_semantics_guidance(), 'type', type_key) $$;

DO $$
BEGIN
  IF pg_temp.diagram_writing_standards('diagram') IS DISTINCT FROM
    '{"guidance": "latest guidance", "type": "diagram"}'::jsonb THEN
    RAISE EXCEPTION 'Later migration did not use its own guidance';
  END IF;
END
$$;

\ir ../db/flyway/beforeEachMigrate__clear_diagram_helpers.sql
\ir ../db/flyway/beforeEachMigrate__clear_diagram_helpers.sql

DO $$
BEGIN
  IF to_regprocedure('pg_temp.diagram_semantics_guidance()') IS NOT NULL
    OR to_regprocedure('pg_temp.diagram_writing_standards(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration helpers survived cleanup';
  END IF;
END
$$;
