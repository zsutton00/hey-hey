-- REVIEW is part of the OpenAPI ReportType contract. Keep PostgreSQL and the
-- persisted system work-item definitions aligned with the generated clients.
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'REVIEW';

UPDATE "work_item_type"
SET
  "anchorable_report_types" = "anchorable_report_types" || '["REVIEW"]'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "is_system" = true
  AND NOT "anchorable_report_types" @> '["REVIEW"]'::jsonb;
