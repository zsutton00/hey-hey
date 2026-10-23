import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationStartRunRequestDtoProviderEnum } from "../../../api";
import { fetchRuntimeModelCatalog } from "../../../data/collections/runtimeModelCatalog";
import {
  resetCapabilityCatalogForTests,
  setCapabilityCatalogForTests,
  type RuntimeCapabilityCatalogPayload,
} from "../capabilityCatalog";
import { TEST_CAPABILITY_CATALOG } from "../../../test/capabilityCatalogFixture";
import { RuntimeModelSelector } from "../RuntimeModelSelector";
import {
  resetModelSelectionFavoritesForTests,
  saveModelSelectionFavorite,
} from "../modelSelectionFavorites";

vi.mock("../../../data/collections/runtimeModelCatalog", () => ({
  fetchRuntimeModelCatalog: vi.fn(),
}));

const fetchCatalog = vi.mocked(fetchRuntimeModelCatalog);

const CATALOG_SOURCE = {
  organizationId: "org-1",
  projectId: "project-1",
  machineId: "machine-a",
};

const cliSuccess = (providers: unknown[]) => ({
  id: "request-1",
  response: {
    requestId: "request-1",
    operation: "runtime.model_catalog.get" as const,
    status: "success" as const,
    result: { providers },
  },
});

const buildPayload = (): RuntimeCapabilityCatalogPayload => ({
  providers: [
    {
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      models: [
        {
          id: "runtime-gpt",
          label: "Runtime GPT",
          efforts: ["medium"],
        },
        {
          id: "runtime-other",
          label: "Runtime Other",
          efforts: ["medium"],
        },
      ],
    },
  ],
});

const buildProps = () => ({
  catalogSource: CATALOG_SOURCE,
  provider: ConversationStartRunRequestDtoProviderEnum.Codex,
  model: "runtime-gpt",
  reasoningEffort: "medium" as const,
  onProviderChange: vi.fn(),
  onModelChange: vi.fn(),
  onReasoningEffortChange: vi.fn(),
  fastMode: false,
  onFastModeChange: vi.fn(),
  testIdPrefix: "runtime-model-selector",
});

