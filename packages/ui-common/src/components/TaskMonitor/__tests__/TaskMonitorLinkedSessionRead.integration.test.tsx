import type { ApolloClient } from "@apollo/client";
import { useApolloClient } from "@apollo/client/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  WorkStatus,
  type MachineDto,
  type TaskMonitorExecutionDefinition,
} from "../../../api";
import { createApiRuntime, registerApiRuntime } from "../../../clients";
import { getGraphQLClients } from "../../../data/graphql/client";
import { ProjectContext } from "../../../contexts";
import { workItemHandlers } from "../../../test/workItemGraphQLHandlers";
import type { FakeWorkItem } from "../../../test/workItemGraphQLAnswers";
import { ActionsCapsuleProvider } from "../../ActionsCapsule/ActionsCapsuleProvider";
import { TaskMonitor } from "../TaskMonitor";
import { createSession } from "./taskMonitorTestFixtures";

// Analytics only; it needs the signed-in organization stack, not this flow.
vi.mock("../../../contexts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../contexts")>()),
  TrackingProvider: ({ children }: { children: ReactNode }) => children,
}));

// The conversation surfaces stand in for the coordinator's composer; the
// projection, its session reads and the workspace boundary are real.
vi.mock("../useTaskMonitorSessionReports", () => ({
  useTaskMonitorCoordinatorConversation: () => ({
    session: { ...createSession(), conversationId: "coordinator-conversation" },
    conversation: null,
    project: null,
    loading: false,
    fetched: true,
    errorMessage: null,
  }),
  useTaskMonitorConversation: () => ({
    conversation: null,
    project: null,
    loading: false,
    fetched: true,
    errorMessage: null,
  }),
}));
vi.mock("../../AgentSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../AgentSession")>()),
  AgentConversationView: ({
    onDraftChange,
  }: {
    onDraftChange?: (draft: string) => void;
  }) => (
    <textarea
      aria-label="Coordinator reply"
      data-testid="coordinator-composer"
      onChange={(event) => onDraftChange?.(event.target.value)}
    />
  ),
}));

const ORGANIZATION_ID = "org-1";
const PROJECT_ID = "project-1";
const MONITOR_ID = "66666666-6666-4666-8666-666666666666";
const taskIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
] as const;
const firstSessionId = "44444444-4444-4444-8444-444444444444";
const nextSessionId = "55555555-5555-4555-8555-555555555555";

const machine: MachineDto = {
  machineId: "machine-1",
  name: "Ready machine",
  pairedAt: "2026-08-13T00:00:00.000Z",
  active: true,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness: MachineExecutionReadinessState.Ready,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
  bindings: [],
};

const definitionAt = (cursor: 0 | 1): TaskMonitorExecutionDefinition => ({
  kind: "task",
  executionPlan: taskIds.map((taskId, position) => ({
    taskId,
    dependsOnTaskIds: position === 0 ? [] : [taskIds[0]],
    launchConfiguration: {
      method: "quick",
      provider: "claude",
      model: "claude-sonnet-5-5",
      reasoningEffort: "medium",
    },
    ...(position === 0
      ? { agentSessionId: firstSessionId }
      : cursor === 1
        ? { agentSessionId: nextSessionId }
        : {}),
  })),
  launchPolicy: { terminalSupervision: { mode: "AGENT_DECIDES" } },
  cursor,
});

const itemsAt = (cursor: 0 | 1): FakeWorkItem[] => [
  {
    id: MONITOR_ID,
    name: "Release monitor",
    type: "TASK_MONITOR",
    status: WorkStatus.Active,
    sections: [
      {
        id: "section-1",
        key: "executionDefinition",
        order: 0,
        materializedMarkdown: JSON.stringify(definitionAt(cursor)),
      },
    ],
  },
  ...taskIds.map((id, position) => ({
    id,
    name: position === 0 ? "Route Service scope requests" : "Verify the flow",
    type: "STANDARD",
    status: position === 0 ? WorkStatus.Completed : WorkStatus.Active,
    serviceRelations: [],
  })),
];

const sessionRecord = (id: string, title: string) => ({
  ...createSession(),
  id,
  title,
});

let graphql: ApolloClient | null = null;
const CaptureGraphQLClient = () => {
  graphql = useApolloClient();
  return null;
};

