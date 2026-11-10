import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import i18n from "@hey-hey/ui-common/i18n";
import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type MachineDto,
} from "@hey-hey/ui-common/api";
import { LocalWelcome } from "../LocalWelcome";
import { fetchRuntimeModelCatalog } from "../../../../../../packages/ui-common/src/data/collections/runtimeModelCatalog";
import { resetCapabilityCatalogForTests } from "../../../../../../packages/ui-common/src/components/AgentSession/capabilityCatalog";

const projectId = "cc354f44-b317-4d87-afcd-7caf6b4a170c";
const organizationId = "ceb49be5-bd93-4f7e-a59b-58de0793a1c8";
const conversationId = "09663832-e014-4a98-b3bd-f8f32b888ab8";
const machineId = "d70c8dd6-ff8b-4a0d-827c-926dcaf06150";

/**
 * An in-memory platform behind the API clients. Controller authorization only
 * succeeds for an existing Agent Session already bound to the selected
 * machine, and otherwise answers 403 TARGET_MISMATCH, as the server does.
 */
const platform = vi.hoisted(() => {
  const state = {
    sessions: new Map<string, Record<string, unknown>>(),
    events: [] as string[],
    starts: [] as Array<Record<string, unknown>>,
    startStates: [] as string[],
    nextId: 1,
    missingProject: false,
    machine: undefined as unknown,
  };
  const forbidden = () =>
    Object.assign(new Error("Forbidden"), {
      response: { status: 403, data: { code: "TARGET_MISMATCH" } },
    });
  return { state, forbidden };
});

vi.mock(
  "../../../../../../packages/ui-common/src/clients/serviceClients",
  () => ({
    projectsClient: { cancelAgentOperationInput: vi.fn() },
    machinesClient: {
      listMachines: vi.fn(async () => ({
        data: { data: { machines: [platform.state.machine] } },
      })),
      pingMachine: vi.fn(async () => {
        platform.state.events.push("ping");
        return { data: { data: { acknowledged: true } } };
      }),
    },
    agentSessionsClient: {
      updateAgentSession: vi.fn(
        async (request: {
          agentSessionId: string;
          updateAgentSessionDto: { machineId: string };
        }) => {
          platform.state.events.push("bind");
          const session = platform.state.sessions.get(request.agentSessionId)!;
          session.machineId = request.updateAgentSessionDto.machineId;
          return { data: { data: { ...session } } };
        },
      ),
    },
    unifiedApiClient: {
      createAgentSession: vi.fn(
        async (request: { createAgentSessionDto: Record<string, unknown> }) => {
          platform.state.events.push("create");
          const id = `session-${platform.state.nextId++}`;
          const session = {
            ...request.createAgentSessionDto,
            id,
            status: "NOT_STARTED",
            machineId: null,
            conversationId,
          };
          platform.state.sessions.set(id, session);
          return { data: { data: { ...session } } };
        },
      ),
      startConversationRun: vi.fn(
        async (request: {
          conversationStartRunRequestDto: Record<string, unknown>;
        }) => {
          platform.state.events.push("start");
          platform.state.starts.push(request.conversationStartRunRequestDto);
          return {
            data: {
              data: {
                operationId: request.conversationStartRunRequestDto.operationId,
                operationFingerprint:
                  request.conversationStartRunRequestDto.operationFingerprint,
                operationState:
                  platform.state.startStates.shift() ?? "SUCCEEDED",
                dispatched: true,
                triggerMessageId: "trigger-1",
              },
            },
          };
        },
      ),
      getAgentOperation: vi.fn(),
    },
    controllerAuthorizationClient: {
      resolveControllerAuthorization: vi.fn(
        async (request: {
          resolveControllerAuthorizationRequestDto: {
            machineId: string;
            action: { targetId: string };
          };
        }) => {
          platform.state.events.push("authorize");
          const { machineId: selected, action } =
            request.resolveControllerAuthorizationRequestDto;
          const session = platform.state.sessions.get(action.targetId);
          if (!session || session.machineId !== selected) {
            throw platform.forbidden();
          }
          return {
            data: {
              data: {
                outcome: "ACTIVE_GRANT",
                authorization: { kind: "bounded_grant", grantId: "grant-1" },
              },
            },
          };
        },
      ),
    },
  }),
);

const createProject = vi.hoisted(() => vi.fn());
vi.mock("@hey-hey/ui-common/context", async (original) => ({
  ...(await original<typeof import("@hey-hey/ui-common/context")>()),
  useOrganization: () => ({ currentOrganization: { id: organizationId } }),
}));
vi.mock("@hey-hey/ui-common/data", async (original) => ({
  ...(await original<typeof import("@hey-hey/ui-common/data")>()),
  useProjects: () => ({
    projects: platform.state.missingProject
      ? []
      : [{ id: projectId, organizationId, status: "ONBOARDING" }],
    isReady: true,
    error: null,
    create: createProject,
  }),
  useConversationByWorkflow: () => ({
    data: {
      id: conversationId,
      workflowId: "c6ddcd52-2e40-414b-a76b-6cf5ec84538b",
    },
    error: null,
  }),
  useAgentSessions: () => ({ agentSessions: [], isLoading: false }),
}));
vi.mock(
  "../../../../../../packages/ui-common/src/data/hooks/useUserPairedMachines",
  () => ({
    useUserPairedMachines: () => ({
      machines: [platform.state.machine],
      isReady: true,
      isFetched: true,
      isLoading: false,
      error: null,
    }),
  }),
);
vi.mock(
  "../../../../../../packages/ui-common/src/data/collections/runtimeModelCatalog",
  () => ({ fetchRuntimeModelCatalog: vi.fn() }),
);

