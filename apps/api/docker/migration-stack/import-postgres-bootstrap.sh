#!/usr/bin/env bash
set -euo pipefail

source_database="${POSTGRES_DB}_bootstrap"

if [[ "$(psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command "SELECT to_regclass('migration_stack.bootstrap_import') IS NOT NULL")" == 't' ]]; then
  echo "Bootstrap data has already been imported into ${POSTGRES_DB}; skipping."
  exit 0
fi

echo "Importing compatible bootstrap data from ${source_database} into ${POSTGRES_DB}."
psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set ON_ERROR_STOP=1 \
  --set source_database="$source_database" \
  --set database_user="$POSTGRES_USER" \
  --set database_password="$POSTGRES_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS postgres_fdw;
DROP SCHEMA IF EXISTS migration_stack_bootstrap CASCADE;
CREATE SCHEMA migration_stack_bootstrap;
DROP SERVER IF EXISTS migration_stack_bootstrap CASCADE;
CREATE SERVER migration_stack_bootstrap
  FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host '127.0.0.1', port '5432', dbname :'source_database');
CREATE USER MAPPING FOR CURRENT_USER
  SERVER migration_stack_bootstrap
  OPTIONS (user :'database_user', password :'database_password');
IMPORT FOREIGN SCHEMA public
  EXCEPT (flyway_schema_history, _prisma_migrations)
  FROM SERVER migration_stack_bootstrap
  INTO migration_stack_bootstrap;

DO $$
DECLARE
  table_record record;
  insert_column_list text;
  select_expression_list text;
  missing_columns text;
  imported_rows bigint;
BEGIN
  SET LOCAL session_replication_role = replica;

  FOR table_record IN
    SELECT target.relname AS table_name
    FROM pg_class target
    JOIN pg_namespace target_namespace ON target_namespace.oid = target.relnamespace
    JOIN pg_class source ON source.relname = target.relname
    JOIN pg_namespace source_namespace ON source_namespace.oid = source.relnamespace
    WHERE target_namespace.nspname = 'public'
      AND source_namespace.nspname = 'migration_stack_bootstrap'
      AND target.relkind IN ('r', 'p')
      AND source.relkind = 'f'
      AND target.relname NOT IN ('flyway_schema_history', '_prisma_migrations')
    ORDER BY target.relname
  LOOP
    SELECT
      string_agg(format('%I', target_column.attname), ', ' ORDER BY target_column.attnum),
      string_agg(
        CASE
          WHEN source_column.attname IS NOT NULL THEN format('%I', target_column.attname)
          WHEN target_column.attname = 'accepted_config_kinds'
            AND table_record.table_name IN ('work_item_type', 'work_item_type_template')
            THEN 'CASE WHEN type_key = ''STANDARD'' THEN ''["INITIAL_WORKTREE"]''::jsonb ELSE ''[]''::jsonb END'
        END,
        ', ' ORDER BY target_column.attnum
      )
    INTO insert_column_list, select_expression_list
    FROM pg_attribute target_column
    JOIN pg_class target_table ON target_table.oid = target_column.attrelid
    JOIN pg_namespace target_namespace ON target_namespace.oid = target_table.relnamespace
    LEFT JOIN (
      SELECT source_column.attname
      FROM pg_attribute source_column
      JOIN pg_class source_table ON source_table.oid = source_column.attrelid
      JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
      WHERE source_namespace.nspname = 'migration_stack_bootstrap'
        AND source_table.relname = table_record.table_name
        AND source_column.attnum > 0
        AND NOT source_column.attisdropped
    ) source_column ON source_column.attname = target_column.attname
    WHERE target_namespace.nspname = 'public'
      AND target_table.relname = table_record.table_name
      AND target_column.attnum > 0
      AND NOT target_column.attisdropped
      AND target_column.attgenerated = ''
      AND (
        source_column.attname IS NOT NULL
        OR (
          target_column.attname = 'accepted_config_kinds'
          AND table_record.table_name IN ('work_item_type', 'work_item_type_template')
        )
      );

    SELECT string_agg(target_column.attname, ', ' ORDER BY target_column.attnum)
    INTO missing_columns
    FROM pg_attribute target_column
    JOIN pg_class target_table ON target_table.oid = target_column.attrelid
    JOIN pg_namespace target_namespace ON target_namespace.oid = target_table.relnamespace
    WHERE target_namespace.nspname = 'public'
      AND target_table.relname = table_record.table_name
      AND target_column.attnum > 0
      AND NOT target_column.attisdropped
      AND target_column.attnotnull
      AND target_column.attgenerated = ''
      AND target_column.attidentity = ''
      AND NOT (
        target_column.attname = 'accepted_config_kinds'
        AND table_record.table_name IN ('work_item_type', 'work_item_type_template')
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_attrdef default_value
        WHERE default_value.adrelid = target_table.oid
          AND default_value.adnum = target_column.attnum
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_attribute source_column
        JOIN pg_class source_table ON source_table.oid = source_column.attrelid
        JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
        WHERE source_namespace.nspname = 'migration_stack_bootstrap'
          AND source_table.relname = table_record.table_name
          AND source_column.attname = target_column.attname
          AND source_column.attnum > 0
          AND NOT source_column.attisdropped
      );

    IF missing_columns IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot import table %: bootstrap lacks required branch columns: %',
        table_record.table_name, missing_columns;
    END IF;

    IF insert_column_list IS NOT NULL THEN
      EXECUTE format(
        'INSERT INTO public.%I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM migration_stack_bootstrap.%I ON CONFLICT DO NOTHING',
        table_record.table_name,
        insert_column_list,
        select_expression_list,
        table_record.table_name
      );
      GET DIAGNOSTICS imported_rows = ROW_COUNT;
      RAISE NOTICE 'Imported % rows into %', imported_rows, table_record.table_name;
    END IF;
  END LOOP;
