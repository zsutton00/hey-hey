import { HostedModalFixture } from "../../test/HostedModalFixture";
import { ModalRestoreControls } from "../Modals/ModalRestoreControls";
import type { AgentComposerContext } from "../SmarterTextAreaCard/slashCommands/types";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DiscussModal } from "./DiscussModal";
import {
  CurrentControllerMachineEligibilityState,
  EntityType,
  type MachineDto,
} from "../../api";
import { ConversationStartRunRequestDtoProviderEnum } from "../../api";
import { FeatureReferenceMatchNode } from "../SmarterTextAreaCard/FeatureReferenceMatchNode";
import { FileReferenceNode } from "../SmarterTextAreaCard/fileReferences/FileReferenceNode";
import { MentionNode } from "../SmarterTextAreaCard/MentionNode";
import {
  listEfforts,
  listModels,
  listProviders,
  resetCapabilityCatalogForTests,
  setCapabilityCatalogForTests,
} from "../AgentSession/capabilityCatalog";
import { TEST_CAPABILITY_CATALOG } from "../../test/capabilityCatalogFixture";
import type { SurfaceSelection } from "../AgentSession/surfaceSelectionMemory";
import type { LocalCliForSessionState } from "../AgentSession/runtime/hooks/useLocalCliForSession";
import {
  LocalRunAttachmentUploadError,
  LocalStagedBrowserTabOpenError,
} from "../AgentSession/runtime/directoryBindingApi";

const editorState = vi.hoisted(() => ({ text: "" }));
const lexicalConfig = vi.hoisted(() => ({ nodes: [] as readonly unknown[] }));
const machineState = vi.hoisted(() => ({ machines: [] as MachineDto[] }));
const serviceState = vi.hoisted(() => ({
  services: [{ id: "service-1", name: "Service One" }],
}));
const roleState = vi.hoisted(() => ({
  isOrganizationAdmin: false,
  isPlatformAdmin: false,
}));
const focalWorkItemState = vi.hoisted(() => ({
  workItem: { type: "STANDARD" } as { type: string } | undefined,
  workItemTypeSummary: undefined as
    { definition: unknown; effectiveSource?: unknown } | undefined,
}));

const attachmentMocks = vi.hoisted(() => ({
  stage: vi.fn(),
  openStagedBrowserTab: vi.fn(),
  local: { status: "local", machineId: "machine-1" } as LocalCliForSessionState,
}));

vi.mock("../AgentSession/runtime/hooks/useLocalCliForSession", () => ({
  useLocalCliForSession: () => attachmentMocks.local,
}));

vi.mock("../AgentSession/runtime/directoryBindingApi", async (original) => ({
  ...(await original<
    typeof import("../AgentSession/runtime/directoryBindingApi")
  >()),
  createDirectoryBindingApi: () => ({
    uploadLocalStagedRunAttachment: attachmentMocks.stage,
    openStagedBrowserTab: attachmentMocks.openStagedBrowserTab,
  }),
}));

vi.mock("../../data/hooks/useWorkItem", () => ({
  useWorkItem: () => ({ workItem: focalWorkItemState.workItem }),
}));

vi.mock("../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeByKey: () => ({
    workItemTypeSummary: focalWorkItemState.workItemTypeSummary,
  }),
}));

vi.mock("../../hooks/auth/useRole", () => ({
  useRole: () => ({
    isOrganizationAdmin: roleState.isOrganizationAdmin,
  }),
}));

vi.mock("../../data/hooks/usePlatformAdminAccess", () => ({
  usePlatformAdminAccess: () => ({
    isPlatformAdmin: roleState.isPlatformAdmin,
    isResolved: true,
  }),
}));

vi.mock("@lexical/react/LexicalComposer", () => ({
  LexicalComposer: ({
    children,
    initialConfig,
  }: {
    children: React.ReactNode;
    initialConfig?: { nodes?: readonly unknown[] };
  }) => {
    lexicalConfig.nodes = initialConfig?.nodes ?? [];
    return <div data-testid="mock-lexical-composer">{children}</div>;
  },
}));

vi.mock("@lexical/react/LexicalComposerContext", () => ({
  useLexicalComposerContext: () => [
    {
      registerCommand: () => () => {},
      setEditable: () => {},
      update: () => {},
      focus: () => {},
    },
  ],
}));

vi.mock("@lexical/react/LexicalRichTextPlugin", () => ({
  RichTextPlugin: ({
    contentEditable,
  }: {
    contentEditable: React.ReactNode;
  }) => <>{contentEditable}</>,
}));

vi.mock("@lexical/react/LexicalContentEditable", () => ({
  ContentEditable: (props: Record<string, unknown>) => <div {...props} />,
}));

vi.mock("@lexical/react/LexicalErrorBoundary", () => ({
  LexicalErrorBoundary: () => null,
}));

vi.mock("@lexical/react/LexicalHistoryPlugin", () => ({
  HistoryPlugin: () => null,
}));

vi.mock("@lexical/react/LexicalOnChangePlugin", () => ({
  OnChangePlugin: ({
    onChange,
  }: {
    onChange: (state: { read: (fn: () => void) => void }) => void;
  }) => (
    <textarea
      data-testid="mock-editor-input"
      onChange={(e) => {
        editorState.text = e.target.value;
        onChange({ read: (fn: () => void) => fn() });
      }}
    />
  ),
}));

vi.mock("../SmarterTextAreaCard/MentionPlugin", () => ({
  MentionPlugin: () => null,
}));

vi.mock("../SmarterTextAreaCard/FeatureReferenceDiscoveryPlugin", () => ({
  FeatureReferenceDiscoveryPlugin: ({
    organizationId,
    projectId,
  }: {
    organizationId: string;
    projectId: string;
  }) => (
    <div
      data-testid="mock-discuss-feature-reference-discovery"
      data-organization-id={organizationId}
      data-project-id={projectId}
    />
  ),
}));

vi.mock("../SmarterTextAreaCard/EntityDropPlugin", () => ({
  EntityDropPlugin: () => <div data-testid="mock-discuss-entity-drop-plugin" />,
}));

