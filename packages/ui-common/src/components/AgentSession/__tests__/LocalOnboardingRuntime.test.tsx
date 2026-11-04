import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { LocalOnboardingRuntime } from "../LocalOnboardingRuntime";
import { fetchRuntimeModelCatalog } from "../../../data/collections/runtimeModelCatalog";
import { resetCapabilityCatalogForTests } from "../capabilityCatalog";

const state = vi.hoisted(() => ({ authorized: true, providerAvailable: true }));
const create = vi.hoisted(() => vi.fn());
const start = vi.hoisted(() => vi.fn());
const machine = {
  machineId: "d70c8dd6-ff8b-4a0d-827c-926dcaf06150",
  name: "Local computer",
  pairedAt: "2026-11-01T00:00:00Z",
  active: true,
  authorizationProtocolVersion: 2,
  executionReadiness: "READY",
  currentControllerEligibility: "ELIGIBLE",
  currentControllerCredentialId: null,
  bindings: [],
};
vi.mock("../../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({
    machines: [machine],
    isReady: true,
    isFetched: true,
    isLoading: false,
  }),
}));
vi.mock("../../../data/hooks/useAgentSessions", () => ({
  useAgentSessions: () => ({ agentSessions: [], isLoading: false }),
}));
vi.mock("../../../data/hooks/useCreateAgentSession", () => ({
  useCreateAgentSession: () => ({ mutate: create }),
}));
vi.mock("../../../data/collections/runtimeModelCatalog", () => ({
  fetchRuntimeModelCatalog: vi.fn(),
}));
vi.mock("../operations/useAgentSessionInteractionAccess", () => ({
  useAgentSessionInteractionAccessResolver: () => ({
    getAccess: () =>
      state.authorized
        ? { isDeviceEnabled: true, interactions: { startSession: start } }
        : {
            isDeviceEnabled: false,
            unavailable: {
              type: "machine_not_ready",
              message: "Authorize this computer",
            },
          },
  }),
}));

const props = {
  children: <div data-testid="onboarding-conversation" />,
  onLaunchReady: vi.fn(),
  organizationId: "ceb49be5-bd93-4f7e-a59b-58de0793a1c8",
  projectId: "cc354f44-b317-4d87-afcd-7caf6b4a170c",
  conversationId: "09663832-e014-4a98-b3bd-f8f32b888ab8",
  workflowId: "c6ddcd52-2e40-414b-a76b-6cf5ec84538b",
};
beforeEach(() => {
  state.authorized = true;
  state.providerAvailable = true;
  localStorage.clear();
  resetCapabilityCatalogForTests();
  create.mockImplementation(async ({ agentSession }) => ({
    id: "18bc5953-152c-4251-b064-9b37434ce391",
    status: "NOT_STARTED",
    ...agentSession,
  }));
  start.mockResolvedValue({ state: "succeeded" });
  vi.mocked(fetchRuntimeModelCatalog).mockImplementation(async () => ({
    id: "catalog",
    response: {
      requestId: "catalog",
      operation: "runtime.model_catalog.get",
      status: "success",
      result: {
        providers: state.providerAvailable
          ? [
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
            ]
          : [],
      },
    },
  }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("local onboarding admission", () => {
  it("launches with the full selector configuration and binds the existing conversation", async () => {
    render(<LocalOnboardingRuntime {...props} />);
    const launch = screen.getByTestId("local-onboarding-launch");
    await waitFor(() => expect(launch).toBeEnabled());
    await userEvent.click(launch);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSession: expect.objectContaining({
          existingWorkflowBinding: {
            conversationId: props.conversationId,
            workflowId: props.workflowId,
          },
          provider: "codex",
          config: {
            type: "CODING_SESSION",
            version: "v2",
            model: "selected-model",
            effort: "high",
            fastMode: false,
          },
        }),
      }),
    );
    const model = await screen.findByTestId("agent-session-metadata-model");
    expect(
      screen
        .getByTestId("onboarding-conversation")
        .compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          provider: "codex",
          model: "selected-model",
          reasoningEffort: "high",
          fastMode: false,
          payload: expect.objectContaining({
            promptType: "local_onboarding",
            conversationId: props.conversationId,
          }),
        }),
      }),
    );
  });
  it("keeps the committed runtime fixed and reuses its session after launch fails", async () => {
    start.mockResolvedValueOnce({
      state: "failed",
      message: "Connection interrupted",
    });
    render(<LocalOnboardingRuntime {...props} />);
    const launch = screen.getByTestId("local-onboarding-launch");
    await waitFor(() => expect(launch).toBeEnabled());
    await userEvent.click(launch);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Connection interrupted",
      ),
    );
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    await userEvent.click(screen.getByTestId("local-onboarding-launch"));
    expect(create).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
  });
  it("blocks a ready provider when the machine is unauthorized", async () => {
    state.authorized = false;
    render(<LocalOnboardingRuntime {...props} />);
    await waitFor(() => expect(fetchRuntimeModelCatalog).toHaveBeenCalled());
    expect(screen.getByTestId("local-onboarding-launch")).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });
  it("blocks an authorized machine when no provider is available", async () => {
    state.providerAvailable = false;
    render(<LocalOnboardingRuntime {...props} />);
    await waitFor(() => expect(fetchRuntimeModelCatalog).toHaveBeenCalled());
    expect(screen.getByTestId("local-onboarding-launch")).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });
});
