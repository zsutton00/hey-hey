import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportAudience, ReportType, type ProjectReportPayload, type ReportDto } from "@hey-hey/ui-common/api";

const mocks = vi.hoisted(() => ({ project: vi.fn(), report: vi.fn() }));
vi.mock("@hey-hey/ui-common/context", async (importOriginal) => ({
  ...await importOriginal<typeof import("@hey-hey/ui-common/context")>(),
  useOrganization: () => ({ currentOrganization: { id: "org" } }),
}));
vi.mock("@hey-hey/ui-common/hooks", () => ({ useUserIdentity: () => ({ userId: "user" }) }));
vi.mock("@hey-hey/ui-common/data", () => ({ useProject: mocks.project, useReport: mocks.report }));
vi.mock("../../hooks/useProjectNotificationActivity", () => ({ useProjectNotificationActivity: () => ({ alertItems: [], dismissNotification: vi.fn(), pagination: {} }) }));
vi.mock("../../components/Notifications", () => ({ NotificationAlertList: () => null }));
vi.mock("../../components/Layout", () => ({
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DetailPageHeader: ({ title, subtitle }: { title: string; subtitle?: string }) => <><h1>{title}</h1>{subtitle ? <p>{subtitle}</p> : null}</>,
  PageBreadcrumbs: () => null,
}));
import { ProjectReportPage } from "./ProjectReportPage";

const payload: ProjectReportPayload = {
  reportType: "PROJECT_REPORT",
  title: "September delivery review",
  summary: "The historical project state.",
  question: "What shipped that week?",
  scope: { projectId: "project", windowStart: "2026-09-01T00:00:00.000Z", windowEnd: "2026-09-08T00:00:00.000Z", timeZone: "UTC" },
  exclusions: [],
  provenance: { requestId: "historical-request", attemptId: "historical-attempt", evidenceReadStartedAt: "2026-09-08T09:00:00.000Z", evidenceReadCompletedAt: "2026-09-08T09:05:00.000Z", evidence: [] },
  coverage: { status: "COMPLETE", matchingActivityCount: 3, processedActivityCount: 3, pagesRead: 1, limitations: [] },
  body: { html: "<p>Historical delivery</p>", css: "" },
};
const historicalReport: ReportDto = {
  id: "historical-report", organizationId: "org", projectId: "project",
  reportType: ReportType.ProjectReport, audience: ReportAudience.WorkflowOnly,
  title: "Project Report", payload, version: 1, schemaVersion: 1,
  createdAt: "2026-09-08T09:05:00.000Z", expiresAt: "2026-10-08T00:00:00.000Z", entities: [],
};
const Location = () => <div data-testid="location">{useLocation().pathname}</div>;
const mount = () => render(<MemoryRouter initialEntries={["/projects/project/reports/historical-report"]}><Routes><Route path="/projects/:projectId/reports/:reportId" element={<ProjectReportPage />} /></Routes><Location /></MemoryRouter>);
const viewerId = "report-viewer-historical-report";
beforeEach(() => {
  mocks.project.mockReturnValue({ data: { id: "project", organizationId: "org" }, isFetched: true });
  mocks.report.mockReturnValue({ data: historicalReport });
});
describe("project report route with the canonical typed viewer", () => {
  it("passes producer citation keys and typed evidence through the real shared viewer", () => {
    mocks.report.mockReturnValue({ data: { ...historicalReport, payload: {
      ...payload,
      provenance: { ...payload.provenance, evidence: [{
        key: "selected-period-1", subject: { entityType: "TASK", entityId: "delivery-task" },
        title: "Deliver invoices", kind: "SELECTED_PERIOD",
      }] },
      body: { html: '<span data-evidence-key="selected-period-1">Delivered</span><span data-evidence-key="unknown">Missing</span>', css: "" },
    } } });
    mount();
    const evidence = screen.getByTestId(`${viewerId}-project-report-evidence-item`);
    expect(evidence).toHaveTextContent("Deliver invoices");
    expect(evidence).toHaveAttribute("data-evidence-key", "selected-period-1");
    expect(evidence).toHaveAttribute("data-cited", "true");
    const frame = screen.getByTestId(`${viewerId}-project-report-body-frame`);
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame.getAttribute("srcdoc")).toContain('data-evidence-key="selected-period-1"');
    expect(screen.getByTestId(`${viewerId}-project-report-evidence-unresolved`)).toHaveTextContent("unknown");
  });
  it("renders the historical title, covered period, creation date, and persisted identity", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(payload.title);
    expect(screen.getAllByText(payload.title)).toHaveLength(1);
    const period = screen.getByTestId(`${viewerId}-project-report-scope-period`);
    for (const date of [payload.scope.windowStart, payload.scope.windowEnd]) {
      expect(period).toHaveTextContent(new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }));
    }
    expect(period).toHaveTextContent("UTC");
    expect(screen.getByText(`Created ${new Date(historicalReport.createdAt).toLocaleString()}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`${viewerId}-project-report-provenance`)).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/projects/project/reports/historical-report");
    expect(mocks.report).toHaveBeenCalledWith("org", historicalReport.id, { enabled: true });
    expect(mocks.project).toHaveBeenCalledWith("org", "project", { enabled: true });
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveTextContent(historicalReport.id);
  });
  it.each([
    { name: "report project", report: { ...historicalReport, projectId: "other" } },
    { name: "report organization", report: { ...historicalReport, organizationId: "other" } },
    { name: "typed payload project", report: { ...historicalReport, payload: { ...payload, scope: { ...payload.scope, projectId: "other" } } } },
  ])("refuses a mismatched $name before rendering the viewer", ({ report }) => {
    mocks.report.mockReturnValue({ data: report });
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent("This report is unavailable in the current project.");
    expect(screen.queryByTestId(viewerId)).not.toBeInTheDocument();
    expect(screen.queryByText(payload.title)).not.toBeInTheDocument();
  });
  it("refuses a project outside the authorized organization", () => {
    mocks.project.mockReturnValue({ data: { id: "project", organizationId: "other" }, isFetched: true });
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent("This project is unavailable in the current organization.");
    expect(screen.queryByTestId(viewerId)).not.toBeInTheDocument();
  });
});
