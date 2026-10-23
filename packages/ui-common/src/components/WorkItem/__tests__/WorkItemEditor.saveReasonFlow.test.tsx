import React, { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkStatus } from "../../../api";
import { WorkItemEditor } from "../WorkItemEditor";

type CapsuleActionMockProps = {
  id: string;
  label?: string;
  onClick?: () => void | Promise<void>;
  disabled?: boolean;
};

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

let mockHasUnsavedChanges = true;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (value: string) => value }),
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
        description: "Edited description",
        acceptanceCriteria: "",
        requirements: "",
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
      type: "STANDARD",
      status: WorkStatus.Backlog,
      sections: [
        {
          id: "section-description",
          key: "description",
          order: 0,
          materializedMarkdown: "Existing description",
          crdtSnapshotSeq: null,
        },
      ],
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
    workItemTypeDefinition: {
      key: "STANDARD",
      name: "Standard",
      sections: [
        { key: "description", label: "Description" },
        { key: "acceptanceCriteria", label: "Acceptance Criteria" },
      ],
      allowedStatuses: [],
    },
    isLoading: false,
    isFetched: true,
    error: null,
  }),
}));

vi.mock("../../AgentSession/RefinerChat", () => ({
  RefinerChat: ({
    onConversationReady,
  }: {
    onConversationReady?: (conversationId: string) => void;
  }) => {
    useEffect(() => {
      onConversationReady?.("conv-1");
    }, [onConversationReady]);
    return <div data-testid="refiner-chat-mock" />;
  },
}));

vi.mock("../../../data/hooks/useStagedContentReveal", () => ({
  useStagedContentReveal: () => ({
    revealStage: vi.fn(),
    isRevealing: () => false,
    clearRevealingStates: vi.fn(),
  }),
}));

vi.mock("../../../data/hooks/useConversation", () => ({
  useConversation: () => ({
    data: null,
    isLoading: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../../../data/hooks/useConversationPolling", () => ({
  useConversationPolling: () => ({ isWaitingForFirstMessage: false }),
}));

vi.mock("../../../data/hooks/useDeleteConversation", () => ({
  useDeleteConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../../../services/editorSync/suggestionAppliedBus", () => ({
  subscribeSuggestionAppliedEvent: () => () => undefined,
}));

vi.mock("../../Conversation", () => ({
  EditorConversationPanel: ({
    leftContent,
    rightContent,
  }: {
    leftContent: React.ReactNode;
    rightContent: React.ReactNode;
  }) => (
    <div data-testid="editor-conversation-panel">
      <div>{leftContent}</div>
      <div>{rightContent}</div>
    </div>
  ),
  ConversationPanelLayout: ({
    leftContent,
    rightContent,
  }: {
    leftContent: React.ReactNode;
    rightContent: React.ReactNode;
  }) => (
    <div data-testid="conversation-panel">
      <div>{leftContent}</div>
      <div>{rightContent}</div>
    </div>
  ),
  useConversationPanel: () => ({ isExpanded: false, toolbarButtons: [] }),
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

// Render CapsuleAction as a plain button so the save click is reachable.
vi.mock("../../ActionsCapsule", () => ({
  CapsuleAction: ({ id, label, onClick, disabled }: CapsuleActionMockProps) => (
    <button
      type="button"
      data-testid={`capsule-${id}`}
      onClick={() => {
        void onClick?.();
      }}
      disabled={disabled}
    >
      {label}
    </button>
  ),
  AlignmentCheckCapsuleAction: () => null,
}));

vi.mock("../WorkItemRefinementActions", () => ({
  WorkItemRefinementActions: () => null,
}));

vi.mock("../UnifiedWorkItemEditor", () => ({
  UnifiedWorkItemEditor: () => <div data-testid="unified-editor-mock" />,
}));

const renderEditor = (): void => {
  render(
    <WorkItemEditor
      entityType="task"
      workItemId="task-1"
      organizationId="org-1"
      projectId="project-1"
    />
  );
};

describe("WorkItemEditor save-reason flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasUnsavedChanges = true;
    mockUpdateTask.mockResolvedValue(undefined);
    mockRefetchWorkItem.mockResolvedValue(undefined);
  });

  it("opens the SaveReasonModal when the user triggers save with content edits", async () => {
    renderEditor();

    expect(screen.queryByTestId("save-reason-modal")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("capsule-save-work-item"));

    await waitFor(() => {
      expect(screen.getByTestId("save-reason-modal")).toBeInTheDocument();
    });
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it("forwards an empty reason when the user submits without typing", async () => {
    renderEditor();

    await userEvent.click(screen.getByTestId("capsule-save-work-item"));
    await screen.findByTestId("save-reason-modal");
    await userEvent.click(screen.getByTestId("save-reason-submit"));

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledTimes(1);
    });
    const [taskId, body] = mockUpdateTask.mock.calls[0];
    expect(taskId).toBe("task-1");
    expect(body.reason).toBe("");
    expect(body.sections).toEqual([
      { key: "description", content: "Edited description", order: 0 },
      { key: "acceptanceCriteria", content: "", order: 1 },
    ]);
    expect(mockUpdateTask.mock.calls[0][2].sectionSelection).toMatchObject({
      status: "resolved",
      typeKey: "STANDARD",
    });
  });

  it("forwards a non-empty trimmed reason on submit", async () => {
    renderEditor();

    await userEvent.click(screen.getByTestId("capsule-save-work-item"));
    await screen.findByTestId("save-reason-modal");
    await userEvent.type(
      screen.getByTestId("save-reason-input"),
      "  Tightening copy  "
    );
    await userEvent.click(screen.getByTestId("save-reason-submit"));

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateTask.mock.calls[0][1].reason).toBe("Tightening copy");
  });

  it("does not PATCH when the user cancels the modal", async () => {
    renderEditor();

    await userEvent.click(screen.getByTestId("capsule-save-work-item"));
    await screen.findByTestId("save-reason-modal");
    await userEvent.click(screen.getByTestId("save-reason-cancel"));

    expect(mockUpdateTask).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId("save-reason-modal")).not.toBeInTheDocument();
    });
  });

  it("surfaces the pending-proposal indicator after the server stages the edit", async () => {
    mockUpdateTask.mockImplementation(
      async (
        _id: string,
        _updates: unknown,
        callbacks?: {
          onPendingProposal?: (proposal: unknown, task: unknown) => void;
        }
      ) => {
        callbacks?.onPendingProposal?.({ id: "prop-1" }, { id: "task-1" });
        return undefined;
      }
    );

    renderEditor();

    await userEvent.click(screen.getByTestId("capsule-save-work-item"));
    await screen.findByTestId("save-reason-modal");
    await userEvent.click(screen.getByTestId("save-reason-submit"));

    await waitFor(() => {
      expect(
        screen.getByTestId("pending-proposal-indicator")
      ).toBeInTheDocument();
    });
  });

  it("does not open the modal when there are no unsaved changes (quick-toggle path stays unblocked)", async () => {
    mockHasUnsavedChanges = false;
    renderEditor();

    await userEvent.click(screen.getByTestId("capsule-save-work-item"));

    expect(screen.queryByTestId("save-reason-modal")).not.toBeInTheDocument();
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });
});
