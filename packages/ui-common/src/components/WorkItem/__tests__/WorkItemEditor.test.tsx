import React, { useEffect } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkStatus } from "../../../api";
import type { WorkItemTypeKey } from "../../../constants/taskTypes";
import type { WorkItemTypeDefinitionDto } from "../../../api";
import {
  useRunBrowserContext,
  type RunBrowserContextValue,
} from "../../AgentSession/runtime/RunBrowserContext";
import { WorkItemEditor } from "../WorkItemEditor";

const mockRevealStage = vi.fn();
const mockUpdateTask = vi.fn();
const mockUpdateInitiative = vi.fn();
const mockRefetchWorkItem = vi.fn();
const mockMarkWorkItemStale = vi.fn();
const mockApplyUserPatch = vi.fn();
const mockApplyAcceptedSuggestion = vi.fn();
const mockApplyServerRefresh = vi.fn();
const mockReplaceDraft = vi.fn();
const mockDiscardDraft = vi.fn();
const mockCommitDraftAsBase = vi.fn();
const mockOnDone = vi.fn();
const mockUseStagedContentReveal = vi.fn((_options?: unknown) => ({
  revealStage: mockRevealStage,
  isRevealing: () => false,
  clearRevealingStates: vi.fn(),
}));

let mockHasUnsavedChanges = true;
let mockWorkItemType: WorkItemTypeKey = "STANDARD";
let mockWorkItemTypeFetched = true;
let mockWorkItemTypeDefinition: WorkItemTypeDefinitionDto | undefined;
let mockWorkItemSections = [
  {
    id: "section-description",
    key: "description",
    order: 0,
    materializedMarkdown: "Existing description",
    crdtSnapshotSeq: null,
  },
];
let mockDraft: Record<string, string> = {
  description: "Draft description",
  details: "Draft details",
  acceptanceCriteria: "Draft acceptance criteria",
  requirements: "",
};

const standardDefinition: WorkItemTypeDefinitionDto = {
  key: "STANDARD",
  name: "Standard",
  description: "Standard task",
  sections: [
    { key: "description", label: "Description" },
    { key: "acceptanceCriteria", label: "Acceptance Criteria" },
  ],
  allowedStatuses: [],
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (value: string) => value,
  }),
}));

vi.mock("../../../contexts/TrackingContext", () => ({
  TrackingProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../../../hooks/useUnsavedChangesGuard", () => ({
  useUnsavedChangesGuard: () => undefined,
}));

vi.mock("../../../hooks/useLocalDraftRecovery", () => ({
  useLocalDraftRecovery: () => undefined,
}));

vi.mock("../../../hooks/useLockedEditorSync", () => ({
  useLockedEditorSync: () => ({
    state: {
      draft: {
        ...mockDraft,
      },
    },
    hasUnsavedChanges: mockHasUnsavedChanges,
    applyUserPatch: mockApplyUserPatch,
    applyAcceptedSuggestion: mockApplyAcceptedSuggestion,
    applyServerRefresh: mockApplyServerRefresh,
    replaceDraft: mockReplaceDraft,
    discardDraft: mockDiscardDraft,
    commitDraftAsBase: mockCommitDraftAsBase,
  }),
}));