vi.mock("../SmarterTextAreaCard/slashCommands/RichSlashCommandPlugin", () => ({
  RichSlashCommandPlugin: ({
    organizationId,
    projectId,
    surfaceContext,
    agentContext,
  }: {
    agentContext?: AgentComposerContext | null;
    organizationId: string | null;
    projectId: string | null;
    surfaceContext: {
      focalEntity:
        | { kind: "none" }
        | { kind: "entity"; entityType: EntityType; entityId: string };
      unavailableSkillCommandReason?: string;
    };
  }) => (
    <div
      data-testid="mock-discuss-slash-command-plugin"
      data-organization-id={organizationId ?? ""}
      data-project-id={projectId ?? ""}
      data-focal-kind={surfaceContext.focalEntity.kind}
      data-focal-entity-type={
        surfaceContext.focalEntity.kind === "entity"
          ? surfaceContext.focalEntity.entityType
          : ""
      }
      data-focal-entity-id={
        surfaceContext.focalEntity.kind === "entity"
          ? surfaceContext.focalEntity.entityId
          : ""
      }
    >
      {agentContext ? (
        <button
          data-testid="mock-discuss-select-skill"
          data-policy={
            "catalogContext" in agentContext
              ? agentContext.catalogContext.policy
              : "attached"
          }
          onClick={() =>
            agentContext.onSkillSelected({
              provider: "codex",
              name: "personal",
              catalogScope: "user",
            })
          }
        >
          {agentContext.selectedSkill?.name ?? "Choose Skill"}
        </button>
      ) : null}
      {surfaceContext.unavailableSkillCommandReason ? (
        <span data-testid="mock-discuss-skill-command-unavailable">
          {surfaceContext.unavailableSkillCommandReason}
        </span>
      ) : null}
    </div>
  ),
}));

vi.mock("../SmarterTextAreaCard/fileReferences/FileReferencePlugin", () => ({
  FileReferencePlugin: ({
    config,
  }: {
    config: {
      organizationId: string;
      projectId: string;
      scope:
        | { kind: "task"; taskId: string }
        | { kind: "feature"; featureId: string };
    };
  }) => (
    <div
      data-testid="mock-discuss-file-reference-plugin"
      data-organization-id={config.organizationId}
      data-project-id={config.projectId}
      data-scope-kind={config.scope.kind}
      data-scope-id={
        config.scope.kind === "task"
          ? config.scope.taskId
          : config.scope.featureId
      }
    />
  ),
}));

vi.mock("../SmarterTextAreaCard/serializationUtils", () => ({
  serializeEditorState: () => editorState.text,
}));

vi.mock("../SmarterTextAreaCard/slashCommands/subagentEditorState", () => ({
  $readSubagentEditorState: () => ({ kind: "literal" }),
}));

vi.mock("../../data/hooks/useMentionEntitySearch", () => ({
  useMentionEntitySearch: () => ({ searchEntities: vi.fn() }),
}));

vi.mock("../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({
    machines: machineState.machines,
    isReady: true,
  }),
}));

vi.mock("../Selectors/ServiceSelector", () => ({
  ServiceSelector: ({
    value,
    onChange,
    disabled,
  }: {
    value: string | null;
    onChange: (serviceId: string | null) => void;
    disabled?: boolean;
  }) => (
    <div data-testid="mock-service-selector">
      <span data-testid="mock-service-selection">{value ?? "None"}</span>
      {serviceState.services.map((service) => (
        <button
          key={service.id}
          type="button"
          data-testid={`mock-select-${service.id}`}
          onClick={() => onChange(service.id)}
          disabled={disabled}
        >
          {service.name}
        </button>
      ))}
    </div>
  ),
}));

const catalogRead = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../data/collections/runtimeModelCatalog", () => ({
  fetchRuntimeModelCatalog: catalogRead.fetch,
}));

const SURFACE_KEY = "hey-hey:agent-selection:discuss";

const defaultProps = () => ({
  open: true,
  onClose: vi.fn(),
  onSubmit: vi.fn(),
  submitError: null,
  onClearSubmitError: vi.fn(),
  organizationId: "org-1",
  projectId: "proj-1",
  focalEntity: {
    kind: "entity" as const,
    entityType: EntityType.Task,
    entityId: "task-1",
  },
  walkthroughEntity: null,
  fileReferenceScope: { kind: "task" as const, taskId: "task-1" },
});

