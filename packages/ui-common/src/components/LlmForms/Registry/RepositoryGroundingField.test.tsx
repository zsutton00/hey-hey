import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  ConversationStartRunRequestDtoProviderEnum,
  type MachineDto,
  type ServiceDto,
} from "../../../api";
import { setCapabilityCatalogForTests } from "../../AgentSession/capabilityCatalog";
import { TEST_CAPABILITY_CATALOG } from "../../../test/capabilityCatalogFixture";
import {
  readSurfaceSelection,
  SERVICE_IMPORT_SURFACE_ID,
  writeSurfaceSelection,
} from "../../AgentSession/surfaceSelectionMemory";
import { RepositoryGroundingNextAction } from "./repositoryGroundingUtils";
import type { LocalRepoBindingsState } from "../../../data/hooks/useLocalRepoBindings";
import {
  RepositoryGroundingField,
  type RepositoryGroundingFieldConfig,
  type RepositoryGroundingFieldProps,
} from "./RepositoryGroundingField";

const mocks = vi.hoisted(() => ({
  localBindings: {
    status: "empty" as LocalRepoBindingsState["status"],
    bindings: [],
    bindingsByServiceId: {},
    error: undefined as Error | undefined,
    refetch: vi.fn(),
    markStale: vi.fn(),
  },
  directoryApi: {
    listRepos: vi.fn(),
    pickDirectory: vi.fn(),
    setRepo: vi.fn(),
  },
  serviceQuery: {
    services: [] as ServiceDto[],
    error: undefined as Error | undefined,
  },
  machineQuery: {
    machines: [] as MachineDto[],
    isLoading: false,
    error: undefined as Error | undefined,
  },
  bindings: null as Array<{ serviceId: string }> | null,
  modalService: {
    showCreateService: vi.fn(),
    close: vi.fn(),
  },
}));

vi.mock("../../../contexts/ModalService", () => ({
  useModalService: () => mocks.modalService,
}));

vi.mock("../../../data/hooks", () => ({
  useMachineRepoBindings: () => mocks.bindings,
  useServices: () => mocks.serviceQuery,
  useUserPairedMachines: () => mocks.machineQuery,
}));

vi.mock("../../Selectors/ServiceSelector", () => ({
  ServiceSelector: ({
    onChange,
  }: {
    onChange: (serviceId: string | null, service?: ServiceDto) => void;
  }) => (
    <button
      type="button"
      data-testid="mock-service-selector"
      onClick={() => onChange("service-id", mocks.serviceQuery.services[0])}
    >
      Select Service
    </button>
  ),
}));

vi.mock("../../AgentSession/MachinePicker", () => ({
  MachinePicker: ({ onSelect }: { onSelect: (machineId: string) => void }) => (
    <button
      type="button"
      data-testid="mock-machine-picker"
      onClick={() => onSelect("machine-id")}
    >
      Select machine
    </button>
  ),
}));

vi.mock("../../../data/hooks/useLocalRepoBindings", () => ({
  useLocalRepoBindings: () => mocks.localBindings,
}));

vi.mock("../../AgentSession/runtime/directoryBindingApi", () => ({
  createDirectoryBindingApi: () => mocks.directoryApi,
  resolveLocalDirectoryRuntimeBaseUrl: () => "http://localhost:3847",
}));

