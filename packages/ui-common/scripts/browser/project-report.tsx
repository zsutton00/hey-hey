import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ProjectReport } from "../../src/components/Reports/viewer/ProjectReport";
import type { ProjectReportPayload, ReportDto } from "../../src/api";

const payload: ProjectReportPayload = {
  reportType: "PROJECT_REPORT", title: "Browser citation verification",
  question: "What changed?", summary: "Evidence-backed browser fixture",
  scope: { projectId: "browser-project", windowStart: "2026-09-24T00:00:00Z", windowEnd: "2026-10-01T00:00:00Z", timeZone: "UTC" },
  exclusions: [],
  coverage: { status: "COMPLETE", matchingActivityCount: 1, processedActivityCount: 1, pagesRead: 1, limitations: [] },
  provenance: {
    requestId: "browser-request", attemptId: "browser-attempt",
    evidenceReadStartedAt: "2026-10-01T00:00:00Z", evidenceReadCompletedAt: "2026-10-01T00:01:00Z",
    evidence: [{ key: "E1", subject: { entityType: "TASK", entityId: "browser-task" }, title: "Matching evidence", kind: "SELECTED_PERIOD" }],
  },
  body: {
    html: `<main>
      <a id="resolved" href="https://blocked.invalid/citation" target="_top" data-evidence-key="E1"><span>Resolved citation</span></a>
      <button id="unresolved" data-evidence-key="E9">Unknown citation</button>
      <a id="navigation" href="https://blocked.invalid/navigation" target="_top">External navigation</a>
      <form action="https://blocked.invalid/form" target="_top"><button id="submit">Submit</button></form>
      <img src="https://blocked.invalid/image" onerror="parent.postMessage('authored-script-ran', '*')">
      <script>parent.postMessage('authored-script-ran', '*'); fetch('https://blocked.invalid/fetch'); top.location='https://blocked.invalid/script-navigation';</script>
      <script src="https://blocked.invalid/script"></script>
    </main>`,
    css: `@import url('https://blocked.invalid/style'); main { background-image: url('https://blocked.invalid/background'); }`,
  },
};
payload.body.html = payload.body.html.replaceAll("https://blocked.invalid", `${location.origin}/forbidden`);
payload.body.css = payload.body.css.replaceAll("https://blocked.invalid", `${location.origin}/forbidden`);
const report: ReportDto = {
  id: "browser-report", title: payload.title, organizationId: "browser-organization", audience: "WORKFLOW_ONLY",
  version: 1, schemaVersion: 1, sourceExecutionId: "browser-execution",
  createdAt: "2026-10-01T00:01:00Z", expiresAt: "2026-11-01T00:01:00Z",
  entities: [], reportType: "PROJECT_REPORT", payload,
};
createRoot(document.getElementById("root")!).render(
  <MemoryRouter><ProjectReport payload={payload} report={report} reportTestId="browser" /></MemoryRouter>
);