const renderModal = (
  overrides: Partial<ReturnType<typeof defaultProps>> = {},
) => {
  const props = { ...defaultProps(), ...overrides };
  const utils = render(
    <MemoryRouter>
      <DiscussModal {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
};

const openSelect = async (testId: string) => {
  const user = userEvent.setup();
  const select = screen.getByTestId(testId);
  const button = within(select).getByRole("combobox");
  await user.click(button);
  return user;
};

beforeEach(() => {
  attachmentMocks.stage.mockReset();
  attachmentMocks.openStagedBrowserTab.mockReset();
  attachmentMocks.local = { status: "local", machineId: "machine-1" };
  editorState.text = "";
  lexicalConfig.nodes = [];
  machineState.machines = [
    {
      machineId: "machine-1",
      name: "CLI One",
      pairedAt: "2026-01-01T00:00:00.000Z",
      active: true,
      authorizationProtocolVersion: 2,
      executionReadiness: "READY",
      currentControllerEligibility:
        CurrentControllerMachineEligibilityState.Eligible,
      bindings: [],
    },
  ];
  serviceState.services = [{ id: "service-1", name: "Service One" }];
  roleState.isOrganizationAdmin = false;
  roleState.isPlatformAdmin = false;
  focalWorkItemState.workItem = { type: "STANDARD" };
  focalWorkItemState.workItemTypeSummary = undefined;
  localStorage.clear();
  setCapabilityCatalogForTests(TEST_CAPABILITY_CATALOG);
  setCapabilityCatalogForTests(TEST_CAPABILITY_CATALOG);
});

afterEach(() => {
  cleanup();
  setCapabilityCatalogForTests(TEST_CAPABILITY_CATALOG);
});

describe("DiscussModal focal entity", () => {
  it("shows the project-effective custom work-item icon beside the title", () => {
    focalWorkItemState.workItem = { type: "RISK" };
    focalWorkItemState.workItemTypeSummary = {
      definition: { key: "RISK", iconKey: "bug" },
      effectiveSource: "PROJECT_CUSTOM",
    };
    renderModal({ entityTitle: "Flaky deploys" });

    const icon = screen.getByTestId("discuss-modal-entity-icon");
    expect(within(icon).getByTestId("BugReportIcon")).toBeInTheDocument();
    expect(screen.getByText("Flaky deploys")).toBeInTheDocument();
  });

  it("withholds the work-item icon until its type is known", () => {
    focalWorkItemState.workItem = undefined;
    renderModal({ entityTitle: "Loading task" });

    expect(
      screen.queryByTestId("discuss-modal-entity-icon"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Loading task")).toBeInTheDocument();
  });

  it("shows the entity-type icon for non-work-item focal entities", () => {
    renderModal({
      entityTitle: "Design",
      focalEntity: {
        kind: "entity" as const,
        entityType: EntityType.DesignDoc,
        entityId: "doc-1",
      },
    });

    expect(screen.getByTestId("discuss-modal-entity-icon")).toBeInTheDocument();
  });
});

describe("DiscussModal model selection", () => {
  it("gives the model selector a full non-shrinking row", () => {
    renderModal();

    const container = screen.getByTestId("discuss-model-selector-container");

    expect(container).toContainElement(screen.getByTestId("discuss-root"));
    expect(container).toHaveStyle({
      width: "100%",
      flexBasis: "100%",
      flexShrink: 0,
    });
  });

  it("registers the shared rich-editor nodes with Lexical", () => {
    renderModal();

    expect(lexicalConfig.nodes).toContain(FileReferenceNode);
    expect(lexicalConfig.nodes).toContain(FeatureReferenceMatchNode);
    expect(lexicalConfig.nodes).toContain(MentionNode);
    expect(
      screen.getByTestId("mock-discuss-entity-drop-plugin"),
    ).toBeInTheDocument();
  });

  it("passes pre-run Skill availability guidance to the slash-command surface", () => {
    renderModal();

    const plugin = screen.getByTestId("mock-discuss-slash-command-plugin");
    expect(plugin).toHaveAttribute("data-organization-id", "org-1");
    expect(plugin).toHaveAttribute("data-project-id", "proj-1");
    expect(plugin).toHaveAttribute("data-focal-kind", "entity");
    expect(plugin).toHaveAttribute("data-focal-entity-type", EntityType.Task);
    expect(plugin).toHaveAttribute("data-focal-entity-id", "task-1");
    expect(
      screen.queryByTestId("mock-discuss-select-skill"),
    ).not.toBeInTheDocument();
  });

  it("mounts feature discovery with the explicit organization and project context", () => {
    renderModal();

    const plugin = screen.getByTestId(
      "mock-discuss-feature-reference-discovery",
    );
    expect(plugin).toHaveAttribute("data-organization-id", "org-1");
    expect(plugin).toHaveAttribute("data-project-id", "proj-1");
  });

  it("does not mount project-aware discovery when context is unavailable", () => {
    renderModal({ organizationId: undefined, projectId: undefined });

    expect(
      screen.queryByTestId("mock-discuss-feature-reference-discovery"),
    ).not.toBeInTheDocument();
  });

  it("mounts scoped touched-file suggestions alongside slash commands", () => {
    renderModal({
      fileReferenceScope: {
        kind: "feature",
        featureId: "feature-1",
      },
    });

    const plugin = screen.getByTestId("mock-discuss-file-reference-plugin");
    expect(plugin).toHaveAttribute("data-organization-id", "org-1");
    expect(plugin).toHaveAttribute("data-project-id", "proj-1");
    expect(plugin).toHaveAttribute("data-scope-kind", "feature");
    expect(plugin).toHaveAttribute("data-scope-id", "feature-1");
    expect(
      screen.getByTestId("mock-discuss-slash-command-plugin"),
    ).toBeInTheDocument();
  });

  it("does not mount touched-file suggestions without task or feature context", () => {
    renderModal({ fileReferenceScope: null });

    expect(
      screen.queryByTestId("mock-discuss-file-reference-plugin"),
    ).not.toBeInTheDocument();
  });

  it("renders a single ModelSelector under the 'discuss' testIdPrefix and no legacy selects", () => {
    renderModal();

    expect(screen.getByTestId("discuss-provider-select")).toBeInTheDocument();
    expect(screen.getByTestId("discuss-model-select")).toBeInTheDocument();
    expect(screen.getByTestId("discuss-effort-select")).toBeInTheDocument();
  });

  it("seeds initial state from readSurfaceSelection when a stored value exists", () => {
    const stored: SurfaceSelection = {
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      model: "claude-sonnet-5-5",
      reasoningEffort: "high",
      fastMode: false,
    };
    localStorage.setItem(SURFACE_KEY, JSON.stringify(stored));

    renderModal();

    expect(
      within(screen.getByTestId("discuss-model-select")).getByRole("combobox"),
    ).toHaveValue("Sonnet 5.5");
    expect(
      within(screen.getByTestId("discuss-effort-select")).getByText("High"),
    ).toBeInTheDocument();
  });

  it("falls back to catalog defaults when nothing is stored", () => {
    renderModal();

    const defaultProvider = listProviders()[0];
    const defaultModel = listModels(defaultProvider)[0];
    const defaultEfforts = listEfforts(defaultProvider, defaultModel.id);

    expect(
      within(screen.getByTestId("discuss-model-select")).getByRole("combobox"),
    ).toHaveValue(defaultModel.label);
    if (defaultEfforts.length > 0) {
      expect(screen.getByTestId("discuss-effort-select")).toBeInTheDocument();
    }
  });

  it("preserves stored Codex provider while reconciling stale model and effort", () => {
    setCapabilityCatalogForTests([
      {
        provider: ConversationStartRunRequestDtoProviderEnum.Claude,
        models: [
          {
            id: "runtime-claude",
            label: "Runtime Claude",
            efforts: ["low", "medium", "high"],
          },
        ],
      },
      {
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        models: [
          {
            id: "runtime-codex",
            label: "Runtime Codex",
            efforts: ["low", "high"],
          },
        ],
      },
    ]);
    localStorage.setItem(
      SURFACE_KEY,
      JSON.stringify({
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        model: "stale-codex-model",
        reasoningEffort: "medium",
        fastMode: true,
      }),
    );

    renderModal();

    expect(
      within(screen.getByTestId("discuss-provider-select")).getByText("Codex"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("discuss-model-select")).getByRole("combobox"),
    ).toHaveValue("Runtime Codex");
    expect(
      within(screen.getByTestId("discuss-effort-select")).getByText("Low"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Runtime Claude")).not.toBeInTheDocument();
  });

  it("persists provider, model, and effort changes through writeSurfaceSelection", async () => {
    renderModal();

    const userP = await openSelect("discuss-provider-select");
    await userP.click(screen.getByTestId("discuss-provider-option-codex"));

    const writtenAfterProvider = JSON.parse(
      localStorage.getItem(SURFACE_KEY) ?? "null",
    ) as SurfaceSelection;
    expect(writtenAfterProvider.provider).toBe(
      ConversationStartRunRequestDtoProviderEnum.Codex,
    );
    expect(writtenAfterProvider.model).toBe("gpt-5.6-sol");

    const userE = await openSelect("discuss-effort-select");
    await userE.click(screen.getByTestId("discuss-effort-option-low"));

    const writtenAfterEffort = JSON.parse(
      localStorage.getItem(SURFACE_KEY) ?? "null",
    ) as SurfaceSelection;
    expect(writtenAfterEffort.reasoningEffort).toBe("low");
  });
});

describe("DiscussModal model catalog from the picked machine's CLI", () => {
  beforeEach(() => {
    resetCapabilityCatalogForTests();
    catalogRead.fetch.mockReset();
  });

  it("shows the failed read and preselects nothing, so a run cannot start", async () => {
    catalogRead.fetch.mockRejectedValue(new Error("CLI did not answer"));
    renderModal();
    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "hello" },
    });

    expect(
      await screen.findByTestId("discuss-catalog-error"),
    ).toHaveTextContent("CLI did not answer");
    expect(catalogRead.fetch).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "proj-1",
      machineId: "machine-1",
    });
    expect(screen.queryByTestId("discuss-provider-select")).toBeNull();
    expect(screen.getByTestId("discuss-modal-submit")).toBeDisabled();
    expect(screen.getByTestId("discuss-modal-ask")).toBeDisabled();
  });

  it("offers the CLI's choices once its catalog arrives", async () => {
    catalogRead.fetch.mockResolvedValue({
      id: "request-1",
      response: {
        requestId: "request-1",
        operation: "runtime.model_catalog.get",
        status: "success",
        result: {
          providers: [
            {
              provider: ConversationStartRunRequestDtoProviderEnum.Codex,
              models: [
                { id: "only-model", label: "Only model", efforts: ["low"] },
              ],
            },
          ],
        },
      },
    });
    renderModal();

    const provider = await screen.findByTestId("discuss-provider-select");
    expect(within(provider).getByRole("combobox")).toHaveTextContent("Codex");
    expect(
      within(screen.getByTestId("discuss-model-select")).getByRole("combobox"),
    ).toHaveValue("Only model");
  });
});

describe("DiscussModal submit and close behavior", () => {
  it("lets admins persist the Codex base-instruction pilot selection", async () => {
    roleState.isOrganizationAdmin = true;
    localStorage.setItem(
      SURFACE_KEY,
      JSON.stringify({
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        fastMode: false,
      } satisfies SurfaceSelection),
    );
    const { props } = renderModal();

    await userEvent.click(
      screen.getByTestId("discuss-disable-codex-system-prompt"),
    );
    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "evaluate this mode" },
    });
    await userEvent.click(screen.getByTestId("discuss-modal-submit"));

    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ disableCodexSystemPrompt: true }),
    );
  });

  it("offers the Codex pilot selection to platform admins", () => {
    roleState.isPlatformAdmin = true;
    localStorage.setItem(
      SURFACE_KEY,
      JSON.stringify({
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        fastMode: false,
      } satisfies SurfaceSelection),
    );
    renderModal();

    expect(
      screen.getByTestId("discuss-disable-codex-system-prompt"),
    ).toBeInTheDocument();
  });

  it("does not expose or submit the Codex pilot selection to non-admins", async () => {
    localStorage.setItem(
      SURFACE_KEY,
      JSON.stringify({
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        fastMode: false,
      } satisfies SurfaceSelection),
    );
    const { props } = renderModal();

    expect(
      screen.queryByTestId("discuss-disable-codex-system-prompt"),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "normal launch" },
    });
    await userEvent.click(screen.getByTestId("discuss-modal-submit"));

    expect(props.onSubmit.mock.calls[0]?.[0]).not.toHaveProperty(
      "disableCodexSystemPrompt",
    );
  });

  it("treats missing runtime error controls as an empty state while closed and open", async () => {
    const onClose = vi.fn();
    const { props, rerender } = renderModal({
      open: false,
      onClose,
      submitError: undefined,
      onClearSubmitError: undefined,
    });

    expect(
      screen.queryByTestId("discuss-modal-submit-error"),
    ).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <DiscussModal {...props} open />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByText("Cancel"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires onSubmit with the no-Service launch context by default", async () => {
    const stored: SurfaceSelection = {
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      model: "claude-opus-5-5",
      reasoningEffort: "medium",
      fastMode: false,
    };
    localStorage.setItem(SURFACE_KEY, JSON.stringify(stored));

    const { props } = renderModal();

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "draft a plan" },
    });

    const user = userEvent.setup();
    const askWithContext = screen.getByTestId("discuss-modal-submit");
    expect(askWithContext).toHaveTextContent("Start Conversation");
    expect(askWithContext).toHaveClass("MuiButton-contained");
    await user.click(askWithContext);

    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).toHaveBeenCalledWith({
      prompt: "draft a plan",
      attachments: [],
      stagedBrowserTab: null,
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      model: "claude-opus-5-5",
      reasoningEffort: "medium",
      fastMode: false,
      machineId: "machine-1",
    });
    expect(props.onSubmit.mock.calls[0]?.[0]).not.toHaveProperty(
      "projectAssistant",
    );
  });

  it("submits the seeded prompt without replacing it before editing", async () => {
    const { props } = renderModal({
      initialValue: "Review the completed feature changes.",
    });

    await userEvent.click(screen.getByTestId("discuss-modal-submit"));

    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Review the completed feature changes.",
        machineId: "machine-1",
      }),
    );
  });

  it("submits Quick Question with Project Assistant explicitly disabled", async () => {
    const stored: SurfaceSelection = {
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      fastMode: true,
    };
    localStorage.setItem(SURFACE_KEY, JSON.stringify(stored));
    const { props } = renderModal();

    fireEvent.click(screen.getByTestId("mock-select-service-1"));
    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "answer this quickly" },
    });
    const ask = screen.getByTestId("discuss-modal-ask");
    expect(ask).toHaveTextContent("Quick Question");
    expect(ask).toHaveClass("MuiButton-outlined");
    await userEvent.click(ask);

    expect(props.onSubmit).toHaveBeenCalledWith({
      prompt: "answer this quickly",
      attachments: [],
      stagedBrowserTab: null,
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      machineId: "machine-1",
      fastMode: true,
      serviceId: "service-1",
      projectAssistant: { enabled: false },
    });
  });

  it("shows the pending spinner in Quick Question and restores both labels after failure", async () => {
    const { props, rerender } = renderModal();

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "start without context" },
    });
    await userEvent.click(screen.getByTestId("discuss-modal-ask"));

    rerender(
      <MemoryRouter>
        <DiscussModal {...props} isLoading />
      </MemoryRouter>,
    );

    const ask = screen.getByTestId("discuss-modal-ask");
    expect(
      within(ask).getByRole("progressbar", { name: "Starting conversation" }),
    ).toBeInTheDocument();
    expect(ask).toHaveAttribute(
      "aria-label",
      "Quick Question, starting conversation",
    );
    expect(ask).toHaveAttribute("aria-busy", "true");
    expect(ask).toBeDisabled();
    expect(screen.getByTestId("discuss-modal-submit")).toBeDisabled();
    expect(screen.getByTestId("discuss-modal-submit")).toHaveTextContent(
      "Start Conversation",
    );

    rerender(
      <MemoryRouter>
        <DiscussModal
          {...props}
          isLoading={false}
          submitError={{ code: null, message: "Launch failed" }}
        />
      </MemoryRouter>,
    );

    expect(ask).toHaveTextContent("Quick Question");
    expect(ask).not.toContainElement(within(ask).queryByRole("progressbar"));
    expect(screen.getByTestId("discuss-modal-submit")).toHaveTextContent(
      "Start Conversation",
    );
    expect(screen.getByTestId("discuss-modal-submit-error")).toHaveTextContent(
      "Launch failed",
    );
  });

  it("shows the pending spinner in Start Conversation and restores both labels after failure", async () => {
    const { props, rerender } = renderModal();

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "start with context" },
    });
    await userEvent.click(screen.getByTestId("discuss-modal-submit"));

    rerender(
      <MemoryRouter>
        <DiscussModal {...props} isLoading />
      </MemoryRouter>,
    );

    const askWithContext = screen.getByTestId("discuss-modal-submit");
    expect(
      within(askWithContext).getByRole("progressbar", {
        name: "Starting conversation",
      }),
    ).toBeInTheDocument();
    expect(askWithContext).toHaveAttribute(
      "aria-label",
      "Start Conversation, starting conversation",
    );
    expect(askWithContext).toHaveAttribute("aria-busy", "true");
    expect(askWithContext).toBeDisabled();
    expect(screen.getByTestId("discuss-modal-ask")).toBeDisabled();
    expect(screen.getByTestId("discuss-modal-ask")).toHaveTextContent(
      "Quick Question",
    );

    rerender(
      <MemoryRouter>
        <DiscussModal
          {...props}
          isLoading={false}
          submitError={{ code: null, message: "Launch failed" }}
        />
      </MemoryRouter>,
    );

    expect(askWithContext).toHaveTextContent("Start Conversation");
    expect(askWithContext).not.toContainElement(
      within(askWithContext).queryByRole("progressbar"),
    );
    expect(screen.getByTestId("discuss-modal-ask")).toHaveTextContent(
      "Quick Question",
    );
    expect(screen.getByTestId("discuss-modal-submit-error")).toHaveTextContent(
      "Launch failed",
    );
  });

  it("adds the selected Service without changing the machine context", async () => {
    const { props } = renderModal();

    fireEvent.click(screen.getByTestId("mock-select-service-1"));
    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "use the repository" },
    });

    await userEvent.click(screen.getByTestId("discuss-modal-submit"));

    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "use the repository",
        machineId: "machine-1",
        serviceId: "service-1",
      }),
    );
  });

  it("renders and submits a fixed Service through a disabled selector", async () => {
    const { props } = renderModal({
      fixedServiceScope: {
        serviceId: "service-1",
        serviceName: "Service One",
      },
    });

    expect(
      screen.queryByTestId("discuss-service-selector"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("discuss-fixed-service")).toContainElement(
      screen.getByTestId("mock-service-selector"),
    );
    expect(screen.getByTestId("mock-service-selection")).toHaveTextContent(
      "service-1",
    );
    expect(screen.getByTestId("mock-select-service-1")).toBeDisabled();

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "work in this repository" },
    });
    await userEvent.click(screen.getByTestId("discuss-modal-submit"));

    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "work in this repository",
        machineId: "machine-1",
        serviceId: "service-1",
      }),
    );
  });

  it("keeps graph launch available when the project has no Services", async () => {
    serviceState.services = [];
    const { props } = renderModal();

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "discuss without a repository" },
    });
    await userEvent.click(screen.getByTestId("discuss-modal-submit"));

    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "discuss without a repository",
        machineId: "machine-1",
      }),
    );
    expect(props.onSubmit.mock.calls[0]?.[0]).not.toHaveProperty("serviceId");
  });

  it("clears the prompt on close but leaves the persisted selection intact on reopen", async () => {
    const stored: SurfaceSelection = {
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.6-sol",
      reasoningEffort: "low",
      fastMode: false,
    };
    localStorage.setItem(SURFACE_KEY, JSON.stringify(stored));

    const onClose = vi.fn();
    const onClearSubmitError = vi.fn();
    const { rerender, props } = renderModal({
      onClose,
      onClearSubmitError,
    });

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "scratch text" },
    });

    const user = userEvent.setup();
    await user.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClearSubmitError).toHaveBeenCalledTimes(1);

    rerender(
      <MemoryRouter>
        <DiscussModal {...props} open={false} onClose={onClose} />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter>
        <DiscussModal {...props} open onClose={onClose} />
      </MemoryRouter>,
    );

    expect(
      within(screen.getByTestId("discuss-provider-select")).getByText("Codex"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("discuss-model-select")).getByRole("combobox"),
    ).toHaveValue("GPT 5.6 Sol");
    expect(JSON.parse(localStorage.getItem(SURFACE_KEY) ?? "null")).toEqual(
      stored,
    );
  });

  it("renders a known launch code as actionable guidance inside the modal", () => {
    renderModal({
      submitError: {
        code: "NO_CLI_CONNECTION",
        message: "Conversation owner has no active CLI websocket connection",
      },
    });

    const error = screen.getByTestId("discuss-modal-submit-error");
    expect(error).toHaveTextContent("Your coding agent isn't connected");
    expect(error).toHaveTextContent("Start your agent CLI");
  });

  it("renders unknown launch failures generically inside the modal", () => {
    renderModal({
      submitError: {
        code: null,
        message: "Unable to start this conversation",
      },
    });

    const error = screen.getByTestId("discuss-modal-submit-error");
    expect(error).toHaveTextContent("Something went wrong");
    expect(error).toHaveTextContent("Unable to start this conversation");
  });

  it.each([
    {
      code: null,
      message: "Agent execution failed: network stalled (Type: TIMEOUT)",
      specializedTitle: "Agent timed out",
    },
    {
      code: "UNRECOGNIZED_ERROR",
      message: "Provider rejected the request (Type: RATE_LIMITED)",
      specializedTitle: "Rate limit reached",
    },
  ])(
    "does not infer actionable guidance from message text when code is $code",
    ({ code, message, specializedTitle }) => {
      renderModal({ submitError: { code, message } });

      const error = screen.getByTestId("discuss-modal-submit-error");
      expect(error).toHaveTextContent("Something went wrong");
      expect(error).toHaveTextContent(message);
      expect(error).not.toHaveTextContent(specializedTitle);
    },
  );

  it("retains the prompt after failure and clears the stale error on resubmit", async () => {
    const onClearSubmitError = vi.fn();
    const { props, rerender } = renderModal({ onClearSubmitError });

    const input = screen.getByTestId("mock-editor-input");
    fireEvent.change(input, { target: { value: "keep this prompt" } });

    rerender(
      <MemoryRouter>
        <DiscussModal
          {...props}
          submitError={{ code: null, message: "Launch failed" }}
        />
      </MemoryRouter>,
    );

    expect(input).toHaveValue("keep this prompt");
    expect(onClearSubmitError).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId("discuss-modal-submit"));

    expect(onClearSubmitError).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "keep this prompt",
        machineId: "machine-1",
      }),
    );
  });

  it("keeps Quick Question retryable inside the modal after a launch failure", async () => {
    const onClearSubmitError = vi.fn();
    const { props, rerender } = renderModal({ onClearSubmitError });
    const input = screen.getByTestId("mock-editor-input");
    fireEvent.change(input, { target: { value: "retry quickly" } });

    rerender(
      <MemoryRouter>
        <DiscussModal
          {...props}
          submitError={{ code: null, message: "Launch failed" }}
        />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByTestId("discuss-modal-ask"));

    expect(input).toHaveValue("retry quickly");
    expect(onClearSubmitError).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "retry quickly",
        projectAssistant: { enabled: false },
      }),
    );
  });

  it("preserves the same editable draft, launch selections and retry error through minimization without launching", async () => {
    const props = {
      ...defaultProps(),
      submitError: { code: null, message: "Retry this launch" },
    };
    render(
      <MemoryRouter>
        <HostedModalFixture>
          <DiscussModal {...props} />
          <ModalRestoreControls />
        </HostedModalFixture>
      </MemoryRouter>,
    );
    const input = screen.getByTestId("mock-editor-input");
    fireEvent.change(input, { target: { value: "Keep this draft" } });
    const model = within(screen.getByTestId("discuss-model-select")).getByRole(
      "combobox",
    );
    const modelBefore = model.textContent;
    await userEvent.click(screen.getByTestId("modal-minimize"));
    await userEvent.click(
      screen.getByRole("button", { name: /Restore Discuss/ }),
    );
    expect(screen.getByTestId("mock-editor-input")).toBe(input);
    expect(input).toHaveValue("Keep this draft");
    expect(
      within(screen.getByTestId("discuss-model-select")).getByRole("combobox")
        .textContent,
    ).toBe(modelBefore);
    expect(screen.getByText("Retry this launch")).toBeVisible();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  describe("file attachments", () => {
    const stagedResult = (name: string) => ({
      result: {
        attachment: {
          attachmentId: `id-${name}`,
          fileName: name,
          sizeBytes: 1,
        },
      },
    });
    const dropFiles = (...files: File[]) =>
      fireEvent.drop(screen.getByTestId("discuss-modal-attachment-drop-zone"), {
        dataTransfer: { types: ["Files"], files },
      });

    it("uses the same upload path from the Attach files picker and preserves attachments while minimized", async () => {
      attachmentMocks.stage.mockImplementation((_machine, file: File) =>
        Promise.resolve(stagedResult(file.name)),
      );
      const props = defaultProps();
      render(
        <MemoryRouter>
          <HostedModalFixture>
            <DiscussModal {...props} />
            <ModalRestoreControls />
          </HostedModalFixture>
        </MemoryRouter>,
      );
      await userEvent.upload(
        screen.getByTestId("discuss-attachment-picker"),
        new File(["notes"], "notes.txt"),
      );
      await waitFor(() =>
        expect(screen.getByTestId("run-attachment-chip")).toHaveAttribute(
          "data-upload-status",
          "ready",
        ),
      );
      expect(attachmentMocks.stage).toHaveBeenCalledWith(
        "machine-1",
        expect.any(File),
      );
      await userEvent.click(screen.getByTestId("modal-minimize"));
      await userEvent.click(
        screen.getByRole("button", { name: /Restore Discuss/ }),
      );
      expect(screen.getByTestId("run-attachment-chip")).toHaveAttribute(
        "data-file-name",
        "notes.txt",
      );
      expect(attachmentMocks.stage).toHaveBeenCalledOnce();
      expect(props.onSubmit).not.toHaveBeenCalled();
    });

    it("uploads dropped files to the selected machine, shows removable chips and creates no conversation", async () => {
      attachmentMocks.stage.mockImplementation((_machine, file: File) =>
        Promise.resolve(stagedResult(file.name)),
      );
      const { props } = renderModal();
      dropFiles(new File(["a"], "notes.txt"));

      const chip = await screen.findByTestId("run-attachment-chip");
      expect(chip).toHaveAttribute("data-file-name", "notes.txt");
      await waitFor(() =>
        expect(chip).toHaveAttribute("data-upload-status", "ready"),
      );
      expect(attachmentMocks.stage).toHaveBeenCalledWith(
        "machine-1",
        expect.any(File),
      );
      await userEvent.click(screen.getByTestId("remove-run-attachment"));
      expect(screen.queryByTestId("run-attachment-chip")).toBeNull();
      expect(props.onSubmit).not.toHaveBeenCalled();
    });

    it("rejects the drop when the selected machine is not the browser's host", () => {
      attachmentMocks.local = { status: "local", machineId: "other" };
      renderModal();
      dropFiles(new File(["a"], "notes.txt"));

      expect(screen.getByTestId("run-attachment-rejection")).toBeVisible();
      expect(attachmentMocks.stage).not.toHaveBeenCalled();
      expect(screen.queryByTestId("run-attachment-chip")).toBeNull();
    });

    it("blocks both submit buttons while an upload is pending or failed, and a failed file does not block the others", async () => {
      let finish: (value: unknown) => void = () => undefined;
      attachmentMocks.stage.mockImplementation((_machine, file: File) =>
        file.name === "bad.txt"
          ? Promise.reject(
              new LocalRunAttachmentUploadError("Too large", "FILE_TOO_LARGE"),
            )
          : new Promise((resolve) => {
              finish = resolve;
            }),
      );
      renderModal();
      fireEvent.change(screen.getByTestId("mock-editor-input"), {
        target: { value: "with files" },
      });
      dropFiles(new File(["a"], "good.txt"), new File(["b"], "bad.txt"));

      await screen.findByTestId("run-attachment-error");
      expect(screen.getByTestId("discuss-modal-submit")).toBeDisabled();
      expect(screen.getByTestId("discuss-modal-ask")).toBeDisabled();

      finish(stagedResult("good.txt"));
      await waitFor(() =>
        expect(screen.getByTestId("run-attachment-chip")).toHaveAttribute(
          "data-upload-status",
          "ready",
        ),
      );
      expect(screen.getByTestId("discuss-modal-submit")).toBeDisabled();
      await userEvent.click(
        within(screen.getByTestId("run-attachment-error")).getByTestId(
          "remove-run-attachment",
        ),
      );
      expect(screen.getByTestId("discuss-modal-submit")).toBeEnabled();
    });

    it("sends the remaining references on both launch actions, keeps them after a failed start and clears them after an accepted one", async () => {
      attachmentMocks.stage.mockImplementation((_machine, file: File) =>
        Promise.resolve(stagedResult(file.name)),
      );
      const { props } = renderModal();
      props.onSubmit.mockResolvedValueOnce(false).mockResolvedValue(true);
      fireEvent.change(screen.getByTestId("mock-editor-input"), {
        target: { value: "look at this" },
      });
      dropFiles(new File(["a"], "notes.txt"));
      await waitFor(() =>
        expect(screen.getByTestId("run-attachment-chip")).toHaveAttribute(
          "data-upload-status",
          "ready",
        ),
      );
      const references = [
        { attachmentId: "id-notes.txt", fileName: "notes.txt" },
      ];

      await userEvent.click(screen.getByTestId("discuss-modal-ask"));
      expect(props.onSubmit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          attachments: references,
          projectAssistant: { enabled: false },
        }),
      );
      expect(screen.getByTestId("run-attachment-chip")).toBeVisible();

      await userEvent.click(screen.getByTestId("discuss-modal-submit"));
      expect(props.onSubmit).toHaveBeenLastCalledWith(
        expect.objectContaining({ attachments: references }),
      );
      await waitFor(() =>
        expect(screen.queryByTestId("run-attachment-chip")).toBeNull(),
      );
    });
  });

  describe("Open browser before the session starts", () => {
    const reference = { stagedTabId: "66666666-6666-4666-8666-666666666666" };

    it("sits with the launch tools at the bottom left, apart from the launch actions", () => {
      renderModal();
      const tools = screen.getByTestId("discuss-launch-tools");
      expect(
        within(tools).getByRole("button", { name: "Open browser" }),
      ).toBeEnabled();
      expect(within(tools).queryByTestId("discuss-modal-submit")).toBeNull();
    });

    it.each([
      [
        "a different machine",
        { status: "unavailable", reason: "different-machine" },
      ],
      [
        "an unreachable CLI",
        { status: "unavailable", reason: "cli-unreachable" },
      ],
      ["a machine still being checked", { status: "checking" }],
    ] as const)("is disabled for %s", (_name, local) => {
      attachmentMocks.local = local as LocalCliForSessionState;
      renderModal();
      expect(screen.getByTestId("discuss-open-browser")).toBeDisabled();
    });

    it("opens a tab on the selected machine for the project", async () => {
      attachmentMocks.openStagedBrowserTab.mockResolvedValue({
        stagedBrowserTab: reference,
        url: "about:blank",
      });
      renderModal();
      await userEvent.click(screen.getByTestId("discuss-open-browser"));
      expect(attachmentMocks.openStagedBrowserTab).toHaveBeenCalledWith({
        machineId: "machine-1",
        projectId: "proj-1",
      });
    });

    it("shows the typed reason when the CLI refuses", async () => {
      attachmentMocks.openStagedBrowserTab.mockRejectedValue(
        new LocalStagedBrowserTabOpenError(
          "The shared browser is turned off on this machine.",
          "SHARED_BROWSER_DISABLED",
        ),
      );
      renderModal();
      await userEvent.click(screen.getByTestId("discuss-open-browser"));
      expect(
        await screen.findByTestId("discuss-open-browser-error"),
      ).toHaveTextContent("The shared browser is turned off on this computer.");
    });

    it("sends the opened tab on both launch actions, keeps it after a failed start and clears it after an accepted one", async () => {
      attachmentMocks.openStagedBrowserTab.mockResolvedValue({
        stagedBrowserTab: reference,
        url: "about:blank",
      });
      const { props } = renderModal();
      props.onSubmit
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValue(true);
      fireEvent.change(screen.getByTestId("mock-editor-input"), {
        target: { value: "look at this page" },
      });
      await userEvent.click(screen.getByTestId("discuss-open-browser"));
      await waitFor(() =>
        expect(attachmentMocks.openStagedBrowserTab).toHaveBeenCalledOnce(),
      );

      await userEvent.click(screen.getByTestId("discuss-modal-ask"));
      expect(props.onSubmit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          stagedBrowserTab: reference,
          projectAssistant: { enabled: false },
        }),
      );

      await userEvent.click(screen.getByTestId("discuss-modal-submit"));
      expect(props.onSubmit).toHaveBeenLastCalledWith(
        expect.objectContaining({ stagedBrowserTab: reference }),
      );

      await userEvent.click(screen.getByTestId("discuss-modal-submit"));
      expect(props.onSubmit).toHaveBeenLastCalledWith(
        expect.objectContaining({ stagedBrowserTab: null }),
      );
    });
  });

  it("persists and submits an explicit Fast mode boolean for supported Codex models", async () => {
    const stored: SurfaceSelection = {
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      fastMode: false,
    };
    localStorage.setItem(SURFACE_KEY, JSON.stringify(stored));
    const { props } = renderModal();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("discuss-fast-mode-switch"));
    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "launch fast" },
    });
    await user.click(screen.getByTestId("discuss-modal-submit"));

    expect(JSON.parse(localStorage.getItem(SURFACE_KEY) ?? "null")).toEqual({
      ...stored,
      fastMode: true,
    });
    expect(props.onSubmit).toHaveBeenCalledWith({
      prompt: "launch fast",
      attachments: [],
      stagedBrowserTab: null,
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      machineId: "machine-1",
      fastMode: true,
    });
  });
});

