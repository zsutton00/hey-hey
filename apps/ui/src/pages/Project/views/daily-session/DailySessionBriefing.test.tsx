import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProjectConfigVersionEnum,
  ProjectExistingWorkIntent,
  ProjectStatus,
  ReportType,
  type ReportDto,
} from "@hey-hey/ui-common/api";
import { DailySessionBriefing } from "./DailySessionBriefing";
import type { UseDailySessionBriefingReportsReturn } from "./useDailySessionBriefingReports";

const mocks = vi.hoisted(() => ({
  useDailySessionBriefingReports: vi.fn(),
  useProject: vi.fn(),
  introHelpView: vi.fn(),
}));

vi.mock("../../help/ProjectHelpProvider", () => ({
  ProjectHelpProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("./useDailySessionBriefingReports", () => ({
  useDailySessionBriefingReports: mocks.useDailySessionBriefingReports,
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useProject: mocks.useProject,
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  IntroHelpView: (props: { variant?: "generic" | "existing-work" }) => {
    mocks.introHelpView(props);
    return (
      <div data-testid="intro-help-view" data-variant={props.variant}>
        <a href="https://nodejs.org/">
          <span>Open Node.js installer</span>
        </a>
        <button disabled>Download Agent Bridge</button>
      </div>
    );
  },
  LoadingPanel: ({ label }: { label: string }) => (
    <div data-testid="loading-panel">{label}</div>
  ),
  ReportCard: ({ report }: { report: ReportDto }) => (
    <div data-testid={`report-card-${report.id}`}>{report.title}</div>
  ),
}));

const buildReport = (overrides: Partial<ReportDto>): ReportDto => ({
  id: "report-1",
  organizationId: "org-1",
  projectId: "project-1",
  reportType: ReportType.DailySession,
  audience: "PROJECT_VISIBLE",
  title: "Daily Session",
  payload: {
    reportType: ReportType.DailySession,
    summary: "Daily session parent",
  },
  version: 1,
  schemaVersion: 1,
  sourceExecutionId: "exec-1",
  parentReportId: null,
  createdAt: "2026-07-08T08:00:00.000Z",
  expiresAt: "2026-07-15T08:00:00.000Z",
  entities: [],
  ...overrides,
});

const setBriefingState = (
  overrides: Partial<UseDailySessionBriefingReportsReturn> = {},
): UseDailySessionBriefingReportsReturn => {
  const parent = buildReport({
    id: "parent-new",
    createdAt: "2026-07-08T08:00:00.000Z",
  });
  const child = buildReport({
    id: "child-goal",
    reportType: ReportType.GoalProgress,
    title: "Goal progress",
    payload: {
      reportType: ReportType.GoalProgress,
      summary: "Summary",
      text: "Progress text",
    },
    parentReportId: "parent-new",
  });
  const state: UseDailySessionBriefingReportsReturn = {
    availableBriefings: [
      { reportId: "parent-new", createdAt: "2026-07-08T08:00:00.000Z" },
      { reportId: "parent-old", createdAt: "2026-07-07T08:00:00.000Z" },
    ],
    error: null,
    isFetching: false,
    isLoading: false,
    isSelectionExplicit: false,
    refresh: vi.fn(),
    reports: [child],
    selectedParentReport: parent,
    selectedParentReportId: "parent-new",
    selectParentReport: vi.fn(),
    ...overrides,
  };

  mocks.useDailySessionBriefingReports.mockReturnValue(state);
  return state;
};

const renderBriefing = (): ReturnType<typeof render> =>
  render(<DailySessionBriefing organizationId="org-1" projectId="project-1" />);

describe("DailySessionBriefing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useProject.mockReturnValue({
      data: { id: "project-1", status: ProjectStatus.Active },
      isFetched: true,
    });
  });

  it("renders the selected parent's child reports", () => {
    setBriefingState();

    renderBriefing();

    expect(screen.getByTestId("daily-session-briefing")).toBeInTheDocument();
    expect(screen.getByTestId("report-card-child-goal")).toHaveTextContent(
      "Goal progress",
    );
  });

  it("uses the date selector to change the selected parent report", () => {
    const state = setBriefingState();

    renderBriefing();

    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(
      within(screen.getByRole("listbox")).getByText(/Jul 7|Yesterday/),
    );

    expect(state.selectParentReport).toHaveBeenCalledWith("parent-old");
  });

  it("renders the getting-started intro for an active project without a parent briefing", () => {
    setBriefingState({
      availableBriefings: [],
      reports: [],
      selectedParentReport: null,
      selectedParentReportId: null,
    });

    renderBriefing();

    expect(screen.getByTestId("intro-help-view")).toBeInTheDocument();
    expect(screen.getByTestId("intro-help-view")).toHaveAttribute(
      "data-variant",
      "generic",
    );
    expect(
      screen.queryByRole("button", { name: "Download Agent Bridge" }),
    ).not.toBeInTheDocument();
  });

  it("uses persisted selected intent for the daily-session intro after navigation", () => {
    mocks.useProject.mockReturnValue({
      data: {
        id: "project-1",
        status: ProjectStatus.Active,
        config: {
          version: ProjectConfigVersionEnum.NUMBER_1,
          existingWorkIntent: ProjectExistingWorkIntent.Selected,
        },
      },
      isFetched: true,
    });
    setBriefingState({
      availableBriefings: [],
      reports: [],
      selectedParentReport: null,
      selectedParentReportId: null,
    });

    renderBriefing();

    expect(mocks.introHelpView).toHaveBeenCalledWith({
      variant: "existing-work",
    });
  });

  it("opens the intro's Node.js installer in a new tab", () => {
    setBriefingState({
      availableBriefings: [],
      reports: [],
      selectedParentReport: null,
      selectedParentReportId: null,
    });

    renderBriefing();

    const link = screen.getByRole("link", {
      name: "Open Node.js installer",
    });
    fireEvent.click(screen.getByText("Open Node.js installer"));

    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders the warming state for a non-active project without a parent briefing", () => {
    mocks.useProject.mockReturnValue({
      data: { id: "project-1", status: ProjectStatus.Onboarding },
      isFetched: true,
    });
    setBriefingState({
      availableBriefings: [],
      reports: [],
      selectedParentReport: null,
      selectedParentReportId: null,
    });

    renderBriefing();

    expect(screen.getByTestId("daily-session-warming")).toHaveTextContent(
      "Daily session is warming up — check back shortly.",
    );
  });
});
