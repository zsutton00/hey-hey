-- Add PLAN_DOCUMENT template for plan document design docs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'DesignDocTemplate'
      AND e.enumlabel = 'PLAN_DOCUMENT'
  ) THEN
    ALTER TYPE "DesignDocTemplate" ADD VALUE 'PLAN_DOCUMENT';
  END IF;
END $$;