/** What a change notification does: every active read asks again. */
const readEverythingAgain = async (queryClient: QueryClient) => {
  if (!graphql) {
    throw new Error("The GraphQL client was not captured.");
  }
  await Promise.all([
    ...[...getGraphQLClients(graphql)].map((client) =>
      client.refetchQueries({ include: "active" }),
    ),
    queryClient.invalidateQueries(),
  ]);
};

const ok = (data: unknown) =>
  HttpResponse.json({
    success: true,
    message: "ok",
    data,
    timestamp: "2026-11-22T00:00:00.000Z",
    statusCode: 200,
  });

describe("Task Monitor linked session reads", () => {
  let items: FakeWorkItem[];
  let releaseNextSession: () => void;
  const sessionReads: string[][] = [];

  beforeEach(() => {
    const network = axios.create({ baseURL: "http://localhost:3000/api/v1" });
    registerApiRuntime(
      createApiRuntime({
        baseUrl: "http://localhost:3000/api/v1",
        transport: {
          axios: network,
          request: (config) => network.request(config),
          setAuthToken: vi.fn(),
        },
      }),
    );
    items = itemsAt(0);
    sessionReads.length = 0;
    globalThis.mswServer.use(
      ...workItemHandlers(() => items),
      http.get("*/api/v1/machines", () => ok({ machines: [machine] })),
      http.post(
        "*/organizations/:organizationId/projects/:projectId/work-items/execution-state\\:batch",
        () => ok({ items: [{ workItemId: MONITOR_ID, result: "MISSING" }] }),
      ),
      http.get(
        "*/organizations/:organizationId/projects/:projectId/work-item-types/:typeKey",
        () => HttpResponse.json({ message: "Not found" }, { status: 404 }),
      ),
      http.get("*/organizations/:organizationId/services", () => ok([])),
      http.post(
        "*/organizations/:organizationId/projects/:projectId/agent-sessions/current-state\\:batch",
        () => ok({ items: [] }),
      ),
      http.get(
        "*/organizations/:organizationId/projects/:projectId/agent-sessions",
        async ({ request }) => {
          const ids = new URL(request.url).searchParams.getAll("ids");
          const requested = ids.flatMap((value) => value.split(","));
          sessionReads.push(requested);
          if (requested.includes(nextSessionId)) {
            // Held open: the newly linked session is still being read.
            await new Promise<void>((resolve) => {
              releaseNextSession = resolve;
            });
          }
          return ok(
            [
              sessionRecord(firstSessionId, "First task session"),
              sessionRecord(nextSessionId, "Next task session"),
            ].filter((session) => requested.includes(session.id)),
          );
        },
      ),
    );
  });

  it("keeps the focused coordinator draft while a newly linked session loads", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <CaptureGraphQLClient />
        <MemoryRouter>
          <ProjectContext.Provider
            value={{
              organizationId: ORGANIZATION_ID,
              projectId: PROJECT_ID,
              navigate: vi.fn(),
            }}
          >
            <ActionsCapsuleProvider>
              <TaskMonitor
                organizationId={ORGANIZATION_ID}
                projectId={PROJECT_ID}
                monitorId={MONITOR_ID}
              />
            </ActionsCapsuleProvider>
          </ProjectContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();

    const composer = await screen.findByTestId("coordinator-composer");
    await user.click(composer);
    await user.type(composer, "Hold the next task until review");

    // The monitor advances and links the next task's session.
    items = itemsAt(1);
    await act(async () => {
      void readEverythingAgain(queryClient);
    });
    await waitFor(() =>
      expect(sessionReads.some((ids) => ids.includes(nextSessionId))).toBe(
        true,
      ),
    );

    expect(screen.getByTestId("task-monitor-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("coordinator-composer")).toBe(composer);
    expect(composer).toHaveFocus();
    expect(composer).toHaveValue("Hold the next task until review");

    releaseNextSession();

    await waitFor(() =>
      expect(
        screen.getAllByTestId("task-monitor-task-card").length,
      ).toBeGreaterThan(0),
    );
    expect(screen.getByTestId("coordinator-composer")).toBe(composer);
    expect(composer).toHaveFocus();
    expect(composer).toHaveValue("Hold the next task until review");
  });
});
