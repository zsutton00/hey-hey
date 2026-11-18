-- MONITOR_NODE_RESULT is the kind-neutral verdict a monitor node's session
-- records on itself (accept, or fail with a reason). Keep the database enum
-- aligned with the generated OpenAPI report types so report.create() can
-- persist it through Prisma.
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'MONITOR_NODE_RESULT';
