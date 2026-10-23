-- Diagram guidance migrations reuse these helpers within their own file.
-- PostgreSQL retains pg_temp functions across transactions in one Flyway
-- session, so clear the previous migration's helpers before the next file.
DO $callback$
BEGIN
  IF pg_my_temp_schema() <> 0 THEN
    DROP FUNCTION IF EXISTS pg_temp.diagram_writing_standards(text);
    DROP FUNCTION IF EXISTS pg_temp.diagram_semantics_guidance();
  END IF;
END
$callback$;
