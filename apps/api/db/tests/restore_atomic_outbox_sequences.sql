-- Run with psql -X -v ON_ERROR_STOP=1 -f this-file against a disposable database.
-- Fixtures and migration changes are rolled back together.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA outbox_sequence_migration_test;
SET LOCAL search_path TO outbox_sequence_migration_test;
CREATE TABLE outbox_events (
  aggregate_id text NOT NULL,
  aggregate_type text NOT NULL,
  event_type text NOT NULL,
  sequence_number bigint NOT NULL DEFAULT 0,
  UNIQUE (aggregate_id, aggregate_type, event_type, sequence_number)
);
CREATE TABLE outbox_agg_seq (
  aggregate_id uuid NOT NULL,
  aggregate_type text NOT NULL,
  event_type text NOT NULL,
  last_seq bigint NOT NULL,
  PRIMARY KEY (aggregate_id, aggregate_type, event_type)
);
-- Missing, behind, ahead, and counter-only histories.
INSERT INTO outbox_events VALUES
 ('00000000-0000-4000-8000-000000000001','Conversation','updated',0),
 ('00000000-0000-4000-8000-000000000002','Conversation','updated',7),
 ('00000000-0000-4000-8000-000000000003','Conversation','updated',3);
INSERT INTO outbox_agg_seq VALUES
 ('00000000-0000-4000-8000-000000000002','Conversation','updated',2),
 ('00000000-0000-4000-8000-000000000003','Conversation','updated',20),
 ('00000000-0000-4000-8000-000000000004','Conversation','updated',30);
\ir ../flyway/V2026.09.28.183925__restore_atomic_outbox_sequences.sql
CREATE TEMP TABLE original_objects AS
SELECT oid, prosrc FROM pg_proc
WHERE pronamespace = 'outbox_sequence_migration_test'::regnamespace;
CREATE TEMP TABLE original_trigger AS
SELECT oid FROM pg_trigger WHERE tgrelid = 'outbox_events'::regclass AND NOT tgisinternal;
-- Already-installed Prisma-equivalent objects: a second application must preserve them.
\ir ../flyway/V2026.09.28.183925__restore_atomic_outbox_sequences.sql
DO $test$
DECLARE actual bigint; expected bigint; n integer;
BEGIN
  IF (SELECT count(*) FROM original_objects o JOIN pg_proc p USING (oid)
      WHERE o.prosrc = p.prosrc) <> 2 THEN
    RAISE EXCEPTION 'Existing functions were replaced';
  END IF;
  IF (SELECT count(*) FROM original_trigger o JOIN pg_trigger t USING (oid)) <> 1 THEN
    RAISE EXCEPTION 'Existing trigger was replaced';
  END IF;
  FOR n IN 1..5 LOOP
    expected := (ARRAY[1,8,21,31,1])[n];
    INSERT INTO outbox_events (aggregate_id,aggregate_type,event_type)
    VALUES ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'),'Conversation','updated')
    RETURNING sequence_number INTO actual;
    IF actual <> expected THEN RAISE EXCEPTION 'Expected %, got %', expected, actual; END IF;
  END LOOP;
  -- Two inserts for the same key in one transaction must not collide.
  INSERT INTO outbox_events (aggregate_id,aggregate_type,event_type)
  VALUES ('00000000-0000-4000-8000-000000000001','Conversation','updated')
  RETURNING sequence_number INTO actual;
  IF actual <> 2 THEN RAISE EXCEPTION 'Repeated event did not advance'; END IF;
  INSERT INTO outbox_events (aggregate_id,aggregate_type,event_type)
  VALUES ('00000000-0000-4000-8000-000000000001','Conversation','created')
  RETURNING sequence_number INTO actual;
  IF actual <> 1 THEN RAISE EXCEPTION 'Event types must have independent sequences'; END IF;
  IF (SELECT count(*) FROM outbox_events WHERE sequence_number IN (0,7,3)) <> 3 THEN
    RAISE EXCEPTION 'Historical event numbers changed';
  END IF;
END;
$test$;
ROLLBACK;
\echo 'Outbox sequence migration regression checks passed'
