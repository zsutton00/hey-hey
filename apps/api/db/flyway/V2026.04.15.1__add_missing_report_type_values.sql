-- Align ReportType enum with the OpenAPI spec.
-- These values were present in the API contract and generated clients but
-- missing from the database enum, causing PrismaClientValidationError on
-- report.create() for DAILY_SESSION and related report types.
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'RECONCILIATION';
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'DAILY_SESSION';
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'GOAL_PROGRESS';
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'RISK_ALERT';
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'SESSION_SUMMARY';
