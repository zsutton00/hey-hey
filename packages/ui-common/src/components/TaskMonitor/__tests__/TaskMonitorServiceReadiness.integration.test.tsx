import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  ServiceLinkDtoEntityTypeEnum,
  WorkStatus,
  type MachineDto,
  type ServiceDto,
  type TaskMonitorExecutionDefinition,
} from "../../../api";
import axios from "axios";
import { createApiRuntime, registerApiRuntime } from "../../../clients";
import { ProjectContext } from "../../../contexts";
import { workItemHandlers } from "../../../test/workItemGraphQLHandlers";
import type { FakeWorkItem } from "../../../test/workItemGraphQLAnswers";
import { CapsuleScreenButtonControl } from "../../ActionsCapsule/CapsuleScreenButtonControl";
import { useActionsCapsule } from "../../ActionsCapsule/ActionsCapsuleContext";
import { ActionsCapsuleProvider } from "../../ActionsCapsule/ActionsCapsuleProvider";
import { TaskMonitor } from "../TaskMonitor";
import { createSession } from "./taskMonitorTestFixtures";

// Analytics only; it needs the signed-in organization stack, not this flow.
vi.mock("../../../contexts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../contexts")>()),
  TrackingProvider: ({ children }: { children: ReactNode }) => children,
}));

const ORGANIZATION_ID = "org-1";
const PROJECT_ID = "project-1";
const MONITOR_ID = "66666666-6666-4666-8666-666666666666";
const SERVICE_ID = "77777777-7777-4777-8777-777777777777";
const taskIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
] as const;
const unservedTaskId = taskIds[2];

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

const service: ServiceDto = {
  id: SERVICE_ID,
  name: "hey-hey-cli",
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
} as ServiceDto;

const definition: TaskMonitorExecutionDefinition = {
  kind: "task",
  executionPlan: taskIds.map((taskId, position) => ({
    taskId,
    dependsOnTaskIds: position === 0 ? [] : [taskIds[position - 1]],
    launchConfiguration: {
      method: "quick",
      provider: "claude",
      model: "claude-sonnet-5-5",
      reasoningEffort: "medium",
    },
  })),
  launchPolicy: { terminalSupervision: { mode: "AGENT_DECIDES" } },
  cursor: 0,
};

const relationTo = (taskId: string) => ({
  id: `relation-${taskId}`,
  serviceId: SERVICE_ID,
  taskId,
  createdAt: "2026-11-01T00:00:00.000Z",
});

const initialItems = (): FakeWorkItem[] => [
  {
    id: MONITOR_ID,
    name: "Release monitor",
    type: "TASK_MONITOR",
    status: WorkStatus.Backlog,
    sections: [
      {
        id: "section-1",
        key: "executionDefinition",
        order: 0,
        materializedMarkdown: JSON.stringify(definition),
      },
    ],
  },
  {
    id: taskIds[0],
    name: "Route Service scope requests",
    type: "STANDARD",
    status: WorkStatus.Backlog,
    serviceRelations: [relationTo(taskIds[0])],
  },
  {
    id: taskIds[1],
    name: "Every permission request ends answered",
    type: "STANDARD",
    status: WorkStatus.Backlog,
    serviceRelations: [relationTo(taskIds[1])],
  },
  {
    id: unservedTaskId,
    name: "Verify end to end",
    type: "STANDARD",
    status: WorkStatus.Backlog,
    serviceRelations: [],
  },
];

const CapsuleScreenButtons = () => {
  const { screenButtons } = useActionsCapsule();
  return screenButtons.map((button) => (
    <CapsuleScreenButtonControl
      key={button.key}
      button={button}
      onClick={button.onClick}
    />
  ));
};

const ok = (data: unknown) =>
  HttpResponse.json({
    success: true,
    message: "ok",
    data,
    timestamp: "2026-11-22T00:00:00.000Z",
    statusCode: 200,
  });

