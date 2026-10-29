import type { ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExtendedUIFieldType,
  MessageStatus,
  ConversationStatus,
  MessageType,
  SecondaryActionConfigTypeEnum,
  SecondaryActionConfigPresentationEnum,
  SecondaryActionHandler,
  AgentSessionCurrentState,
  AgentSessionStatus,
  AgentSessionType,
  type AgentSessionDto,
  type ConversationResponseDto,
  type MessageResponseDto,
  type UIElement,
} from "../../../api";
import type { ConversationFormResolver } from "../../Conversation/Components/conversationFormTypes";
import type { SecondaryActionContext } from "../../LlmForms/Registry/types";
import { AgentConversationView } from "../AgentConversationView";
import "../../../i18n";
import {
  beginOptimisticInput,
  removeOptimisticInput,
} from "../../../data/collections/optimisticConversationInputs";

const state = vi.hoisted(() => ({
  conversation: null as ConversationResponseDto | null,
  messages: [] as MessageResponseDto[],
  ready: true,
  session: null as AgentSessionDto | null,
  submit: vi.fn(),
  currentState: null as AgentSessionCurrentState | null,
}));
vi.mock("../../../data/hooks/useAgentSession", () => ({
  useAgentSession: () => ({ agentSession: state.session, error: null }),
}));
vi.mock("../../../data/hooks/useServices", () => ({
  useServices: () => ({ services: [], isReady: true }),
}));
vi.mock("../../../data/hooks/useConversation", () => ({
  useConversation: () => ({
    data: state.conversation,
    isFetched: true,
    isLoading: false,
    isFetching: false,
    error: null,
  }),
}));
vi.mock("../../../data/hooks/useConversationMessages", () => ({
  useConversationMessages: () => ({
    data: state.messages,
    orderedData: state.messages,
    undatedInputs: [],
    isFetched: state.ready,
    error: null,
    hasOlder: false,
    isLoadingOlder: false,
    olderError: null,
    loadOlder: vi.fn(),
    refetch: vi.fn(),
  }),
}));
vi.mock("../../../data/hooks/useProject", () => ({
  useProject: () => ({
    data: { id: "project", organizationId: "organization", name: "Project" },
    isLoading: false,
    error: null,
  }),
}));
vi.mock(
  "../../../data/hooks/useAgentSessionCurrentState",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../data/hooks/useAgentSessionCurrentState")
    >()),
    useAgentSessionCurrentState: () => ({ currentState: state.currentState }),
  }),
);
vi.mock("../runtime/hooks/useCliRequired", () => ({
  useCliRequired: () => ({ type: "ready", machine: { machineId: "machine" } }),
}));
vi.mock("../operations/useAgentSessionInteractionAccess", () => ({
  useAgentSessionInteractionAccess: () => ({
    isDeviceEnabled: true,
    interactions: { submitMessage: state.submit },
    unavailable: null,
  }),
  useAgentSessionInteractionAccessResolver: () => vi.fn(),
}));
vi.mock("../../../hooks/useWorkflowStatus", () => ({
  useWorkflowStatus: () => ({ status: "open", canSubmit: true }),
}));
vi.mock("../../../hooks/useUserIdentity", () => ({
  useUserIdentity: () => ({ userId: "user" }),
}));
vi.mock("../../../contexts/TrackingContext", () => ({
  useUserAction: () => ({ trackUI: vi.fn() }),
  useFormTracking: () => ({
    trackFormStart: vi.fn(),
    trackSubmitSuccess: vi.fn(),
  }),
}));
vi.mock("../../Conversation/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../Conversation/hooks")>()),
  useConversationScrolling: () => ({
    handleStepClick: vi.fn(),
    loadOlderMessages: vi.fn(),
    initialScrollReady: true,
  }),
}));
// Only the editor and field leaf are simplified; viewer, provider, target
// publication, containing surface, policy, and composer are all production code.
vi.mock("../../SmarterTextAreaCard/SmarterTextAreaEditor", () => ({
  SmarterTextAreaEditor: ({
    initialValue,
    onChange,
    editable,
    onSubmit,
    submitDisabled,
    presentation,
  }: {
    initialValue: string;
    onChange: (text: string, subagentState: { kind: "literal" }) => void;
    editable: boolean;
    onSubmit: () => void;
    submitDisabled: boolean;
    presentation?: { focusSignal?: number };
  }) => (
    <div>
      <textarea
        aria-label="Ordinary reply"
        data-focus-signal={presentation?.focusSignal ?? 0}
        value={initialValue}
        disabled={!editable}
        onChange={(event) => onChange(event.target.value, { kind: "literal" })}
      />
      <button onClick={onSubmit} disabled={submitDisabled}>
        Send ordinary reply
      </button>
    </div>
  ),
}));
vi.mock("../../LlmForms/DynamicForm", async () => {
  const { ImplementationReadinessSecondaryAction } =
    await import("../../LlmForms/Registry/ImplementationReadinessSecondaryAction");
  return {
    DynamicForm: ({
      disabled,
      onNext,
      uiElements,
      context,
    }: {
      disabled: boolean;
      onNext: (values: Record<string, string>) => void;
      uiElements: UIElement[];
      context: SecondaryActionContext;
    }) => (
      <div>
        <button
          disabled={disabled}
          onClick={() => onNext({ judgment: "Proceed" })}
        >
          Embedded response
        </button>
        {uiElements.some(
          ({ type }) => type === ExtendedUIFieldType.ImplementationReadiness,
        ) ? (
          <ImplementationReadinessSecondaryAction
            action={{
              id: "readiness-clarify",
              type: SecondaryActionConfigTypeEnum.FieldAction,
              label: "Clarify",
              fieldId: "readiness",
              handler: SecondaryActionHandler.ImplementationReadinessReply,
            }}
            context={context}
            formValues={{}}
            onExecute={() => {}}
            kind="clarify"
          />
        ) : null}
      </div>
    ),
  };
});

