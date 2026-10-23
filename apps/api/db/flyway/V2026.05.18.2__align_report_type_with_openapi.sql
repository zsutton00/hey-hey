-- Align ReportType enum with the OpenAPI spec.
-- COMPETITIVE_ANALYSIS, FEATURE_TREE_ANALYSIS, PHASE_BREAKDOWN, and
-- VALIDATION_WALKTHROUGH were added to reports.yaml and the generated
-- TypeScript clients (and exposed via create_report) but never to the database
-- enum, causing PrismaClientValidationError on report.create() for any of
-- these types. ALTER TYPE ... ADD VALUE is online and append-only, so this is
-- safe to run without rewriting the reports table.
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'VALIDATION_WALKTHROUGH';
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'FEATURE_TREE_ANALYSIS';
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'COMPETITIVE_ANALYSIS';
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'PHASE_BREAKDOWN';