describe("RuntimeModelSelector", () => {
  beforeEach(() => {
    localStorage.clear();
    resetModelSelectionFavoritesForTests();
    fetchCatalog.mockReset();
    setCapabilityCatalogForTests(TEST_CAPABILITY_CATALOG);
  });

  afterEach(() => {
    cleanup();
    setCapabilityCatalogForTests(TEST_CAPABILITY_CATALOG);
  });

  it("exposes the options the picked machine's CLI reports", async () => {
    resetCapabilityCatalogForTests();
    fetchCatalog.mockResolvedValue(
      cliSuccess(buildPayload().providers as never),
    );

    render(<RuntimeModelSelector {...buildProps()} />);

    expect(
      screen.getByTestId("runtime-model-selector-catalog-loading"),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("runtime-model-selector-catalog-ready"),
    ).toBeInTheDocument();
    expect(fetchCatalog).toHaveBeenCalledWith(CATALOG_SOURCE);
    expect(
      screen.getByTestId("runtime-model-selector-model-input"),
    ).toHaveValue("Runtime GPT");
  });

  it("filters the runtime catalog and forwards the selected model identity", async () => {
    resetCapabilityCatalogForTests();
    fetchCatalog.mockResolvedValue(
      cliSuccess(buildPayload().providers as never),
    );
    const props = buildProps();
    const user = userEvent.setup();

    render(<RuntimeModelSelector {...props} />);
    await screen.findByTestId("runtime-model-selector-catalog-ready");

    const input = screen.getByTestId("runtime-model-selector-model-input");
    await user.clear(input);
    await user.type(input, "Runtime Other");

    const option = screen.getByRole("option", { name: "Runtime Other" });
    expect(option).toHaveAttribute(
      "data-testid",
      "runtime-model-selector-model-option-runtime-other",
    );
    await user.click(option);

    expect(props.onModelChange).toHaveBeenCalledWith("runtime-other");
    expect(props.onReasoningEffortChange).not.toHaveBeenCalled();
  });

  it("asks for a machine instead of offering choices before one is picked", () => {
    resetCapabilityCatalogForTests();

    render(
      <RuntimeModelSelector
        {...buildProps()}
        catalogSource={null}
        provider={null}
        model={null}
        reasoningEffort={null}
      />,
    );

    expect(
      screen.getByTestId("runtime-model-selector-catalog-machine-required"),
    ).toBeInTheDocument();
    expect(fetchCatalog).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("runtime-model-selector-provider-select"),
    ).not.toBeInTheDocument();
  });

  it("shows the CLI's notice when an installed provider reported zero models", async () => {
    resetCapabilityCatalogForTests();
    fetchCatalog.mockResolvedValue(
      cliSuccess([
        {
          provider: ConversationStartRunRequestDtoProviderEnum.Claude,
          models: [],
          notice: "Claude is installed but reported no models.",
        },
        ...buildPayload().providers,
      ]),
    );

    render(<RuntimeModelSelector {...buildProps()} />);

    expect(
      await screen.findByTestId("runtime-model-selector-catalog-notice-claude"),
    ).toHaveTextContent("Claude is installed but reported no models.");
    expect(
      screen.getByTestId("runtime-model-selector-model-input"),
    ).toHaveValue("Runtime GPT");
    expect(
      screen.queryByTestId("runtime-model-selector-provider-option-claude"),
    ).not.toBeInTheDocument();
  });

  it("shows only the notice when no provider can launch a model", async () => {
    resetCapabilityCatalogForTests();
    fetchCatalog.mockResolvedValue(
      cliSuccess([
        {
          provider: ConversationStartRunRequestDtoProviderEnum.Claude,
          models: [],
          notice: "Claude is installed but reported no models.",
        },
      ]),
    );

    render(<RuntimeModelSelector {...buildProps()} />);

    expect(
      await screen.findByTestId("runtime-model-selector-catalog-notice-claude"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("runtime-model-selector-provider-select"),
    ).not.toBeInTheDocument();
  });

  it("passes a no-effort runtime selection through and forwards provider recovery", async () => {
    setCapabilityCatalogForTests([
      {
        provider: ConversationStartRunRequestDtoProviderEnum.Opencode,
        models: [{ id: "runtime-glm", label: "Runtime GLM", efforts: [] }],
      },
      ...buildPayload().providers,
    ]);
    const props = buildProps();
    const { rerender } = render(
      <RuntimeModelSelector
        {...props}
        provider={ConversationStartRunRequestDtoProviderEnum.Opencode}
        model="runtime-glm"
        reasoningEffort={null}
      />,
    );

    expect(
      screen.getByTestId("runtime-model-selector-catalog-ready"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("runtime-model-selector-provider-select"),
    ).toHaveTextContent("Opencode");
    expect(
      screen.getByTestId("runtime-model-selector-model-input"),
    ).toHaveValue("Runtime GLM");
    expect(
      screen.queryByTestId("runtime-model-selector-effort-select"),
    ).not.toBeInTheDocument();
    expect(props.onReasoningEffortChange).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(
      within(
        screen.getByTestId("runtime-model-selector-provider-select"),
      ).getByRole("combobox"),
    );
    await user.click(
      screen.getByTestId("runtime-model-selector-provider-option-codex"),
    );

    expect(props.onProviderChange).toHaveBeenCalledWith(
      ConversationStartRunRequestDtoProviderEnum.Codex,
    );
    expect(props.onModelChange).toHaveBeenCalledWith("runtime-gpt");
    expect(props.onReasoningEffortChange).toHaveBeenCalledWith("medium");

    rerender(<RuntimeModelSelector {...props} />);
    expect(
      screen.getByTestId("runtime-model-selector-model-input"),
    ).toHaveValue("Runtime GPT");
    expect(
      screen.getByTestId("runtime-model-selector-effort-select"),
    ).toHaveTextContent("Medium");
  });

  it("shows the CLI's failure instead of falling back to a built-in list", async () => {
    resetCapabilityCatalogForTests();
    fetchCatalog.mockResolvedValue({
      id: "request-1",
      response: {
        requestId: "request-1",
        operation: "runtime.model_catalog.get",
        status: "error",
        error: { code: "TIMEOUT", message: "The CLI did not answer in time." },
      },
    } as never);

    render(<RuntimeModelSelector {...buildProps()} />);

    expect(
      await screen.findByTestId("runtime-model-selector-catalog-error"),
    ).toHaveTextContent("The CLI did not answer in time.");
    expect(
      screen.queryByTestId("runtime-model-selector-provider-select"),
    ).not.toBeInTheDocument();
  });

  it("reconciles a stale model within the selected provider", async () => {
    setCapabilityCatalogForTests(buildPayload().providers);
    const props = buildProps();

    render(
      <RuntimeModelSelector
        {...props}
        model="bundled-but-not-runtime"
        reasoningEffort="high"
      />,
    );

    expect(
      screen.getByTestId("runtime-model-selector-catalog-ready"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("runtime-model-selector-model-input"),
    ).toHaveValue("Runtime GPT");
    await waitFor(() => {
      expect(props.onModelChange).toHaveBeenCalledWith("runtime-gpt");
      expect(props.onReasoningEffortChange).toHaveBeenCalledWith("medium");
    });
  });

  it("clears only Fast mode when runtime metadata no longer supports it", async () => {
    setCapabilityCatalogForTests(buildPayload().providers);
    const props = buildProps();
    const onFastModeChange = vi.fn();

    render(
      <RuntimeModelSelector
        {...props}
        fastMode
        onFastModeChange={onFastModeChange}
      />,
    );

    await waitFor(() => {
      expect(onFastModeChange).toHaveBeenCalledWith(false);
    });
    expect(props.onProviderChange).not.toHaveBeenCalled();
    expect(props.onModelChange).not.toHaveBeenCalled();
    expect(props.onReasoningEffortChange).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("runtime-model-selector-fast-mode-switch"),
    ).not.toBeInTheDocument();
  });

  it("adopts what the CLI offers when the held provider is not in its catalog", async () => {
    setCapabilityCatalogForTests(buildPayload().providers);
    const props = buildProps();

    render(
      <RuntimeModelSelector
        {...props}
        provider={ConversationStartRunRequestDtoProviderEnum.Claude}
        model="claude-opus-4-7"
      />,
    );

    await waitFor(() => {
      expect(props.onProviderChange).toHaveBeenCalledWith(
        ConversationStartRunRequestDtoProviderEnum.Codex,
      );
      expect(props.onModelChange).toHaveBeenCalledWith("runtime-gpt");
      expect(props.onReasoningEffortChange).toHaveBeenCalledWith("medium");
      expect(props.onFastModeChange).toHaveBeenCalledWith(false);
    });
    expect(
      screen.queryByTestId("runtime-model-selector-provider-select"),
    ).not.toBeInTheDocument();
  });

  it("applies a favorite after repairing stale catalog fields", async () => {
    setCapabilityCatalogForTests(buildPayload().providers);
    saveModelSelectionFavorite("Repaired", {
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "removed-runtime-model",
      reasoningEffort: "high",
      serviceTier: "priority",
    });
    const props = buildProps();
    render(<RuntimeModelSelector {...props} model="runtime-other" />);

    const user = userEvent.setup();
    await user.click(
      within(
        screen.getByTestId("runtime-model-selector-favorite-select"),
      ).getByRole("combobox"),
    );
    await user.click(screen.getByText("Repaired"));

    expect(props.onModelChange).toHaveBeenCalledWith("runtime-gpt");
    expect(props.onReasoningEffortChange).not.toHaveBeenCalled();
  });

  it("shares newly saved favorites across mounted selector surfaces", async () => {
    setCapabilityCatalogForTests(buildPayload().providers);
    const user = userEvent.setup();
    render(
      <>
        <RuntimeModelSelector {...buildProps()} testIdPrefix="surface-one" />
        <RuntimeModelSelector {...buildProps()} testIdPrefix="surface-two" />
      </>,
    );

    await user.click(screen.getByTestId("surface-one-favorite-save"));
    await user.type(screen.getByLabelText("Favorite name"), "Shared choice");
    await user.click(screen.getByTestId("surface-one-favorite-dialog-submit"));

    await waitFor(() =>
      expect(
        screen.getByTestId("surface-two-favorite-select"),
      ).toHaveTextContent("Shared choice"),
    );
  });
});
