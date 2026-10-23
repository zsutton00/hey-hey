import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type MachineDto,
} from "../../../api";
import { AgentSetupView, type AgentSetupViewProps } from "../AgentSetupView";

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("../PromptEditor", () => ({
  PromptEditor: () => <div data-testid="prompt-editor" />,
}));

vi.mock("../../Services/ServiceDirectoryBindingControl", () => ({
  ServiceDirectoryBindingControl: ({ serviceId }: { serviceId: string }) => (
    <div data-testid={`directory-binding-control-${serviceId}`} />
  ),
}));

const readyMachine: MachineDto = {
  machineId: "machine-1",
  name: "machine-1",
  pairedAt: "2026-08-13T00:00:00.000Z",
  active: true,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness: MachineExecutionReadinessState.Ready,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
  bindings: [],
};

const buildProps = (
  overrides: Partial<AgentSetupViewProps> = {},
): AgentSetupViewProps => ({
  step: "selection",
  primaryServices: [],
  additionalServices: [],
  loadingServices: false,
  servicesError: null,
  selectedServiceId: null,
  selectedServiceIds: [],
  isMultiServiceMode: false,
  serviceSelectionLocked: false,
  onSelectService: vi.fn(),
  onToggleService: vi.fn(),
  onContinueToSelection: vi.fn(),
  onBackToSessionMethod: vi.fn(),
  sessionMethod: "plan",
  onSelectSessionMethod: vi.fn(),
  compatibleSessionMethods: ["plan"],
  projectModeCatalog: [],
  projectModeCatalogLoading: false,
  projectModeCatalogError: null,
  projectModeSelection: null,
  onSelectProjectMode: vi.fn(),
  recoveryState: { type: "ready", machine: readyMachine },
  repositoryPath: null,
  directoryPaths: {},
  worktreeBranch: null,
  worktreeLocked: false,
  setWorktreeBranch: vi.fn(),
  launchServiceId: null,
  onSelectLaunchService: vi.fn(),
  hasActiveRun: false,
  canStartCoding: false,
  startingValidation: false,
  promptDraft: "",
  onPromptDraftChange: vi.fn(),
  onSubmitPrompt: vi.fn(),
  onBackToSelection: vi.fn(),
  submittingPrompt: false,
  launchErrorMessages: [],
  catalogSource: null,
  promptProvider: "claude",
  promptModel: null,
  promptReasoningEffort: null,
  promptFastMode: false,
  onPromptProviderChange: vi.fn(),
  onPromptModelChange: vi.fn(),
  onPromptReasoningEffortChange: vi.fn(),
  onPromptFastModeChange: vi.fn(),
  machines: [readyMachine],
  machineMode: "one",
  selectedMachineId: "machine-1",
  onSelectMachine: vi.fn(),
  onAddService: vi.fn(),
  ...overrides,
});

describe("AgentSetupView with no Service", () => {
  it("offers an Add a service button instead of an error", async () => {
    const onAddService = vi.fn();
    render(<AgentSetupView {...buildProps({ onAddService })} />);

    expect(screen.getByTestId("coding-setup-no-service")).toHaveTextContent(
      "This project has no Service yet",
    );
    expect(
      screen.queryByText("No services are available for this project."),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("coding-setup-add-service"));
    expect(onAddService).toHaveBeenCalledOnce();
  });

  it("does not repeat machine-readiness guidance in the empty state", () => {
    render(<AgentSetupView {...buildProps()} />);
    const empty = screen.getByTestId("coding-setup-no-service");
    expect(empty).not.toHaveTextContent(/machine|CLI|pair/i);
  });

  it("explains the missing Service without a button when the host cannot open the modal", () => {
    render(<AgentSetupView {...buildProps({ onAddService: null })} />);
    expect(screen.getByTestId("coding-setup-no-service")).toBeInTheDocument();
    expect(
      screen.queryByTestId("coding-setup-add-service"),
    ).not.toBeInTheDocument();
  });

  it("reports a failed Service load instead of offering to add a Service", () => {
    render(
      <AgentSetupView {...buildProps({ servicesError: "Network error" })} />,
    );

    expect(screen.getByTestId("coding-setup-services-error")).toHaveTextContent(
      "Services could not be loaded: Network error",
    );
    expect(
      screen.queryByTestId("coding-setup-no-service"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coding-setup-add-service"),
    ).not.toBeInTheDocument();
  });

  it("keeps listing Services when a background refresh fails after a successful load", () => {
    render(
      <AgentSetupView
        {...buildProps({
          servicesError: "Network error",
          primaryServices: [{ id: "service-1", name: "Billing API" }],
        })}
      />,
    );

    expect(screen.getByTestId("coding-service-row")).toHaveTextContent(
      "Billing API",
    );
    expect(
      screen.queryByTestId("coding-setup-services-error"),
    ).not.toBeInTheDocument();
  });

  it("shows no empty state while Services are loading or once a Service exists", () => {
    const { rerender } = render(
      <AgentSetupView {...buildProps({ loadingServices: true })} />,
    );
    expect(
      screen.queryByTestId("coding-setup-no-service"),
    ).not.toBeInTheDocument();

    rerender(
      <AgentSetupView
        {...buildProps({
          primaryServices: [{ id: "service-1", name: "Billing API" }],
          selectedServiceId: "service-1",
          selectedServiceIds: ["service-1"],
        })}
      />,
    );
    expect(
      screen.queryByTestId("coding-setup-no-service"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("coding-service-row")).toHaveTextContent(
      "Billing API",
    );
  });
});