const service: ServiceDto = {
  id: "service-id",
  name: "API Service",
  description: "The API service",
  organizationId: "organization-id",
  projectId: "project-id",
  status: "ACTIVE",
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

const machine: MachineDto = {
  machineId: "machine-id",
  name: "Developer laptop",
  pairedAt: "2026-08-25T00:00:00.000Z",
  active: true,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness: MachineExecutionReadinessState.Ready,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
  currentControllerCredentialId: "credential-id",
  bindings: [{ serviceId: "service-id", repositoryPath: "/workspace/api" }],
};

const context: RepositoryGroundingFieldProps["context"] = {
  organizationId: "organization-id",
  projectId: "project-id",
  conversationId: "conversation-id",
};

const config: RepositoryGroundingFieldConfig = {
  field: "repository-grounding",
  description: "Use existing work to ground the project.",
  type: "repository_grounding",
  payload: {
    providerOptions: [
      {
        provider: "claude",
        frontierModel: "stale-claude-model",
      },
    ],
  },
};

const readyValue: RepositoryGroundingFieldProps["value"] = {
  entryMode: "existing",
  serviceId: "service-id",
  brief: "The API service",
  machineId: "machine-id",
  scope: "comprehensive",
  focus: "",
  provider: "codex",
  model: "runtime-frontier",
  reasoningEffort: "medium",
  fastMode: false,
  bounds: {
    maxFiles: 100,
    maxTotalBytes: 1_000_000,
    maxFileBytes: 100_000,
    maxDepth: 8,
    maxGeneratedFiles: 20,
    maxIgnoredFiles: 20,
    maxUnsupportedFiles: 20,
    maxBinaryFiles: 20,
  },
  phase: "ready",
  progress: null,
  statusMessage: null,
  errorMessage: null,
  resultSummary: null,
};

const freshSetupValue: RepositoryGroundingFieldProps["value"] = {
  ...readyValue,
  provider: null,
  model: null,
  reasoningEffort: null,
  fastMode: null,
};

const renderField = (overrides: Partial<RepositoryGroundingFieldProps> = {}) =>
  render(
    <RepositoryGroundingField
      config={config}
      context={context}
      value={readyValue}
      isSubmitted={false}
      onChange={vi.fn()}
      {...overrides}
    />,
  );

describe("RepositoryGroundingField", () => {
  beforeEach(() => {
    mocks.localBindings.status = "empty";
    mocks.localBindings.error = undefined;
    mocks.localBindings.refetch.mockReset().mockResolvedValue([]);
    mocks.directoryApi.listRepos
      .mockReset()
      .mockResolvedValue({ machineId: "machine-id", bindings: [] });
    mocks.directoryApi.pickDirectory.mockReset().mockResolvedValue({
      status: "selected",
      machineId: "machine-id",
      repositoryPath: "/workspace/non-git-directory",
    });
    mocks.directoryApi.setRepo.mockReset().mockResolvedValue({
      serviceId: "service-id",
      repositoryPath: "/workspace/non-git-directory",
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
    });
    localStorage.clear();
    setCapabilityCatalogForTests([
      {
        provider: ConversationStartRunRequestDtoProviderEnum.Claude,
        models: [
          {
            id: "runtime-claude-frontier",
            label: "Runtime Claude Frontier",
            efforts: ["low", "medium", "high"],
          },
        ],
      },
      {
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        models: [
          {
            id: "runtime-frontier",
            label: "Runtime Frontier",
            efforts: ["low", "medium", "high"],
            serviceTiers: ["priority"],
          },
          {
            id: "runtime-alternative",
            label: "Runtime Alternative",
            efforts: ["low", "medium", "high"],
          },
        ],
      },
    ]);
    mocks.serviceQuery.services = [service];
    mocks.serviceQuery.error = undefined;
    mocks.machineQuery.machines = [machine];
    mocks.machineQuery.isLoading = false;
    mocks.machineQuery.error = undefined;
    mocks.bindings = [{ serviceId: "service-id" }];
  });

  afterEach(() => {
    // Unmount catalog subscribers before resetting the store. Mounted
    // subscribers would otherwise start a fetch that leaks into the next test.
    cleanup();
    localStorage.clear();
    setCapabilityCatalogForTests(TEST_CAPABILITY_CATALOG);
  });

  it.each(["error", "empty"] as const)(
    "recovers a %s binding list through the real control and requires explicit analysis start",
    async (status) => {
      const user = userEvent.setup();
      mocks.bindings = [];
      mocks.machineQuery.machines = [{ ...machine, bindings: [] }];
      mocks.localBindings.status = status;
      mocks.localBindings.error =
        status === "error"
          ? new Error("Request failed with status 503")
          : undefined;
      const onLaunchAnalysis = vi.fn().mockResolvedValue(undefined);
      const onChange = vi.fn();
      renderField({
        onLaunchAnalysis,
        onChange,
        value: { ...readyValue, scope: "focused", focus: "API boundaries" },
      });
      expect(
        screen.getByTestId("repository-grounding-analysis-locked"),
      ).toBeInTheDocument();
      if (status === "error")
        expect(
          screen.getByText(/Could not reach the local CLI on this computer/),
        ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Link directory" }));
      await waitFor(() =>
        expect(
          screen.getByTestId("repository-grounding-start-analysis"),
        ).toBeEnabled(),
      );
      expect(mocks.directoryApi.pickDirectory).toHaveBeenCalledWith(
        "machine-id",
      );
      expect(mocks.directoryApi.setRepo).toHaveBeenCalledWith(
        "service-id",
        "machine-id",
        "/workspace/non-git-directory",
      );
      expect(mocks.localBindings.refetch).toHaveBeenCalledOnce();
      expect(onChange).not.toHaveBeenCalled();
      expect(onLaunchAnalysis).not.toHaveBeenCalled();
      await user.click(
        screen.getByTestId("repository-grounding-start-analysis"),
      );
      expect(onLaunchAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceId: "service-id",
          machineId: "machine-id",
          scope: "focused",
          focus: "API boundaries",
          provider: "codex",
          model: "runtime-frontier",
          reasoningEffort: "medium",
          fastMode: false,
          bounds: readyValue.bounds,
        }),
      );
      expect(onLaunchAnalysis.mock.calls[0]?.[0]).not.toHaveProperty(
        "repositoryPath",
      );
    },
  );

  it.each(["read", "cancel", "picker", "write", "machine mismatch"])(
    "preserves import configuration after recovery encounters %s and permits retry",
    async (failure) => {
      const user = userEvent.setup();
      mocks.bindings = [];
      mocks.machineQuery.machines = [{ ...machine, bindings: [] }];
      mocks.localBindings.status = "error";
      mocks.localBindings.error = new Error("Initial read failed");
      if (failure === "read")
        mocks.directoryApi.listRepos.mockRejectedValueOnce(
          new Error("CLI unavailable"),
        );
      if (failure === "cancel")
        mocks.directoryApi.pickDirectory.mockResolvedValueOnce({
          status: "cancelled",
          machineId: "machine-id",
        });
      if (failure === "picker")
        mocks.directoryApi.pickDirectory.mockRejectedValueOnce(
          new Error("Picker unavailable"),
        );
      if (failure === "write")
        mocks.directoryApi.setRepo.mockRejectedValueOnce(
          new Error("Permission denied"),
        );
      if (failure === "machine mismatch")
        mocks.directoryApi.listRepos.mockResolvedValueOnce({
          machineId: "other-machine",
          bindings: [],
        });
      const onLaunchAnalysis = vi.fn();
      const onChange = vi.fn();
      renderField({ onLaunchAnalysis, onChange });
      await user.click(screen.getByRole("button", { name: "Link directory" }));
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Link directory" }),
        ).toBeEnabled(),
      );
      expect(
        screen.getByTestId("repository-grounding-analysis-locked"),
      ).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
      expect(onLaunchAnalysis).not.toHaveBeenCalled();
      expect(mocks.localBindings.refetch).not.toHaveBeenCalled();
      if (failure !== "write")
        expect(mocks.directoryApi.setRepo).not.toHaveBeenCalled();
      if (failure === "read" || failure === "machine mismatch")
        expect(mocks.directoryApi.pickDirectory).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Link directory" }));
      await waitFor(() =>
        expect(
          screen.getByTestId("repository-grounding-start-analysis"),
        ).toBeEnabled(),
      );
      expect(onLaunchAnalysis).not.toHaveBeenCalled();
    },
  );

  it("launches comprehensive analysis from the dedicated button without submitting a generic reply", async () => {
    const onSubmitValue = vi.fn();
    const onLaunchAnalysis = vi.fn().mockResolvedValue(undefined);
    renderField({ onSubmitValue, onLaunchAnalysis });

    expect(
      screen.getByTestId("repository-grounding-model-selector-catalog-ready"),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByTestId("repository-grounding-model-selector-model-select"),
      ).getByRole("combobox"),
    ).toHaveValue("Runtime Frontier");
    expect(
      screen.getByTestId("repository-grounding-model-note"),
    ).toHaveTextContent("We recommend a frontier model");

    fireEvent.click(screen.getByTestId("repository-grounding-start-analysis"));

    await waitFor(() =>
      expect(onLaunchAnalysis).toHaveBeenCalledWith({
        entryMode: "existing",
        serviceId: "service-id",
        brief: "The API service",
        machineId: "machine-id",
        scope: "comprehensive",
        provider: "codex",
        model: "runtime-frontier",
        reasoningEffort: "medium",
        fastMode: false,
        bounds: readyValue.bounds,
        nextAction: RepositoryGroundingNextAction.StartAnalysis,
      }),
    );
    expect(onSubmitValue).not.toHaveBeenCalled();
    expect(onLaunchAnalysis.mock.calls[0]?.[0]).not.toHaveProperty(
      "repositoryPath",
    );
  });

  it("renders the selector immediately with a complete initial runtime selection", () => {
    const ControlledRepositoryGroundingField = () => {
      const [value, setValue] = useState({
        ...readyValue,
        provider: null,
        model: null,
        reasoningEffort: null,
        fastMode: null,
      });
      return (
        <RepositoryGroundingField
          config={config}
          context={context}
          value={value}
          onChange={setValue}
        />
      );
    };
    render(<ControlledRepositoryGroundingField />);

    expect(
      screen.getByTestId("repository-grounding-model-selector-catalog-ready"),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByTestId("repository-grounding-model-selector-model-select"),
      ).getByRole("combobox"),
    ).toHaveValue("Runtime Claude Frontier");
    expect(
      screen.getByTestId("repository-grounding-start-analysis"),
    ).toBeEnabled();
  });

  it("persists a user-selected supported model through the controlled value", async () => {
    const user = userEvent.setup();
    const ControlledRepositoryGroundingField = () => {
      const [value, setValue] = useState(readyValue);
      return (
        <RepositoryGroundingField
          config={config}
          context={context}
          value={value}
          onChange={setValue}
        />
      );
    };
    render(<ControlledRepositoryGroundingField />);

    await user.click(
      within(
        screen.getByTestId("repository-grounding-model-selector-model-select"),
      ).getByRole("combobox"),
    );
    await user.click(screen.getByText("Runtime Alternative"));

    await waitFor(() =>
      expect(
        within(
          screen.getByTestId(
            "repository-grounding-model-selector-model-select",
          ),
        ).getByRole("combobox"),
      ).toHaveValue("Runtime Alternative"),
    );
  });

  it("saves the complete runtime choice after deliberate setup edits", async () => {
    const user = userEvent.setup();
    const ControlledRepositoryGroundingField = () => {
      const [value, setValue] = useState(freshSetupValue);
      return (
        <RepositoryGroundingField
          config={config}
          context={context}
          value={value}
          onChange={setValue}
        />
      );
    };
    render(<ControlledRepositoryGroundingField />);

    await user.click(
      within(
        screen.getByTestId(
          "repository-grounding-model-selector-provider-select",
        ),
      ).getByRole("combobox"),
    );
    await user.click(screen.getByText("Codex"));
    await waitFor(() =>
      expect(
        within(
          screen.getByTestId(
            "repository-grounding-model-selector-model-select",
          ),
        ).getByRole("combobox"),
      ).toHaveValue("Runtime Frontier"),
    );

    await user.click(
      within(
        screen.getByTestId("repository-grounding-model-selector-model-select"),
      ).getByRole("combobox"),
    );
    await user.click(screen.getByText("Runtime Alternative"));
    await waitFor(() =>
      expect(
        within(
          screen.getByTestId(
            "repository-grounding-model-selector-model-select",
          ),
        ).getByRole("combobox"),
      ).toHaveValue("Runtime Alternative"),
    );

    await user.click(
      within(
        screen.getByTestId("repository-grounding-model-selector-model-select"),
      ).getByRole("combobox"),
    );
    await user.click(screen.getByText("Runtime Frontier"));
    await waitFor(() =>
      expect(
        within(
          screen.getByTestId(
            "repository-grounding-model-selector-model-select",
          ),
        ).getByRole("combobox"),
      ).toHaveValue("Runtime Frontier"),
    );

    await user.click(
      within(
        screen.getByTestId("repository-grounding-model-selector-effort-select"),
      ).getByRole("combobox"),
    );
    await user.click(screen.getByText("High"));
    await user.click(
      screen.getByTestId(
        "repository-grounding-model-selector-fast-mode-switch",
      ),
    );

    await waitFor(() =>
      expect(readSurfaceSelection(SERVICE_IMPORT_SURFACE_ID)).toEqual({
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        model: "runtime-frontier",
        reasoningEffort: "high",
        fastMode: true,
      }),
    );
    expect(Object.keys(localStorage)).toEqual([
      `hey-hey:agent-selection:${SERVICE_IMPORT_SURFACE_ID}`,
    ]);
  });

  it("reuses one remembered choice across separate fresh Service Import mounts", () => {
    writeSurfaceSelection(SERVICE_IMPORT_SURFACE_ID, {
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "runtime-alternative",
      reasoningEffort: "high",
      fastMode: false,
    });

    const { unmount } = renderField({ value: freshSetupValue });
    expect(
      screen.getByTestId("repository-grounding-model-selector-provider-select"),
    ).toHaveTextContent("Codex");
    expect(
      within(
        screen.getByTestId("repository-grounding-model-selector-model-select"),
      ).getByRole("combobox"),
    ).toHaveValue("Runtime Alternative");
    expect(
      screen.getByTestId("repository-grounding-model-selector-effort-select"),
    ).toHaveTextContent("High");

    unmount();
    renderField({ value: freshSetupValue });
    expect(
      within(
        screen.getByTestId("repository-grounding-model-selector-model-select"),
      ).getByRole("combobox"),
    ).toHaveValue("Runtime Alternative");
  });

  it("keeps canonical committed and resumed runtime choices ahead of shared memory", () => {
    writeSurfaceSelection(SERVICE_IMPORT_SURFACE_ID, {
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      model: "runtime-claude-frontier",
      reasoningEffort: "low",
    });

    const { rerender } = renderField({
      value: {
        ...readyValue,
        phase: "completed",
        model: "runtime-alternative",
      },
    });
    expect(screen.getByText("Analysis complete")).toBeInTheDocument();
    expect(
      screen.getByTestId("repository-grounding-choice-summary"),
    ).toHaveTextContent("Codex");
    expect(
      screen.getByTestId("repository-grounding-choice-summary"),
    ).toHaveTextContent("runtime-alternative");
    expect(
      screen.queryByTestId("repository-grounding-model-selection"),
    ).not.toBeInTheDocument();

    rerender(
      <RepositoryGroundingField
        config={config}
        context={context}
        value={{
          ...readyValue,
          phase: "finished-later",
          model: "runtime-alternative",
        }}
        isSubmitted={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Analysis saved for later")).toBeInTheDocument();
    expect(
      screen.getByTestId("repository-grounding-choice-summary"),
    ).toHaveTextContent("Codex");
    expect(
      screen.getByTestId("repository-grounding-choice-summary"),
    ).toHaveTextContent("runtime-alternative");
  });

  it("does not default an active analysis that has no complete runtime choice", () => {
    writeSurfaceSelection(SERVICE_IMPORT_SURFACE_ID, {
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      model: "runtime-claude-frontier",
      reasoningEffort: "low",
    });

    renderField({
      value: {
        ...freshSetupValue,
        phase: "running",
      },
    });

    expect(screen.getByText("Analysis in progress")).toBeInTheDocument();
    expect(
      screen.getByTestId("repository-grounding-choice-summary"),
    ).toHaveTextContent("Provider: Not chosen");
    expect(
      screen.queryByTestId("repository-grounding-model-selection"),
    ).not.toBeInTheDocument();
  });

  it("does not persist Service metadata when setup fields change", () => {
    const onChange = vi.fn();
    renderField({ value: freshSetupValue, onChange });

    fireEvent.click(screen.getByTestId("mock-service-selector"));

    expect(onChange).toHaveBeenCalled();
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it("accepts a runtime provider change without API usage metadata", async () => {
    const user = userEvent.setup();
    const initialValue: RepositoryGroundingFieldProps["value"] = {
      ...readyValue,
      provider: "claude",
      model: "runtime-claude-frontier",
    };
    const ControlledRepositoryGroundingField = () => {
      const [value, setValue] = useState(initialValue);
      return (
        <RepositoryGroundingField
          config={config}
          context={context}
          value={value}
          onChange={setValue}
        />
      );
    };
    render(<ControlledRepositoryGroundingField />);

    await user.click(
      within(
        screen.getByTestId(
          "repository-grounding-model-selector-provider-select",
        ),
      ).getByRole("combobox"),
    );
    await user.click(screen.getByText("Codex"));

    await waitFor(() => {
      expect(
        screen.getByTestId(
          "repository-grounding-model-selector-provider-select",
        ),
      ).toHaveTextContent("Codex");
      expect(
        within(
          screen.getByTestId(
            "repository-grounding-model-selector-model-select",
          ),
        ).getByRole("combobox"),
      ).toHaveValue("Runtime Frontier");
      expect(
        screen.getByTestId("repository-grounding-start-analysis"),
      ).toBeEnabled();
    });
  });

  it("clears Fast mode when the selected model does not support it", async () => {
    const user = userEvent.setup();
    const onLaunchAnalysis = vi.fn().mockResolvedValue(undefined);
    const ControlledRepositoryGroundingField = () => {
      const [value, setValue] = useState({ ...readyValue, fastMode: true });
      return (
        <RepositoryGroundingField
          config={config}
          context={context}
          value={value}
          onChange={setValue}
          onLaunchAnalysis={onLaunchAnalysis}
        />
      );
    };
    render(<ControlledRepositoryGroundingField />);

    await user.click(
      within(
        screen.getByTestId("repository-grounding-model-selector-model-select"),
      ).getByRole("combobox"),
    );
    await user.click(screen.getByText("Runtime Alternative"));
    await waitFor(() =>
      expect(
        screen.getByTestId("repository-grounding-start-analysis"),
      ).toBeEnabled(),
    );

    await user.click(screen.getByTestId("repository-grounding-start-analysis"));
    expect(onLaunchAnalysis).toHaveBeenCalledWith(
      expect.not.objectContaining({ fastMode: expect.anything() }),
    );
  });

  it("restores a persisted non-frontier catalog selection", () => {
    renderField({ value: { ...readyValue, model: "runtime-alternative" } });
    expect(
      within(
        screen.getByTestId("repository-grounding-model-selector-model-select"),
      ).getByRole("combobox"),
    ).toHaveValue("Runtime Alternative");
  });

  it("keeps focused analysis disabled until focus is non-empty", () => {
    const onSubmitValue = vi.fn();
    const onLaunchAnalysis = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderField({
      value: { ...readyValue, scope: "focused", focus: "" },
      onSubmitValue,
      onLaunchAnalysis,
    });

    expect(
      screen.getByTestId("repository-grounding-start-analysis"),
    ).toBeDisabled();

    rerender(
      <RepositoryGroundingField
        config={config}
        context={context}
        value={{ ...readyValue, scope: "focused", focus: "API boundaries" }}
        isSubmitted={false}
        onChange={vi.fn()}
        onSubmitValue={onSubmitValue}
        onLaunchAnalysis={onLaunchAnalysis}
      />,
    );

    expect(
      screen.getByTestId("repository-grounding-start-analysis"),
    ).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("repository-grounding-start-analysis"));

    expect(onLaunchAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "focused",
        focus: "API boundaries",
      }),
    );
    expect(onSubmitValue).not.toHaveBeenCalled();
  });

  it("shows a launch error without falling back to the generic reply path", async () => {
    const onSubmitValue = vi.fn();
    const onLaunchAnalysis = vi
      .fn()
      .mockRejectedValue(new Error("Agent Session creation failed."));
    renderField({ onSubmitValue, onLaunchAnalysis });

    fireEvent.click(screen.getByTestId("repository-grounding-start-analysis"));

    expect(
      await screen.findByText("Agent Session creation failed."),
    ).toBeInTheDocument();
    expect(onSubmitValue).not.toHaveBeenCalled();
  });

  it("exposes readiness as pending on the stable Start analysis control", async () => {
    let resolveLaunch: (() => void) | undefined;
    const onLaunchAnalysis = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLaunch = resolve;
        }),
    );
    renderField({ onLaunchAnalysis });

    fireEvent.click(screen.getByTestId("repository-grounding-start-analysis"));

    await waitFor(() =>
      expect(
        screen.getByTestId("repository-grounding-start-analysis"),
      ).toHaveAttribute("aria-busy", "true"),
    );
    expect(
      screen.getByTestId("repository-grounding-start-analysis"),
    ).toHaveTextContent("Starting analysis");
    expect(
      screen.getByTestId("repository-grounding-start-analysis"),
    ).toBeDisabled();

    resolveLaunch?.();
    await waitFor(() =>
      expect(
        screen.getByTestId("repository-grounding-start-analysis"),
      ).toHaveAttribute("aria-busy", "false"),
    );
  });

  it("routes Retry analysis through readiness without generic submission", async () => {
    const onSubmitValue = vi.fn();
    const onLaunchAnalysis = vi.fn().mockResolvedValue(undefined);
    renderField({
      value: { ...readyValue, phase: "retryable-error" },
      onSubmitValue,
      onLaunchAnalysis,
    });

    fireEvent.click(screen.getByTestId("repository-grounding-retry"));

    await waitFor(() =>
      expect(onLaunchAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({
          nextAction: RepositoryGroundingNextAction.RetryAnalysis,
        }),
      ),
    );
    expect(onSubmitValue).not.toHaveBeenCalled();
  });

  it("prefills the controlled brief when a Service is selected", () => {
    const onChange = vi.fn();
    renderField({
      value: { ...readyValue, serviceId: null, brief: "" },
      onChange,
    });

    fireEvent.click(screen.getByTestId("mock-service-selector"));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entryMode: "existing",
        serviceId: "service-id",
        brief: "The API service",
      }),
    );
  });

  it("preserves spaces while editing the controlled Service brief", () => {
    const ControlledRepositoryGroundingField = () => {
      const [value, setValue] = useState(readyValue);

      return (
        <RepositoryGroundingField
          config={config}
          context={context}
          value={value}
          onChange={setValue}
        />
      );
    };

    render(<ControlledRepositoryGroundingField />);

    const brief = screen.getByRole("textbox", { name: /service brief/i });
    fireEvent.change(brief, { target: { value: "API " } });

    expect(brief).toHaveValue("API ");

    fireEvent.change(brief, { target: { value: "API service" } });

    expect(brief).toHaveValue("API service");
  });

  it("restores persisted running state with finish-later recovery", () => {
    renderField({
      value: {
        ...readyValue,
        phase: "running",
        progress: 35,
        statusMessage: "Reading repository evidence",
      },
    });

    expect(screen.getByText("Analysis in progress")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "35",
    );
    expect(
      screen.getByTestId("repository-grounding-finish-later"),
    ).toBeInTheDocument();
  });
});