const source = (
  id = "source",
  fieldType: UIElement["type"] = ExtendedUIFieldType.Textarea,
): MessageResponseDto => {
  const fieldId =
    fieldType === ExtendedUIFieldType.ImplementationReadiness
      ? "readiness"
      : "review";
  return {
    id,
    conversationId: "conversation",
    projectId: "project",
    type: MessageType.System,
    status: MessageStatus.Open,
    awaitingResponse: true,
    createdAt: "2026-09-28T00:00:00Z",
    responses: [],
    data: {
      type: "QUESTIONS",
      uiElements: [{ id: fieldId, type: fieldType, label: "Response" }],
      ...(fieldType === ExtendedUIFieldType.ImplementationReadiness
        ? {
            secondaryActions: [
              {
                id: "readiness-clarify",
                type: SecondaryActionConfigTypeEnum.FieldAction,
                presentation: SecondaryActionConfigPresentationEnum.Button,
                label: "Clarify",
                fieldId,
                handler: SecondaryActionHandler.ImplementationReadinessReply,
                payload: { runId: "run", sourceRevision: "sha256:readiness" },
              },
            ],
          }
        : {}),
    },
  };
};
const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      {children}
    </QueryClientProvider>
  </MemoryRouter>
);
const surface = (
  resolver?: ConversationFormResolver,
  conversationId = "conversation",
  readOnly = false,
) => (
  <AgentConversationView
    organizationId="organization"
    projectId="project"
    agentSessionId="session"
    conversationId={conversationId}
    onStopRun={() => {}}
    conversationFormResolver={resolver}
    onSubmitReply={state.submit}
    readOnly={readOnly}
    agentSessionMetadata={{ provider: "codex", model: "Test model" }}
  />
);

