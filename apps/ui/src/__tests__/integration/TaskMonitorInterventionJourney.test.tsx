import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canonicalBoundary: vi.fn(),
  commandRequests: [] as Array<{
    requestId: string;
    command: Record<string, string>;
  }>,
  params: vi.fn(),
  useFullEntityContext: vi.fn(),
  useProject: vi.fn(),
  useWorkItem: vi.fn(),
}));

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "20000000-0000-4000-8000-000000000002";
const MONITOR_ID = "30000000-0000-4000-8000-000000000003";
const INTERVENTION_ID = "50000000-0000-4000-8000-000000000005";
const RUN_ID = "60000000-0000-4000-8000-000000000006";
const AGENT_SESSION_ID = "70000000-0000-4000-8000-000000000007";

vi.mock("@hey-hey/ui-common/data", () => ({
  // Cached hierarchy unavailable, so pages use the server-derived ancestry.
  useFeatureLookup: () => ({
    isReady: false,
    isLoading: false,
    get: () => undefined,
    resolveAncestry: () => ({ ancestors: [], complete: false }),
  }),
  useFullEntityContext: (...args: unknown[]) => mocks.useFullEntityContext(...args),
  useProject: (...args: unknown[]) => mocks.useProject(...args),
  useWorkItem: (...args: unknown[]) => mocks.useWorkItem(...args),
}));

vi.mock("@hey-hey/ui-common/components", async () => {
  const React = await import("react");
  return {
    TaskMonitor: ({ monitorId }: { monitorId: string }) => {
      const requestRef = React.useRef<{
        requestId: string;
        command: Record<string, string>;
      } | null>(null);
      const [attempts, setAttempts] = React.useState(0);
      const [visible, setVisible] = React.useState(true);

      if (!visible) return null;
      const submit = () => {
        requestRef.current ??= {
          requestId: "80000000-0000-4000-8000-000000000008",
          command: {
            cause: "HUMAN_DECISION",
            interventionId: INTERVENTION_ID,
            providerActionId: "provider-action-1",
            runId: RUN_ID,
            agentSessionId: AGENT_SESSION_ID,
            fingerprint: "sha256:exact-action",
            resolution: "APPROVE",
          },
        };
        mocks.commandRequests.push(structuredClone(requestRef.current));
        if (attempts === 0) {
          setAttempts(1);
          return;
        }
        setVisible(false);
      };

      return (
        <div data-monitor-id={monitorId} data-testid="task-monitor-intervention-message">
          <div data-testid="task-monitor-intervention-action">exec</div>
          <div data-testid="task-monitor-intervention-target">pnpm test:run</div>
          <button onClick={submit}>{attempts === 0 ? "Approve" : "Retry approve"}</button>
          <button>Deny</button>
        </div>
      );
    },
  };
});

vi.mock("../../components/Layout", () => ({ PageBreadcrumbs: () => null }));
vi.mock("../../components/Layout/LayoutMainBottomSpacingContext", () => ({
  useSuppressLayoutMainBottomSpacing: () => undefined,
}));
vi.mock("../../hooks/useRemainingViewportHeight", () => ({
  useRemainingViewportHeight: () => ({ containerRef: () => undefined, height: 640 }),
}));
vi.mock("../../pages/Plan/PlanPage", () => ({
  PlanPage: (props: { automationContent: ReactNode }) => (
    <div data-testid="plan-shell">{props.automationContent}</div>
  ),
}));
vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: ORGANIZATION_ID }),
}));
vi.mock("@hey-hey/ui-common", () => ({
  createNavigationLineageEntry: (entityType: string, entityId: string) => ({
    entityType,
    entityId,
  }),
}));
vi.mock("@hey-hey/ui-common/context", () => ({
  CanonicalPageBoundary: (props: { children: ReactNode; composition: unknown }) => {
    mocks.canonicalBoundary(props);
    return <>{props.children}</>;
  },
  createCanonicalPageDescriptor: () => ({ kind: "canonical" }),
}));
vi.mock("react-router-dom", () => ({ useParams: () => mocks.params() }));

import { PlanTaskMonitorPage } from "../../pages/Plan/PlanTaskMonitorPage";
import { TaskMonitorPage } from "../../pages/Task/TaskMonitorPage";

describe("Task Monitor intervention workspace seam", () => {
  beforeEach(() => {
    mocks.commandRequests.length = 0;
    mocks.params.mockReturnValue({
      projectId: PROJECT_ID,
      planId: "90000000-0000-4000-8000-000000000009",
      stageId: "a0000000-0000-4000-8000-00000000000a",
      monitorId: MONITOR_ID,
    });
    mocks.useProject.mockReturnValue({ data: { name: "Hey Hey" } });
    mocks.useFullEntityContext.mockReturnValue({ data: { featureHierarchy: [] } });
    mocks.useWorkItem.mockReturnValue({
      workItem: { id: MONITOR_ID, name: "Release monitor", type: "TASK_MONITOR" },
      isLoading: false,
      error: null,
    });
  });

  it.each(["task route", "plan route"])(
    "keeps one complete generated decision across an uncertain retry through the %s",
    async (routeKind) => {
      const user = userEvent.setup();
      render(
        routeKind === "task route" ? (
          <TaskMonitorPage
            organizationId={ORGANIZATION_ID}
            projectId={PROJECT_ID}
            monitorId={MONITOR_ID}
            task={{ id: MONITOR_ID, name: "Release monitor", type: "TASK_MONITOR" } as never}
          />
        ) : (
          <PlanTaskMonitorPage />
        ),
      );

      expect(screen.getAllByTestId("task-monitor-intervention-message")).toHaveLength(1);
      expect(screen.getByTestId("task-monitor-intervention-action")).toHaveTextContent("exec");
      expect(screen.getByTestId("task-monitor-intervention-target")).toHaveTextContent(
        "pnpm test:run",
      );
      expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Deny" })).toBeEnabled();

      await user.click(screen.getByRole("button", { name: "Approve" }));
      expect(screen.getByRole("button", { name: "Retry approve" })).toBeEnabled();
      await user.click(screen.getByRole("button", { name: "Retry approve" }));

      expect(mocks.commandRequests).toHaveLength(2);
      expect(mocks.commandRequests[1]).toEqual(mocks.commandRequests[0]);
      expect(mocks.commandRequests[0]).toMatchObject({
        command: {
          cause: "HUMAN_DECISION",
          interventionId: INTERVENTION_ID,
          providerActionId: "provider-action-1",
          runId: RUN_ID,
          agentSessionId: AGENT_SESSION_ID,
          fingerprint: "sha256:exact-action",
          resolution: "APPROVE",
        },
      });
      await waitFor(() =>
        expect(screen.queryByTestId("task-monitor-intervention-message")).not.toBeInTheDocument(),
      );
    },
  );
});
