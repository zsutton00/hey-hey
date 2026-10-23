-- FEATURE_SYNC_DECISION and DECISION_NEEDED were added to the generated
-- TypeScript clients and exposed via create_report but never to the database
-- enum, causing PrismaClientValidationError on report.create(). ALTER TYPE ...
-- ADD VALUE is online and append-only — safe without rewriting the reports table.
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'FEATURE_SYNC_DECISION';
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'DECISION_NEEDED';
