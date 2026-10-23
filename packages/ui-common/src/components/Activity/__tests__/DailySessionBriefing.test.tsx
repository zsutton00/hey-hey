import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProjectStatus,
  ReportAudience,
  ReportType,
  type ProjectResponseDto,
  type ReportDto,
} from "../../../api";
import { useProject } from "../../../data/hooks/useProject";
import { DailySessionBriefing } from "../DailySessionBriefing";
import { useDailySessionBriefing } from "../useDailySessionBriefing";
import { useDailySessionReports } from "../useDailySessionReports";

vi.mock("../../../data/hooks/useProject", () => ({
  useProject: vi.fn(),
}));

vi.mock("../useDailySessionBriefing", () => ({
  useDailySessionBriefing: vi.fn(),
}));

vi.mock("../useDailySessionReports", () => ({
  useDailySessionReports: vi.fn(),
}));

vi.mock("../../Help", () => ({
  IntroHelpView: () => <div data-testid="intro-help-view" />,
}));

vi.mock("../ReportCard", () => ({
  ReportCard: ({ report }: { report: ReportDto }) => {
    const payload = report.payload;
    const text = "text" in payload ? payload.text : report.title;
    return <article data-testid="report-card">{text}</article>;
  },
}));

const mockUseProject = vi.mocked(useProject);
const mockUseDailySessionBriefing = vi.mocked(useDailySessionBriefing);
const mockUseDailySessionReports = vi.mocked(useDailySessionReports);

const activeProject: ProjectResponseDto = {
  id: "project-1",
  name: "Project",
  organizationId: "org-1",
  status: ProjectStatus.Active,
  createdAt: "2026-03-01T09:00:00.000Z",
  updatedAt: "2026-03-01T09:00:00.000Z",
};

const buildParentReport = (id: string, createdAt: string): ReportDto => ({
  id,
  organizationId: "org-1",
  projectId: "project-1",
  reportType: ReportType.DailySession,
  audience: ReportAudience.ProjectVisible,
  title: "Daily Session",
  payload: {
    reportType: "DAILY_SESSION",
    summary: "Daily session parent report grouping child reports.",
  },
  version: 1,
  schemaVersion: 1,
  sourceExecutionId: "run-1",
  parentReportId: null,
  createdAt,
  expiresAt: "2026-03-20T09:00:00.000Z",
  entities: [],
});

const parentReports = [
  buildParentReport("parent-new", "2026-03-03T09:00:00"),
  buildParentReport("parent-old", "2026-03-02T09:00:00"),
];

const buildChildReport = (
  id: string,
  reportType: ReportType.GoalProgress | ReportType.RiskAlert,
  text: string
): ReportDto => ({
  id,
  organizationId: "org-1",
  projectId: "project-1",
  reportType,
  audience: ReportAudience.ProjectVisible,
  title: reportType,
  payload:
    reportType === ReportType.GoalProgress
      ? {
          reportType: "GOAL_PROGRESS",
          summary: "Goal progress summary",
          text,
        }
      : {
          reportType: "RISK_ALERT",
          summary: "Risk alert summary",
          text,
        },
  version: 1,
  schemaVersion: 1,
  sourceExecutionId: "run-1",
  parentReportId: "parent-new",
  createdAt: "2026-03-03T09:00:00.000Z",
  expiresAt: "2026-03-20T09:00:00.000Z",
  entities: [],
});

const childReportsByParent = new Map<string, ReportDto[]>([
  [
    "parent-new",
    [
      buildChildReport(
        "new-goal",
        ReportType.GoalProgress,
        "Newest parent goal progress."
      ),
    ],
  ],
  [
    "parent-old",
    [
      buildChildReport(
        "old-risk",
        ReportType.RiskAlert,
        "Older parent risk alert."
      ),
    ],
  ],
]);

describe("DailySessionBriefing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseProject.mockReturnValue({
      data: activeProject,
      isFetched: true,
      isLoading: false,
      isFetching: false,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
    mockUseDailySessionBriefing.mockImplementation(
      (_organizationId, _projectId, selectedReportId) => {
        const selected =
          parentReports.find((report) => report.id === selectedReportId) ??
          parentReports[0];

        return {
          dailySessionReport: selected,
          reportId: selected.id,
          isLoading: false,
          availableBriefings: parentReports.map((report) => ({
            createdAt: report.createdAt,
            reportId: report.id,
          })),
          error: null,
        };
      }
    );
    mockUseDailySessionReports.mockImplementation(
      (_organizationId, _projectId, parentReportId) => ({
        reports: parentReportId
          ? childReportsByParent.get(parentReportId) ?? []
          : [],
        isLoading: false,
        error: null,
      })
    );
  });

  it("uses parent report ids for the briefing selector and child report query", async () => {
    const user = userEvent.setup();

    render(
      <DailySessionBriefing organizationId="org-1" projectId="project-1" />
    );

    expect(
      screen.getByText("Newest parent goal progress.")
    ).toBeInTheDocument();
    expect(mockUseDailySessionReports).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      "parent-new"
    );

    await user.click(
      screen.getByRole("combobox", { name: "Select briefing date" })
    );
    await user.click(screen.getByRole("option", { name: "Mar 2, 9:00 AM" }));

    await waitFor(() => {
      expect(mockUseDailySessionReports).toHaveBeenLastCalledWith(
        "org-1",
        "project-1",
        "parent-old"
      );
    });
    expect(screen.getByText("Older parent risk alert.")).toBeInTheDocument();
    expect(
      screen.queryByText("Newest parent goal progress.")
    ).not.toBeInTheDocument();
  });

  it("renders the empty active-project state when no parent briefing exists", () => {
    mockUseDailySessionBriefing.mockReturnValue({
      dailySessionReport: null,
      reportId: undefined,
      isLoading: false,
      availableBriefings: [],
      error: null,
    });
    mockUseDailySessionReports.mockReturnValue({
      reports: [],
      isLoading: false,
      error: null,
    });

    render(
      <DailySessionBriefing organizationId="org-1" projectId="project-1" />
    );

    expect(screen.getByTestId("intro-help-view")).toBeInTheDocument();
  });
});
