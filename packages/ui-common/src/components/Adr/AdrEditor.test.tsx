import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdrStatus, EntityType } from "../../api";

const refinerProps: Record<string, unknown> = {};
const mockOnDone = vi.fn();
let reportConversationReady: ((conversationId: string) => void) | undefined;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}));

vi.mock("../../contexts", () => ({
  DesignDocCollabProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../../contexts/WalkthroughContext", () => ({
  useOptionalWalkthroughContext: () => null,
  WalkthroughProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  WalkthroughType: { DESIGN_DOC_EDITOR: "DESIGN_DOC_EDITOR" },
}));

vi.mock("../../data/hooks/useUpdateDesignDoc", () => ({
  useUpdateDesignDoc: () => ({ mutate: vi.fn(), error: null }),
  UpdateDesignDocResultStatus: { PendingApproval: "PENDING_APPROVAL" },
}));

vi.mock("../../hooks/useLocalDraftRecovery", () => ({
  useLocalDraftRecovery: () => undefined,
}));

vi.mock("../../hooks/useUnsavedChangesGuard", () => ({
  useUnsavedChangesGuard: () => undefined,
}));

vi.mock("../ActionsCapsule", () => ({
  CapsuleAction: ({
    id,
    label,
    onClick,
    disabled,
  }: {
    id: string;
    label?: string;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" data-testid={`capsule-${id}`} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  ),
  useTaskGenerationCapsuleAction: () => null,
}));

vi.mock("../Conversation", () => ({
  EditorConversationPanel: ({
    leftContent,
    rightContent,
  }: {
    leftContent: React.ReactNode;
    rightContent: React.ReactNode;
  }) => (
    <div>
      {leftContent}
      {rightContent}
    </div>
  ),
}));

vi.mock("../AgentSession/RefinerChat", () => ({
  RefinerChat: (props: Record<string, unknown>) => {
    Object.assign(refinerProps, props);
    reportConversationReady = props.onConversationReady as
      | ((conversationId: string) => void)
      | undefined;
    return <div data-testid="refiner-chat-mock" />;
  },
}));

vi.mock("./AdrEditorContentEditor", () => ({
  AdrEditorContentEditor: ({
    conversationId,
  }: {
    conversationId?: string;
  }) => (
    <div
      data-testid="adr-content-editor"
      data-conversation-id={conversationId}
    />
  ),
}));

vi.mock("../SmartTextAreaCard", () => ({ SmartTextAreaCard: () => null }));
vi.mock("../Walkthrough/DesignDocEditorWalkthrough", () => ({
  DesignDocEditorWalkthrough: () => null,
}));
vi.mock("./useCollabBridgeValue", () => ({
  useCollabBridgeValue: () => undefined,
}));

import { AdrEditor } from "./AdrEditor";

describe("AdrEditor refinement", () => {
  beforeEach(() => {
    for (const key of Object.keys(refinerProps)) {
      delete refinerProps[key];
    }
    reportConversationReady = undefined;
    mockOnDone.mockReset();
  });

  it("renders the editor before refinement and binds the persisted conversation when ready", () => {
    render(
      <AdrEditor
        adrId="adr-1"
        organizationId="org-1"
        projectId="project-1"
        title="Choose a queue"
        summary="Record the delivery decision"
        status={AdrStatus.AdrContext}
        sections={[]}
        onDone={mockOnDone}
      />
    );

    expect(screen.getByTestId("refiner-chat-mock")).toBeInTheDocument();
    expect(refinerProps).toMatchObject({
      organizationId: "org-1",
      projectId: "project-1",
      entityType: EntityType.DesignDoc,
      entityId: "adr-1",
      entityName: "Choose a queue",
      entitySummary: "Record the delivery decision",
    });
    expect(screen.getByTestId("adr-content-editor")).not.toHaveAttribute(
      "data-conversation-id"
    );

    act(() => reportConversationReady?.("adr-conversation-1"));

    expect(screen.getByTestId("adr-content-editor")).toHaveAttribute(
      "data-conversation-id",
      "adr-conversation-1"
    );
  });

  it("returns a clean ADR through its identity callback without browser history", () => {
    const historyBack = vi.spyOn(window.history, "back");

    render(
      <AdrEditor
        adrId="adr-1"
        organizationId="org-1"
        projectId="project-1"
        title="Choose a queue"
        summary="Record the delivery decision"
        status={AdrStatus.AdrContext}
        sections={[]}
        onDone={mockOnDone}
      />
    );

    fireEvent.click(screen.getByTestId("capsule-cancel-adr"));

    expect(mockOnDone).toHaveBeenCalledWith("adr-1");
    expect(historyBack).not.toHaveBeenCalled();
    historyBack.mockRestore();
  });
});
