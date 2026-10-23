DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'EntityType'
      AND e.enumlabel = 'REPORT'
  ) THEN
    ALTER TYPE "EntityType" ADD VALUE 'REPORT';
  END IF;
END
$$;