describe("DiscussModal machine selection", () => {
  it("disables both actions while the prompt is empty", () => {
    renderModal();

    expect(screen.getByTestId("discuss-modal-submit")).toBeDisabled();
    expect(screen.getByTestId("discuss-modal-ask")).toBeDisabled();
  });

  it("automatically selects the sole active machine and leaves Service unselected", async () => {
    renderModal();

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "let's talk" },
    });

    expect(screen.getByTestId("machine-picker")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("machine-picker")).getByRole("combobox"),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("discuss-service-selector")).toBeInTheDocument();
    expect(screen.getByTestId("mock-service-selection")).toHaveTextContent(
      "None",
    );
    expect(screen.getByTestId("discuss-modal-submit")).toBeEnabled();
    expect(screen.getByTestId("discuss-modal-ask")).toBeEnabled();
  });

  it("shows actionable unavailable state and disables submit when no machine is active", () => {
    machineState.machines = [];
    renderModal();

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "let's talk" },
    });

    expect(screen.getByTestId("discuss-machine-unavailable")).toHaveTextContent(
      "Pair an Agent Bridge",
    );
    expect(screen.getByTestId("discuss-modal-submit")).toBeDisabled();
    expect(screen.getByTestId("discuss-modal-ask")).toBeDisabled();
  });

  it("allows selecting any ready paired CLI", async () => {
    machineState.machines = [
      {
        machineId: "machine-1",
        name: "CLI One",
        pairedAt: "2026-01-01T00:00:00.000Z",
        active: true,
        authorizationProtocolVersion: 2,
        executionReadiness: "READY",
        currentControllerEligibility:
          CurrentControllerMachineEligibilityState.Eligible,
        bindings: [],
      },
      {
        machineId: "machine-2",
        name: "CLI Two",
        pairedAt: "2026-01-02T00:00:00.000Z",
        active: true,
        authorizationProtocolVersion: 2,
        executionReadiness: "READY",
        currentControllerEligibility:
          CurrentControllerMachineEligibilityState.Eligible,
        bindings: [],
      },
    ];
    const { props } = renderModal();

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "use a selected machine" },
    });

    expect(screen.getByTestId("machine-picker")).toBeInTheDocument();
    expect(screen.getByTestId("discuss-modal-submit")).toBeDisabled();
    expect(screen.getByTestId("discuss-modal-ask")).toBeDisabled();

    const user = await openSelect("machine-picker");
    const remoteOption = screen.getByRole("option", {
      name: "CLI One — Ready",
    });
    expect(remoteOption).not.toHaveAttribute("aria-disabled", "true");
    await user.click(remoteOption);

    expect(screen.getByTestId("discuss-modal-submit")).toBeEnabled();
    expect(screen.getByTestId("discuss-modal-ask")).toBeEnabled();
    await user.click(screen.getByTestId("discuss-modal-submit"));

    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "use a selected machine",
        machineId: "machine-1",
      }),
    );
  });

  it("prefers the source run machine when the modal opens", async () => {
    machineState.machines = [
      {
        machineId: "machine-1",
        name: "CLI One",
        pairedAt: "2026-01-01T00:00:00.000Z",
        active: true,
        authorizationProtocolVersion: 2,
        executionReadiness: "READY",
        currentControllerEligibility:
          CurrentControllerMachineEligibilityState.Eligible,
        bindings: [],
      },
      {
        machineId: "machine-2",
        name: "CLI Two",
        pairedAt: "2026-01-02T00:00:00.000Z",
        active: true,
        authorizationProtocolVersion: 2,
        executionReadiness: "READY",
        currentControllerEligibility:
          CurrentControllerMachineEligibilityState.Eligible,
        bindings: [],
      },
    ];
    const { props } = renderModal({ preferredMachineId: "machine-2" });

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "use the source machine" },
    });

    await waitFor(() =>
      expect(screen.getByTestId("discuss-modal-submit")).toBeEnabled(),
    );
    await userEvent.click(screen.getByTestId("discuss-modal-submit"));

    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: "machine-2" }),
    );
  });

  it("disables both actions while a launch is pending", () => {
    renderModal({ isLoading: true });

    expect(screen.getByTestId("discuss-modal-submit")).toBeDisabled();
    expect(screen.getByTestId("discuss-modal-ask")).toBeDisabled();
  });
});