vi.mock("../../InteractionComponent/useEntityConversationLauncher", () => ({
  useEntityConversationLauncher: () => ({
    launch: vi.fn().mockResolvedValue(true),
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../../data/hooks/useProject", () => ({
  useProject: () => ({
    data: { id: "project-1", name: "Project 1" },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: () => ({
    workItem: {
      id: "task-1",
      name: "Task 1",
      organizationId: "org-1",
      initiativeId: "initiative-1",
      type: mockWorkItemType,
      status: WorkStatus.RefiningDescription,
      sections: mockWorkItemSections,
    },
    isLoading: false,
    error: null,
    refetch: mockRefetchWorkItem,
    markStale: mockMarkWorkItemStale,
  }),
}));

vi.mock("../../../data/hooks/useWorkItems", () => ({
  useWorkItems: () => ({
    updateTask: mockUpdateTask,
    updateInitiative: mockUpdateInitiative,
  }),
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: true,
    isReady: true,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypeByKey: () => ({
    workItemTypeDefinition: mockWorkItemTypeDefinition,
    isLoading: false,
    isFetched: mockWorkItemTypeFetched,
    error: null,
  }),
}));

vi.mock("../../AgentSession/RefinerChat", () => ({
  RefinerChat: ({
    onConversationReady,
    onRunBrowserContextChange,
  }: {
    onConversationReady?: (conversationId: string) => void;
    onRunBrowserContextChange?: (
      context: RunBrowserContextValue | null,
    ) => void;
  }) => {
    useEffect(() => {
      onConversationReady?.("conv-1");
    }, [onConversationReady]);
    useEffect(() => {
      onRunBrowserContextChange?.({
        runId: "session-1",
        sessionMachineId: "machine-1",
      });
    }, [onRunBrowserContextChange]);
    return <div data-testid="refiner-chat-mock" />;
  },
}));

vi.mock("../../../data/hooks/useStagedContentReveal", () => ({
  useStagedContentReveal: (...args: unknown[]) =>
    mockUseStagedContentReveal(...args),
}));

vi.mock("../../../data/hooks/useConversation", () => ({
  useConversation: () => ({
    data: { id: "conv-1" },
    isLoading: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../../../data/hooks/useConversationPolling", () => ({
  useConversationPolling: () => ({
    isWaitingForFirstMessage: false,
  }),
}));

vi.mock("../../../data/hooks/useDeleteConversation", () => ({
  useDeleteConversation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("../../../services/editorSync/suggestionAppliedBus", () => ({
  subscribeSuggestionAppliedEvent: () => () => undefined,
}));

vi.mock("../../Conversation", () => ({
  EditorConversationPanel: ({
    leftContent,
    rightContent,
    initiallyOpen,
    onConversationOpenChange,
  }: {
    leftContent: React.ReactNode;
    rightContent: React.ReactNode;
    initiallyOpen?: boolean;
    onConversationOpenChange?: (open: boolean) => void;
  }) => (
    <div
      data-testid="conversation-panel"
      data-initially-open={String(initiallyOpen ?? false)}
    >
      <button
        type="button"
        data-testid="open-conversation"
        onClick={() => onConversationOpenChange?.(true)}
      />
      <div>{leftContent}</div>
      <div>{rightContent}</div>
    </div>
  ),
}));

vi.mock("../../Conversation/ConversationViewer", () => ({
  ConversationViewer: () => <div data-testid="conversation-viewer-mock" />,
}));

vi.mock("../../ThinkingIndicator", () => ({
  ThinkingIndicator: () => <div data-testid="thinking-indicator-mock" />,
}));

vi.mock("../../DesignDoc/CreateDocumentModal", () => ({
  CreateDocumentModal: () => null,
}));

vi.mock("../../ActionsCapsule", () => ({
  CapsuleAction: ({
    id,
    label,
    onClick,
    disabled,
  }: {
    id: string;
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <button data-testid={id} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  ),
  AlignmentCheckCapsuleAction: () => null,
}));

vi.mock("../WorkItemRefinementActions", () => ({
  WorkItemRefinementActions: () => null,
}));

interface MockTemplateSection {
  id: string;
  content?: {
    showAsSkeleton?: boolean;
  };
}

interface MockTemplate {
  sections: MockTemplateSection[];
}

vi.mock("../UnifiedWorkItemEditor", () => ({
  UnifiedWorkItemEditor: ({
    template,
    mentionConfig,
    fileReferenceConfig,
    workItemId,
  }: {
    workItemId?: string;
    template?: MockTemplate;
    mentionConfig?: {
      organizationId: string;
      projectId: string;
    };
    fileReferenceConfig?: { scope: { kind: string } };
  }) => (
    <UnifiedEditorMockBody
      workItemId={workItemId}
      mentionConfig={mentionConfig}
      fileReferenceConfig={fileReferenceConfig}
      template={template}
    />
  ),
}));

const UnifiedEditorMockBody = ({
  template,
  mentionConfig,
  fileReferenceConfig,
  workItemId,
}: {
  workItemId?: string;
  template?: MockTemplate;
  mentionConfig?: { organizationId: string; projectId: string };
  fileReferenceConfig?: { scope: { kind: string } };
}) => {
  const run = useRunBrowserContext();
  return (
    <div
      data-testid="unified-editor-mock"
      data-work-item-id={workItemId ?? ""}
      data-run-id={run?.runId ?? ""}
      data-run-machine-id={run?.sessionMachineId ?? ""}
      data-mention-organization-id={mentionConfig?.organizationId ?? ""}
      data-mention-project-id={mentionConfig?.projectId ?? ""}
      data-file-reference-scope={fileReferenceConfig?.scope.kind ?? ""}
    >
      {template?.sections.map((section) => (
        <div
          key={section.id}
          data-testid={`section-${section.id}`}
          data-skeleton={section.content?.showAsSkeleton ? "true" : "false"}
        />
      ))}
    </div>
  );
};

const renderEditor = (onDone = mockOnDone): void => {
  render(
    <WorkItemEditor
      entityType="task"
      workItemId="task-1"
      organizationId="org-1"
      projectId="project-1"
      onDone={onDone}
    />,
  );
};

const waitForConversationReady = async (): Promise<void> => {
  await waitFor(() => {
    expect(screen.getByTestId("refiner-chat-mock")).toBeInTheDocument();
  });
};

describe("WorkItemEditor progressive sections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasUnsavedChanges = false;
    mockWorkItemType = "STANDARD";
    mockWorkItemTypeFetched = true;
    mockWorkItemTypeDefinition = standardDefinition;
    mockWorkItemSections = [
      {
        id: "section-description",
        key: "description",
        order: 0,
        materializedMarkdown: "Existing description",
        crdtSnapshotSeq: null,
      },
    ];
    mockDraft = {
      description: "Draft description",
      details: "Draft details",
      acceptanceCriteria: "Draft acceptance criteria",
      requirements: "",
    };

    mockRevealStage.mockResolvedValue({
      newStage: "acceptanceCriteria",
      progress: 66,
    });
    mockUpdateTask.mockResolvedValue(undefined);
    mockUpdateInitiative.mockResolvedValue(undefined);
    mockRefetchWorkItem.mockResolvedValue(undefined);
  });

  it("renders both description and acceptance criteria sections fully when refining", async () => {
    renderEditor();
    await waitForConversationReady();

    const description = await screen.findByTestId("section-description");
    const acceptance = screen.getByTestId("section-acceptanceCriteria");

    expect(description).toBeInTheDocument();
    expect(acceptance).toBeInTheDocument();
    expect(description.dataset.skeleton).toBe("false");
    expect(acceptance.dataset.skeleton).toBe("false");
  });

  it("does not surface a save-before-reveal dialog (reveal flow is hidden)", async () => {
    renderEditor();
    await waitForConversationReady();

    expect(
      screen.queryByTestId("save-before-reveal-dialog"),
    ).not.toBeInTheDocument();
  });

  it("mounts task authoring with project-scoped mention context", async () => {
    renderEditor();
    await waitForConversationReady();

    const editor = screen.getByTestId("unified-editor-mock");
    expect(editor).toHaveAttribute("data-mention-organization-id", "org-1");
    expect(editor).toHaveAttribute("data-mention-project-id", "project-1");
    expect(editor).not.toHaveAttribute("data-mention-conversation-id");
    expect(editor).toHaveAttribute("data-file-reference-scope", "task");
  });

  it("gives the editor the session's Run only once the conversation window is open", async () => {
    renderEditor();
    const editor = await screen.findByTestId("unified-editor-mock");
    expect(editor).toHaveAttribute("data-work-item-id", "task-1");
    await waitFor(() =>
      expect(screen.getByTestId("refiner-chat-mock")).toBeInTheDocument(),
    );
    expect(editor).toHaveAttribute("data-run-id", "");

    fireEvent.click(screen.getByTestId("open-conversation"));

    await waitFor(() =>
      expect(screen.getByTestId("unified-editor-mock")).toHaveAttribute(
        "data-run-id",
        "session-1",
      ),
    );
    expect(screen.getByTestId("unified-editor-mock")).toHaveAttribute(
      "data-run-machine-id",
      "machine-1",
    );
  });

  it("opens the conversation column by default for a mockup", async () => {
    mockWorkItemType = "mockup";
    renderEditor();

    const panel = await screen.findByTestId("conversation-panel");
    expect(panel).toHaveAttribute("data-initially-open", "true");
  });

  it("keeps the conversation column collapsed by default for other work items", async () => {
    renderEditor();

    const panel = await screen.findByTestId("conversation-panel");
    expect(panel).toHaveAttribute("data-initially-open", "false");
  });

  it("passes the ready conversation identity to staged-content reveal", async () => {
    renderEditor();
    await waitFor(() =>
      expect(mockUseStagedContentReveal).toHaveBeenLastCalledWith(
        expect.objectContaining({ conversationId: "conv-1" }),
      ),
    );
  });

  it("returns a standard work item to its owner on clean Done without history back", async () => {
    const historyBack = vi.spyOn(window.history, "back");

    renderEditor();
    await waitForConversationReady();
    fireEvent.click(screen.getByTestId("cancel-work-item"));

    expect(mockOnDone).toHaveBeenCalledWith("task-1");
    expect(historyBack).not.toHaveBeenCalled();
    historyBack.mockRestore();
  });

  it("uses the same clean Done callback for a registry-defined custom work item", async () => {
    mockWorkItemType = "RESEARCH";
    mockWorkItemTypeDefinition = {
      key: "RESEARCH",
      name: "Research",
      sections: [
        { key: "sources", label: "Evidence sources" },
        { key: "findings", label: "Findings" },
      ],
      allowedStatuses: [],
    };

    renderEditor();
    await waitForConversationReady();
    fireEvent.click(screen.getByTestId("cancel-work-item"));

    expect(mockOnDone).toHaveBeenCalledWith("task-1");
  });

  it("mounts feature authoring with the same project-scoped mention context", async () => {
    mockWorkItemType = "FEATURE";
    mockWorkItemTypeDefinition = {
      key: "FEATURE",
      name: "Feature",
      sections: [
        { key: "description", label: "Description" },
        { key: "requirements", label: "Requirements" },
      ],
      allowedStatuses: [],
    };

    renderEditor();
    await waitForConversationReady();

    const editor = screen.getByTestId("unified-editor-mock");
    expect(editor).toHaveAttribute("data-mention-organization-id", "org-1");
    expect(editor).toHaveAttribute("data-mention-project-id", "project-1");
    expect(editor).not.toHaveAttribute("data-mention-conversation-id");
    expect(editor).toHaveAttribute("data-file-reference-scope", "feature");
  });

  it("renders project-defined custom sections from the resolved definition", async () => {
    mockWorkItemType = "RESEARCH";
    mockWorkItemTypeDefinition = {
      key: "RESEARCH",
      name: "Research",
      sections: [
        { key: "sources", label: "Evidence sources" },
        { key: "findings", label: "Findings" },
      ],
      allowedStatuses: [],
    };
    mockWorkItemSections = [
      {
        id: "section-sources",
        key: "sources",
        order: 0,
        materializedMarkdown: "Primary evidence",
        crdtSnapshotSeq: null,
      },
      {
        id: "section-findings",
        key: "findings",
        order: 1,
        materializedMarkdown: "Research result",
        crdtSnapshotSeq: null,
      },
    ];

    renderEditor();
    await waitForConversationReady();

    const editorSections = screen
      .getAllByTestId(/^section-/)
      .map((section) => section.dataset.testid);
    expect(screen.getByTestId("section-sources")).toBeInTheDocument();
    expect(screen.getByTestId("section-findings")).toBeInTheDocument();
    expect(editorSections).toEqual(["section-sources", "section-findings"]);
    expect(mockApplyServerRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: "Primary evidence",
        findings: "Research result",
      }),
    );
  });

  it("withholds the editor after an unresolved type lookup", async () => {
    mockWorkItemType = "UNKNOWN";
    mockWorkItemTypeDefinition = undefined;

    renderEditor();

    expect(
      await screen.findByTestId("work-item-type-unavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("unified-editor-mock")).not.toBeInTheDocument();
  });

  it("submits registry-selected structured mockup JSON in the proposal payload", async () => {
    const structuredDocument = JSON.stringify({
      schemaVersion: "work-item-structured-mockup.v1",
      content: [
        {
          type: "button",
          props: {
            id: "primary",
            width: { mode: "fit" },
            height: { mode: "content" },
            label: "Save",
          },
        },
        {
          type: "button",
          props: {
            id: "secondary",
            width: { mode: "fit" },
            height: { mode: "content" },
            label: "Cancel",
          },
        },
      ],
    });
    mockWorkItemType = "MOCKUP";
    mockWorkItemTypeDefinition = {
      key: "MOCKUP",
      name: "Mockup",
      sections: [{ key: "mockup", label: "Mockup", kind: "structured-mockup" }],
      allowedStatuses: [],
    };
    mockWorkItemSections = [
      {
        id: "section-mockup",
        key: "mockup",
        order: 0,
        materializedMarkdown: structuredDocument,
        crdtSnapshotSeq: null,
      },
    ];
    mockDraft = { ...mockDraft, mockup: structuredDocument };
    mockHasUnsavedChanges = true;

    renderEditor();
    await waitForConversationReady();
    fireEvent.click(screen.getByTestId("save-work-item"));
    fireEvent.change(await screen.findByTestId("save-reason-input"), {
      target: { value: "Improve mockup" },
    });
    fireEvent.click(screen.getByTestId("save-reason-submit"));

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalled());
    expect(mockUpdateTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        sections: [
          expect.objectContaining({
            key: "mockup",
            content: {
              ...JSON.parse(structuredDocument),
              schemaVersion: "work-item-structured-mockup.v3",
              revision: 1,
              annotations: [],
            },
          }),
        ],
        reason: "Improve mockup",
      }),
      expect.any(Object),
    );
    expect(mockCommitDraftAsBase).toHaveBeenCalled();
  });

  it("discards structured edits through the shared editing lifecycle", async () => {
    mockHasUnsavedChanges = true;
    renderEditor();
    await waitForConversationReady();
    fireEvent.click(screen.getByTestId("cancel-work-item"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Discard changes" }),
    );
    expect(mockDiscardDraft).toHaveBeenCalled();
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });
});