END
$$;

-- The bootstrap can predate branch migrations that normalize values inside
-- otherwise shape-compatible JSON columns. Reapply those data transformations
-- after import; Flyway ran before the snapshot rows existed.
UPDATE public.work_item_type
SET capabilities = capabilities - 'isHierarchyNode'
WHERE capabilities ? 'isHierarchyNode';

UPDATE public.work_item_type_template
SET capabilities = capabilities - 'isHierarchyNode'
WHERE capabilities ? 'isHierarchyNode';

-- Bootstrap rows are imported with user triggers disabled, so synchronize the
-- database-managed outbox counters to the imported event history before the
-- stack starts accepting writes.
CREATE OR REPLACE FUNCTION public.next_outbox_seq(
  p_agg_id uuid,
  p_agg_type text,
  p_evt_type text
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_next bigint;
BEGIN
  INSERT INTO public.outbox_agg_seq (
    aggregate_id,
    aggregate_type,
    event_type,
    last_seq
  )
  VALUES (p_agg_id, p_agg_type, p_evt_type, 1)
  ON CONFLICT (aggregate_id, aggregate_type, event_type)
  DO UPDATE SET last_seq = public.outbox_agg_seq.last_seq + 1
  RETURNING last_seq INTO v_next;

  RETURN v_next;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_outbox_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.sequence_number := public.next_outbox_seq(
    NEW.aggregate_id::uuid,
    NEW.aggregate_type,
    NEW.event_type
  );
  RETURN NEW;
END;
$$;

INSERT INTO public.outbox_agg_seq (
  aggregate_id,
  aggregate_type,
  event_type,
  last_seq
)
SELECT
  aggregate_id::uuid,
  aggregate_type,
  event_type,
  max(sequence_number)
FROM public.outbox_events
GROUP BY aggregate_id, aggregate_type, event_type
ON CONFLICT (aggregate_id, aggregate_type, event_type)
DO UPDATE SET last_seq = greatest(
  public.outbox_agg_seq.last_seq,
  EXCLUDED.last_seq
);

DROP TRIGGER IF EXISTS outbox_sequence_trigger ON public.outbox_events;

CREATE TRIGGER outbox_sequence_trigger
BEFORE INSERT ON public.outbox_events
FOR EACH ROW
EXECUTE FUNCTION public.set_outbox_sequence();

DROP SCHEMA migration_stack_bootstrap CASCADE;
DROP SERVER migration_stack_bootstrap CASCADE;

CREATE SCHEMA IF NOT EXISTS migration_stack;
CREATE TABLE IF NOT EXISTS migration_stack.bootstrap_import (
  imported_at timestamptz NOT NULL DEFAULT now(),
  source_database text NOT NULL
);
INSERT INTO migration_stack.bootstrap_import (source_database)
VALUES (:'source_database');
SQL

dropdb --username "$POSTGRES_USER" "$source_database"
echo "Bootstrap import complete; removed temporary source database ${source_database}."
