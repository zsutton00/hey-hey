import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskResponseDto } from "@hey-hey/ui-common/api";

const mockNavigate = vi.fn();
const mockUseWorkItems = vi.fn();
const mockUseEvalRuns = vi.fn();
let mockTab = "eval";

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("nuqs", () => ({
  parseAsString: { withDefault: (value: string) => value },
  useQueryState: () => [mockTab, vi.fn()],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@hey-hey/ui-common/api", () => ({
  WorkStatus: { Active: "ACTIVE" },
  EvalRunStatus: { Finished: "FINISHED", Stopped: "STOPPED" },
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  CapsuleAction: (props: { id: string; onClick: () => void }) => (
    <button data-testid={`capsule-${props.id}`} onClick={props.onClick} />
  ),
  WorkItemReadView: () => <div data-testid="read-view" />,
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  usePlatformAdminAccess: () => ({ isPlatformAdmin: false, isResolved: true }),
  useEvalRuns: (...args: unknown[]) => mockUseEvalRuns(...args),
  useWorkItems: (...args: unknown[]) => mockUseWorkItems(...args),
  useWorkItemTypeByKey: () => ({
    workItemTypeDefinition: undefined,
    isFetched: true,
  }),
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: {
    evalRunSetup: ({
      projectId,
      evalId,
    }: {
      projectId: string;
      evalId: string;
    }) => `/projects/${projectId}/evals/${evalId}/runs/new`,
    task: ({ projectId, taskId }: { projectId: string; taskId: string }) =>
      `/projects/${projectId}/tasks/${taskId}`,
    returnToProject: (projectId: string) => `/projects/${projectId}`,
    evalRun: (p: { projectId: string; evalId: string; runId: string }) =>
      `/projects/${p.projectId}/evals/${p.evalId}/runs/${p.runId}`,
    evalRunResults: (p: { projectId: string; evalId: string; runId: string }) =>
      `/projects/${p.projectId}/evals/${p.evalId}/runs/${p.runId}/results`,
  },
}));

vi.mock("../../components/Layout", () => ({
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DetailPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  DetailPageTabs: () => <div data-testid="eval-tabs" />,
}));
vi.mock("../../components/Tabs", () => ({
  AdminTab: () => null,
  buildAdminMetadataItems: () => [],
}));
vi.mock("../../components/Tabs/ConversationListTab", () => ({
  ConversationListTab: () => null,
}));
vi.mock("../../components/Tabs/DataDebugTab", () => ({
  DataDebugTab: () => null,
}));
vi.mock("../../components/TaskBreadcrumbs", () => ({
  TaskBreadcrumbs: () => null,
}));
vi.mock("../../components/useFeatureAncestors", () => ({
  useFeatureAncestors: () => ({ ancestors: [] }),
}));

import { EvalPage } from "./EvalPage";

const task = {
  id: "eval-1",
  name: "Refiner eval",
  type: "EVAL",
} as TaskResponseDto;

const renderPage = (): void => {
  render(<EvalPage organizationId="org" projectId="p1" task={task} />);
};

describe("EvalPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTab = "eval";
    mockUseWorkItems.mockReturnValue({
      workItems: [],
      isLoading: false,
      remove: vi.fn(),
    });
    mockUseEvalRuns.mockReturnValue({
      runs: [],
      isLoading: false,
      error: null,
    });
  });

  it("asks only for approved cases of this Eval", () => {
    renderPage();
    expect(mockUseWorkItems).toHaveBeenCalledWith(
      "org",
      "task",
      "p1",
      undefined,
      expect.objectContaining({
        parentTaskId: "eval-1",
        taskType: "EVAL_CASE",
        status: "ACTIVE",
      }),
    );
    expect(screen.getByTestId("eval-case-list-empty")).toBeInTheDocument();
  });

  it("lists each case as a link to its own page", () => {
    mockUseWorkItems.mockReturnValue({
      workItems: [{ id: "case-1", name: "Refuses stale plan" }],
      isLoading: false,
      remove: vi.fn(),
    });
    renderPage();
    const row = screen.getByTestId("eval-case-case-1");
    expect(row).toHaveAttribute("href", "/projects/p1/tasks/case-1");
    fireEvent.click(row);
    expect(mockNavigate).toHaveBeenCalledWith("/projects/p1/tasks/case-1");
  });

  it("leaves modified clicks to the browser", () => {
    mockUseWorkItems.mockReturnValue({
      workItems: [{ id: "case-1", name: "Refuses stale plan" }],
      isLoading: false,
      remove: vi.fn(),
    });
    renderPage();
    fireEvent.click(screen.getByTestId("eval-case-case-1"), { metaKey: true });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("Run only navigates to run setup", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("capsule-run-eval"));
    expect(mockNavigate).toHaveBeenCalledWith(
      "/projects/p1/evals/eval-1/runs/new",
    );
  });

  it("lists earlier runs and New run navigates to run setup", () => {
    mockTab = "runs";
    mockUseEvalRuns.mockReturnValue({
      runs: [
        {
          id: "run-1",
          title: "Run 1",
          createdAt: "2026-10-20T10:00:00.000Z",
          payload: {
            status: "FINISHED",
            cases: [{}, {}],
            configurations: [{}, {}, {}],
          },
        },
      ],
      isLoading: false,
      error: null,
    });
    renderPage();
    const row = screen.getByTestId("eval-run-row-run-1");
    expect(row).toHaveTextContent("eval.page.runs.status.FINISHED");
    expect(row).toHaveTextContent("2 × 3");
    fireEvent.click(screen.getByTestId("eval-run-link-run-1"));
    expect(mockNavigate).toHaveBeenCalledWith(
      "/projects/p1/evals/eval-1/runs/run-1",
    );
    fireEvent.click(screen.getByTestId("eval-run-results-link-run-1"));
    expect(mockNavigate).toHaveBeenCalledWith(
      "/projects/p1/evals/eval-1/runs/run-1/results",
    );
    fireEvent.click(screen.getByTestId("eval-new-run"));
    expect(mockNavigate).toHaveBeenCalledWith(
      "/projects/p1/evals/eval-1/runs/new",
    );
  });
});
