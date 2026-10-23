import { loadContentWithMentions } from "../../SmarterTextAreaCard/serializationUtils";
import React, { useEffect } from "react";
import { http, HttpResponse } from "msw";
import axios, { type AxiosAdapter } from "axios";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntityConversationChat } from "../EntityConversationChat";
import { EntitySearchChat } from "../EntitySearchChat";
import { FeatureTreeConversationChat } from "../FeatureTreeConversationChat";
import { ValidationSession } from "../ValidationSession";
import { AgentConversationView } from "../AgentConversationView";
import { ExistingEntityConversationSession } from "../ExistingEntityConversationSession";
import { isExistingEntityConversationAgentSession } from "../existingEntityConversationAgentSession";
import { createApiRuntime } from "../../../clients/createApiRuntime";
import { registerRuntimeClients } from "../../../clients/serviceClients";
import {
  AgentSessionStatus,
  AgentSessionCurrentState,
  AgentSessionType,
  type AgentSessionDto,
  type MachineDto,
} from "../../../api";
import type { BoundSubagentInteractionInput } from "../operations/AgentOperationCoordinator";
import type { ResponseTargetChangeHandler } from "../../Conversation/Components/conversationFormTypes";
import { NO_RESPONSE_TARGET } from "../../Conversation/utils/conversationResponseModel";

// Keep real editor state, conversion, serialization and typed-intent reading in transport tests.
const lexicalConfig = vi.hoisted(() => ({ nodes: [] as readonly unknown[] }));
vi.mock("@lexical/react/LexicalComposer", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@lexical/react/LexicalComposer")>();
  return {
    LexicalComposer: (
      props: React.ComponentProps<typeof actual.LexicalComposer>,
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
  const actual =
    await importOriginal<
      typeof import("@lexical/react/LexicalOnChangePlugin")
    >();
  const { useLexicalComposerContext } =
    await import("@lexical/react/LexicalComposerContext");
  return {
    OnChangePlugin: (
      props: React.ComponentProps<typeof actual.OnChangePlugin>,
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
            surfaceContext.subagentCommandAvailable,
          )}
          data-message-agent-available={String(
            surfaceContext.messageAgentCommandAvailable,
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
  }),
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

const state = vi.hoisted(() => ({
  session: null as AgentSessionDto | null,
  ordinary: vi.fn(async () => ({ state: "succeeded" })),
  grant: {
    kind: "bounded_grant",
    grantId: "20000000-0000-4000-8000-000000000001",
  } as const,
  authorizations: [] as Array<{ machineId: string; action: unknown }>,
  denyAuthorization: false,
}));
// The controller rail is exercised at its boundary: record the machine and
// action it was asked to authorize, then submit with a fixed active grant.
vi.mock(
  "../../../data/hooks/useControllerAuthorizedAction",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../data/hooks/useControllerAuthorizedAction")
    >()),
    executeControllerAuthorizedAction: vi.fn(
      async ({
        machine,
        action,
        submit,
      }: {
        machine: { machineId: string };
        action: unknown;
        submit: (input: { authorization: unknown }) => Promise<unknown>;
      }) => {
        state.authorizations.push({ machineId: machine.machineId, action });
        if (state.denyAuthorization)
          return {
            outcome: "DENIED",
            reason: "GRANT_NOT_ACTIVE",
            retryable: false,
          };
        return {
          outcome: "ADMITTED",
          data: await submit({ authorization: state.grant }),
        };
      },
    ),
  }),
);
vi.mock("../../../data/hooks/useAgentSession", () => ({
  useAgentSession: () => ({ agentSession: state.session }),
}));
vi.mock("../../../data/hooks/useAgentSessionCurrentState", () => ({
  useAgentSessionCurrentState: () => ({ currentState: "IDLE" }),
}));
vi.mock("../operations/useAgentLaunchHandoff", () => ({
  useAgentLaunchHandoff: () => false,
}));
vi.mock("../../../data/hooks/useConversation", () => ({
  useConversation: () => ({
    data: {
      id: state.session?.conversationId,
      projectId: "project",
      organizationId: "org",
    },
    isFetched: true,
    isLoading: false,
    isFetching: false,
    error: null,
  }),
}));
vi.mock("../../../data/hooks/useProject", () => ({
  useProject: () => ({ data: { id: "project" } }),
}));
vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: () => ({ workItem: null }),
}));
vi.mock("../../../contexts/TrackingContext", () => ({
  TrackingProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useTracking: () => ({ trackEvent: vi.fn() }),
}));
vi.mock("../../../contexts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../contexts")>()),
  TrackingProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  CanonicalPageBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("../runtime/hooks/useCliRequired", () => ({
  useCliRequired: () => ({
    type: "ready",
    machine: {
      machineId: "machine",
      name: "Machine",
      executionReadiness: "READY",
      currentControllerEligibility: "ELIGIBLE",
    },
  }),
}));
vi.mock("../operations/useAgentSessionInteractionAccess", async () => {
  const { requestSubagentInteraction } =
    await import("../operations/AgentOperationProvider");
  return {
    useAgentSessionInteractionAccess: () => ({
      isDeviceEnabled: true,
      interactions: {
        submitMessage: state.ordinary,
        requestSubagent: (input: BoundSubagentInteractionInput) =>
          requestSubagentInteraction({
            ...input,
            machine: {
              machineId: state.session!.machineId!,
              executionReadiness: "READY",
            } as MachineDto,
          }),
      },
      unavailable: null,
    }),
  };
});
vi.mock("../../Conversation/ConversationViewer", () => ({
  ConversationViewer: ({
    onResponseTargetChange,
    conversation,
  }: {
    onResponseTargetChange: ResponseTargetChangeHandler;
    conversation: { id: string };
  }) => {
    const conversationId = conversation.id;
    useEffect(() => {
      onResponseTargetChange(NO_RESPONSE_TARGET, conversationId, true);
    }, [conversationId, onResponseTargetChange]);
    return <div data-testid="history" />;
  },
}));

