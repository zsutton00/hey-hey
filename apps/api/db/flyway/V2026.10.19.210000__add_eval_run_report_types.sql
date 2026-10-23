-- Eval runs, attempts and human reviews are stored as reports. Run-record
-- reports never expire, so a report's expiry becomes optional; NULL means the
-- report lives until the entity it is attached to is deleted.
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'EVAL_RUN';
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'EVAL_ATTEMPT';
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'EVAL_HUMAN_REVIEW';

ALTER TABLE "reports" ALTER COLUMN "expires_at" DROP NOT NULL;

-- An Eval anchors its run records. Only the canonical template changes; a
-- project-owned override of EVAL is never updated here.
UPDATE work_item_type_template
SET anchorable_report_types = (
      SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb)
      FROM jsonb_array_elements_text(
        anchorable_report_types || '["EVAL_RUN","EVAL_ATTEMPT","EVAL_HUMAN_REVIEW"]'::jsonb
      ) AS value
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'EVAL';
