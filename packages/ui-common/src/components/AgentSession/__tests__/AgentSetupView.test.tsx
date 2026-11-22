import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  ProjectModeSelectionSchemaVersionEnum,
  type MachineDto,
} from "../../../api";
import type { ProjectModeCatalogEntry } from "../../../agents/coordination/projectModeCatalog";
import type { WorkItemResponseDto } from "../../../data/collections/workItems";
import { AgentSetupView, type AgentSetupViewProps } from "../AgentSetupView";
import { resetCapabilityCatalogForTests } from "../capabilityCatalog";

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("../PromptEditor", () => ({
  PromptEditor: ({
    onSubmitPrompt,
    submitDisabled,
  }: {
    onSubmitPrompt: () => void;
    submitDisabled: boolean;
  }) => (
    <div data-testid="prompt-editor">
      <button type="button" disabled={submitDisabled} onClick={onSubmitPrompt}>
        Submit Prompt
      </button>
    </div>
  ),
}));

vi.mock("../../Services/ServiceDirectoryBindingControl", () => ({
  // Mirrors the real control's label rule: bound shows "Update directory",
  // otherwise the caller's unboundLabel.
  ServiceDirectoryBindingControl: ({
    serviceId,
    isBound,
    unboundLabel,
  }: {
    serviceId: string;
    isBound: boolean;
    unboundLabel: string;
  }) => (
    <button
      type="button"
      data-testid={`directory-binding-control-${serviceId}`}
    >
      {isBound ? "Update directory" : unboundLabel}
    </button>
  ),
}));

const machine = (
  machineId: string,
  executionReadiness: MachineDto["executionReadiness"],
): MachineDto => ({
  machineId,
  name: machineId,
  pairedAt: "2026-08-13T00:00:00.000Z",
  active: executionReadiness === MachineExecutionReadinessState.Ready,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
  bindings: [],
});

const placesEntry = (branch: string) =>
  ({
    status: "ready",
    mainFolder: { branch },
    worktrees: [],
    recentBranches: [],
    branchMatches: [],
    branchMatchesTruncated: false,
  }) as const;

const READY_PLACES: AgentSetupViewProps["servicePlaces"] = {
  status: "ready",
  byServiceId: {
    "service-1": placesEntry("dev"),
    "service-2": placesEntry("main"),
  },
  searching: false,
  searchError: null,
};

const manyServices = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `extra-${String(index)}`,
    name: `Extra ${String(index)}`,
  }));

const buildProps = (
  overrides: Partial<AgentSetupViewProps> = {},
): AgentSetupViewProps => ({
  step: "session-method",
  primaryServices: [{ id: "service-1", name: "API Service" }],
  additionalServices: [],
  loadingServices: false,
  servicesError: null,
  selectedServiceId: "service-1",
  selectedServiceIds: ["service-1"],
  isMultiServiceMode: true,
  serviceSelectionLocked: false,
  onSelectService: vi.fn(),
  onToggleService: vi.fn(),
  onContinueToSelection: vi.fn(),
  onBackToSessionMethod: vi.fn(),
  sessionMethod: "plan",
  onSelectSessionMethod: vi.fn(),
  compatibleSessionMethods: [
    "plan",
    "open",
    "quick",
    "debug",
    "research",
    "split_by_service",
    "split_by_function",
  ],
  projectModeCatalog: [],
  projectModeCatalogLoading: false,
  projectModeCatalogError: null,
  projectModeSelection: null,
  onSelectProjectMode: vi.fn(),
  recoveryState: {
    type: "ready",
    machine: machine("machine-1", MachineExecutionReadinessState.Ready),
  },
  repositoryPaths: {
    "service-1": "/repos/api",
    "service-2": "/repos/worker",
  },
  lockedWorktreeBranch: null,
  servicePlaces: READY_PLACES,
  branchQuery: "",
  onBranchQueryChange: vi.fn(),
  sessionPlaceChoice: null,
  perServicePlaceChoices: null,
  onChangeSessionPlace: vi.fn(),
  onChangeServicePlace: vi.fn(),
  onTogglePerServicePlaces: vi.fn(),
  launchServiceId: "service-1",
  onSelectLaunchService: vi.fn(),
  preparingRun: false,
  hasActiveRun: false,
  canStartCoding: true,
  onStartValidation: vi.fn(),
  startingValidation: false,
  promptDraft: "",
  onPromptDraftChange: vi.fn(),
  onSubmitPrompt: vi.fn(),
  onBackToSelection: vi.fn(),
  submittingPrompt: false,
  launchErrorMessages: [],
  catalogSource: {
    organizationId: "org-1",
    projectId: "project-1",
    machineId: "machine-1",
  },
  promptProvider: "claude",
  promptModel: "claude-opus-4-8",
  promptReasoningEffort: "medium",
  promptFastMode: false,
  onPromptProviderChange: vi.fn(),
  onPromptModelChange: vi.fn(),
  onPromptReasoningEffortChange: vi.fn(),
  onPromptFastModeChange: vi.fn(),
  machines: [machine("machine-1", MachineExecutionReadinessState.Ready)],
  machineMode: "one",
  selectedMachineId: "machine-1",
  onSelectMachine: vi.fn(),
  onAddService: vi.fn(),
  ...overrides,
});

