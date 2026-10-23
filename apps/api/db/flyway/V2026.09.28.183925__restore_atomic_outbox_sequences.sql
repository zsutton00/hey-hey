-- Restore the functions/trigger from Prisma 20251003011524_atomic_outbox_sequences,
-- which were omitted from the Flyway baseline. Flyway runs this transactionally.
-- Serialize counter reconciliation with event inserts; never renumber old events.
LOCK TABLE outbox_events, outbox_agg_seq IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO outbox_agg_seq (aggregate_id, aggregate_type, event_type, last_seq)
SELECT aggregate_id::uuid, aggregate_type, event_type, MAX(sequence_number)
FROM outbox_events
GROUP BY aggregate_id::uuid, aggregate_type, event_type
ON CONFLICT (aggregate_id, aggregate_type, event_type)
DO UPDATE SET last_seq = EXCLUDED.last_seq
WHERE outbox_agg_seq.last_seq < EXCLUDED.last_seq;

-- Preserve functions already installed by Prisma, including their ownership,
-- grants and implementation. Only fill gaps on baseline-created databases.
DO $migration$
BEGIN
  IF to_regprocedure('next_outbox_seq(uuid,text,text)') IS NULL THEN
    EXECUTE $ddl$
      CREATE FUNCTION next_outbox_seq(p_agg_id uuid, p_agg_type text, p_evt_type text)
      RETURNS bigint LANGUAGE plpgsql AS $function$
      DECLARE v_next bigint;
      BEGIN
        INSERT INTO outbox_agg_seq (aggregate_id, aggregate_type, event_type, last_seq)
        VALUES (p_agg_id, p_agg_type, p_evt_type, 1)
        ON CONFLICT (aggregate_id, aggregate_type, event_type)
        DO UPDATE SET last_seq = outbox_agg_seq.last_seq + 1
        RETURNING last_seq INTO v_next;
        RETURN v_next;
      END;
      $function$;
    $ddl$;
  END IF;

  IF to_regprocedure('set_outbox_sequence()') IS NULL THEN
    EXECUTE $ddl$
      CREATE FUNCTION set_outbox_sequence()
      RETURNS trigger LANGUAGE plpgsql AS $function$
      BEGIN
        NEW.sequence_number := next_outbox_seq(
          NEW.aggregate_id::uuid, NEW.aggregate_type, NEW.event_type
        );
        RETURN NEW;
      END;
      $function$;
    $ddl$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'outbox_events'::regclass
      AND tgname = 'outbox_sequence_trigger'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER outbox_sequence_trigger
      BEFORE INSERT ON outbox_events
      FOR EACH ROW EXECUTE FUNCTION set_outbox_sequence();
  END IF;
END;
$migration$;
