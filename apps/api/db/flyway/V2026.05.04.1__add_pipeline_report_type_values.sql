-- Align ReportType enum with the OpenAPI spec.
-- COMMIT, PLAN, IMPLEMENT, FEATURE_SYNC, and FEATURE_SYNC_HANDOFF were added to
-- reports.yaml and the generated TypeScript clients but never to the database
-- enum, causing PrismaClientValidationError on report.create() for any of these
-- types. ALTER TYPE ... ADD VALUE is online and append-only, so this is safe to
-- run without rewriting the reports table.
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'COMMIT';
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'PLAN';
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'IMPLEMENT';
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'FEATURE_SYNC';
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'FEATURE_SYNC_HANDOFF';