const getServiceRow = (serviceId: string): HTMLElement => {
  const row = screen
    .getAllByTestId("coding-service-row")
    .find((candidate) => candidate.dataset.serviceId === serviceId);
  if (!row) throw new Error(`Service row not found: ${serviceId}`);
  return row;
};

const getLaunchServiceRow = (serviceId: string): HTMLElement => {
  const row = screen
    .getAllByTestId("coding-launch-service-row")
    .find((candidate) => candidate.dataset.serviceId === serviceId);
  if (!row) throw new Error(`Launch Service row not found: ${serviceId}`);
  return row;
};

describe("AgentSetupView", () => {
  it("shares file-only drop capture, named chips, removal and pending submission guards", () => {
    const drop = vi.fn();
    const remove = vi.fn();
    const onSubmit = vi.fn();
    const promptAttachments = {
      canDrop: true,
      blocked: true,
      rejection: null,
      entries: [
        {
          key: "file",
          fileName: "notes.txt",
          status: "uploading" as const,
          file: new File(["x"], "notes.txt"),
        },
      ],
      references: [],
      drop,
      remove,
      clearSubmitted: vi.fn(),
    };
    render(
      <AgentSetupView
        {...buildProps({ promptAttachments, onSubmitPrompt: onSubmit })}
      />,
    );
    const zone = screen.getByTestId("initial-prompt-attachment-drop-zone");
    const file = new File(["a"], "notes.txt");
    fireEvent.drop(zone, {
      dataTransfer: { types: ["text/plain"], files: [file] },
    });
    expect(drop).not.toHaveBeenCalled();
    fireEvent.dragEnter(zone, {
      dataTransfer: { types: ["Files"], files: [file] },
    });
    expect(
      screen.getByTestId("run-attachment-drop-indicator"),
    ).toBeInTheDocument();
    fireEvent.drop(zone, { dataTransfer: { types: ["Files"], files: [file] } });
    expect(drop).toHaveBeenCalledExactlyOnceWith([file]);
    expect(screen.getByTestId("run-attachment-chip")).toHaveTextContent(
      "notes.txt",
    );
    fireEvent.click(screen.getByTestId("remove-run-attachment"));
    expect(remove).toHaveBeenCalledWith("file");
    expect(
      screen.getByRole("button", { name: "Submit Prompt" }),
    ).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders method, Service, workspace, runtime, and prompt controls together", () => {
    render(<AgentSetupView {...buildProps()} />);

    expect(screen.getByTestId("coding-setup-one-screen")).toBeInTheDocument();
    expect(screen.getByTestId("coding-method-card-plan")).toBeInTheDocument();
    expect(screen.getByTestId("coding-method-card-plan")).toHaveTextContent(
      "With Plan + Project Assistant",
    );
    expect(screen.getByTestId("coding-method-card-open")).toHaveTextContent(
      "With Project Assistant",
    );
    expect(screen.getByTestId("coding-method-card-quick")).toHaveTextContent(
      "Task Only",
    );
    expect(
      screen.queryByTestId("coding-method-card-validation"),
    ).not.toBeInTheDocument();
    expect(getServiceRow("service-1")).toBeInTheDocument();
    expect(
      screen.getByTestId("directory-binding-control-service-1"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("coding-work-in")).toBeInTheDocument();
    expect(screen.getByTestId("coding-setup-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("prompt-editor")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Submit Prompt" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Next" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
  });

  it("renders eligible Agent Modes beside built-ins and forwards selection", async () => {
    const projectModeSelection = {
      schemaVersion:
        ProjectModeSelectionSchemaVersionEnum.ProjectModeSelectionV1,
      modeId: "mode-review",
    } as const;
    const projectModeCatalog: readonly ProjectModeCatalogEntry[] = [
      {
        selection: projectModeSelection,
        name: "Review mode",
        description:
          "Review changes with the project conventions. Apply the full review workflow before reporting.",
      },
    ];
    const onSelectProjectMode = vi.fn();

    render(
      <AgentSetupView
        {...buildProps({
          projectModeCatalog,
          onSelectProjectMode,
          taskData: {
            id: "task-1",
            name: "Task 1",
            type: "STANDARD",
          } as WorkItemResponseDto,
        })}
      />,
    );

    const card = screen.getByTestId("coding-project-mode-card");
    expect(screen.getByText("Agent Modes")).toBeInTheDocument();
    expect(card).toHaveAttribute("data-mode-id", "mode-review");
    expect(card).toHaveTextContent("Review mode");
    expect(card).toHaveTextContent(
      "Review changes with the project conventions.",
    );
    expect(card).not.toHaveTextContent(
      "Apply the full review workflow before reporting.",
    );
    expect(projectModeCatalog[0].description).toContain(
      "Apply the full review workflow before reporting.",
    );
    expect(screen.getByTestId("coding-method-card-plan")).toBeInTheDocument();

    await userEvent.click(card);

    expect(onSelectProjectMode).toHaveBeenCalledWith(projectModeSelection);
  });

  it("defines loading, empty, and error states for the project-mode catalog", () => {
    const taskData = {
      id: "task-1",
      name: "Task 1",
      type: "STANDARD",
    } as WorkItemResponseDto;
    const { rerender } = render(
      <AgentSetupView {...buildProps({ taskData })} />,
    );

    expect(
      screen.getByText("No Agent Modes are available for this work item."),
    ).toBeInTheDocument();

    rerender(
      <AgentSetupView
        {...buildProps({ projectModeCatalogLoading: true, taskData })}
      />,
    );
    expect(
      screen.getByTestId("coding-project-mode-loading"),
    ).toBeInTheDocument();

    rerender(
      <AgentSetupView
        {...buildProps({
          projectModeCatalogError: "Agent Modes could not be loaded.",
          taskData,
        })}
      />,
    );
    expect(
      screen.getByText("Agent Modes could not be loaded."),
    ).toBeInTheDocument();
  });

  it("keeps the selected method, launch Service, and workspace visible", () => {
    render(
      <AgentSetupView
        {...buildProps({
          sessionMethod: "split_by_function",
          selectedServiceIds: ["service-1", "service-2"],
          additionalServices: [{ id: "service-2", name: "Worker" }],
          launchServiceId: "service-2",
        })}
      />,
    );

    expect(
      within(
        screen.getByTestId("coding-method-card-split_by_function"),
      ).getByText("Selected"),
    ).toBeInTheDocument();
    expect(
      within(getServiceRow("service-1")).getByRole("checkbox"),
    ).toBeChecked();
    expect(
      within(getLaunchServiceRow("service-2")).getByRole("radio"),
    ).toBeChecked();
    expect(
      screen
        .getAllByTestId("coding-service-path")
        .find((path) => path.dataset.serviceId === "service-2"),
    ).toHaveTextContent("/repos/worker");
  });

  it("renders compact, clamped Service rows", () => {
    render(
      <AgentSetupView
        {...buildProps({
          primaryServices: [
            {
              id: "service-1",
              name: "API Service",
              description:
                "A long description that can wrap across the available row width.",
            },
          ],
          additionalServices: [
            { id: "service-2", name: "Worker", description: "Runs jobs" },
          ],
        })}
      />,
    );

    const taskServiceRow = getServiceRow("service-1");
    const description = within(taskServiceRow).getByTestId(
      "coding-service-description",
    );

    expect(taskServiceRow).toHaveStyle({ height: "40px", maxHeight: "40px" });
    expect(within(taskServiceRow).getByRole("checkbox")).toBeChecked();
    expect(description).toHaveStyle({
      color: "rgba(0, 0, 0, 0.6)",
      display: "-webkit-box",
      overflow: "hidden",
      textOverflow: "ellipsis",
      WebkitLineClamp: "2",
    });
    expect(screen.getByText("Task Services")).toBeInTheDocument();
    expect(screen.getByText("Other Services")).toBeInTheDocument();
  });

  it("uses toggle semantics when clicking a Service row or checkbox", async () => {
    const user = userEvent.setup();
    const onToggleService = vi.fn();

    render(
      <AgentSetupView
        {...buildProps({
          onToggleService,
          additionalServices: [{ id: "service-2", name: "Worker" }],
        })}
      />,
    );

    const serviceRow = getServiceRow("service-2");
    await user.click(serviceRow);
    await user.click(within(serviceRow).getByRole("checkbox"));

    expect(onToggleService).toHaveBeenNthCalledWith(1, "service-2");
    expect(onToggleService).toHaveBeenNthCalledWith(2, "service-2");
  });

  it("uses single-Service selection semantics", async () => {
    const user = userEvent.setup();
    const onSelectService = vi.fn();

    render(
      <AgentSetupView
        {...buildProps({
          isMultiServiceMode: false,
          onSelectService,
          additionalServices: [{ id: "service-2", name: "Worker" }],
        })}
      />,
    );

    await user.click(getServiceRow("service-2"));
    expect(onSelectService).toHaveBeenCalledWith("service-2");
  });

  it("disables Service row selection when selection is locked", async () => {
    const user = userEvent.setup();
    const onToggleService = vi.fn();

    render(
      <AgentSetupView
        {...buildProps({
          serviceSelectionLocked: true,
          onToggleService,
          additionalServices: [{ id: "service-2", name: "Worker" }],
        })}
      />,
    );

    const serviceRow = getServiceRow("service-2");
    expect(serviceRow).toHaveAttribute("aria-disabled", "true");
    expect(within(serviceRow).getByRole("checkbox")).toBeDisabled();
    await user.click(serviceRow);
    expect(onToggleService).not.toHaveBeenCalled();
  });

  it("filters compact Service rows without changing method or launch controls", async () => {
    const user = userEvent.setup();

    render(
      <AgentSetupView
        {...buildProps({
          selectedServiceIds: ["service-1", "service-2"],
          additionalServices: [
            { id: "service-2", name: "Worker" },
            ...manyServices(8),
          ],
        })}
      />,
    );

    await user.type(screen.getByLabelText("Search services"), "worker");

    expect(getServiceRow("service-2")).toBeInTheDocument();
    expect(
      screen
        .queryAllByTestId("coding-service-row")
        .some((row) => row.dataset.serviceId === "service-1"),
    ).toBe(false);
    expect(screen.getByTestId("coding-method-card-plan")).toBeInTheDocument();
    expect(getLaunchServiceRow("service-2")).toBeInTheDocument();
  });

  it("uses compact radio rows for the single-choice launch Service", async () => {
    const user = userEvent.setup();
    const onSelectLaunchService = vi.fn();

    render(
      <AgentSetupView
        {...buildProps({
          selectedServiceIds: ["service-1", "service-2"],
          additionalServices: [
            { id: "service-2", name: "Worker", description: "Runs jobs" },
          ],
          launchServiceId: "service-1",
          onSelectLaunchService,
        })}
      />,
    );

    const workerRow = getLaunchServiceRow("service-2");
    expect(
      screen.getByRole("radiogroup", { name: "Launch from" }),
    ).toBeInTheDocument();
    expect(workerRow).toHaveStyle({ height: "40px", maxHeight: "40px" });
    expect(
      within(getLaunchServiceRow("service-1")).getByRole("radio"),
    ).toBeChecked();
    expect(within(workerRow).getByRole("radio")).not.toBeChecked();
    expect(within(workerRow).queryByRole("checkbox")).not.toBeInTheDocument();

    await user.click(workerRow);

    expect(onSelectLaunchService).toHaveBeenCalledWith("service-2");
  });

  it("keeps Quick available and routes its selection through the existing method value", async () => {
    const user = userEvent.setup();
    const onSelectSessionMethod = vi.fn();

    render(<AgentSetupView {...buildProps({ onSelectSessionMethod })} />);

    await user.click(screen.getByTestId("coding-method-card-quick"));

    expect(onSelectSessionMethod).toHaveBeenCalledWith("quick");
  });

  it("renders only methods allowed by the resolved work-item type", () => {
    render(
      <AgentSetupView
        {...buildProps({ compatibleSessionMethods: ["research"] })}
      />,
    );

    expect(
      screen.getByTestId("coding-method-card-research"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("coding-method-card-plan"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Work")).not.toBeInTheDocument();
    expect(screen.queryByText("Split")).not.toBeInTheDocument();
  });

  it("shows the validation action as a separate launch path", () => {
    render(<AgentSetupView {...buildProps({ sessionMethod: "validation" })} />);

    expect(
      screen.getByTestId("coding-setup-start-validation-button"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("prompt-editor")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Next" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
  });

  it("shows a Plan's branch as the locked Work in choice", () => {
    render(
      <AgentSetupView
        {...buildProps({
          lockedWorktreeBranch: "plan/shared-worktree",
          servicePlaces: { status: "idle" },
        })}
      />,
    );

    expect(screen.getByLabelText("Work in")).toBeDisabled();
    expect(screen.getByLabelText("Work in")).toHaveValue(
      "Plan branch: plan/shared-worktree",
    );
    expect(
      screen.queryByTestId("coding-work-in-per-service-toggle"),
    ).not.toBeInTheDocument();
  });

  it("offers one Work in choice defaulting to the main folder's branch", () => {
    render(<AgentSetupView {...buildProps()} />);

    expect(screen.getAllByTestId("work-in")).toHaveLength(1);
    expect(screen.getByTestId("work-in-select")).toHaveTextContent(
      "Current: dev (main folder)",
    );
    expect(
      screen.queryByRole("switch", { name: "Enable worktree" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coding-repository-path-service-1"),
    ).not.toBeInTheDocument();
  });

  it("shows a Work in choice for each selected Service when choosing per Service", () => {
    render(
      <AgentSetupView
        {...buildProps({
          selectedServiceIds: ["service-1", "service-2"],
          additionalServices: [{ id: "service-2", name: "Worker" }],
          perServicePlaceChoices: {},
        })}
      />,
    );

    const selects = screen.getAllByTestId("work-in");
    expect(selects.map((select) => select.dataset.serviceId)).toEqual([
      "service-1",
      "service-2",
    ]);
  });

  it("turns on per-Service choices from Advanced", async () => {
    const user = userEvent.setup();
    const onTogglePerServicePlaces = vi.fn();
    render(<AgentSetupView {...buildProps({ onTogglePerServicePlaces })} />);

    await user.click(screen.getByText("Advanced"));
    await user.click(
      screen.getByRole("switch", { name: "Choose per Service" }),
    );

    expect(onTogglePerServicePlaces).toHaveBeenCalledWith(true);
  });

  it("greys out a Service without a repository path and offers to set one", async () => {
    const user = userEvent.setup();
    const onToggleService = vi.fn();
    render(
      <AgentSetupView
        {...buildProps({
          onToggleService,
          additionalServices: [{ id: "service-2", name: "Worker" }],
          repositoryPaths: { "service-1": "/repos/api" },
        })}
      />,
    );

    const row = getServiceRow("service-2");
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(within(row).getByRole("checkbox")).toBeDisabled();
    await user.click(row);
    expect(onToggleService).not.toHaveBeenCalled();
    expect(screen.getByTestId("coding-service-no-path")).toHaveAttribute(
      "data-service-id",
      "service-2",
    );
    expect(
      screen.getByTestId("directory-binding-control-service-2"),
    ).toHaveTextContent("Set repository path");
  });

  it("shows a Service's repository path with Update directory", () => {
    render(
      <AgentSetupView
        {...buildProps({ repositoryPaths: { "service-1": "/repos/api" } })}
      />,
    );

    expect(screen.getByTestId("coding-service-path")).toHaveTextContent(
      "/repos/api",
    );
    expect(
      screen.getByTestId("directory-binding-control-service-1"),
    ).toHaveTextContent("Update directory");
  });

  it("hides the Service search at 9 Services and shows it at 10", () => {
    const { rerender } = render(
      <AgentSetupView
        {...buildProps({ additionalServices: manyServices(8) })}
      />,
    ); // 1 primary + 8 additional = 9
    expect(screen.queryByLabelText("Search services")).not.toBeInTheDocument();

    rerender(
      <AgentSetupView
        {...buildProps({ additionalServices: manyServices(9) })}
      />,
    ); // 1 primary + 9 additional = 10
    expect(screen.getByLabelText("Search services")).toBeInTheDocument();
  });

  it("offers no provider or model until a machine's CLI catalog is available", () => {
    resetCapabilityCatalogForTests();
    render(
      <AgentSetupView
        {...buildProps({
          catalogSource: null,
          promptProvider: null,
          promptModel: null,
          promptReasoningEffort: null,
          selectedMachineId: null,
        })}
      />,
    );

    expect(
      screen.getByTestId("coding-agent-catalog-machine-required"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("coding-agent-provider-select"),
    ).not.toBeInTheDocument();
  });

  it("shows the auto-resolved sole ready machine as read-only", () => {
    render(<AgentSetupView {...buildProps()} />);

    expect(
      within(screen.getByTestId("machine-picker")).getByRole("combobox"),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps the picker available when a sole ready machine needs explicit reselection", () => {
    render(
      <AgentSetupView
        {...buildProps({
          machines: [
            machine("machine-ready", MachineExecutionReadinessState.Ready),
            machine(
              "machine-disconnected",
              MachineExecutionReadinessState.Disconnected,
            ),
          ],
          machineMode: "one",
          selectedMachineId: null,
        })}
      />,
    );

    expect(screen.getByTestId("machine-picker")).toBeInTheDocument();
  });

  it("renders the machine picker in the runtime configuration for multiple ready machines", () => {
    render(
      <AgentSetupView
        {...buildProps({
          machines: [
            machine("machine-1", MachineExecutionReadinessState.Ready),
            machine("machine-2", MachineExecutionReadinessState.Ready),
          ],
          machineMode: "many",
          selectedMachineId: null,
        })}
      />,
    );

    const runtimeConfiguration = screen.getByTestId(
      "coding-runtime-configuration",
    );
    const machineSelection = within(runtimeConfiguration).getByTestId(
      "coding-agent-machine-selection",
    );
    const machinePicker =
      within(machineSelection).getByTestId("machine-picker");
    const promptEditor = screen.getByTestId("prompt-editor");

    expect(
      runtimeConfiguration.compareDocumentPosition(promptEditor) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      machinePicker.compareDocumentPosition(promptEditor) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows no-machine readiness guidance and keeps launch unavailable", () => {
    render(
      <AgentSetupView
        {...buildProps({
          machines: [],
          machineMode: "zero",
          selectedMachineId: null,
          recoveryState: { type: "no_paired_machines" },
          canStartCoding: false,
        })}
      />,
    );

    expect(screen.queryByTestId("machine-picker")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("coding-agent-machine-readiness-notice"),
    ).toHaveTextContent("Pair an Agent Bridge");
  });

  it("puts sole-ineligible machine guidance behind its picker action", () => {
    render(
      <AgentSetupView
        {...buildProps({
          machines: [
            machine(
              "machine-legacy",
              MachineExecutionReadinessState.LegacyProtocol,
            ),
          ],
          machineMode: "zero",
          selectedMachineId: null,
          recoveryState: {
            type: "paired_none_ready",
            machines: [
              {
                type: "legacy_protocol",
                machine: machine(
                  "machine-legacy",
                  MachineExecutionReadinessState.LegacyProtocol,
                ),
              },
            ],
          },
          canStartCoding: false,
        })}
      />,
    );

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "CLI machine" }));

    expect(
      screen.queryByTestId("coding-agent-machine-readiness-notice"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("machine-picker-option"));
    expect(
      screen.getByRole("dialog", {
        name: "CLI update required — machine-legacy",
      }),
    ).toBeInTheDocument();
  });
});