describe("pre-conversation Skill selection", () => {
  it("retains the prompt and pathless Skill after launch failure and clears it on Service change", async () => {
    localStorage.setItem(
      SURFACE_KEY,
      JSON.stringify({
        provider: "codex",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
      }),
    );
    const { props, rerender } = renderModal();
    const choose = screen.getByTestId("mock-discuss-select-skill");
    expect(choose).toHaveAttribute("data-policy", "non_repository");
    fireEvent.click(choose);
    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "Use my Skill" },
    });
    await userEvent.click(screen.getByTestId("discuss-modal-submit"));
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Use my Skill",
        skillSelection: {
          provider: "codex",
          name: "personal",
          catalogScope: "user",
        },
      }),
    );
    expect(props.onSubmit.mock.calls[0]![0]).not.toHaveProperty("serviceId");
    rerender(
      <MemoryRouter>
        <DiscussModal
          {...props}
          submitError={{
            code: "SKILL_UNAVAILABLE",
            message: "Skill unavailable",
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("mock-editor-input")).toHaveValue("Use my Skill");
    expect(screen.getByTestId("mock-discuss-select-skill")).toHaveTextContent(
      "personal",
    );
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("mock-select-service-1"));
    expect(screen.getByTestId("mock-discuss-select-skill")).toHaveAttribute(
      "data-policy",
      "service_workspace",
    );
    expect(screen.getByTestId("mock-discuss-select-skill")).toHaveTextContent(
      "Choose Skill",
    );
  });
});
