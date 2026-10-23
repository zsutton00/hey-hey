import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EntityType,
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportType,
  TaskSource,
  WorkStatus,
  type ReportDto,
  type ReportEntityDto,
  type TaskResponseDto,
} from "../../../api";
import { ReportCard } from "../ReportCard";

const taskHierarchyMock = vi.hoisted(() => vi.fn());
const createTaskMock = vi.hoisted(() => vi.fn());
const useWorkItemsMock = vi.hoisted(() => vi.fn());
const attachToGoalMock = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}));

vi.mock("../../../data/hooks/useTaskHierarchy", () => ({
  useTaskHierarchy: (...args: unknown[]) => taskHierarchyMock(...args),
}));

vi.mock("../../../data/hooks/useWorkItems", () => ({
  useWorkItems: (...args: unknown[]) => useWorkItemsMock(...args),
}));

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    attachToGoal: (...args: unknown[]) => attachToGoalMock(...args),
  },
}));

vi.mock("../../InteractionComponent/InteractionComponent", () => ({
  InteractionComponent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="interaction-component">{children}</div>
  ),
}));

const renderCard = (ui: ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

const buildGoalTask = (
  overrides: Partial<TaskResponseDto> = {},
): TaskResponseDto => ({
  id: "goal-1",
  name: "Ship Q2 onboarding",
  type: "GOAL",
  organizationId: "org-1",
  projectId: "project-1",
  status: WorkStatus.Active,
  source: TaskSource.User,
  dueDate: "2099-08-15T00:00:00.000Z",
  trackedEntities: [
    {
      targetEntityId: "task-a",
      targetEntityType: EntityType.Task,
      title: "Tracked Task A",
      status: WorkStatus.Active,
    },
  ],
  ...overrides,
});

const setGoalTaskResponse = (task: TaskResponseDto | null): void => {
  taskHierarchyMock.mockReturnValue({
    hierarchy: task ? { task, parent: undefined, children: [] } : null,
    parent: undefined,
    task,
    children: [],
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn().mockResolvedValue(null),
    markStale: vi.fn(),
  });
};

const goalProgressReport: ReportDto = {
  id: "report-goal-1",
  organizationId: "org-1",
  reportType: ReportType.GoalProgress,
  title: "Goal Progress",
  payload: {
    reportType: "GOAL_PROGRESS",
    summary: "Progress summary",
    text: "We are on track for the Q2 ship.",
    goalAnchor: {
      entityType: "GOAL",
      entityId: "goal-1",
    },
  },
  version: 1,
  schemaVersion: 1,
  sourceExecutionId: "exec-1",
  createdAt: "2026-03-02T09:00:00.000Z",
  expiresAt: "2026-03-20T09:00:00.000Z",
  entities: [],
};

const goalProgressReportNoAnchor: ReportDto = {
  ...goalProgressReport,
  id: "report-goal-no-anchor",
  payload: {
    reportType: "GOAL_PROGRESS",
    summary: "Progress summary",
    text: "We are on track for the Q2 ship.",
  },
};

const riskAlertReport: ReportDto = {
  id: "report-risk-1",
  organizationId: "org-1",
  reportType: ReportType.RiskAlert,
  title: "Risk Alert",
  payload: {
    reportType: "RISK_ALERT",
    summary: "Risk summary",
    text: "Schedule risk detected on the auth feature.",
  },
  version: 1,
  schemaVersion: 1,
  sourceExecutionId: "exec-2",
  createdAt: "2026-03-02T09:00:00.000Z",
  expiresAt: "2026-03-20T09:00:00.000Z",
  entities: [],
};

const buildReportEntity = (
  overrides: Partial<ReportEntityDto> = {},
): ReportEntityDto => ({
  entityType: ReportRelatedEntityType.Task,
  entityId: "task-ref-1",
  relation: ReportEntityRelation.Context,
  createdAt: "2026-03-02T09:00:00.000Z",
  displayName: "Referenced task",
  ...overrides,
});

const sessionSummaryReport: ReportDto = {
  id: "report-session-1",
  organizationId: "org-1",
  reportType: ReportType.SessionSummary,
  title: "Session Summary",
  payload: {
    reportType: "SESSION_SUMMARY",
    summary: "Session summary",
    text: "We synced on plans.",
  },
  version: 1,
  schemaVersion: 1,
  sourceExecutionId: "exec-3",
  createdAt: "2026-03-02T09:00:00.000Z",
  expiresAt: "2026-03-20T09:00:00.000Z",
  entities: [],
};

describe("ReportCard", () => {
  beforeEach(() => {
    taskHierarchyMock.mockReset();
    createTaskMock.mockReset();
    useWorkItemsMock.mockReset();
    attachToGoalMock.mockReset();
    setGoalTaskResponse(null);
    useWorkItemsMock.mockReturnValue({
      workItems: [],
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      createTask: createTaskMock,
      createInitiative: vi.fn(),
      updateTask: vi.fn(),
      updateInitiative: vi.fn(),
      remove: vi.fn(),
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
  });

  it("renders goal name, due date, and derived status chip when goalAnchor is present", () => {
    setGoalTaskResponse(buildGoalTask());

    renderCard(
      <ReportCard
        report={goalProgressReport}
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    expect(
      screen.getByTestId("report-card-goal-anchor-name"),
    ).toHaveTextContent("Ship Q2 onboarding");
    expect(
      screen.getByTestId("report-card-goal-anchor-due-date"),
    ).toHaveTextContent(/Due/);
    expect(
      screen.getByTestId("report-card-goal-anchor-status"),
    ).toHaveTextContent("On track");
  });

  it("derives an at-risk status from a past due date", () => {
    setGoalTaskResponse(buildGoalTask({ dueDate: "2024-01-01T00:00:00.000Z" }));

    renderCard(
      <ReportCard
        report={goalProgressReport}
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    expect(
      screen.getByTestId("report-card-goal-anchor-status"),
    ).toHaveTextContent("At risk");
  });

  it("falls back to the original layout when goalAnchor is absent", () => {
    renderCard(
      <ReportCard
        report={goalProgressReportNoAnchor}
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    expect(
      screen.queryByTestId("report-card-goal-anchor"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(`report-card-${ReportType.GoalProgress}`),
    ).toBeInTheDocument();
    expect(taskHierarchyMock).not.toHaveBeenCalled();
  });

  it("renders a GOAL entity reference as a link to the goal detail page", () => {
    const reportWithGoalEntity: ReportDto = {
      ...riskAlertReport,
      entities: [
        buildReportEntity({
          entityType: ReportRelatedEntityType.Goal,
          entityId: "goal-link-1",
          displayName: "Linked goal",
        }),
      ],
    };

    renderCard(
      <ReportCard
        report={reportWithGoalEntity}
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    const link = screen.getByRole("link", { name: "Linked goal" });
    expect(link).toHaveAttribute(
      "href",
      "/projects/project-1/tasks/goal-link-1",
    );
  });

  it("renders RISK_ALERT reports unchanged", () => {
    renderCard(
      <ReportCard
        report={riskAlertReport}
        organizationId="org-1"
        projectId="project-1"
      />,
    );

    expect(
      screen.queryByTestId("report-card-goal-anchor"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(`report-card-${ReportType.RiskAlert}`),
    ).toBeInTheDocument();
    expect(taskHierarchyMock).not.toHaveBeenCalled();
  });

  describe("create-goal-from-report affordance", () => {
    it("renders the button on an unanchored GOAL_PROGRESS report", () => {
      renderCard(
        <ReportCard
          report={goalProgressReportNoAnchor}
          organizationId="org-1"
          projectId="project-1"
        />,
      );

      expect(
        screen.getByTestId("report-card-create-goal-button"),
      ).toBeInTheDocument();
    });

    it("hides the button when goalAnchor is present", () => {
      setGoalTaskResponse(buildGoalTask());
      renderCard(
        <ReportCard
          report={goalProgressReport}
          organizationId="org-1"
          projectId="project-1"
        />,
      );

      expect(
        screen.queryByTestId("report-card-create-goal-button"),
      ).not.toBeInTheDocument();
    });

    it("hides the button on RISK_ALERT reports", () => {
      renderCard(
        <ReportCard
          report={riskAlertReport}
          organizationId="org-1"
          projectId="project-1"
        />,
      );

      expect(
        screen.queryByTestId("report-card-create-goal-button"),
      ).not.toBeInTheDocument();
    });

    it("hides the button when embeddedInGoalPage is true even on an unanchored GOAL_PROGRESS report", () => {
      renderCard(
        <ReportCard
          report={goalProgressReportNoAnchor}
          organizationId="org-1"
          projectId="project-1"
          embeddedInGoalPage
        />,
      );

      expect(
        screen.queryByTestId("report-card-create-goal-button"),
      ).not.toBeInTheDocument();
    });

    it("hides the button on SESSION_SUMMARY reports", () => {
      renderCard(
        <ReportCard
          report={sessionSummaryReport}
          organizationId="org-1"
          projectId="project-1"
        />,
      );

      expect(
        screen.queryByTestId("report-card-create-goal-button"),
      ).not.toBeInTheDocument();
    });

    it("opens NewGoalModal seeded with payload title, text, and report entities as source refs", async () => {
      const reportWithEntities: ReportDto = {
        ...goalProgressReportNoAnchor,
        payload: {
          reportType: "GOAL_PROGRESS",
          summary: "Progress summary",
          title: "Seeded goal title",
          text: "Seeded description text",
        },
        entities: [
          buildReportEntity({
            entityType: ReportRelatedEntityType.Task,
            entityId: "task-ref-1",
          }),
          buildReportEntity({
            entityType: ReportRelatedEntityType.Task,
            entityId: "plan-ref-1",
          }),
          buildReportEntity({
            entityType: ReportRelatedEntityType.DesignDoc,
            entityId: "design-doc-ref-1",
          }),
        ],
      };

      renderCard(
        <ReportCard
          report={reportWithEntities}
          organizationId="org-1"
          projectId="project-1"
        />,
      );

      await userEvent.click(
        screen.getByTestId("report-card-create-goal-button"),
      );

      const dialog = await screen.findByRole("dialog");
      expect(
        (within(dialog).getByLabelText("tasks.form.title") as HTMLInputElement)
          .value,
      ).toBe("Seeded goal title");
      expect(
        (
          within(dialog).getByLabelText(
            "tasks.form.description",
          ) as HTMLTextAreaElement
        ).value,
      ).toBe("Seeded description text");
    });

    it("creates the goal and attaches canonical work-item refs only", async () => {
      const reportWithEntities: ReportDto = {
        ...goalProgressReportNoAnchor,
        entities: [
          buildReportEntity({
            entityType: ReportRelatedEntityType.Task,
            entityId: "task-ref-1",
          }),
          buildReportEntity({
            entityType: ReportRelatedEntityType.Task,
            entityId: "plan-ref-1",
          }),
          buildReportEntity({
            entityType: ReportRelatedEntityType.DesignDoc,
            entityId: "design-doc-ref-1",
          }),
          buildReportEntity({
            entityType: ReportRelatedEntityType.AgentSession,
            entityId: "agent-session-ref-1",
          }),
        ],
      };

      createTaskMock.mockResolvedValue({ id: "new-goal-id" });
      attachToGoalMock.mockResolvedValue({ data: { data: {} } });

      renderCard(
        <ReportCard
          report={reportWithEntities}
          organizationId="org-1"
          projectId="project-1"
        />,
      );

      await userEvent.click(
        screen.getByTestId("report-card-create-goal-button"),
      );

      const dialog = await screen.findByRole("dialog");
      await userEvent.type(
        within(dialog).getByLabelText("tasks.form.title"),
        "New goal name",
      );
      await userEvent.type(
        within(dialog).getByLabelText("goals.dialog.dueDateLabel"),
        "2026-12-31",
      );

      const submitButton = within(dialog).getByRole("button", {
        name: "goals.dialog.createButton",
      });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(createTaskMock).toHaveBeenCalledTimes(1);
      });

      const [createPayload] = createTaskMock.mock.calls[0]!;
      expect(createPayload).toMatchObject({
        name: "New goal name",
        dueDate: new Date(2026, 11, 31).toISOString(),
        type: "GOAL",
      });

      await waitFor(() => {
        expect(attachToGoalMock).toHaveBeenCalledTimes(2);
      });

      const attachedTargets = attachToGoalMock.mock.calls.map(
        (call) =>
          (call[0] as { attachToGoalDto: { targetEntityId: string } })
            .attachToGoalDto,
      );
      expect(attachedTargets).toEqual(
        expect.arrayContaining([
          { targetEntityId: "task-ref-1", targetEntityType: EntityType.Task },
          { targetEntityId: "plan-ref-1", targetEntityType: EntityType.Task },
        ]),
      );
      const attachedIds = attachedTargets.map((d) => d.targetEntityId);
      expect(attachedIds).not.toContain("design-doc-ref-1");
      expect(attachedIds).not.toContain("agent-session-ref-1");
    });
  });
});
