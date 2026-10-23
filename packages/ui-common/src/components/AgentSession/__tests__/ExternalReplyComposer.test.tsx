import { loadContentWithMentions } from "../../SmarterTextAreaCard/serializationUtils";
import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExternalReplyComposer } from "../ExternalReplyComposer";
import type { AgentSessionMetadataValues } from "../AgentSessionMetadata";
import { FeatureReferenceMatchNode } from "../../SmarterTextAreaCard/FeatureReferenceMatchNode";
import { FileReferenceNode } from "../../SmarterTextAreaCard/fileReferences/FileReferenceNode";
import { MentionNode } from "../../SmarterTextAreaCard/MentionNode";

// Keep real editor state, conversion, serialization and typed-intent reading in transport tests.
const lexicalConfig = vi.hoisted(() => ({ nodes: [] as readonly unknown[] }));
vi.mock("@lexical/react/LexicalComposer", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@lexical/react/LexicalComposer")
  >();
  return {
    LexicalComposer: (
      props: React.ComponentProps<typeof actual.LexicalComposer>
    ) => {
      lexicalConfig.nodes = props.initialConfig.nodes ?? [];
      return <actual.LexicalComposer {...props} />;
    },
  };
});

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

vi.mock("@lexical/react/LexicalOnChangePlugin", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@lexical/react/LexicalOnChangePlugin")
  >();
  const { useLexicalComposerContext } = await import(
    "@lexical/react/LexicalComposerContext"
  );
  return {
    OnChangePlugin: (
      props: React.ComponentProps<typeof actual.OnChangePlugin>
    ) => {
      const [editor] = useLexicalComposerContext();
      return (
        <>
          <actual.OnChangePlugin {...props} />
          <textarea
            data-testid="mock-editor-input"
            onChange={(event) => {
              const value = event.target.value;
              editor.update(() => loadContentWithMentions(value), {
                discrete: true,
              });
              props.onChange(editor.getEditorState(), editor, new Set());
            }}
          />
        </>
      );
    },
  };
});

vi.mock("../../SmarterTextAreaCard/MentionPlugin", () => ({
  MentionPlugin: () => null,
}));

vi.mock("../../SmarterTextAreaCard/FeatureReferenceDiscoveryPlugin", () => ({
  FeatureReferenceDiscoveryPlugin: ({
    organizationId,
    projectId,
  }: {
    organizationId: string;
    projectId: string;
  }) => (
    <div
      data-testid="mock-feature-reference-discovery"
      data-organization-id={organizationId}
      data-project-id={projectId}
    />
  ),
}));

vi.mock(
  "../../SmarterTextAreaCard/slashCommands/RichSlashCommandPlugin",
  () => ({
    RichSlashCommandPlugin: ({
      organizationId,
      projectId,
      surfaceContext,
      agentContext,
    }: {
      organizationId: string | null;
      projectId: string | null;
      surfaceContext: {
        focalEntity: { kind: "none" };
        subagentCommandAvailable?: boolean;
        messageAgentCommandAvailable?: boolean;
        cachedConversationMentionOptions: readonly unknown[];
      };
      agentContext?: {
        onSkillSelected: (selection: {
          provider: "codex";
          name: string;
          catalogScope: "repo";
        }) => void;
      } | null;
    }) => (
      <>
        <div
          data-testid="mock-rich-slash-command-plugin"
          data-organization-id={organizationId ?? ""}
          data-project-id={projectId ?? ""}
          data-focal-kind={surfaceContext.focalEntity.kind}
          data-subagent-available={String(
            surfaceContext.subagentCommandAvailable
          )}
          data-message-agent-available={String(
            surfaceContext.messageAgentCommandAvailable
          )}
        />
        {agentContext ? (
          <button
            type="button"
            data-testid="mock-select-skill"
            onClick={() =>
              agentContext.onSkillSelected({
                provider: "codex",
                name: "release-check",
                catalogScope: "repo",
              })
            }
          >
            Select Skill
          </button>
        ) : null}
      </>
    ),
  })
);

vi.mock("../../SmarterTextAreaCard/fileReferences/FileReferencePlugin", () => ({
  FileReferencePlugin: ({
    config,
  }: {
    config: {
      organizationId: string;
      projectId: string;
      scope: { kind: string };
    };
  }) => (
    <div
      data-testid="mock-file-reference-plugin"
      data-organization-id={config.organizationId}
      data-project-id={config.projectId}
      data-scope-kind={config.scope.kind}
    />
  ),
}));

vi.mock("../../SmarterTextAreaCard/EntityDropPlugin", () => ({
  EntityDropPlugin: () => <div data-testid="mock-entity-drop-plugin" />,
}));

vi.mock("../../../data/hooks/useMentionEntitySearch", () => ({
  useMentionEntitySearch: () => ({ searchEntities: vi.fn() }),
}));

const messageContext = {
  organizationId: "org-1",
  projectId: "proj-1",
  conversationId: "conv-1",
};