const readyMachine: MachineDto = {
  machineId,
  name: "Local computer",
  pairedAt: "2026-11-01T00:00:00Z",
  active: true,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness: MachineExecutionReadinessState.Ready,
  currentControllerCredentialId: null,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
};

function Destination() {
  const location = useLocation();
  return <div data-testid="destination">{location.pathname}</div>;
}

function renderWelcome() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={createTheme()}>
          <MemoryRouter initialEntries={[`/welcome?projectId=${projectId}`]}>
            <Routes>
              <Route path="/welcome" element={<LocalWelcome />} />
              <Route
                path="/projects/:projectId/onboarding"
                element={<Destination />}
              />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const enabledStart = async () => {
  const start = await screen.findByTestId("local-onboarding-launch");
  await waitFor(() => expect(start).toBeEnabled());
  return start;
};

beforeEach(() => {
  window.__HEY_HEY_RUNTIME_CONFIG__ = { deployment: "local" };
  Object.assign(platform.state, {
    machine: readyMachine,
    missingProject: false,
    nextId: 1,
  });
  platform.state.sessions.clear();
  platform.state.events.length = 0;
  platform.state.starts.length = 0;
  platform.state.startStates.length = 0;
  localStorage.clear();
  resetCapabilityCatalogForTests();
  vi.mocked(fetchRuntimeModelCatalog).mockResolvedValue({
    id: "catalog",
    response: {
      requestId: "catalog",
      operation: "runtime.model_catalog.get",
      status: "success",
      result: {
        providers: [
          {
            provider: "codex",
            models: [
              {
                id: "selected-model",
                label: "Selected model",
                efforts: ["high"],
              },
            ],
          },
        ],
      },
    },
  });
});

afterEach(() => {
  delete window.__HEY_HEY_RUNTIME_CONFIG__;
  cleanup();
  vi.clearAllMocks();
});

describe("local /welcome", () => {
  it("starts onboarding with the chosen runtime for the existing project, binding the machine before authorization", async () => {
    renderWelcome();
    expect(screen.getByTestId("onboarding-model-guidance")).toBeInTheDocument();

    await userEvent.click(await enabledStart());

    await waitFor(() =>
      expect(screen.getByTestId("destination")).toHaveTextContent(
        `/projects/${projectId}/onboarding`,
      ),
    );
    expect(platform.state.events).toEqual([
      "ping",
      "create",
      "bind",
      "authorize",
      "start",
    ]);
    expect(platform.state.starts).toEqual([
      expect.objectContaining({
        agentSessionId: "session-1",
        machineId,
        provider: "codex",
        model: "selected-model",
        reasoningEffort: "high",
        handlerPromptType: "local_onboarding",
        payload: expect.objectContaining({
          promptType: "local_onboarding",
          conversationId,
        }),
      }),
    ]);
    expect(platform.state.sessions.get("session-1")).toMatchObject({
      projectId,
      provider: "codex",
      config: expect.objectContaining({ model: "selected-model" }),
      existingWorkflowBinding: expect.objectContaining({ conversationId }),
    });
    expect(createProject).not.toHaveBeenCalled();
  });

  it("pre-selects the low-cost Claude model instead of the first reported one", async () => {
    vi.mocked(fetchRuntimeModelCatalog).mockResolvedValue({
      id: "catalog",
      response: {
        requestId: "catalog",
        operation: "runtime.model_catalog.get",
        status: "success",
        result: {
          providers: [
            {
              provider: "claude",
              models: [
                {
                  id: "claude-opus",
                  label: "Opus",
                  efforts: ["low", "medium", "high"],
                },
                {
                  id: "claude-haiku-5-5",
                  label: "Haiku 5.5",
                  efforts: ["low", "medium", "high"],
                },
              ],
            },
          ],
        },
      },
    });
    renderWelcome();

    await userEvent.click(await enabledStart());

    await waitFor(() =>
      expect(platform.state.starts).toEqual([
        expect.objectContaining({
          provider: "claude",
          model: "claude-haiku-5-5",
          reasoningEffort: "medium",
        }),
      ]),
    );
  });

  it("keeps the saved choice fixed and retries the same session after a failed start", async () => {
    platform.state.startStates.push("FAILED");
    renderWelcome();
    const start = await enabledStart();
    expect(
      screen.getByTestId("onboarding-model-provider-select"),
    ).toBeInTheDocument();

    await userEvent.click(start);

    await waitFor(() =>
      expect(
        screen.queryByTestId("onboarding-model-provider-select"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("destination")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("agent-session-metadata-model"),
    ).toHaveTextContent("selected-model");

    await userEvent.click(await enabledStart());

    await screen.findByTestId("destination");
    expect(
      platform.state.events.filter((event) => event === "create"),
    ).toHaveLength(1);
    expect(platform.state.starts).toHaveLength(2);
    expect(platform.state.starts[1]).toMatchObject({
      agentSessionId: "session-1",
      model: "selected-model",
    });
  });

  it("cannot start until the machine is authorized for this browser", async () => {
    platform.state.machine = {
      ...readyMachine,
      currentControllerEligibility:
        CurrentControllerMachineEligibilityState.NotEnrolled,
    };
    renderWelcome();

    expect(
      await screen.findByTestId("onboarding-model-machine-selection"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("local-onboarding-launch"),
    ).not.toBeInTheDocument();
    expect(platform.state.events).toEqual([]);
  });

  it("does not create a replacement project when the setup project is missing", () => {
    platform.state.missingProject = true;
    renderWelcome();

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.queryByTestId("local-onboarding-launch"),
    ).not.toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
    expect(platform.state.events).toEqual([]);
  });
});
