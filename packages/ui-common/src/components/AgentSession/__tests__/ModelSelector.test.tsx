import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type MachineDto,
} from "../../../api";
import { ConversationStartRunRequestDtoProviderEnum } from "../../../api";
import { setCapabilityCatalogForTests } from "../capabilityCatalog";
import { TEST_CAPABILITY_CATALOG } from "../../../test/capabilityCatalogFixture";
import { ModelSelector, type ModelSelectorProps } from "../ModelSelector";

const readyMachine: MachineDto = {
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

const buildProps = (
  overrides: Partial<ModelSelectorProps> = {},
): ModelSelectorProps => ({
  provider: ConversationStartRunRequestDtoProviderEnum.Claude,
  model: "claude-opus-5-5",
  reasoningEffort: "medium",
  onProviderChange: vi.fn(),
  onModelChange: vi.fn(),
  onReasoningEffortChange: vi.fn(),
  fastMode: false,
  onFastModeChange: vi.fn(),
  favorites: [],
  onSaveFavorite: vi.fn(() => ({ ok: true })),
  onApplyFavorite: vi.fn(),
  onRenameFavorite: vi.fn(() => ({ ok: true })),
  onDeleteFavorite: vi.fn(),
  testIdPrefix: "model-selector",
  ...overrides,
});

const openSelect = async (testId: string) => {
  const user = userEvent.setup();
  const select = screen.getByTestId(testId);
  // MUI Select and Autocomplete both expose their interactive control as a combobox.
  const button = within(select).getByRole("combobox");
  await user.click(button);
  return user;
};

const generatedStylesFor = (element: HTMLElement) => {
  const classNames = element.className.split(/\s+/).filter(Boolean);
  return [...document.querySelectorAll("style")]
    .map((style) => style.textContent ?? "")
    .filter((text) =>
      classNames.some((className) => text.includes(`.${className}`)),
    )
    .join("\n");
};

describe("ModelSelector", () => {
  beforeEach(() => {
    localStorage.clear();
    setCapabilityCatalogForTests(TEST_CAPABILITY_CATALOG);
  });

  afterEach(() => localStorage.clear());

  it("renders each provider option with its icon in the open menu", async () => {
    render(<ModelSelector {...buildProps()} />);
    await openSelect("model-selector-provider-select");

    const claudeOption = screen.getByTestId(
      "model-selector-provider-option-claude",
    );
    const codexOption = screen.getByTestId(
      "model-selector-provider-option-codex",
    );
    const opencodeOption = screen.getByTestId(
      "model-selector-provider-option-opencode",
    );

    expect(
      within(claudeOption).getByLabelText("Claude Code"),
    ).toBeInTheDocument();
    expect(within(codexOption).getByLabelText("Codex")).toBeInTheDocument();
    expect(
      within(opencodeOption).getByLabelText("Opencode"),
    ).toBeInTheDocument();
  });

  it("renders the controlled provider, model, and effort values", () => {
    render(
      <ModelSelector
        {...buildProps({
          provider: ConversationStartRunRequestDtoProviderEnum.Claude,
          model: "claude-sonnet-5-5",
          reasoningEffort: "high",
        })}
      />,
    );

    expect(
      within(screen.getByTestId("model-selector-provider-select")).getByText(
        "Claude Code",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("model-selector-model-input")).toHaveValue(
      "Sonnet 5.5",
    );
    expect(
      within(screen.getByTestId("model-selector-effort-select")).getByText(
        "High",
      ),
    ).toBeInTheDocument();
  });

  it.each([
    {
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      currentModel: "claude-opus-5-5",
      currentEffort: "high" as const,
      search: "Fable 5.1",
      targetModel: "claude-fable-5-1",
      targetEffort: "high" as const,
    },
    {
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      currentModel: "gpt-5.6-sol",
      currentEffort: "medium" as const,
      search: "GPT 6.1 Sol",
      targetModel: "gpt-6.1-sol",
      targetEffort: "medium" as const,
    },
    {
      provider: ConversationStartRunRequestDtoProviderEnum.Opencode,
      currentModel: "glm-5.3",
      currentEffort: "high" as const,
      search: "Kimi K3",
      targetModel: "kimi-k3",
      targetEffort: "max" as const,
    },
  ])(
    "filters the $provider catalog and selects its model identity",
    async ({
      provider,
      currentModel,
      currentEffort,
      search,
      targetModel,
      targetEffort,
    }) => {
      const user = userEvent.setup();
      const onModelChange = vi.fn();
      const onReasoningEffortChange = vi.fn();
      render(
        <ModelSelector
          {...buildProps({
            provider,
            model: currentModel,
            reasoningEffort: currentEffort,
            onModelChange,
            onReasoningEffortChange,
          })}
        />,
      );

      const input = screen.getByTestId("model-selector-model-input");
      await user.clear(input);
      await user.type(input, search);

      const matchingOption = screen.getByRole("option", { name: search });
      expect(matchingOption).toHaveAttribute(
        "data-testid",
        `model-selector-model-option-${targetModel}`,
      );
      expect(screen.getAllByRole("option")).toHaveLength(1);

      await user.click(matchingOption);

      expect(onModelChange).toHaveBeenCalledWith(targetModel);
      if (targetEffort !== currentEffort) {
        expect(onReasoningEffortChange).toHaveBeenCalledWith(targetEffort);
      } else {
        expect(onReasoningEffortChange).not.toHaveBeenCalled();
      }
    },
  );

  it("leaves selection persistence to its consumer", async () => {
    render(<ModelSelector {...buildProps()} />);
    const user = await openSelect("model-selector-model-select");
    await user.click(screen.getByText("Sonnet 5.5"));

    expect(
      Object.keys(localStorage).filter((key) =>
        key.startsWith("hey-hey:agent-selection:"),
      ),
    ).toEqual([]);
  });

  it("places Favorite between Provider and Model and keeps the save slot last", () => {
    render(<ModelSelector {...buildProps()} />);

    const controls = screen.getByTestId("model-selector-controls");
    expect(
      within(controls)
        .getAllByRole("combobox")
        .map((combobox) => combobox.getAttribute("aria-labelledby")),
    ).toEqual([
      "model-selector-provider-label",
      "model-selector-favorite-label",
      null,
      "model-selector-effort-label",
    ]);
    expect(
      within(controls).getByRole("combobox", { name: "Model" }),
    ).toBeInTheDocument();
    expect(controls.lastElementChild).toBe(
      screen.getByTestId("model-selector-favorite-save-slot"),
    );
    expect(
      document.getElementById("model-selector-favorite-label"),
    ).toHaveAttribute("data-shrink", "true");
    expect(screen.getByTestId("model-selector-favorite-save-slot")).toHaveStyle(
      {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      },
    );
  });

  it("shows an exact full-configuration favorite or Custom", () => {
    const favorite = {
      id: "favorite-1" as never,
      name: "Fast GPT",
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.6-sol",
      reasoningEffort: "high" as const,
      serviceTier: "priority" as const,
    };
    const { rerender } = render(
      <ModelSelector
        {...buildProps({
          provider: ConversationStartRunRequestDtoProviderEnum.Codex,
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          favorites: [favorite],
        })}
        fastMode
        onFastModeChange={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("model-selector-favorite-select"),
    ).toHaveTextContent("Fast GPT");
    expect(
      screen.queryByTestId("model-selector-favorite-save"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("model-selector-favorite-save-slot"),
    ).toBeInTheDocument();

    rerender(
      <ModelSelector
        {...buildProps({
          provider: ConversationStartRunRequestDtoProviderEnum.Codex,
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          favorites: [favorite],
        })}
        fastMode={false}
        onFastModeChange={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("model-selector-favorite-select"),
    ).toHaveTextContent("Custom");
    expect(
      screen.getByTestId("model-selector-favorite-save"),
    ).toHaveAccessibleName("Save as favorite");
    expect(screen.getByTestId("model-selector-favorite-save")).toHaveClass(
      "MuiIconButton-colorPrimary",
    );
  });

  it("surfaces favorite naming errors and leaves deletion selection-neutral", async () => {
    const user = userEvent.setup();
    const onSaveFavorite = vi.fn(() => ({
      ok: false as const,
      reason: "duplicate-name" as const,
    }));
    const onDeleteFavorite = vi.fn();
    const favorite = {
      id: "favorite-1" as never,
      name: "Daily",
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      model: "claude-sonnet-5-5",
      reasoningEffort: "medium" as const,
    };
    const onProviderChange = vi.fn();
    render(
      <ModelSelector
        {...buildProps({
          favorites: [favorite],
          onSaveFavorite,
          onDeleteFavorite,
          onProviderChange,
        })}
      />,
    );

    await user.click(screen.getByTestId("model-selector-favorite-save"));
    await user.type(screen.getByLabelText("Favorite name"), "daily");
    await user.click(
      screen.getByTestId("model-selector-favorite-dialog-submit"),
    );
    expect(
      screen.getByText("A favorite with this name already exists."),
    ).toBeVisible();

    await user.click(screen.getByText("Cancel"));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Save favorite" }),
      ).toBeNull(),
    );
    await user.click(screen.getByRole("combobox", { name: "Favorite" }));
    await user.click(screen.getByTestId("model-selector-favorite-manage"));
    await user.click(screen.getByTestId("model-selector-favorite-delete"));
    expect(onDeleteFavorite).toHaveBeenCalledWith(favorite.id);
    expect(onProviderChange).not.toHaveBeenCalled();
  });

  it("keeps an explicitly selected favorite addressable when configurations match", async () => {
    const user = userEvent.setup();
    const firstFavorite = {
      id: "favorite-1" as never,
      name: "Daily",
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      model: "claude-opus-5-5",
      reasoningEffort: "medium" as const,
    };
    const secondFavorite = {
      ...firstFavorite,
      id: "favorite-2" as never,
      name: "Review",
    };
    const onDeleteFavorite = vi.fn();
    render(
      <ModelSelector
        {...buildProps({
          favorites: [firstFavorite, secondFavorite],
          onDeleteFavorite,
        })}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Favorite" }));
    await user.click(screen.getByRole("option", { name: "Review" }));

    expect(
      screen.getByTestId("model-selector-favorite-select"),
    ).toHaveTextContent("Review");
    await user.click(screen.getByRole("combobox", { name: "Favorite" }));
    await user.click(screen.getByTestId("model-selector-favorite-manage"));
    await user.click(
      screen.getAllByTestId("model-selector-favorite-delete")[1],
    );
    expect(onDeleteFavorite).toHaveBeenCalledWith(secondFavorite.id);
  });

  it("on provider change to Codex, cascades to first model and a valid effort", async () => {
    const onProviderChange = vi.fn();
    const onModelChange = vi.fn();
    const onReasoningEffortChange = vi.fn();

    render(
      <ModelSelector
        {...buildProps({
          provider: ConversationStartRunRequestDtoProviderEnum.Claude,
          model: "claude-opus-5-5",
          reasoningEffort: "max",
          onProviderChange,
          onModelChange,
          onReasoningEffortChange,
        })}
      />,
    );

    const user = await openSelect("model-selector-provider-select");
    await user.click(
      screen.getByTestId("model-selector-provider-option-codex"),
    );

    expect(onProviderChange).toHaveBeenCalledWith(
      ConversationStartRunRequestDtoProviderEnum.Codex,
    );
    expect(onModelChange).toHaveBeenCalledWith("gpt-5.6-sol");
    expect(onReasoningEffortChange).not.toHaveBeenCalled();
  });

  it("on provider change to Opencode, cascades to first model and null effort", async () => {
    const onProviderChange = vi.fn();
    const onModelChange = vi.fn();
    const onReasoningEffortChange = vi.fn();

    render(
      <ModelSelector
        {...buildProps({
          provider: ConversationStartRunRequestDtoProviderEnum.Claude,
          model: "claude-opus-5-5",
          reasoningEffort: "high",
          onProviderChange,
          onModelChange,
          onReasoningEffortChange,
        })}
      />,
    );

    const user = await openSelect("model-selector-provider-select");
    await user.click(
      screen.getByTestId("model-selector-provider-option-opencode"),
    );

    expect(onProviderChange).toHaveBeenCalledWith(
      ConversationStartRunRequestDtoProviderEnum.Opencode,
    );
    expect(onModelChange).toHaveBeenCalledWith("glm-5.3");
    // GLM-5.3 also offers "high", so the current effort is kept.
    expect(onReasoningEffortChange).not.toHaveBeenCalled();
  });

  it("changing model to one whose efforts list excludes the current effort resets the effort", async () => {
    const onReasoningEffortChange = vi.fn();
    const onModelChange = vi.fn();

    render(
      <ModelSelector
        {...buildProps({
          provider: ConversationStartRunRequestDtoProviderEnum.Opencode,
          model: "glm-5.3",
          reasoningEffort: "high",
          onModelChange,
          onReasoningEffortChange,
        })}
      />,
    );

    const user = await openSelect("model-selector-model-select");
    await user.click(screen.getByTestId("model-selector-model-option-kimi-k3"));

    expect(onModelChange).toHaveBeenCalledWith("kimi-k3");
    // Kimi K3 only supports "max", so reset the unsupported "high" effort.
    expect(onReasoningEffortChange).toHaveBeenCalledWith("max");
  });

  it("preserves max effort when switching from Sonnet to Haiku 5.5", async () => {
    const onReasoningEffortChange = vi.fn();
    const onModelChange = vi.fn();

    render(
      <ModelSelector
        {...buildProps({
          provider: ConversationStartRunRequestDtoProviderEnum.Claude,
          model: "claude-sonnet-5-5",
          reasoningEffort: "max",
          onModelChange,
          onReasoningEffortChange,
        })}
      />,
    );

    const user = await openSelect("model-selector-model-select");
    await user.click(
      screen.getByTestId("model-selector-model-option-claude-haiku-5-5"),
    );

    expect(onModelChange).toHaveBeenCalledWith("claude-haiku-5-5");
    // The current effort is supported by both models.
    expect(onReasoningEffortChange).not.toHaveBeenCalled();
  });

  it("keeps a no-effort OpenCode selection usable and cascades when switching providers", async () => {
    const props = buildProps({
      provider: ConversationStartRunRequestDtoProviderEnum.Opencode,
      model: "opencode-default",
      reasoningEffort: null,
    });
    const { rerender } = render(<ModelSelector {...props} />);

    expect(
      screen.getByTestId("model-selector-provider-select"),
    ).toHaveTextContent("Opencode");
    expect(screen.getByTestId("model-selector-model-input")).toHaveValue(
      "Default",
    );
    expect(
      screen.queryByTestId("model-selector-effort-select"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("model-selector-selection-unavailable"),
    ).not.toBeInTheDocument();

    const user = await openSelect("model-selector-provider-select");
    await user.click(
      screen.getByTestId("model-selector-provider-option-codex"),
    );

    expect(props.onProviderChange).toHaveBeenCalledWith(
      ConversationStartRunRequestDtoProviderEnum.Codex,
    );
    expect(props.onModelChange).toHaveBeenCalledWith("gpt-5.6-sol");
    expect(props.onReasoningEffortChange).toHaveBeenCalledWith("low");

    rerender(
      <ModelSelector
        {...props}
        provider={ConversationStartRunRequestDtoProviderEnum.Codex}
        model="gpt-5.6-sol"
        reasoningEffort="low"
      />,
    );
    expect(
      screen.getByTestId("model-selector-provider-select"),
    ).toHaveTextContent("Codex");
    expect(
      screen.getByTestId("model-selector-effort-select"),
    ).toHaveTextContent("Low");
  });

  it("renders a controlled Fast mode switch only for supported catalog selections", async () => {
    const onFastModeChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <ModelSelector
        {...buildProps({
          provider: ConversationStartRunRequestDtoProviderEnum.Codex,
          model: "gpt-5.6-sol",
          reasoningEffort: "medium",
        })}
        fastMode={false}
        onFastModeChange={onFastModeChange}
      />,
    );

    await user.click(screen.getByTestId("model-selector-fast-mode-switch"));
    expect(onFastModeChange).toHaveBeenCalledWith(true);

    rerender(
      <ModelSelector
        {...buildProps({
          provider: ConversationStartRunRequestDtoProviderEnum.Claude,
          model: "claude-opus-5-5",
          reasoningEffort: "medium",
        })}
        fastMode={false}
        onFastModeChange={onFastModeChange}
      />,
    );
    expect(
      screen.getByTestId("model-selector-fast-mode-switch"),
    ).toBeInTheDocument();

    rerender(
      <ModelSelector
        {...buildProps({
          provider: ConversationStartRunRequestDtoProviderEnum.Claude,
          model: "claude-opus-5",
          reasoningEffort: "medium",
        })}
        fastMode={false}
        onFastModeChange={onFastModeChange}
      />,
    );
    expect(
      screen.getByTestId("model-selector-fast-mode-switch"),
    ).toBeInTheDocument();

    rerender(
      <ModelSelector
        {...buildProps({
          provider: ConversationStartRunRequestDtoProviderEnum.Claude,
          model: "claude-sonnet-5-5",
          reasoningEffort: "medium",
        })}
        fastMode={false}
        onFastModeChange={onFastModeChange}
      />,
    );
    expect(
      screen.queryByTestId("model-selector-fast-mode-switch"),
    ).not.toBeInTheDocument();
  });

  it("renders Fast mode below the provider, model, and effort controls", () => {
    render(
      <ModelSelector
        {...buildProps({
          provider: ConversationStartRunRequestDtoProviderEnum.Codex,
          model: "gpt-5.6-sol",
          reasoningEffort: "medium",
        })}
        fastMode={false}
        onFastModeChange={vi.fn()}
      />,
    );

    const controls = screen.getByTestId("model-selector-controls");
    const fastModeSwitch = screen.getByTestId(
      "model-selector-fast-mode-switch",
    );

    expect(controls).toContainElement(
      screen.getByTestId("model-selector-provider-select"),
    );
    expect(controls).toContainElement(
      screen.getByTestId("model-selector-model-select"),
    );
    expect(controls).toContainElement(
      screen.getByTestId("model-selector-effort-select"),
    );
    expect(
      fastModeSwitch.closest('[data-testid="model-selector-controls"]'),
    ).toBeNull();
    expect(screen.getByTestId("model-selector-root")).toContainElement(
      fastModeSwitch,
    );
  });

  it("clears Fast mode when a provider change removes support", async () => {
    const onFastModeChange = vi.fn();
    const onModelChange = vi.fn();
    render(
      <ModelSelector
        {...buildProps({
          provider: ConversationStartRunRequestDtoProviderEnum.Codex,
          model: "gpt-5.6-sol",
          reasoningEffort: "medium",
          onModelChange,
        })}
        fastMode
        onFastModeChange={onFastModeChange}
      />,
    );

    const user = await openSelect("model-selector-provider-select");
    await user.click(
      screen.getByTestId("model-selector-provider-option-opencode"),
    );

    expect(onFastModeChange).toHaveBeenCalledWith(false);
  });

  it("clears Fast mode when switching from a supported Claude model to an unsupported one", async () => {
    const onFastModeChange = vi.fn();
    const onModelChange = vi.fn();
    render(
      <ModelSelector
        {...buildProps({
          provider: ConversationStartRunRequestDtoProviderEnum.Claude,
          model: "claude-opus-5-5",
          reasoningEffort: "medium",
          onModelChange,
        })}
        fastMode
        onFastModeChange={onFastModeChange}
      />,
    );

    const user = await openSelect("model-selector-model-select");
    await user.click(
      screen.getByTestId("model-selector-model-option-claude-sonnet-5-5"),
    );

    expect(onModelChange).toHaveBeenCalledWith("claude-sonnet-5-5");
    expect(onFastModeChange).toHaveBeenCalledWith(false);
  });

  it("renders controlled machine routing inside the model selector surface", () => {
    render(
      <ModelSelector
        {...buildProps({
          machineSelection: {
            machines: [
              readyMachine,
              { ...readyMachine, machineId: "machine-2" },
            ],
            machineMode: "many",
            selectedMachineId: null,
            onSelectMachine: vi.fn(),
            recoveryState: { type: "multiple_ready", machines: [readyMachine] },
          },
        })}
      />,
    );

    const root = screen.getByTestId("model-selector-root");
    expect(root).toContainElement(screen.getByTestId("machine-picker"));
    expect(
      within(root).getByTestId("model-selector-machine-selection"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("machine-picker-reason"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("machine-picker")).getByRole("combobox"),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("omits redundant controls for a selected sole machine", () => {
    render(
      <ModelSelector
        {...buildProps({
          machineSelection: {
            machines: [readyMachine],
            machineMode: "one",
            selectedMachineId: readyMachine.machineId,
            onSelectMachine: vi.fn(),
            recoveryState: { type: "ready", machine: readyMachine },
          },
        })}
      />,
    );

    expect(screen.queryByTestId("machine-picker")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("model-selector-machine-readiness-notice"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("model-selector-machine-selection"),
    ).toBeInTheDocument();
  });

  it("keeps empty machine recovery in the readiness notice", () => {
    render(
      <ModelSelector
        {...buildProps({
          machineSelection: {
            machines: [],
            machineMode: "zero",
            selectedMachineId: null,
            onSelectMachine: vi.fn(),
            recoveryState: { type: "no_machines" },
          },
        })}
      />,
    );

    expect(screen.queryByTestId("machine-picker")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("model-selector-machine-readiness-notice"),
    ).toBeVisible();
  });

  it("chooses the most detailed complete presentation and keeps the minimal editor controlled", async () => {
    const resizeCallbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const originalClientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth",
    );
    const originalScrollWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollWidth",
    );
    let availableWidth = 150;
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return (this as HTMLElement).dataset.testid === "model-selector-root"
          ? availableWidth
          : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        const testId = (this as HTMLElement).dataset.testid;
        if (testId === "model-selector-full-measure") return 900;
        if (testId === "model-selector-chips-measure") return 400;
        return 0;
      },
    });
    const onModelChange = vi.fn();
    const favorite = {
      id: "favorite-1" as never,
      name: "Review setup",
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      model: "claude-opus-5-5",
      reasoningEffort: "medium" as const,
    };

    const initialProps = buildProps({
      favorites: [favorite],
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      model: "claude-opus-5-5",
      reasoningEffort: "medium",
      onModelChange,
      machineSelection: {
        machines: [readyMachine],
        machineMode: "one",
        selectedMachineId: "machine-1",
        onSelectMachine: vi.fn(),
        recoveryState: { type: "ready", machine: readyMachine },
      },
    });
    const { rerender } = render(<ModelSelector {...initialProps} />);

    const summary = screen.getByTestId("model-selector-minimal-summary");
    expect(
      within(summary).getByRole("img", { name: "Claude Code" }),
    ).toBeVisible();
    expect(summary).not.toHaveTextContent("Claude Code");
    expect(summary).not.toHaveTextContent("Review setup");
    expect(summary).toHaveTextContent(/^Opus/);
    expect(summary).not.toHaveTextContent("Medium");
    expect(summary).not.toHaveTextContent("Ready machine — Ready");
    expect(
      screen.queryByTestId("model-selector-controls"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("machine-picker")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByTestId("model-selector-minimal-edit"));

    const editorDialog = screen.getByRole("dialog", {
      name: "Edit model selection",
    });
    expect(editorDialog).toBeInTheDocument();
    const editorDialogContent = editorDialog.querySelector(
      ".MuiDialogContent-root",
    );
    expect(editorDialogContent).toBeInstanceOf(HTMLElement);
    expect(generatedStylesFor(editorDialogContent as HTMLElement)).toContain(
      "padding-top:12px",
    );
    expect(screen.getByTestId("model-selector-controls")).toBeInTheDocument();
    expect(screen.getByTestId("model-selector-provider-select")).toBeVisible();
    expect(screen.queryByTestId("machine-picker")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("model-selector-machine-readiness-notice"),
    ).not.toBeInTheDocument();

    await openSelect("model-selector-model-select");
    await user.click(screen.getByRole("option", { name: "Sonnet 5.5" }));
    expect(onModelChange).toHaveBeenCalledWith("claude-sonnet-5-5");

    rerender(<ModelSelector {...initialProps} model="claude-sonnet-5-5" />);
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(
      screen.getByTestId("model-selector-minimal-summary"),
    ).toHaveTextContent("Sonnet 5.5");
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Edit model selection" }),
      ).not.toBeInTheDocument();
    });

    availableWidth = 500;
    act(() => {
      resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver));
    });
    await waitFor(() =>
      expect(screen.getByTestId("model-selector-root")).toHaveAttribute(
        "data-presentation",
        "chips",
      ),
    );
    expect(
      screen.getByTestId("model-selector-chips-summary"),
    ).toHaveTextContent("Medium");

    availableWidth = 1000;
    act(() => {
      resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver));
    });
    await waitFor(() =>
      expect(screen.getByTestId("model-selector-root")).toHaveAttribute(
        "data-presentation",
        "full",
      ),
    );
    expect(screen.getByTestId("model-selector-controls")).toBeVisible();

    if (originalClientWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "clientWidth",
        originalClientWidth,
      );
    }
    if (originalScrollWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollWidth",
        originalScrollWidth,
      );
    }
    vi.unstubAllGlobals();
  });

  it("does not expose controls when an offered effort is missing", () => {
    render(<ModelSelector {...buildProps({ reasoningEffort: null })} />);

    expect(
      screen.getByTestId("model-selector-selection-unavailable"),
    ).toHaveTextContent(
      "selected provider, model, or reasoning effort is not available",
    );
    expect(
      screen.queryByTestId("model-selector-provider-select"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("model-selector-model-select"),
    ).not.toBeInTheDocument();
  });

  it("does not treat an unknown model as a valid no-effort selection", () => {
    render(
      <ModelSelector
        {...buildProps({
          provider: ConversationStartRunRequestDtoProviderEnum.Opencode,
          model: "removed-model",
          reasoningEffort: null,
        })}
      />,
    );

    expect(
      screen.getByTestId("model-selector-selection-unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("model-selector-provider-select"),
    ).not.toBeInTheDocument();
  });

  it("renders a catalog-valid Fast-mode-capable selection", () => {
    render(
      <ModelSelector
        {...buildProps({
          provider: ConversationStartRunRequestDtoProviderEnum.Codex,
          model: "gpt-5.6-sol",
        })}
      />,
    );

    expect(
      screen.getByTestId("model-selector-fast-mode-switch"),
    ).toBeInTheDocument();
  });
});
