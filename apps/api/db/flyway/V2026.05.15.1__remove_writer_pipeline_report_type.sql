-- Drop WRITER_PIPELINE from the ReportType enum.
-- The writer pipeline report payload was removed from the OpenAPI contract; the
-- generated client and service layer no longer reference it. Postgres does not
-- support DROP VALUE, so we recreate the type.

DO $$
DECLARE
  affected INTEGER;
BEGIN
  SELECT COUNT(*) INTO affected
  FROM "reports"
  WHERE "report_type" = 'WRITER_PIPELINE';

  IF affected > 0 THEN
    RAISE EXCEPTION
      'Cannot drop ReportType value: % report(s) still use WRITER_PIPELINE. Migrate or delete them before re-running this migration.',
      affected;
  END IF;
END
$$;

CREATE TYPE "ReportType_new" AS ENUM (
  'CODING_RESEARCH',
  'EVIDENCE_PIPELINE',
  'SNAPSHOT',
  'ROLLUP_PROPOSAL',
  'DAILY_SESSION',
  'GOAL_PROGRESS',
  'RISK_ALERT',
  'SESSION_SUMMARY',
  'COMMIT',
  'PLAN',
  'IMPLEMENT',
  'FEATURE_SYNC',
  'FEATURE_SYNC_HANDOFF'
);

ALTER TABLE "reports"
  ALTER COLUMN "report_type" TYPE "ReportType_new"
  USING "report_type"::text::"ReportType_new";

DROP TYPE "ReportType";

ALTER TYPE "ReportType_new" RENAME TO "ReportType";
