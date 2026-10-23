-- SESSION_MONITOR_DEFERRAL is present in the generated OpenAPI clients and
-- report schema registry; keep the database enum aligned so report.create()
-- can persist it through Prisma without enum validation failures.
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'SESSION_MONITOR_DEFERRAL';