const renderComposer = (
  onSubmitReply: React.ComponentProps<
    typeof ExternalReplyComposer
  >["onSubmitReply"],
  agentSessionMetadata?: AgentSessionMetadataValues,
  attachmentTarget: React.ComponentProps<
    typeof ExternalReplyComposer
  >["attachmentTarget"] = null
) =>
  render(
    <MemoryRouter>
      <ExternalReplyComposer
        attachmentTarget={attachmentTarget}
        subagentCapability={{
          kind: "unavailable",
          reason: "Subagent commands require an attached Agent Session.",
        }}
        availability={{ available: true }}
        messageContext={messageContext}
        submittingPrompt={false}
        onSubmitReply={onSubmitReply}
        {...(agentSessionMetadata ? { agentSessionMetadata } : {})}
      />
    </MemoryRouter>
  );

beforeEach(() => {
  lexicalConfig.nodes = [];
  localStorage.clear();
});

describe("ExternalReplyComposer new-conversation button", () => {
  it("omits the empty attachment row before and after focusing the editor", () => {
    renderComposer(vi.fn());
    expect(screen.queryByTestId("run-attachments")).not.toBeInTheDocument();
    fireEvent.focus(screen.getByTestId("run-stream-external-reply-input"));
    expect(screen.queryByTestId("run-attachments")).not.toBeInTheDocument();
    fireEvent.blur(screen.getByTestId("run-stream-external-reply-input"));
    expect(screen.queryByTestId("run-attachments")).not.toBeInTheDocument();
  });

  it("explains that model changes require a new conversation", async () => {
    const { rerender } = render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
          agentSessionMetadata={{ provider: "claude", model: "opus" }}
        />
      </MemoryRouter>
    );

    expect(
      screen.queryByTestId("run-stream-model-change-tooltip-target")
    ).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
          onCreateNewConversation={vi.fn(async () => {})}
          agentSessionMetadata={{ provider: "claude", model: "opus" }}
        />
      </MemoryRouter>
    );

    fireEvent.mouseOver(
      screen.getByTestId("run-stream-model-change-tooltip-target")
    );

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Start a new conversation to the change the model"
    );
  });

  it("keeps session metadata in the composer action row", () => {
    render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
          onStopRun={vi.fn()}
          runProcessing
          agentSessionMetadata={{
            provider: "codex",
            model: "gpt-5-codex",
            effort: "high",
            worktree: "feature/current-worktree",
          }}
        />
      </MemoryRouter>
    );

    const metadata = screen.getByTestId("agent-session-metadata");
    const actionRow = metadata.parentElement;
    expect(actionRow).not.toBeNull();
    expect(actionRow).toHaveStyle({ flexWrap: "nowrap" });
    expect(actionRow).toContainElement(
      screen.getByTestId("run-stream-external-reply-submit")
    );
    expect(actionRow).toContainElement(screen.getByTestId("run-stream-stop"));
    expect(metadata).toHaveAttribute("data-placement", "below-composer");
    expect(
      screen.getByTestId("agent-session-metadata-worktree")
    ).toHaveTextContent("feature/current-worktree");
  });

  it("registers the shared rich-editor nodes with Lexical", () => {
    renderComposer(vi.fn());

    expect(lexicalConfig.nodes).toContain(FileReferenceNode);
    expect(lexicalConfig.nodes).toContain(FeatureReferenceMatchNode);
    expect(lexicalConfig.nodes).toContain(MentionNode);
    expect(screen.getByTestId("mock-entity-drop-plugin")).toBeInTheDocument();
  });

  it("mounts slash commands with the reply composer project context", () => {
    renderComposer(vi.fn());

    const plugin = screen.getByTestId("mock-rich-slash-command-plugin");
    expect(plugin).toHaveAttribute("data-organization-id", "org-1");
    expect(plugin).toHaveAttribute("data-project-id", "proj-1");
    expect(plugin).toHaveAttribute("data-focal-kind", "none");
  });

  it("mounts feature discovery with the message organization and project context", () => {
    renderComposer(vi.fn());

    const plugin = screen.getByTestId("mock-feature-reference-discovery");
    expect(plugin).toHaveAttribute("data-organization-id", "org-1");
    expect(plugin).toHaveAttribute("data-project-id", "proj-1");
  });

  it("does not mount project-aware discovery when the message context is unavailable", () => {
    render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={null}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(
      screen.queryByTestId("mock-feature-reference-discovery")
    ).not.toBeInTheDocument();
  });

  it("mounts file references when the conversation has task or feature context", () => {
    render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
          fileReferenceScope={{ kind: "feature", featureId: "feature-1" }}
        />
      </MemoryRouter>
    );

    const plugin = screen.getByTestId("mock-file-reference-plugin");
    expect(plugin).toHaveAttribute("data-organization-id", "org-1");
    expect(plugin).toHaveAttribute("data-project-id", "proj-1");
    expect(plugin).toHaveAttribute("data-scope-kind", "feature");
  });

  it("renders with the text label 'New conversation'", () => {
    const onCreateNewConversation = vi.fn(async (_draftText: string) => {});
    render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
          onCreateNewConversation={onCreateNewConversation}
          confirmBeforeNewConversation
        />
      </MemoryRouter>
    );

    const btn = screen.getByTestId("run-stream-new-conversation");
    expect(btn).toHaveTextContent("New conversation");
  });

  it("shows the editable model selector only in new-conversation setup", () => {
    render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
          onCreateNewConversation={vi.fn(async () => {})}
          agentSessionMetadata={{ provider: "claude", model: "opus" }}
          confirmBeforeNewConversation
          newConversationModelSelector={
            <div data-testid="editable-model-selector" />
          }
        />
      </MemoryRouter>
    );

    expect(
      screen.queryByTestId("editable-model-selector")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-session-metadata")).toBeInTheDocument();
    expect(screen.getByTestId("run-stream-new-conversation")).toHaveTextContent(
      "New conversation"
    );

    fireEvent.click(screen.getByTestId("run-stream-new-conversation"));

    expect(screen.getByTestId("editable-model-selector")).toBeInTheDocument();
    expect(screen.getByTestId("new-conversation-dialog-content")).toHaveStyle({
      overflowX: "hidden",
    });
  });

  it("opens confirmation without invoking the new-conversation handler", () => {
    const onCreateNewConversation = vi.fn(async (_draftText: string) => {});
    render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
          onCreateNewConversation={onCreateNewConversation}
          confirmBeforeNewConversation
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("run-stream-new-conversation"));

    expect(
      screen.getByRole("heading", { name: "Are your sure?" })
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog").textContent).toContain(
      "remains available in the Conversations tab"
    );
    expect(onCreateNewConversation).not.toHaveBeenCalled();
  });

  it("cancels without changing the draft or invoking the handler", async () => {
    const onCreateNewConversation = vi.fn(async (_draftText: string) => {});
    render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
          onCreateNewConversation={onCreateNewConversation}
          confirmBeforeNewConversation
        />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "draft to keep" },
    });
    fireEvent.click(screen.getByTestId("run-stream-new-conversation"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Are your sure?" })
      ).not.toBeInTheDocument();
    });
    expect(onCreateNewConversation).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("run-stream-external-reply-input")
    ).toBeInTheDocument();
  });

  it("is in a separate group from the send button", () => {
    const onCreateNewConversation = vi.fn(async (_draftText: string) => {});
    render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
          onCreateNewConversation={onCreateNewConversation}
          confirmBeforeNewConversation
        />
      </MemoryRouter>
    );

    const sendBtn = screen.getByTestId("run-stream-external-reply-submit");
    const newConvBtn = screen.getByTestId("run-stream-new-conversation");
    // The send button is in the left icon group; new-conversation is in the
    // right region. They must not share the same immediate container div.
    const sendGroupDiv = sendBtn.closest("div");
    expect(sendGroupDiv?.contains(newConvBtn)).toBe(false);
  });

  it("invokes the handler with the current draft text", async () => {
    const onCreateNewConversation = vi.fn(async (_draftText: string) => {});
    render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
          onCreateNewConversation={onCreateNewConversation}
          confirmBeforeNewConversation
        />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "some draft text" },
    });

    fireEvent.click(screen.getByTestId("run-stream-new-conversation"));
    fireEvent.click(
      screen.getByRole("button", { name: "Start new conversation" })
    );

    await waitFor(() =>
      expect(onCreateNewConversation).toHaveBeenCalledWith("some draft text")
    );
  });

  it("can start a new conversation without showing confirmation", async () => {
    const onCreateNewConversation = vi.fn(async (_draftText: string) => {});
    render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
          onCreateNewConversation={onCreateNewConversation}
          confirmBeforeNewConversation={false}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("run-stream-new-conversation"));

    await waitFor(() =>
      expect(onCreateNewConversation).toHaveBeenCalledWith("")
    );
    expect(
      screen.queryByRole("heading", { name: "Are your sure?" })
    ).not.toBeInTheDocument();
  });

  it("carries an initial draft into the new session without sending it", async () => {
    const onCreateNewConversation = vi.fn(async (_draftText: string) => {});
    render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
          onCreateNewConversation={onCreateNewConversation}
          initialDraft="carry this draft forward"
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("run-stream-new-conversation"));

    await waitFor(() =>
      expect(onCreateNewConversation).toHaveBeenCalledWith(
        "carry this draft forward"
      )
    );
  });
});