describe("real viewer to composer response ownership", () => {
  beforeEach(() => {
    state.conversation = {
      id: "conversation",
      projectId: "project",
      organizationId: "organization",
    } as ConversationResponseDto;
    state.messages = [source()];
    state.ready = true;
    state.session = null;
    state.currentState = null;
    state.submit.mockReset().mockResolvedValue(undefined);
  });

  it("shows optimistic inputs in the conversation, after the timeline and before the thinking indicator", () => {
    state.currentState = AgentSessionCurrentState.Thinking;
    beginOptimisticInput("placement-test", {
      organizationId: "organization",
      projectId: "project",
      conversationId: "conversation",
      agentSessionId: "session",
      machineId: "machine",
      intent: {
        projectId: "project",
        conversationId: "conversation",
        parentMessageId: null,
        data: { comment: "Pending reply" },
      },
    });
    try {
      render(surface(), { wrapper });
      const preview = screen.getByTestId("submission-preview");
      const indicator = screen.getByTestId(
        "agent-session-current-state-indicator",
      );
      expect(preview).toHaveTextContent("Pending reply");
      expect(preview).toHaveAttribute("data-delivery-state", "sending");
      expect(screen.getByTestId("agent-conversation-viewer")).toContainElement(
        preview,
      );
      expect(screen.getByTestId("conversation-timeline")).not.toContainElement(
        preview,
      );
      expect(
        screen.queryByTestId("agent-conversation-pending-inputs"),
      ).toBeNull();
      expect(
        preview.compareDocumentPosition(indicator) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    } finally {
      act(() => removeOptimisticInput("placement-test"));
    }
  });

  it("shows fallback for fieldless errors and hides it in read-only conversations", async () => {
    state.conversation = {
      ...state.conversation!,
      status: ConversationStatus.Error,
    };
    state.messages = [];
    const view = render(surface(), { wrapper });
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Ordinary reply" }),
      ).toBeVisible(),
    );
    expect(screen.getByTestId("agent-session-metadata")).toHaveAttribute(
      "data-placement",
      "below-composer",
    );
    view.rerender(surface(undefined, "conversation", true));
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Ordinary reply" }),
      ).toBeNull(),
    );
    expect(screen.getByTestId("agent-session-metadata")).toHaveAttribute(
      "data-placement",
      "below-conversation",
    );
    expect(state.submit).not.toHaveBeenCalled();
  });

  it("keeps the readiness composer enabled and forwards Clarify focus to it", async () => {
    state.messages = [
      source("readiness-source", ExtendedUIFieldType.ImplementationReadiness),
    ];
    render(surface(), { wrapper });

    const clarify = await screen.findByTestId(
      "implementation-readiness-clarify-action",
    );
    const composer = screen.getByTestId("run-stream-external-reply-composer");
    const reply = screen.getByRole("textbox", { name: "Ordinary reply" });
    expect(composer).toBeVisible();
    expect(reply).toBeVisible();
    expect(reply).toBeEnabled();
    expect(reply).toHaveAttribute("data-focus-signal", "0");

    fireEvent.click(clarify);

    await waitFor(() =>
      expect(reply).toHaveAttribute("data-focus-signal", "1"),
    );
    expect(composer).toBeVisible();
    expect(reply).toBeEnabled();
  });

  const exclusive =
    (
      disabled: boolean,
      submit = vi.fn().mockResolvedValue(undefined),
    ): ConversationFormResolver =>
    () => ({
      uiElements: [{ id: "judgment", type: "textarea" }],
      responseDeclarations: [
        {
          ownership: "exclusive",
          currentFieldId: "judgment",
          submissionKind: "owner-command",
        },
      ],
      disabled,
      isSubmitted: false,
      submit,
    });
  const reply = () => screen.getByRole("textbox", { name: "Ordinary reply" });
  const hiddenReply = () =>
    screen.getByRole("textbox", { name: "Ordinary reply", hidden: true });

  it("hides the composer for a live response on every surface", async () => {
    const embeddedSubmit = vi.fn().mockResolvedValue(undefined);
    render(surface(exclusive(false, embeddedSubmit)), { wrapper });
    const embedded = await screen.findByRole("button", {
      name: "Embedded response",
    });
    expect(embedded).toBeEnabled();
    expect(hiddenReply()).not.toBeVisible();
    expect(screen.getByTestId("agent-session-metadata")).toHaveAttribute(
      "data-placement",
      "below-conversation",
    );
    fireEvent.click(embedded);
    await waitFor(() =>
      expect(embeddedSubmit).toHaveBeenCalledWith({ judgment: "Proceed" }),
    );
    expect(state.submit).not.toHaveBeenCalled();
  });

  it("waits for the displayed conversation to settle", async () => {
    state.ready = false;
    state.messages = [];
    render(surface(), { wrapper });
    await waitFor(() => expect(hiddenReply()).not.toBeVisible());
  });

  it("hides the plan-generation composer while the response is usable and releases it once answered", async () => {
    const resolver = exclusive(false);
    const view = render(surface(resolver, "conversation", false), { wrapper });
    expect(
      await screen.findByRole("button", { name: "Embedded response" }),
    ).toBeEnabled();
    await waitFor(() => expect(hiddenReply()).not.toBeVisible());
    expect(screen.getByTestId("agent-session-metadata")).toHaveAttribute(
      "data-placement",
      "below-conversation",
    );
    fireEvent.change(hiddenReply(), { target: { value: "Keep this draft" } });
    state.messages = [
      {
        ...source(),
        responses: [
          {
            id: "answer",
            parentMessageId: "source",
            conversationId: "conversation",
            projectId: "project",
            type: MessageType.User,
            createdAt: "2026-09-28T00:01:00Z",
            data: { judgment: "Proceed" },
          },
        ],
      },
    ];
    view.rerender(surface(resolver, "conversation", false));
    await waitFor(() => expect(reply()).toBeVisible());
    expect(reply()).toHaveValue("Keep this draft");
  });

  it("shows the plan-generation composer when the response is disabled and preserves a failed draft", async () => {
    render(surface(exclusive(true), "conversation", false), { wrapper });
    expect(
      await screen.findByRole("button", { name: "Embedded response" }),
    ).toBeDisabled();
    await waitFor(() => expect(reply()).toBeVisible());
    expect(reply()).toBeEnabled();
    fireEvent.change(reply(), { target: { value: "Keep this draft" } });
    let rejectPost: (error: Error) => void = () => {};
    state.submit.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectPost = reject;
        }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Send ordinary reply" }),
    );
    await waitFor(() =>
      expect(state.submit).toHaveBeenCalledWith(
        "Keep this draft",
        undefined,
        [],
        "source",
      ),
    );
    rejectPost(new Error("Try again"));
    expect(
      await screen.findByTestId("run-stream-external-reply-error"),
    ).toHaveTextContent("Try again");
    expect(reply()).toHaveValue("Keep this draft");
  });

  it("locks both response surfaces until the linked saved reply, ignoring unrelated activity", async () => {
    state.messages = [source("question", ExtendedUIFieldType.AgentResponse)];
    const view = render(surface(), { wrapper });
    fireEvent.change(reply(), { target: { value: "Here is my answer" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Send ordinary reply" }),
    );
    await waitFor(() =>
      expect(state.submit).toHaveBeenCalledWith(
        "Here is my answer",
        undefined,
        [],
        "question",
      ),
    );
    await waitFor(() => expect(reply()).toBeDisabled());
    state.messages = [...state.messages, source("unrelated")];
    view.rerender(surface());
    expect(reply()).toBeDisabled();
    for (const button of screen.getAllByRole("button", {
      name: "Embedded response",
    }))
      expect(button).toBeDisabled();
    state.messages = [
      {
        ...state.messages[0],
        responses: [
          {
            id: "saved",
            projectId: "project",
            conversationId: "conversation",
            parentMessageId: "question",
            type: MessageType.User,
            createdAt: "2026-09-28T00:01:00Z",
            data: { comment: "Here is my answer" },
          },
        ],
      },
      source("latest", ExtendedUIFieldType.AgentResponse),
    ];
    view.rerender(surface());
    await waitFor(() => expect(reply()).toBeEnabled());
  });

  it("recognizes a persisted reply arriving before the owner request resolves", async () => {
    state.messages = [source("question", ExtendedUIFieldType.AgentResponse)];
    let accept: () => void = () => {};
    state.submit.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          accept = resolve;
        }),
    );
    const view = render(surface(), { wrapper });
    fireEvent.change(reply(), { target: { value: "Early answer" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Send ordinary reply" }),
    );
    await waitFor(() => expect(state.submit).toHaveBeenCalledTimes(1));
    state.messages = [
      {
        ...state.messages[0],
        responses: [
          {
            id: "early",
            projectId: "project",
            conversationId: "conversation",
            parentMessageId: "question",
            type: MessageType.User,
            createdAt: "2026-09-28T00:01:00Z",
            data: { comment: "Early answer" },
          },
        ],
      },
    ];
    view.rerender(surface());
    expect(reply()).toBeDisabled();
    await act(async () => accept());
    await waitFor(() => expect(reply()).toBeEnabled());
  });

  it("isolates a pending reply from a different displayed conversation", async () => {
    state.messages = [source("question", ExtendedUIFieldType.AgentResponse)];
    const view = render(surface(), { wrapper });
    fireEvent.change(reply(), { target: { value: "Answer" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Send ordinary reply" }),
    );
    await waitFor(() => expect(reply()).toBeDisabled());
    state.conversation = { ...state.conversation!, id: "other" };
    state.messages = [];
    view.rerender(surface(undefined, "other"));
    await waitFor(() => expect(reply()).toBeEnabled());
    expect(reply()).toHaveValue("");
  });

  it("shows the plan-generation composer with no response target and waits for canonical messages", async () => {
    state.messages = [];
    state.ready = false;
    const view = render(surface(undefined, "conversation", false), { wrapper });
    await waitFor(() => expect(hiddenReply()).not.toBeVisible());
    state.ready = true;
    state.session = null;
    view.rerender(surface(undefined, "conversation", false));
    await waitFor(() => expect(reply()).toBeVisible());
    expect(reply()).toBeEnabled();
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("attachment wiring through the shared conversation surface", () => {
  const reference = {
    attachmentId: "f7a198de-03a6-47aa-b0bf-830cde418ddb",
    fileName: "notes.txt",
  };
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  beforeEach(() => {
    state.conversation = {
      id: "conversation",
      projectId: "project",
      organizationId: "organization",
    } as ConversationResponseDto;
    state.messages = [];
    state.ready = true;
    state.submit.mockReset().mockResolvedValue({ state: "succeeded" });
    state.session = {
      id: "session",
      organizationId: "organization",
      projectId: "project",
      userId: "user",
      conversationId: "conversation",
      machineId: "machine",
      status: AgentSessionStatus.InProgress,
      currentState: AgentSessionCurrentState.Idle,
      title: "Run",
      sessionDate: "2026-10-13",
      monitoringEnabled: false,
      autoDecide: false,
      hasUnsyncedChanges: false,
      type: AgentSessionType.Coding,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (url.pathname === "/api/local/repos") {
          return json({ machineId: "machine", bindings: [] });
        }
        if (url.pathname === "/api/local/runs/session/attachments") {
          return json({
            requestId: reference.attachmentId,
            operation: "run.attachments.upload",
            status: "success",
            result: {
              runId: "session",
              attachment: { ...reference, sizeBytes: 4 },
            },
          });
        }
        throw new Error(`Unexpected attachment request: ${url.pathname}`);
      }),
    );
  });

  it.each(["default", "custom"] as const)(
    "delivers dropped references through %s reply submission",
    async (path) => {
      state.conversation = {
        ...state.conversation!,
        workflowId: "workflow",
        workflowName: "repository-import",
      };
      render(
        <AgentConversationView
          organizationId="organization"
          projectId="project"
          agentSessionId="session"
          conversationId="conversation"
          {...(path === "custom" ? { onSubmitReply: state.submit } : {})}
        />,
        { wrapper },
      );
      await act(async () => {});
      fireEvent.drop(screen.getByTestId("run-stream-external-reply-composer"), {
        dataTransfer: {
          types: ["Files"],
          files: [new File(["test"], "notes.txt")],
        },
      });
      await waitFor(() =>
        expect(screen.getByTestId("run-attachment-chip")).toHaveAttribute(
          "data-upload-status",
          "ready",
        ),
      );
      fireEvent.change(
        screen.getByRole("textbox", { name: "Ordinary reply" }),
        { target: { value: "Read the file" } },
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Send ordinary reply" }),
      );
      await waitFor(() => expect(state.submit).toHaveBeenCalledTimes(1));
      if (path === "custom")
        expect(state.submit).toHaveBeenCalledWith(
          "Read the file",
          undefined,
          [reference],
          null,
        );
      else {
        expect(state.submit.mock.calls[0]![0].intent.data.attachments).toEqual([
          reference,
        ]);
        expect(
          state.submit.mock.calls[0]![0].intent.data.agentInput.promptType,
        ).toBe("workflow-defined");
        expect(
          state.submit.mock.calls[0]![0].intent.parentMessageId,
        ).toBeNull();
      }
      await waitFor(() =>
        expect(screen.queryByTestId("run-attachment-chip")).toBeNull(),
      );
    },
  );
});
