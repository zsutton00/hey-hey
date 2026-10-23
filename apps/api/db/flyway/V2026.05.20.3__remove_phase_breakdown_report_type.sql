-- Drop PHASE_BREAKDOWN from the ReportType enum.
-- The phase-breakdown contract was redefined to be payload-carried: the agent
-- now emits a structured { phaseIdx, plan: { stages, steps } } completion
-- payload instead of authoring a PHASE_BREAKDOWN report. The OpenAPI contract
-- removed the PHASE_BREAKDOWN report type, payload schema, and sub-schemas, so
-- the database enum must drop it to stay in parity. Postgres does not support
-- DROP VALUE, so we recreate the type.

DO $$
DECLARE
  affected INTEGER;
BEGIN
  SELECT COUNT(*) INTO affected
  FROM "reports"
  WHERE "report_type" = 'PHASE_BREAKDOWN';

  IF affected > 0 THEN
    RAISE EXCEPTION
      'Cannot drop ReportType value: % report(s) still use PHASE_BREAKDOWN. Migrate or delete them before re-running this migration.',
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
  'FEATURE_SYNC_HANDOFF',
  'VALIDATION_WALKTHROUGH',
  'FEATURE_TREE_ANALYSIS',
  'COMPETITIVE_ANALYSIS'
);

ALTER TABLE "reports"
  ALTER COLUMN "report_type" TYPE "ReportType_new"
  USING "report_type"::text::"ReportType_new";

DROP TYPE "ReportType";

ALTER TYPE "ReportType_new" RENAME TO "ReportType";
