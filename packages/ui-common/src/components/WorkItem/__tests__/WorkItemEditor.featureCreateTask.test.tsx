import React, { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CurrentControllerMachineEligibilityState,
  WorkStatus,
} from "../../../api";
import type { WorkItemTypeDefinitionDto } from "../../../api";
import type { WorkItemTypeKey } from "../../../constants/taskTypes";
import { WorkItemEditor } from "../WorkItemEditor";

type CapsuleActionMockProps = {
  id: string;
  label?: string;
  onClick?: () => void | Promise<void>;
  disabled?: boolean;
};

const mockUpdateTask = vi.fn();
const mockRefetchWorkItem = vi.fn();
const mockMarkWorkItemStale = vi.fn();
const mockLaunch = vi.fn();

// Type of the work item under test — switched per test before rendering.
let mockWorkItemType: WorkItemTypeKey = "FEATURE";

const workItemTypeDefinitions: Record<string, WorkItemTypeDefinitionDto> = {
  FEATURE: {
    key: "FEATURE",
    label: "Feature",
    sections: [
      { key: "description", label: "Description", writingStandard: "" },
      { key: "requirements", label: "Requirements", writingStandard: "" },
    ],
  } as WorkItemTypeDefinitionDto,
  STANDARD: {
    key: "STANDARD",
    label: "Task",
    sections: [
      { key: "description", label: "Description", writingStandard: "" },
      {
        key: "acceptanceCriteria",
        label: "Acceptance Criteria",
        writingStandard: "",
      },
    ],
  } as WorkItemTypeDefinitionDto,
  BUG: {
    key: "BUG",
    label: "Bug",
    sections: [
      { key: "description", label: "Description", writingStandard: "" },
    ],
  } as WorkItemTypeDefinitionDto,
};

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
      base: {
        description: "Original feature description",
        acceptanceCriteria: "",
        requirements: "Original requirements",
      },
      draft: {
        description: "Updated feature description",
        acceptanceCriteria: "",
        requirements: "Original requirements",
      },
    },
    hasUnsavedChanges: true,
    applyUserPatch: vi.fn(),
    applyAcceptedSuggestion: vi.fn(),
    applyServerRefresh: vi.fn(),
    replaceDraft: vi.fn(),
    discardDraft: vi.fn(),
    commitDraftAsBase: vi.fn(),
  }),
}));

vi.mock("../../InteractionComponent/useEntityConversationLauncher", () => ({
  useEntityConversationLauncher: () => ({
    launch: mockLaunch,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({
    isReady: true,
    machines: [
      {
        machineId: "machine-1",
        name: "CLI One",
        active: true,
        authorizationProtocolVersion: 2,
        executionReadiness: "READY",
        currentControllerEligibility:
          CurrentControllerMachineEligibilityState.Eligible,
        bindings: [],
      },
    ],
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
      type: mockWorkItemType,
      status: WorkStatus.Backlog,
      serviceRelations: [{ serviceId: "service-1" }],
      sections: [
        {
          id: "section-description",
          key: "description",
          order: 0,
          materializedMarkdown: "Original feature description",
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

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: true,
    isReady: true,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypeByKey: () => ({
    workItemTypeDefinition: workItemTypeDefinitions[mockWorkItemType],
    isLoading: false,
    isFetched: true,
  }),
}));

vi.mock("../../../data/hooks/useWorkItems", () => ({
  useWorkItems: () => ({
    updateTask: mockUpdateTask,
    updateInitiative: vi.fn(),
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
      title="Realtime Sync"
    />
  );
};

describe("WorkItemEditor — Submit and Create Task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkItemType = "FEATURE";
    mockUpdateTask.mockResolvedValue(undefined);
    mockRefetchWorkItem.mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue(true);
  });

  it("shows the Submit and Create Task button for feature work items", async () => {
    renderEditor();

    await userEvent.click(screen.getByTestId("capsule-save-work-item"));
    await screen.findByTestId("save-reason-modal");

    expect(screen.getByTestId("save-reason-secondary")).toHaveTextContent(
      "Submit and Create Task"
    );
  });

  it("does not show the button for standard tasks", async () => {
    mockWorkItemType = "STANDARD";
    renderEditor();

    await userEvent.click(screen.getByTestId("capsule-save-work-item"));
    await screen.findByTestId("save-reason-modal");

    expect(
      screen.queryByTestId("save-reason-secondary")
    ).not.toBeInTheDocument();
  });

  it("does not show the button for bug tasks", async () => {
    mockWorkItemType = "BUG";
    renderEditor();

    await userEvent.click(screen.getByTestId("capsule-save-work-item"));
    await screen.findByTestId("save-reason-modal");

    expect(
      screen.queryByTestId("save-reason-secondary")
    ).not.toBeInTheDocument();
  });

  it("saves the feature edit and launches the entity-conversation with the synthetic diff message", async () => {
    renderEditor();

    await userEvent.click(screen.getByTestId("capsule-save-work-item"));
    await screen.findByTestId("save-reason-modal");
    await userEvent.type(
      screen.getByTestId("save-reason-input"),
      "  Sharpening the spec  "
    );
    await userEvent.click(screen.getByTestId("save-reason-secondary"));

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateTask.mock.calls[0][0]).toBe("task-1");
    expect(mockUpdateTask.mock.calls[0][1].reason).toBe("Sharpening the spec");

    await waitFor(() => {
      expect(mockLaunch).toHaveBeenCalledTimes(1);
    });
    const [launchInput] = mockLaunch.mock.calls[0];
    expect(launchInput.prompt).toContain("I just updated this feature.");
    expect(launchInput.prompt).toContain("Updated feature description");
    expect(launchInput.prompt).toContain(
      "Please draft a task to implement these changes."
    );
    expect(launchInput.context).toEqual({
      entityId: "task-1",
      entityType: "TASK",
      entitySubtype: "FEATURE",
      entityTitle: "Realtime Sync",
    });
    expect(launchInput.machineId).toBe("machine-1");
    expect(launchInput.machineId).not.toBe("service-1");
  });

  it("does not launch the conversation when the save fails", async () => {
    mockUpdateTask.mockRejectedValue(new Error("save failed"));
    renderEditor();

    await userEvent.click(screen.getByTestId("capsule-save-work-item"));
    await screen.findByTestId("save-reason-modal");
    await userEvent.click(screen.getByTestId("save-reason-secondary"));

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledTimes(1);
    });
    expect(mockLaunch).not.toHaveBeenCalled();
  });
});