describe("ExternalReplyComposer post error handling", () => {
  it("retains a selected Skill through failure and retries the structured selection", async () => {
    const selectedSkill = {
      provider: "codex" as const,
      name: "release-check",
      catalogScope: "repo" as const,
    };
    const onSubmitReply = vi
      .fn<(text: string, selection?: typeof selectedSkill) => Promise<void>>()
      .mockRejectedValueOnce(new Error("The Skill could not be invoked."))
      .mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={onSubmitReply}
          attachedAgent={{
            organizationId: "org-1",
            projectId: "proj-1",
            agentSessionId: "session-1",
            runId: "run-1",
            machineId: "machine-1",
            provider: "codex",
          }}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("mock-select-skill"));
    expect(
      screen.getByTestId("agent-skill-selection-summary")
    ).toHaveTextContent("release-check");

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "ship it" },
    });
    fireEvent.click(screen.getByTestId("run-stream-external-reply-submit"));

    await screen.findByTestId("run-stream-external-reply-error");
    expect(onSubmitReply).toHaveBeenNthCalledWith(
      1,
      "ship it",
      selectedSkill,
      []
    );
    expect(
      screen.getByTestId("agent-skill-selection-summary")
    ).toHaveTextContent("release-check");

    fireEvent.click(screen.getByTestId("run-stream-external-reply-retry"));
    await waitFor(() => expect(onSubmitReply).toHaveBeenCalledTimes(2));
    expect(onSubmitReply).toHaveBeenNthCalledWith(
      2,
      "ship it",
      selectedSkill,
      []
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("agent-skill-selection-summary")
      ).not.toBeInTheDocument()
    );
  });

  it("surfaces a failed post inline, preserves the draft, and clears the error on retry", async () => {
    const onSubmitReply = vi.fn(async (_text: string): Promise<void> => {});
    onSubmitReply.mockRejectedValueOnce(new Error("CLI rejected the message"));

    renderComposer(onSubmitReply);

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "ship it" },
    });

    const submit = screen.getByTestId("run-stream-external-reply-submit");
    await waitFor(() => expect(submit).toBeEnabled());

    fireEvent.click(submit);

    // The rejected post is shown against the composer rather than replacing
    // the conversation with a page-level error.
    const alert = await screen.findByTestId("run-stream-external-reply-error");
    expect(alert).toHaveTextContent("CLI rejected the message");

    expect(onSubmitReply).toHaveBeenCalledTimes(1);
    expect(onSubmitReply).toHaveBeenCalledWith("ship it", undefined, []);

    // The draft was restored, so the user can retry without retyping.
    await waitFor(() =>
      expect(
        screen.getByTestId("run-stream-external-reply-submit")
      ).toBeEnabled()
    );
    expect(screen.getByTestId("run-stream-external-reply-retry")).toBeEnabled();
    fireEvent.click(screen.getByTestId("run-stream-external-reply-retry"));

    // The next attempt clears the inline error and resends the same draft.
    await waitFor(() =>
      expect(
        screen.queryByTestId("run-stream-external-reply-error")
      ).not.toBeInTheDocument()
    );
    expect(onSubmitReply).toHaveBeenCalledTimes(2);
    expect(onSubmitReply.mock.calls[1]![0]).toBe("ship it");
  });

  it("keeps the failed draft identity and replaces the reason when retry fails", async () => {
    const onSubmitReply = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("The first post failed."))
      .mockRejectedValueOnce(new Error("The retry failed differently."));

    renderComposer(onSubmitReply);

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "retry this draft" },
    });
    fireEvent.click(screen.getByTestId("run-stream-external-reply-submit"));

    const firstAlert = await screen.findByTestId(
      "run-stream-external-reply-error"
    );
    const firstFailureIdentity = firstAlert.getAttribute(
      "data-failure-identity"
    );
    expect(firstAlert).toHaveTextContent("The first post failed.");

    fireEvent.click(screen.getByTestId("run-stream-external-reply-retry"));

    const secondAlert = await screen.findByTestId(
      "run-stream-external-reply-error"
    );
    expect(secondAlert).toHaveTextContent("The retry failed differently.");
    expect(secondAlert.getAttribute("data-failure-identity")).not.toBe(
      firstFailureIdentity
    );
    expect(onSubmitReply).toHaveBeenNthCalledWith(
      1,
      "retry this draft",
      undefined,
      []
    );
    expect(onSubmitReply).toHaveBeenNthCalledWith(
      2,
      "retry this draft",
      undefined,
      []
    );
  });

  it("does not retry a failed post after the CLI gate closes", async () => {
    const onSubmitReply = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("The CLI became unavailable."))
      .mockResolvedValue(undefined);
    const { rerender } = render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={onSubmitReply}
        />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "do not send again" },
    });
    fireEvent.click(screen.getByTestId("run-stream-external-reply-submit"));
    await screen.findByTestId("run-stream-external-reply-error");

    rerender(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={onSubmitReply}
          availability={{ available: false, reason: "unavailable" }}
        />
      </MemoryRouter>
    );

    const retry = screen.getByTestId("run-stream-external-reply-retry");
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(onSubmitReply).toHaveBeenCalledTimes(1);
  });

  it("does not carry a failed post into another conversation", async () => {
    const onSubmitReply = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("The first conversation failed."));

    const { rerender } = render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={onSubmitReply}
        />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "conversation one draft" },
    });
    fireEvent.click(screen.getByTestId("run-stream-external-reply-submit"));
    await screen.findByTestId("run-stream-external-reply-error");

    rerender(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={{ ...messageContext, conversationId: "conv-2" }}
          submittingPrompt={false}
          onSubmitReply={onSubmitReply}
        />
      </MemoryRouter>
    );

    expect(
      screen.queryByTestId("run-stream-external-reply-error")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("run-stream-external-reply-retry")
    ).not.toBeInTheDocument();
  });

  it("keeps the send button disabled and does not post when the CLI gate is closed", async () => {
    const onSubmitReply = vi.fn(async (_text: string): Promise<void> => {});

    render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={onSubmitReply}
          availability={{ available: false, reason: "unavailable" }}
        />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "ignored" },
    });

    const submit = screen.getByTestId("run-stream-external-reply-submit");
    expect(submit).toBeDisabled();

    fireEvent.click(submit);
    expect(onSubmitReply).not.toHaveBeenCalled();
  });

  it("disables the stop button when the run is idle and enables it while processing", async () => {
    const onStopRun = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
          onStopRun={onStopRun}
          runProcessing={false}
        />
      </MemoryRouter>
    );

    const idleStop = screen.getByTestId("run-stream-stop");
    expect(idleStop).toBeDisabled();
    expect(idleStop).toHaveStyle({ minWidth: "40px", minHeight: "40px" });
    expect(screen.getByTestId("run-stream-external-reply-submit")).toHaveStyle({
      minWidth: "40px",
      minHeight: "40px",
    });
    fireEvent.click(idleStop);
    expect(onStopRun).not.toHaveBeenCalled();

    rerender(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
          onStopRun={onStopRun}
          runProcessing
        />
      </MemoryRouter>
    );

    const activeStop = screen.getByTestId("run-stream-stop");
    expect(activeStop).toBeEnabled();
    fireEvent.click(activeStop);
    expect(onStopRun).toHaveBeenCalledTimes(1);

    rerender(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
          onStopRun={onStopRun}
          runProcessing
          stoppingRun
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId("run-stream-stop")).toBeDisabled();
  });

  it("does not render the error alert when a post succeeds", async () => {
    const onSubmitReply = vi.fn(async (_text: string): Promise<void> => {});

    renderComposer(onSubmitReply);

    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "looks good" },
    });

    const submit = screen.getByTestId("run-stream-external-reply-submit");
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(onSubmitReply).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByTestId("run-stream-external-reply-error")
    ).not.toBeInTheDocument();
  });
  it("reports unsent draft changes without opting into a creation control", async () => {
    const onDraftChange = vi.fn();
    const onSubmitReply = vi.fn();
    render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={onSubmitReply}
          onDraftChange={onDraftChange}
          initialDraft="Unsent follow-up"
        />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(onDraftChange).toHaveBeenLastCalledWith("Unsent follow-up")
    );
    expect(
      screen.queryByTestId("run-stream-new-conversation")
    ).not.toBeInTheDocument();
    expect(onSubmitReply).not.toHaveBeenCalled();
  });

  it.each(["foreground", "background"] as const)(
    "routes a submitted %s subagent command to the typed callback",
    async (mode) => {
      const onSubmitReply = vi.fn(async () => {});
      const onSubmitSubagent = vi.fn(async () => {});
      render(
        <MemoryRouter>
          <ExternalReplyComposer
            attachmentTarget={null}
            availability={{ available: true }}
            messageContext={messageContext}
            submittingPrompt={false}
            onSubmitReply={onSubmitReply}
            subagentCapability={{ kind: "ready", submit: onSubmitSubagent }}
          />
        </MemoryRouter>
      );
      fireEvent.change(screen.getByTestId("mock-editor-input"), {
        target: {
          value: `/subagent ${mode} research Inspect the implementation`,
        },
      });
      fireEvent.click(screen.getByTestId("run-stream-external-reply-submit"));
      await waitFor(() =>
        expect(onSubmitSubagent).toHaveBeenCalledWith(
          {
            kind: "subagent",
            mode,
            capability: "research",
            objective: "Inspect the implementation",
          },
          expect.stringMatching(/^[0-9a-f-]{36}$/)
        )
      );
      expect(onSubmitReply).not.toHaveBeenCalled();
    }
  );

  it("omits extra composer labels and blocks an empty objective", async () => {
    const submit = vi.fn();
    const ordinary = vi.fn();
    render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={ordinary}
          subagentCapability={{ kind: "ready", submit }}
        />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: "/subagent " },
    });
    expect(
      screen.queryByTestId("subagent-route-label")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("subagent-missing-objective")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("run-stream-external-reply-submit")
    ).toBeDisabled();
    fireEvent.click(screen.getByTestId("run-stream-external-reply-submit"));
    expect(submit).not.toHaveBeenCalled();
    expect(ordinary).not.toHaveBeenCalled();
  });

  it("preserves background choices and reference text through failure and same-identity retry", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("Admission unavailable"))
      .mockResolvedValueOnce(undefined);
    const ordinary = vi.fn();
    render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={ordinary}
          subagentCapability={{ kind: "ready", submit }}
        />
      </MemoryRouter>
    );
    const objective =
      "Read @[task:12345678-1234-1234-1234-123456789012|Investigation]\n\nReport findings";
    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: `/subagent background research ${objective}` },
    });
    expect(
      screen.queryByTestId("subagent-route-label")
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("run-stream-external-reply-submit"));
    await screen.findByTestId("run-stream-external-reply-error");
    expect(submit.mock.calls[0][0]).toEqual({
      kind: "subagent",
      mode: "background",
      capability: "research",
      objective,
    });
    expect(
      screen.queryByTestId("subagent-route-label")
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByTestId("run-stream-external-reply-submit")
      ).toBeEnabled()
    );
    fireEvent.click(screen.getByTestId("run-stream-external-reply-retry"));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
    await waitFor(() =>
      expect(
        screen.queryByTestId("run-stream-external-reply-error")
      ).not.toBeInTheDocument()
    );
    expect(ordinary).not.toHaveBeenCalled();
  });

  it("passes executable command availability through the editor to the slash menu", () => {
    const { rerender } = render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
          subagentCapability={{ kind: "ready", submit: vi.fn() }}
          onSubmitMessageAgent={vi.fn()}
        />
      </MemoryRouter>
    );
    const menu = screen.getByTestId("mock-rich-slash-command-plugin");
    expect(menu).toHaveAttribute("data-subagent-available", "true");
    expect(menu).toHaveAttribute("data-message-agent-available", "true");
    rerender(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={null}
          subagentCapability={{
            kind: "unavailable",
            reason: "Subagent commands require an attached Agent Session.",
          }}
          availability={{ available: true }}
          messageContext={messageContext}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
        />
      </MemoryRouter>
    );
    expect(menu).toHaveAttribute("data-subagent-available", "false");
    expect(menu).toHaveAttribute("data-message-agent-available", "false");
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("desktop file attachments", () => {
  const target = { runId: "run", machineId: "owner" };
  const attachmentId = "f7a198de-03a6-47aa-b0bf-830cde418ddb";
  const secondId = "465c52b5-b010-4da6-b86d-e93206583ef8";
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const uploaded = (fileName: string, id = attachmentId) =>
    json({
      requestId: attachmentId,
      status: "success",
      operation: "run.attachments.upload",
      result: {
        runId: target.runId,
        attachment: { attachmentId: id, fileName, sizeBytes: 4 },
      },
    });
  const drop = (...names: string[]) =>
    fireEvent.drop(screen.getByTestId("run-stream-external-reply-composer"), {
      dataTransfer: {
        types: ["Files"],
        files: names.map((name) => new File(["test"], name)),
      },
    });
  const draftAndSend = async (text = "Read these") => {
    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: { value: text },
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("run-stream-external-reply-submit")
      ).toBeEnabled()
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("run-stream-external-reply-submit"));
    });
  };
  const local = async (fetchMock: ReturnType<typeof vi.fn>) => {
    vi.stubGlobal("fetch", fetchMock);
    renderComposer(vi.fn(), undefined, target);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});
  };

  const fileTransfer = { dataTransfer: { types: ["Files"], files: [] } };
  const indicator = () => screen.queryByTestId("run-attachment-drop-indicator");

  it("keeps feedback across descendants, clears on exit and drop, and uploads", async () => {
    let finishUpload!: (response: Response) => void;
    await local(
      vi
        .fn()
        .mockResolvedValueOnce(json({ machineId: "owner", bindings: [] }))
        .mockReturnValueOnce(
          new Promise<Response>((resolve) => {
            finishUpload = resolve;
          })
        )
    );
    const composer = screen.getByTestId("run-stream-external-reply-composer");
    const editor = screen.getByTestId("mock-editor-input");
    fireEvent.dragEnter(composer, fileTransfer);
    expect(indicator()).toHaveTextContent("Drop files to attach");
    fireEvent.dragEnter(editor, fileTransfer);
    fireEvent.dragLeave(composer, fileTransfer);
    expect(indicator()).not.toBeNull();
    fireEvent.dragOver(editor, fileTransfer);
    fireEvent.dragLeave(editor, fileTransfer);
    expect(indicator()).toBeNull();
    fireEvent.dragOver(editor, fileTransfer);
    expect(indicator()).not.toBeNull();
    drop("notes.md");
    expect(indicator()).toBeNull();
    expect(screen.getByTestId("run-attachment-chip")).toHaveAttribute(
      "data-upload-status",
      "uploading"
    );
    await act(async () => finishUpload(uploaded("notes.md")));
    expect(screen.getByTestId("run-attachment-chip")).toHaveAttribute(
      "data-upload-status",
      "ready"
    );
  });

  it.each([
    "conversation",
    "run",
    "machine",
    "disabled",
    "submitting",
    "replacement",
    "missing-target",
  ])("clears feedback when %s changes", async (change) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ machineId: "owner", bindings: [] }))
    );
    const view = renderComposer(vi.fn(), undefined, target);
    await act(async () => {});
    fireEvent.dragOver(screen.getByTestId("mock-editor-input"), fileTransfer);
    expect(indicator()).not.toBeNull();
    view.rerender(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={
            change === "missing-target"
              ? null
              : {
                  runId: change === "run" ? "other" : target.runId,
                  machineId: change === "machine" ? "other" : target.machineId,
                }
          }
          messageContext={
            change === "conversation"
              ? { ...messageContext, conversationId: "other" }
              : messageContext
          }
          availability={{ available: change !== "disabled" }}
          submittingPrompt={change === "submitting"}
          editorReplacement={
            change === "replacement" ? <div>Unavailable</div> : undefined
          }
          onSubmitReply={vi.fn()}
          subagentCapability={{ kind: "unavailable", reason: "Unavailable" }}
        />
      </MemoryRouter>
    );
    expect(indicator()).toBeNull();
    if (
      [
        "disabled",
        "submitting",
        "replacement",
        "missing-target",
        "machine",
      ].includes(change)
    ) {
      fireEvent.dragOver(
        screen.getByTestId("run-stream-external-reply-composer"),
        fileTransfer
      );
      expect(indicator()).toBeNull();
    }
  });

  it("suppresses feedback while ownership is checking", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise<Response>(() => {}))
    );
    renderComposer(vi.fn(), undefined, target);
    fireEvent.dragOver(screen.getByTestId("mock-editor-input"), fileTransfer);
    expect(indicator()).toBeNull();
    drop("notes.md");
    expect(screen.getByTestId("run-attachment-rejection")).toHaveTextContent(
      "still being checked"
    );
  });

  it("lets entity drag and drop reach the editor without interception", async () => {
    await local(
      vi.fn().mockResolvedValue(json({ machineId: "owner", bindings: [] }))
    );
    const editor = screen.getByTestId("mock-editor-input");
    for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
      const listener = vi.fn();
      editor.addEventListener(type, listener);
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", {
        value: { types: ["text/plain"], files: [] },
      });
      fireEvent(editor, event);
      expect(listener).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(false);
      expect(indicator()).toBeNull();
      editor.removeEventListener(type, listener);
    }
  });

  it("rejects unsupported types independently and preserves whitespace with supported references", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ machineId: "owner", bindings: [] }))
      .mockResolvedValueOnce(uploaded("notes.md"));
    vi.stubGlobal("fetch", fetchMock);
    const submit = vi.fn().mockResolvedValue(undefined);
    renderComposer(submit, undefined, target);
    await act(async () => {});
    drop("file.pdf", "notes.md");
    await waitFor(() =>
      expect(screen.getByTestId("run-attachment-error")).toHaveTextContent(
        "PDFs"
      )
    );
    await waitFor(() =>
      expect(screen.getByTestId("run-attachment-chip")).toHaveAttribute(
        "data-upload-status",
        "ready"
      )
    );
    await draftAndSend("  Read these\n");
    expect(submit).toHaveBeenCalledWith("  Read these\n", undefined, [
      { attachmentId, fileName: "notes.md" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uploads independently, removes a chip, sends remaining references and clears them", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ machineId: "owner", bindings: [] }))
      .mockResolvedValueOnce(uploaded("one.txt"))
      .mockResolvedValueOnce(uploaded("two.txt", secondId));
    vi.stubGlobal("fetch", fetchMock);
    const submit = vi.fn().mockResolvedValue(undefined);
    renderComposer(submit, undefined, target);
    await act(async () => {});
    drop("one.txt", "two.txt");
    await waitFor(() =>
      expect(screen.getAllByTestId("run-attachment-chip")).toHaveLength(2)
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("run-attachment-chip")[0]).toHaveAttribute(
        "data-upload-status",
        "ready"
      )
    );
    fireEvent.click(screen.getAllByTestId("remove-run-attachment")[0]!);
    await draftAndSend();
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith("Read these", undefined, [
        { attachmentId: secondId, fileName: "two.txt" },
      ])
    );
    await waitFor(() =>
      expect(screen.queryByTestId("run-attachment-chip")).toBeNull()
    );
  });

  it("shows oversized failures per file and sends the successful file", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ machineId: "owner", bindings: [] }))
      .mockResolvedValueOnce(
        json(
          {
            requestId: attachmentId,
            status: "error",
            operation: "run.attachments.upload",
            error: { code: "FILE_TOO_LARGE", message: "File exceeds limit" },
          },
          413
        )
      )
      .mockResolvedValueOnce(uploaded("good.txt"));
    vi.stubGlobal("fetch", fetchMock);
    const submit = vi.fn().mockResolvedValue(undefined);
    renderComposer(submit, undefined, target);
    await act(async () => {});
    drop("large.txt", "good.txt");
    await waitFor(() =>
      expect(screen.getByTestId("run-attachment-error")).toHaveTextContent(
        "large.txt: FILE_TOO_LARGE: File exceeds limit"
      )
    );
    await draftAndSend();
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith("Read these", undefined, [
        { attachmentId, fileName: "good.txt" },
      ])
    );
  });

  it.each(["foreign", null])(
    "rejects drops without uploading when local identity is %s",
    async (machineId) => {
      const fetchMock = machineId
        ? vi.fn().mockResolvedValue(json({ machineId, bindings: [] }))
        : vi.fn().mockRejectedValue(new Error("offline"));
      await local(fetchMock);
      fireEvent.dragOver(screen.getByTestId("mock-editor-input"), fileTransfer);
      expect(indicator()).toBeNull();
      drop("secret.txt");
      expect(screen.getByTestId("run-attachment-rejection")).toHaveTextContent(
        "machine that owns this Run"
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("run-attachment-chip")).toBeNull();
    }
  );

  it("retains a failed reply snapshot while later uploads remain for the next reply", async () => {
    let finishUpload!: (value: Response) => void;
    let finishSubmit!: () => void;
    const late = new Promise<Response>((resolve) => {
      finishUpload = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ machineId: "owner", bindings: [] }))
        .mockResolvedValueOnce(uploaded("first.txt"))
        .mockReturnValueOnce(late)
    );
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("Try again"))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishSubmit = resolve;
          })
      );
    renderComposer(submit, undefined, target);
    await act(async () => {});
    drop("first.txt", "late.txt");
    await waitFor(() =>
      expect(screen.getAllByTestId("run-attachment-chip")[0]).toHaveAttribute(
        "data-upload-status",
        "ready"
      )
    );
    await draftAndSend();
    await waitFor(() =>
      expect(
        screen.getByTestId("run-stream-external-reply-error")
      ).toHaveTextContent("Try again")
    );
    fireEvent.click(screen.getByTestId("run-stream-external-reply-retry"));
    await act(async () => {
      finishUpload(uploaded("late.txt", secondId));
    });
    await act(async () => {
      finishSubmit();
    });
    expect(submit).toHaveBeenNthCalledWith(1, "Read these", undefined, [
      { attachmentId, fileName: "first.txt" },
    ]);
    expect(submit).toHaveBeenNthCalledWith(2, "Read these", undefined, [
      { attachmentId, fileName: "first.txt" },
    ]);
    await waitFor(() =>
      expect(screen.getAllByTestId("run-attachment-chip")).toHaveLength(1)
    );
    expect(screen.getByTestId("run-attachment-chip")).toHaveTextContent(
      "late.txt"
    );
  });

  it.each(["conversation", "Run", "removal"])(
    "ignores late upload results after %s changes",
    async (change) => {
      let finishUpload!: (value: Response) => void;
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(json({ machineId: "owner", bindings: [] }))
          .mockReturnValueOnce(
            new Promise<Response>((resolve) => {
              finishUpload = resolve;
            })
          )
      );
      const submit = vi.fn();
      const view = renderComposer(submit, undefined, target);
      await act(async () => {});
      drop("old.txt");
      expect(screen.getByTestId("run-attachment-chip")).toHaveAttribute(
        "data-upload-status",
        "uploading"
      );
      if (change === "removal")
        fireEvent.click(screen.getByTestId("remove-run-attachment"));
      else {
        view.rerender(
          <MemoryRouter>
            <ExternalReplyComposer
              attachmentTarget={
                change === "Run" ? { ...target, runId: "other-run" } : target
              }
              messageContext={
                change === "conversation"
                  ? { ...messageContext, conversationId: "different" }
                  : messageContext
              }
              availability={{ available: true }}
              submittingPrompt={false}
              onSubmitReply={submit}
              subagentCapability={{
                kind: "unavailable",
                reason: "Unavailable",
              }}
            />
          </MemoryRouter>
        );
      }
      await act(async () => {
        finishUpload(uploaded("old.txt"));
      });
      expect(screen.queryByTestId("run-attachment-chip")).toBeNull();
    }
  );

  it("does not capture entity drags and rejects files when disabled", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ machineId: "owner", bindings: [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter>
        <ExternalReplyComposer
          attachmentTarget={target}
          messageContext={messageContext}
          availability={{ available: false }}
          submittingPrompt={false}
          onSubmitReply={vi.fn()}
          subagentCapability={{ kind: "unavailable", reason: "Unavailable" }}
        />
      </MemoryRouter>
    );
    await act(async () => {});
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { types: ["text/plain"], files: [] },
    });
    fireEvent(screen.getByTestId("run-stream-external-reply-composer"), event);
    expect(event.defaultPrevented).toBe(false);
    drop("file.txt");
    expect(screen.getByTestId("run-attachment-rejection")).toHaveTextContent(
      "disabled"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps selected files when a command cannot carry them", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ machineId: "owner", bindings: [] }))
        .mockResolvedValueOnce(uploaded("file.txt"))
    );
    const submit = vi.fn();
    renderComposer(submit, undefined, target);
    await act(async () => {});
    drop("file.txt");
    await waitFor(() =>
      expect(screen.getByTestId("run-attachment-chip")).toHaveAttribute(
        "data-upload-status",
        "ready"
      )
    );
    fireEvent.change(screen.getByTestId("mock-editor-input"), {
      target: {
        value:
          "/message-agent @[agent_session:f7a198de-03a6-47aa-b0bf-830cde418ddb|Other Run] please review",
      },
    });
    fireEvent.click(screen.getByTestId("run-stream-external-reply-submit"));
    await waitFor(() =>
      expect(
        screen.getByTestId("run-stream-external-reply-error")
      ).toHaveTextContent("Remove the files before sending a command")
    );
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByTestId("run-attachment-chip")).toHaveTextContent(
      "file.txt"
    );
  });
});
