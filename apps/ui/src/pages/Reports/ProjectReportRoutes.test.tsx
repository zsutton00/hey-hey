import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectReportRequestProps } from "@hey-hey/ui-common/components";
import type { ReportDto } from "@hey-hey/ui-common/api";
const mocks = vi.hoisted(() => ({ project: vi.fn(), report: vi.fn(), request: vi.fn(), payload: vi.fn() }));
vi.mock("@hey-hey/ui-common/context", () => ({ useOrganization: () => ({ currentOrganization: { id: "org" } }) }));
vi.mock("@hey-hey/ui-common/hooks", () => ({ useUserIdentity: () => ({ userId: "user" }) }));
vi.mock("@hey-hey/ui-common/data", () => ({ useProject: mocks.project, useReport: mocks.report }));
vi.mock("@hey-hey/ui-common/components", () => ({
  ProjectReportRequest: (props: ProjectReportRequestProps) => { mocks.request(props); return <><button onClick={props.onClose}>Close</button><button onClick={() => props.onOpenReport?.("persisted-report")}>Open completed report</button></>; },
  ReportViewer: ({ report }: { report: ReportDto }) => <div data-testid="typed-viewer">{report.title} {report.createdAt}</div>,
  narrowProjectReportPayload: mocks.payload,
}));
vi.mock("../../hooks/useProjectNotificationActivity", () => ({ useProjectNotificationActivity: () => ({ alertItems: [], dismissNotification: vi.fn(), pagination: {} }) }));
vi.mock("../../components/Notifications", () => ({ NotificationAlertList: () => <div>Related activity</div> }));
vi.mock("../../components/Layout", () => ({
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DetailPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  PageBreadcrumbs: () => null,
}));
import { ProjectReportRequestPage } from "./ProjectReportRequestPage";
import { ProjectReportPage } from "./ProjectReportPage";
const Location = () => <div data-testid="location">{useLocation().pathname}</div>;
const mount = (path: string) => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/projects/:projectId/reports/new" element={<ProjectReportRequestPage />} /><Route path="/projects/:projectId/reports/:reportId" element={<ProjectReportPage />} /><Route path="/projects/:projectId" element={<div>Overview</div>} /></Routes><Location /></MemoryRouter>);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.project.mockReturnValue({ data: { id: "project", organizationId: "org" }, isFetched: true });
  mocks.report.mockReturnValue({ data: { id: "persisted-report", projectId: "project", organizationId: "org", title: "Dated report", reportType: "SNAPSHOT", createdAt: "2026-09-10" } });
  mocks.payload.mockReturnValue({ title: "Typed historical title", scope: { projectId: "project" } });
});
describe("project report routes", () => {
  it("wires current scope, completion identity, and close destination", () => {
    const view = mount("/projects/project/reports/new");
    expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({ organizationId: "org", projectId: "project", currentUserId: "user" }));
    fireEvent.click(screen.getByText("Open completed report"));
    expect(screen.getByTestId("location")).toHaveTextContent("/projects/project/reports/persisted-report");
    view.unmount(); mount("/projects/project/reports/new"); fireEvent.click(screen.getByText("Close"));
    expect(screen.getByTestId("location")).toHaveTextContent("/projects/project");
  });
  it("refuses report data outside the current project", () => {
    mocks.report.mockReturnValue({ data: { projectId: "other", organizationId: "org", title: "Hidden title" } });
    mount("/projects/project/reports/historical");
    expect(screen.getByText("This report is unavailable in the current project.")).toBeInTheDocument();
    expect(screen.queryByTestId("typed-viewer")).not.toBeInTheDocument();
  });
  it("refuses create and detail surfaces when the project is unauthorized", () => {
    mocks.project.mockReturnValue({ error: new Error("forbidden"), isFetched: true });
    const view = mount("/projects/project/reports/new");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(screen.getByText("This project is unavailable in the current organization.")).toBeInTheDocument();
    view.unmount(); mount("/projects/project/reports/historical");
    expect(screen.queryByTestId("typed-viewer")).not.toBeInTheDocument();
  });
  it("uses the canonical viewer and preserves historical title and date for other report types", () => {
    mount("/projects/project/reports/historical");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Dated report");
    expect(screen.getByTestId("typed-viewer")).toHaveTextContent("2026-09-10");
    expect(screen.queryByText("Report historical")).not.toBeInTheDocument();
  });
  it("uses the typed project-report title", () => {
    mocks.report.mockReturnValue({ data: { projectId: "project", organizationId: "org", reportType: "PROJECT_REPORT", title: "Project Report" } });
    mount("/projects/project/reports/historical");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Typed historical title");
  });
});