vi.mock("../../../data/hooks/useAgentSessions", () => ({
  useAgentSessions: () => ({
    agentSessions: state.session ? [state.session] : [],
    isFetched: true,
    markStale: vi.fn(),
    remove: vi.fn(),
  }),
}));
vi.mock("../../../data/hooks/useCreateAgentSession", () => ({
  useCreateAgentSession: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../../data/hooks/useCreateAgentSessionConversation", () => ({
  useCreateAgentSessionConversation: () => ({ mutate: vi.fn() }),
}));
vi.mock("../../../data/hooks/useLatestMessage", () => ({
  useLatestMessage: () => ({ isFetched: false, data: null }),
}));
vi.mock("../RuntimeModelSelector", () => ({
  RuntimeModelSelector: () => null,
}));
vi.mock("../useLaunchRunOrchestration", () => ({
  useLaunchRunOrchestration: () => ({}),
}));
vi.mock("../useAgentRunLifecycle", () => ({
  useAgentRunLifecycle: () => ({
    runId: state.session?.id,
    error: null,
    stopRun,
    stoppingRun: false,
    sendUserMessage: vi.fn(),
  }),
}));
vi.mock("../surfaceSelectionMemory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../surfaceSelectionMemory")>()),
  readSurfaceSelection: () => ({
    provider: "claude",
    model: "model",
    reasoningEffort: null,
  }),
}));
const buildSession = (
  overrides: Partial<AgentSessionDto> = {},
): AgentSessionDto => ({
  id: "session",
  organizationId: "org",
  projectId: "project",
  conversationId: "conversation",
  machineId: "machine",
  userId: "user",
  status: AgentSessionStatus.InProgress,
  currentState: AgentSessionCurrentState.Idle,
  type: AgentSessionType.EntityConversation,
  sessionDate: "2026-09-28",
  title: "Conversation",
  autoDecide: false,
  monitoringEnabled: false,
  hasUnsyncedChanges: false,
  ...overrides,
});
interface Request {
  url: string;
  method: string;
  body: unknown;
}
let requests: Request[];
let interactionState: string;
let rejectAdmission: boolean;
let rejectCancellation: boolean;
let interactionId: string;
let cancellationGate: Promise<void> | null;
const stopRun = vi.fn();

