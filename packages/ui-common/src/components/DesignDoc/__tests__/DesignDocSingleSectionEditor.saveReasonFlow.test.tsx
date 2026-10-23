import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesignDocSingleSectionEditor } from "../DesignDocSingleSectionEditor";

type CapsuleActionMockProps = {
  id: string;
  label?: string;
  onClick?: () => void | Promise<void>;
  disabled?: boolean;
};

const mockUpdateDesignDoc = vi.fn();
const mockDiscardDraft = vi.fn();
const mockCommitDraftAsBase = vi.fn();
const mockApplyUserPatch = vi.fn();
const mockApplyAcceptedSuggestion = vi.fn();
const mockApplyServerRefresh = vi.fn();
const mockReplaceDraft = vi.fn();
const mockOnDone = vi.fn();

let mockHasUnsavedChanges = true;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}));

vi.mock("../../../contexts", () => ({
  DesignDocCollabProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../../../data/hooks/useUpdateDesignDoc", () => ({
  useUpdateDesignDoc: () => ({ mutate: mockUpdateDesignDoc }),
  UpdateDesignDocResultStatus: { Applied: "APPLIED", Pending: "PENDING" },
}));

vi.mock("../../../hooks/useLocalDraftRecovery", () => ({
  useLocalDraftRecovery: () => undefined,
}));

vi.mock("../../../hooks/useUnsavedChangesGuard", () => ({
  useUnsavedChangesGuard: () => undefined,
}));

vi.mock("../../../hooks/useLockedEditorSync", () => ({
  useLockedEditorSync: () => ({
    state: {
      draft: { content: "Edited content" },
      base: { content: "Original content" },
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

vi.mock("../../../services/editorSync/suggestionAppliedBus", () => ({
  subscribeSuggestionAppliedEvent: () => () => undefined,
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
}));

vi.mock("../../AgentSession/RefinerChat", () => ({
  RefinerChat: () => <div data-testid="refiner-chat-mock" />,
}));

vi.mock("../../Conversation", () => ({
  EditorConversationPanel: ({
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
}));

vi.mock("../../SmartTextAreaCard", () => ({
  SmartTextAreaCard: () => <div data-testid="smart-textarea-mock" />,
}));

vi.mock("../DesignDocExportPanel", () => ({
  DesignDocExportPanel: () => <div data-testid="export-panel-mock" />,
}));

vi.mock("../DesignDocSingleSectionEditorContent", () => ({
  DesignDocSingleSectionEditorContent: () => (
    <div data-testid="single-section-content-mock" />
  ),
}));

vi.mock("../useDesignDocCollabBridgeValue", () => ({
  useDesignDocCollabBridgeValue: () => ({}),
}));

const renderEditor = (onDone = mockOnDone): void => {
  render(
    <DesignDocSingleSectionEditor
      designDocId="doc-1"
      organizationId="org-1"
      projectId="project-1"
      sections={[
        {
          id: "section-content",
          key: "content",
          order: 0,
          materializedMarkdown: "Original content",
          crdtSnapshotSeq: null,
        },
      ]}
      templateLabel="Brainstorm"
      titlePlaceholder="Title"
      summaryPlaceholder="Summary"
      contentPlaceholder="Content"
      exportHeaderText="Export"
      exportDescriptionText="Export this"
      exportButtonText="Download"
      exportFallbackFilename="doc"
      onDone={onDone}
    />
  );
};

describe("DesignDocSingleSectionEditor save-reason flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasUnsavedChanges = true;
    mockUpdateDesignDoc.mockResolvedValue({
      status: "APPLIED",
      designDoc: { id: "doc-1" },
    });
  });

  it("opens the SaveReasonModal on a content save instead of patching", async () => {
    renderEditor();

    expect(screen.queryByTestId("save-reason-modal")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("capsule-save-design-doc"));

    await waitFor(() => {
      expect(screen.getByTestId("save-reason-modal")).toBeInTheDocument();
    });
    expect(mockUpdateDesignDoc).not.toHaveBeenCalled();
  });

  it("does not PATCH when the user cancels the modal", async () => {
    renderEditor();

    await userEvent.click(screen.getByTestId("capsule-save-design-doc"));
    await screen.findByTestId("save-reason-modal");
    await userEvent.click(screen.getByTestId("save-reason-cancel"));

    expect(mockUpdateDesignDoc).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId("save-reason-modal")).not.toBeInTheDocument();
    });
  });

  it("forwards an empty reason and the section content on submit", async () => {
    renderEditor();

    await userEvent.click(screen.getByTestId("capsule-save-design-doc"));
    await screen.findByTestId("save-reason-modal");
    await userEvent.click(screen.getByTestId("save-reason-submit"));

    await waitFor(() => {
      expect(mockUpdateDesignDoc).toHaveBeenCalledTimes(1);
    });
    const [variables] = mockUpdateDesignDoc.mock.calls[0];
    expect(variables.designDocId).toBe("doc-1");
    expect(variables.updates.reason).toBe("");
    expect(Array.isArray(variables.updates.sections)).toBe(true);
    expect(mockCommitDraftAsBase).toHaveBeenCalledTimes(1);
  });

  it("forwards a trimmed reason on submit", async () => {
    renderEditor();

    await userEvent.click(screen.getByTestId("capsule-save-design-doc"));
    await screen.findByTestId("save-reason-modal");
    await userEvent.type(
      screen.getByTestId("save-reason-input"),
      "  Sharpen wording  "
    );
    await userEvent.click(screen.getByTestId("save-reason-submit"));

    await waitFor(() => {
      expect(mockUpdateDesignDoc).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateDesignDoc.mock.calls[0][0].updates.reason).toBe(
      "Sharpen wording"
    );
  });

  it("rolls back and shows the pending indicator on a PENDING result", async () => {
    mockUpdateDesignDoc.mockResolvedValue({
      status: "PENDING",
      designDoc: { id: "doc-1" },
      proposal: { id: "prop-1" },
    });

    renderEditor();

    await userEvent.click(screen.getByTestId("capsule-save-design-doc"));
    await screen.findByTestId("save-reason-modal");
    await userEvent.click(screen.getByTestId("save-reason-submit"));

    await waitFor(() => {
      expect(
        screen.getByTestId("pending-proposal-indicator")
      ).toBeInTheDocument();
    });
    expect(mockDiscardDraft).toHaveBeenCalledTimes(1);
    expect(mockCommitDraftAsBase).not.toHaveBeenCalled();
  });

  it("does not open the modal when there are no unsaved changes", async () => {
    mockHasUnsavedChanges = false;
    renderEditor();

    await userEvent.click(screen.getByTestId("capsule-save-design-doc"));

    expect(screen.queryByTestId("save-reason-modal")).not.toBeInTheDocument();
    expect(mockUpdateDesignDoc).not.toHaveBeenCalled();
  });

  it("returns a clean single-section design doc through its identity callback", async () => {
    mockHasUnsavedChanges = false;
    const historyBack = vi.spyOn(window.history, "back");

    renderEditor();
    await userEvent.click(screen.getByTestId("capsule-cancel-design-doc"));

    expect(mockOnDone).toHaveBeenCalledWith("doc-1");
    expect(historyBack).not.toHaveBeenCalled();
    historyBack.mockRestore();
  });
});
