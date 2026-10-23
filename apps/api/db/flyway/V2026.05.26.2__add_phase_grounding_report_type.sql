-- Align ReportType enum with the OpenAPI spec.
-- PHASE_GROUNDING was added to reports.yaml and the generated TypeScript
-- clients as the forcing-function pre-flight report a phase emits before it
-- starts executing, but was never added to the database enum, which would
-- cause PrismaClientValidationError on report.create() for this type.
-- ALTER TYPE ... ADD VALUE is online and append-only, so this is safe to run
-- without rewriting the reports table.
ALTER TYPE "ReportType" ADD VALUE IF NOT EXISTS 'PHASE_GROUNDING';
