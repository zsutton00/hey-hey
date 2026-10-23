-- Drop FINAL_RECOMMENDATIONS and RECONCILIATION from the ReportType enum.
-- Both values were removed from the OpenAPI contract; the generated client and
-- service layer no longer reference them. Postgres does not support DROP VALUE,
-- so we recreate the type.

DO $$
DECLARE
  affected INTEGER;
BEGIN
  SELECT COUNT(*) INTO affected
  FROM "reports"
  WHERE "report_type" IN ('FINAL_RECOMMENDATIONS', 'RECONCILIATION');

  IF affected > 0 THEN
    RAISE EXCEPTION
      'Cannot drop ReportType values: % report(s) still use FINAL_RECOMMENDATIONS or RECONCILIATION. Migrate or delete them before re-running this migration.',
      affected;
  END IF;
END
$$;

CREATE TYPE "ReportType_new" AS ENUM (
  'CODING_RESEARCH',
  'EVIDENCE_PIPELINE',
  'WRITER_PIPELINE',
  'SNAPSHOT',
  'ROLLUP_PROPOSAL',
  'DAILY_SESSION',
  'GOAL_PROGRESS',
  'RISK_ALERT',
  'SESSION_SUMMARY'
);

ALTER TABLE "reports"
  ALTER COLUMN "report_type" TYPE "ReportType_new"
  USING "report_type"::text::"ReportType_new";

DROP TYPE "ReportType";

ALTER TYPE "ReportType_new" RENAME TO "ReportType";
