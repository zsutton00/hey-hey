-- Report kind selects the prompt type an attempt launches through. Existing
-- requests are graph-only project reports.
CREATE TYPE "ProjectReportKind" AS ENUM ('PROJECT_REPORT', 'RELEASE_NOTES');

ALTER TABLE project_report_requests
  ADD COLUMN kind "ProjectReportKind" NOT NULL DEFAULT 'PROJECT_REPORT';