beforeEach(() => {
  globalThis.mswServer.use(
    http.get("http://localhost:3847/api/local/repos", () =>
      HttpResponse.json({ machineId: state.session.machineId, bindings: [] }),
    ),
  );
  // Own every polling timer so unfinished requests cannot reach the next test.
  vi.useFakeTimers();
  state.session = buildSession();
  state.ordinary.mockClear();
  stopRun.mockClear();
  state.authorizations = [];
  state.denyAuthorization = false;
  localStorage.clear();
  requests = [];
  interactionState = "DISPATCHING";
  rejectAdmission = false;
  rejectCancellation = false;
  interactionId = "";
  cancellationGate = null;
  const adapter: AxiosAdapter = async (config) => {
    const url = new URL(config.url!, config.baseURL).pathname;
    const body: unknown = config.data ? JSON.parse(config.data) : undefined;
    requests.push({ url, method: config.method!, body });
    let data: unknown;
    if (url.endsWith("/subagent-interactions")) {
      if (rejectAdmission) throw new Error("Admission rejected");
      const parsed: unknown = JSON.parse(config.data);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !("id" in parsed) ||
        typeof parsed.id !== "string"
      ) {
        throw new Error("Missing interaction identity");
      }
      interactionId = parsed.id;
      data = {
        interaction: { id: interactionId, state: interactionState },
        replayed: false,
      };
    } else if (config.method === "post") {
      if (rejectCancellation) throw new Error("Cancellation rejected");
      await cancellationGate;
      interactionState = "CANCELLED";
      data = { id: interactionId, state: interactionState, revision: 3 };
    } else {
      data = { id: interactionId, state: interactionState, revision: 2 };
    }
    return {
      config,
      status: 200,
      statusText: "OK",
      headers: {},
      data: { success: true, data },
    };
  };
  const transport = axios.create({ adapter });
  registerRuntimeClients(
    createApiRuntime({
      baseUrl: "http://local-test.invalid/api/v1",
      transport: {
        axios: transport,
        request: (config) => transport.request(config),
        setAuthToken: () => {},
        onUnauthorized: () => () => {},
      },
    }).clients,
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function view() {
  return (
    <MemoryRouter>
      <AgentConversationView
        organizationId="org"
        projectId="project"
        agentSessionId={state.session!.id}
        conversationId={state.session!.conversationId!}
        onStopRun={stopRun}
      />
    </MemoryRouter>
  );
}
async function submit(text: string) {
  fireEvent.change(screen.getByTestId("mock-editor-input"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByTestId("run-stream-external-reply-submit"));
  // Fake-timer safe: drain the async submit chain by microtask turns.
  await act(async () => {
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  });
}
async function advance(next: string) {
  interactionState = next;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}

describe("shared composer to subagent transport", () => {
  it.each([
    "search",
    "feature tree",
    "entity conversation",
    "validation",
  ] as const)("submits from the actual %s caller", async (surface) => {
    const session = state.session!;
    const scope = { organizationId: "org", projectId: "project" };
    const content =
      surface === "search" ? (
        <EntitySearchChat
          {...scope}
          agentSession={session}
          selection={{
            provider: "claude",
            model: "model",
            reasoningEffort: null,
          }}
        />
      ) : surface === "feature tree" ? (
        <FeatureTreeConversationChat {...scope} agentSession={session} />
      ) : surface === "entity conversation" ? (
        <EntityConversationChat
          {...scope}
          agentSession={session}
          entityId="task"
          entityType="TASK"
          machineId="machine"
          runtimeSelection={{
            provider: "claude",
            model: "model",
            reasoningEffort: null,
          }}
        />
      ) : (
        <ValidationSession {...scope} agentSession={session} taskData={null} />
      );
    interactionState = "WAITING";
    render(<MemoryRouter>{content}</MemoryRouter>);
    await submit("/subagent background research Inspect");
    // Surfaces that read conversation messages issue those reads through
    // the same client; the admission is the only subagent request.
    const admissions = requests.filter((request) =>
      request.url.endsWith("/subagent-interactions"),
    );
    expect(admissions).toHaveLength(1);
    expect(admissions[0].body).toMatchObject({
      sourceSessionId: session.id,
      sourceRunId: session.id,
      mode: "BACKGROUND",
    });
    expect(state.ordinary).not.toHaveBeenCalled();
  });

  it.each(["foreground", "background"] as const)(
    "submits %s from a reopened entity conversation",
    async (mode) => {
      const session = state.session!;
      if (!isExistingEntityConversationAgentSession(session))
        throw new Error("Invalid fixture");
      render(
        <MemoryRouter>
          <ExistingEntityConversationSession
            organizationId="org"
            projectId="project"
            agentSession={session}
          />
        </MemoryRouter>,
      );
      expect(
        screen.getByTestId("mock-rich-slash-command-plugin"),
      ).toHaveAttribute("data-subagent-available", "true");
      await submit(`/subagent ${mode} research Investigate`);
      expect(requests[0].body).toEqual({
        id: interactionId,
        attemptId: interactionId,
        sourceSessionId: "session",
        sourceRunId: "session",
        mode: mode.toUpperCase(),
        capability: "RESEARCH",
        objective: "Investigate",
        serviceIds: [],
        idempotencyKey: interactionId,
        expectedRevision: 0,
        authorization: state.grant,
      });
      expect(state.authorizations).toEqual([
        {
          machineId: "machine",
          action: {
            requestId: expect.any(String),
            actionCategory: "CONVERSATION",
            actionType: "CONVERSATION_TRIGGER",
            targetKind: "AGENT_SESSION",
            targetId: "session",
          },
        },
      ]);
      expect(state.ordinary).not.toHaveBeenCalled();
      expect(screen.queryByTestId("run-stream-stop")).not.toBeInTheDocument();
      await advance("WAITING");
      if (mode === "foreground") await advance("DELIVERED");
      fireEvent.change(screen.getByTestId("mock-editor-input"), {
        target: { value: "Follow up" },
      });
      expect(
        screen.getByTestId("run-stream-external-reply-submit"),
      ).toBeEnabled();
    },
  );

  it("keeps pending separate from accepted waiting and confirms cancellation before stopping", async () => {
    render(view());
    await submit("/subagent foreground research Investigate");
    expect(screen.getByTestId("run-stream-stop")).toBeDisabled();
    await advance("WAITING");
    expect(screen.getByTestId("run-stream-stop")).toBeEnabled();
    rejectCancellation = true;
    fireEvent.click(screen.getByTestId("run-stream-stop"));
    await act(async () => {});
    expect(screen.getByTestId("subagent-cancellation-error")).toHaveTextContent(
      "Cancellation rejected",
    );
    expect(stopRun).not.toHaveBeenCalled();
    rejectCancellation = false;
    let confirmCancellation = () => {};
    cancellationGate = new Promise<void>((resolve) => {
      confirmCancellation = resolve;
    });
    fireEvent.click(screen.getByTestId("run-stream-stop"));
    await act(async () => {});
    expect(stopRun).not.toHaveBeenCalled();
    expect(screen.getByTestId("run-stream-stop")).toBeDisabled();
    await act(async () => {
      confirmCancellation();
    });
    expect(stopRun).toHaveBeenCalledTimes(1);
    await advance("CANCELLED");
  });

  it("protects repeated gestures while the request is pending", async () => {
    render(view());
    await submit("/subagent foreground research Investigate");
    fireEvent.click(screen.getByTestId("run-stream-external-reply-submit"));
    expect(
      requests.filter((request) => request.method === "post"),
    ).toHaveLength(1);
    await advance("DELIVERED");
  });

  it("shows admission failures without sending an ordinary prompt", async () => {
    rejectAdmission = true;
    render(view());
    await submit("/subagent background research Investigate");
    expect(
      screen.getByTestId("run-stream-external-reply-error"),
    ).toHaveTextContent("Admission rejected");
    expect(state.ordinary).not.toHaveBeenCalled();
  });

  it("surfaces controller denial without submitting child work", async () => {
    state.denyAuthorization = true;
    render(view());
    await submit("/subagent background research Investigate");
    expect(state.authorizations).toHaveLength(1);
    expect(
      requests.filter((request) =>
        request.url.endsWith("/subagent-interactions"),
      ),
    ).toHaveLength(0);
    expect(
      screen.getByTestId("run-stream-external-reply-error"),
    ).toHaveTextContent("The controller denied this child request");
    expect(state.ordinary).not.toHaveBeenCalled();
  });

  it("retries failed admission with the original gesture identity", async () => {
    rejectAdmission = true;
    render(view());
    await submit("/subagent background research Investigate");
    const admissions = () =>
      requests.filter(
        (request) =>
          request.method === "post" &&
          request.url.endsWith("/subagent-interactions"),
      );
    const firstRequest = admissions()[0].body;
    rejectAdmission = false;
    interactionState = "WAITING";
    fireEvent.click(screen.getByTestId("run-stream-external-reply-retry"));
    await act(async () => {
      for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    });
    expect(admissions()).toHaveLength(2);
    expect(admissions()[1].body).toEqual(firstRequest);
    expect(
      screen.queryByTestId("run-stream-external-reply-error"),
    ).not.toBeInTheDocument();
  });

  it("shows failed foreground delivery", async () => {
    interactionState = "WAITING";
    render(view());
    await submit("/subagent foreground research Investigate");
    await advance("FAILED");
    expect(
      screen.getByTestId("run-stream-external-reply-error"),
    ).toHaveTextContent("did not deliver");
  });

  it("does not expose pre-launch commands or turn them into ordinary messages", async () => {
    state.session = buildSession({
      status: AgentSessionStatus.NotStarted,
      machineId: null,
    });
    render(view());
    expect(
      screen.getByTestId("mock-rich-slash-command-plugin"),
    ).toHaveAttribute("data-subagent-available", "false");
    await submit("/subagent background research Investigate");
    expect(
      screen.getByTestId("run-stream-external-reply-error"),
    ).toHaveTextContent("Start this Agent Session");
    expect(requests).toHaveLength(0);
    expect(state.ordinary).not.toHaveBeenCalled();
  });

  it("leaves mid-message commands literal", async () => {
    render(view());
    await submit("Explain /subagent foreground research");
    expect(state.ordinary).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(0);
  });

  it("isolates pending completion from the next session", async () => {
    const rendered = render(view());
    await submit("/subagent foreground research Investigate");
    state.session = buildSession({
      id: "next-session",
      conversationId: "next-conversation",
    });
    rendered.rerender(view());
    await advance("WAITING");
    expect(screen.getByTestId("run-stream-stop")).toBeDisabled();
    await advance("FAILED");
    expect(
      screen.queryByTestId("run-stream-external-reply-error"),
    ).not.toBeInTheDocument();
  });
});