describe("Task Monitor Service readiness", () => {
  let items: FakeWorkItem[];
  let releaseLink: () => void;
  const linkRequests: { serviceId: string; body: unknown }[] = [];

  beforeEach(() => {
    // The browser's API runtime, sending every REST request to the network.
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
    items = initialItems();
    linkRequests.length = 0;
    globalThis.mswServer.use(
      ...workItemHandlers(() => items),
      http.get("*/api/v1/machines", () => ok({ machines: [machine] })),
      // Nothing has run yet, so the monitor has no execution state.
      http.post(
        "*/organizations/:organizationId/projects/:projectId/work-items/execution-state\\:batch",
        () => ok({ items: [{ workItemId: MONITOR_ID, result: "MISSING" }] }),
      ),
      // The project's monitor type is not what this flow is about; without it
      // each task offers only the launch method it already has.
      http.get(
        "*/organizations/:organizationId/projects/:projectId/work-item-types/:typeKey",
        () => HttpResponse.json({ message: "Not found" }, { status: 404 }),
      ),
      // The coordinator exists but has no conversation until Start.
      http.post(
        "*/organizations/:organizationId/projects/:projectId/agent-sessions/work-item-coordinator",
        () =>
          ok({ agentSession: { ...createSession(), conversationId: null } }),
      ),
      http.get("*/organizations/:organizationId/services", () => ok([service])),
      http.post(
        "*/organizations/:organizationId/services/:serviceId/links",
        async ({ params, request }) => {
          const body = (await request.json()) as {
            entityType: string;
            entityId: string;
          };
          linkRequests.push({ serviceId: String(params.serviceId), body });
          // Held open so the card can be seen saving.
          await new Promise<void>((resolve) => {
            releaseLink = resolve;
          });
          items = items.map((item) =>
            item.id === body.entityId
              ? { ...item, serviceRelations: [relationTo(body.entityId)] }
              : item,
          );
          return ok({});
        },
      ),
    );
  });

  const renderMonitor = () =>
    render(
      <MemoryRouter>
        <ProjectContext.Provider
          value={{
            organizationId: ORGANIZATION_ID,
            projectId: PROJECT_ID,
            navigate: vi.fn(),
          }}
        >
          <ActionsCapsuleProvider>
            <CapsuleScreenButtons />
            <TaskMonitor
              organizationId={ORGANIZATION_ID}
              projectId={PROJECT_ID}
              monitorId={MONITOR_ID}
            />
          </ActionsCapsuleProvider>
        </ProjectContext.Provider>
      </MemoryRouter>,
    );

  const cardOf = (taskId: string) =>
    screen
      .getAllByTestId("task-monitor-task-card")
      .find((card) => card.dataset.taskId === taskId) as HTMLElement;

  it("holds Start until the task without a Service gets one on its card", async () => {
    renderMonitor();
    const user = userEvent.setup();

    const row = await screen.findByTestId("task-monitor-task-missing-service");
    expect(row).toHaveAttribute("data-task-id", unservedTaskId);
    expect(row).toHaveTextContent("Needs a Service before Start");
    expect(
      within(cardOf(unservedTaskId)).getByTestId(
        "task-monitor-task-setup-summary",
      ),
    ).toHaveTextContent(/^No Service ·/);
    const readyCard = screen.getByTestId("task-monitor-coordinator-prestart");
    expect(readyCard).toHaveTextContent("Not ready to start");
    expect(readyCard).toHaveTextContent("3. Verify end to end");
    const capsuleStart = screen.getByRole("button", { name: "Start" });
    const readyStart = screen.getByTestId("task-monitor-ready-start");
    expect(capsuleStart).toBeDisabled();
    expect(readyStart).toBeDisabled();

    // Cards name their Services once the project's Service list has loaded.
    await waitFor(() =>
      expect(
        within(cardOf(taskIds[0])).getByTestId(
          "task-monitor-task-setup-summary",
        ),
      ).toHaveTextContent(
        /^hey-hey-cli · Claude · Sonnet 5\.5 · Medium · Quick/,
      ),
    );
    await user.click(
      within(screen.getByTestId("task-monitor-task-service-picker")).getByRole(
        "combobox",
      ),
    );
    await user.click(
      await screen.findByRole("option", { name: /hey-hey-cli/ }),
    );

    await waitFor(() => expect(linkRequests).toHaveLength(1));
    expect(linkRequests[0]).toEqual({
      serviceId: SERVICE_ID,
      body: {
        entityType: ServiceLinkDtoEntityTypeEnum.Task,
        entityId: unservedTaskId,
      },
    });
    expect(
      screen.getByTestId("task-monitor-task-missing-service"),
    ).toHaveTextContent("Saving…");
    expect(capsuleStart).toBeDisabled();

    releaseLink();

    await waitFor(() =>
      expect(
        screen.queryByTestId("task-monitor-task-missing-service"),
      ).not.toBeInTheDocument(),
    );
    expect(
      within(cardOf(unservedTaskId)).getByTestId(
        "task-monitor-task-setup-summary",
      ),
    ).toHaveTextContent(/^hey-hey-cli ·/);
    expect(
      screen.getByTestId("task-monitor-coordinator-prestart"),
    ).toHaveTextContent("Ready to start");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start" })).toBeEnabled(),
    );
    expect(screen.getByTestId("task-monitor-ready-start")).toBeEnabled();
  });
});
