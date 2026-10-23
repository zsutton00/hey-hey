import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReportType,
  type ReportDto,
  type ProjectReportPayload,
} from "../../../api";
const query = vi.hoisted(() => vi.fn());
vi.mock("../../../data/hooks/useProjectReports", () => ({
  useProjectReports: query,
}));
import { ProjectReportsOverview } from "../ProjectReportsOverview";

interface ReportOptions {
  createdAt?: string;
  windowStart?: string;
  windowEnd?: string;
  timeZone?: string;
  summary?: string;
}

const makeReport = (id: string, options: ReportOptions = {}): ReportDto => ({
  id,
  organizationId: "org",
  projectId: "project",
  title: id === "latest" ? "Latest week" : "Previous week",
  reportType: ReportType.ProjectReport,
  audience: "WORKFLOW_ONLY",
  version: 1,
  schemaVersion: 1,
  createdAt: options.createdAt ?? "2026-10-01T12:00:00Z",
  expiresAt: "2027-01-01T00:00:00Z",
  entities: [],
  payload: {
    reportType: ReportType.ProjectReport,
    title: id === "latest" ? "Latest week" : "Previous week",
    summary: options.summary ?? "Summary",
    question: "What changed?",
    scope: {
      projectId: "project",
      windowStart: options.windowStart ?? "2026-09-24T00:00:00Z",
      windowEnd: options.windowEnd ?? "2026-10-01T00:00:00Z",
      timeZone: options.timeZone ?? "UTC",
    },
    exclusions: [],
    provenance: {
      requestId: "request",
      attemptId: "attempt",
      evidence: [],
      evidenceReadStartedAt: "2026-10-01T00:00:00Z",
      evidenceReadCompletedAt: "2026-10-01T00:00:00Z",
    },
    coverage: {
      status: "COMPLETE",
      processedActivityCount: 1,
      matchingActivityCount: 1,
      pagesRead: 1,
      limitations: [],
    },
    body: { html: "<p>Report</p>", css: "" },
  } satisfies ProjectReportPayload,
});
const Location = () => (
  <span data-testid="location">{useLocation().pathname}</span>
);
const mount = () =>
  render(
    <MemoryRouter>
      <ProjectReportsOverview organizationId="org" projectId="project" />
      <Location />
    </MemoryRouter>
  );
const ready = (reports: ReportDto[]) => ({
  reports,
  isFetched: true,
  isLoading: false,
  error: null,
});
beforeEach(() => {
  query.mockReset();
});
describe("ProjectReportsOverview", () => {
  it("uses the shared Card header for creation and places history after the latest report", () => {
    query.mockReturnValue(ready([makeReport("latest")]));
    mount();
    const card = screen.getByRole("region", { name: "Project reports" });
    expect(card).toHaveAttribute("data-testid", "project-reports-overview");
    const header = within(card).getByRole("heading", {
      name: "Project reports",
      level: 2,
    }).parentElement?.parentElement;
    expect(header).toBeDefined();
    expect(header).toContainElement(
      screen.getByTestId("project-report-create-route")
    );
    expect(header).not.toContainElement(
      screen.getByTestId("project-report-history")
    );
    expect(
      screen
        .getByTestId("project-report-latest")
        .compareDocumentPosition(screen.getByTestId("project-report-history")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId("project-report-create-route"));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project/reports/new"
    );
  });
  it("pages history independently and opens an older identity without replacing latest", () => {
    query.mockImplementation((_org, _project, options) =>
      ready(
        options.limit === 1
          ? [makeReport("latest")]
          : options.offset === 0
          ? Array.from({ length: 9 }, (_, i) => makeReport(`old-${i}`))
          : [makeReport("older")]
      )
    );
    mount();
    const latestRow = screen.getByTestId("project-report-latest");
    expect(latestRow).toHaveTextContent("Latest week");
    expect(latestRow).toHaveTextContent("Summary");
    expect(latestRow).toHaveTextContent(
      "9/24/2026 – 10/1/2026 · Created 10/1/2026"
    );
    fireEvent.click(screen.getByTestId("project-report-history"));
    const historyEntries = screen.getAllByTestId(
      "project-report-history-entry"
    );
    expect(historyEntries).toHaveLength(8);
    expect(historyEntries[0]).toHaveTextContent(
      "9/24/2026 – 10/1/2026 · Created 10/1/2026"
    );
    expect(historyEntries[0]).not.toHaveTextContent("Summary");
    fireEvent.click(screen.getByRole("button", { name: "Older" }));
    expect(query).toHaveBeenCalledWith(
      "org",
      "project",
      expect.objectContaining({
        types: [ReportType.ProjectReport],
        sortBy: "createdAt",
        sortOrder: "DESC",
        limit: 9,
        offset: 8,
      })
    );
    fireEvent.click(screen.getByTestId("project-report-history-entry"));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project/reports/older"
    );
    expect(screen.getByTestId("project-report-latest")).toHaveAttribute(
      "data-report-id",
      "latest"
    );
  });
  it("keeps start and end times for a report period of exactly 24 hours", () => {
    query.mockReturnValue(
      ready([
        makeReport("latest", {
          createdAt: "2026-10-02T01:00:00Z",
          windowStart: "2026-10-01T00:00:00Z",
          windowEnd: "2026-10-02T00:00:00Z",
        }),
      ])
    );
    mount();
    expect(screen.getByTestId("project-report-latest")).toHaveTextContent(
      "10/1/2026, 12:00:00 AM – 10/2/2026, 12:00:00 AM · Created 10/2/2026"
    );
  });
  it("formats the report period and creation date in the report timezone", () => {
    query.mockReturnValue(
      ready([
        makeReport("latest", {
          createdAt: "2026-10-01T00:30:00Z",
          windowStart: "2026-10-01T00:30:00Z",
          windowEnd: "2026-10-04T00:30:00Z",
          timeZone: "America/Los_Angeles",
        }),
      ])
    );
    mount();
    expect(screen.getByTestId("project-report-latest")).toHaveTextContent(
      "9/30/2026 – 10/3/2026 · Created 9/30/2026"
    );
  });
  it("offers creation in the empty state", () => {
    query.mockReturnValue(ready([]));
    mount();
    expect(screen.getByText("No project reports yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("project-report-create-route"));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project/reports/new"
    );
  });
  it("rejects metadata from another project without displaying its title", () => {
    query.mockReturnValue(
      ready([{ ...makeReport("latest"), projectId: "other" }])
    );
    mount();
    expect(
      screen.getByText("The latest report metadata is unavailable.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Latest week")).not.toBeInTheDocument();
  });
  it("rejects report metadata with a blank required summary", () => {
    query.mockReturnValue(ready([makeReport("latest", { summary: "  " })]));
    mount();
    expect(
      screen.getByText("The latest report metadata is unavailable.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Latest week")).not.toBeInTheDocument();
  });
  it("shows loading and failure without report data", () => {
    query.mockReturnValue({ ...ready([]), isFetched: false, isLoading: true });
    const view = mount();
    expect(
      screen.getByLabelText("Loading project reports")
    ).toBeInTheDocument();
    query.mockReturnValue({
      ...ready([]),
      error: new Error("down"),
      refetch: vi.fn(),
    });
    view.rerender(
      <MemoryRouter>
        <ProjectReportsOverview organizationId="org" projectId="project" />
      </MemoryRouter>
    );
    expect(
      screen.getByText("Could not load project reports.")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("project-report-latest")
    ).not.toBeInTheDocument();
  });
});
