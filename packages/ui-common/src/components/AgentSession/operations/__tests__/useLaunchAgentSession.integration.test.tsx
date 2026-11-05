import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionConfigV2TypeEnum,
  AgentSessionConfigV2VersionEnum,
  AuthorizationProtocolVersion,
  ConversationStartRunRequestDtoProviderEnum,
  ConversationStartRunRequestDtoReasoningEffortEnum,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  WorkflowName,
  type AgentSessionConfigV2,
  type MachineDto,
} from "../../../../api";
import type { AgentSessionLaunchBinding } from "../launchAgentSession";
import { useLaunchAgentSession } from "../useLaunchAgentSession";

const MACHINE_ID = "machine-launch";

/**
 * An in-memory platform that enforces the start-authorization promise: the
 * controller authorization resolve only succeeds for an existing Agent Session
 * that is already bound to the selected machine, and otherwise answers
 * 403 TARGET_MISMATCH.
 */
const platform = vi.hoisted(() => {
  interface Session {
    id: string;
    projectId: string;
    machineId: string | null;
    conversationId: string | null;
    provider: string;
    config: unknown;
  }
  const state = {
    sessions: new Map<string, Session>(),
    events: [] as string[],
    starts: [] as Array<Record<string, unknown>>,
    pingAcknowledged: true,
    failBinding: false,
    startState: "SUCCEEDED" as string,
    nextId: 1,
    machine: undefined as MachineDto | undefined,
  };
  const forbidden = () =>
    Object.assign(new Error("Forbidden"), {
      response: { status: 403, data: { code: "TARGET_MISMATCH" } },
    });
  return { state, forbidden };
});

vi.mock("../../../../clients/serviceClients", () => ({
  projectsClient: { cancelAgentOperationInput: vi.fn() },
  machinesClient: {
    listMachines: vi.fn(async () => ({
      data: { data: { machines: [platform.state.machine] } },
    })),
    pingMachine: vi.fn(async () => {
      platform.state.events.push("ping");
      return {
        data: { data: { acknowledged: platform.state.pingAcknowledged } },
      };
    }),
  },
  agentSessionsClient: {
    updateAgentSession: vi.fn(
      async (request: {
        agentSessionId: string;
        updateAgentSessionDto: { machineId: string };
      }) => {
        platform.state.events.push("bind");
        if (platform.state.failBinding) {
          throw platform.forbidden();
        }
        const session = platform.state.sessions.get(request.agentSessionId);
        if (!session) {
          throw new Error("missing session");
        }
        session.machineId = request.updateAgentSessionDto.machineId;
        return { data: { data: { ...session } } };
      },
    ),
    createAgentSessionConversation: vi.fn(
      async (request: { agentSessionId: string }) => {
        platform.state.events.push("conversation");
        const session = platform.state.sessions.get(request.agentSessionId);
        if (!session) {
          throw new Error("missing session");
        }
        session.conversationId = "conversation-new";
        return {
          data: {
            data: {
              agentSession: { ...session },
              conversation: { id: "conversation-new" },
            },
          },
        };
      },
    ),
  },
  unifiedApiClient: {
    createAgentSession: vi.fn(
      async (request: {
        createAgentSessionDto: {
          projectId: string;
          provider: string;
          config: unknown;
          existingWorkflowBinding?: { conversationId: string };
        };
      }) => {
        platform.state.events.push("create");
        const id = `session-${platform.state.nextId++}`;
        const dto = request.createAgentSessionDto;
        const session = {
          id,
          projectId: dto.projectId,
          machineId: null,
          conversationId: dto.existingWorkflowBinding?.conversationId ?? null,
          provider: dto.provider,
          config: dto.config,
        };
        platform.state.sessions.set(id, session);
        return { data: { data: { ...session } } };
      },
    ),
    startConversationRun: vi.fn(
      async (request: {
        conversationStartRunRequestDto: Record<string, unknown>;
      }) => {
        platform.state.events.push("start");
        platform.state.starts.push(request.conversationStartRunRequestDto);
        return {
          data: {
            data: {
              operationId: request.conversationStartRunRequestDto.operationId,
              operationFingerprint:
                request.conversationStartRunRequestDto.operationFingerprint,
              operationState: platform.state.startState,
              dispatched: true,
              triggerMessageId: "trigger-1",
            },
          },
        };
      },
    ),
    getAgentOperation: vi.fn(),
  },
  controllerAuthorizationClient: {
    resolveControllerAuthorization: vi.fn(
      async (request: {
        resolveControllerAuthorizationRequestDto: {
          machineId: string;
          action: { targetId: string };
        };
      }) => {
        platform.state.events.push("authorize");
        const { machineId, action } =
          request.resolveControllerAuthorizationRequestDto;
        const session = platform.state.sessions.get(action.targetId);
        if (!session || session.machineId !== machineId) {
          throw platform.forbidden();
        }
        return {
          data: {
            data: {
              outcome: "ACTIVE_GRANT",
              authorization: { kind: "bounded_grant", grantId: "grant-1" },
            },
          },
        };
      },
    ),
  },
}));

vi.mock("../../../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({
    machines: [platform.state.machine],
    isFetched: true,
    isLoading: false,
    error: null,
  }),
}));

const machine: MachineDto = {
  machineId: MACHINE_ID,
  name: "Local machine",
  pairedAt: "2026-09-01T00:00:00Z",
  active: true,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness: MachineExecutionReadinessState.Ready,
  currentControllerCredentialId: null,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
};

const config = {
  type: AgentSessionConfigV2TypeEnum.CodingSession,
  version: AgentSessionConfigV2VersionEnum.V2,
  model: "claude-opus-4-8",
  effort: "high",
  fastMode: false,
} satisfies AgentSessionConfigV2;

const baseBinding = {
  organizationId: "organization-1",
  projectId: "project-1",
  session: {},
  runtime: {
    provider: ConversationStartRunRequestDtoProviderEnum.Claude,
    model: "claude-opus-4-8",
    reasoningEffort: ConversationStartRunRequestDtoReasoningEffortEnum.High,
    fastMode: false,
    config,
  },
  start: {
    handlerPromptType: "local_onboarding",
    payload: (prompt, conversationId) => ({
      promptType: "local_onboarding",
      userMessage: prompt,
      conversationId,
    }),
    initialMessage: true,
  },
} satisfies Omit<AgentSessionLaunchBinding, "conversation">;

const newConversationBinding: AgentSessionLaunchBinding = {
  ...baseBinding,
  conversation: {
    kind: "new",
    body: { workflowType: WorkflowName.AgentSession },
  },
};

const workflowBinding: AgentSessionLaunchBinding = {
  ...baseBinding,
  conversation: {
    kind: "existingWorkflow",
    conversationId: "conversation-workflow",
    workflowId: "workflow-1",
  },
};

const wrapper = ({ children }: PropsWithChildren) => (
  <QueryClientProvider client={new QueryClient()}>
    {children}
  </QueryClientProvider>
);

const renderLaunch = (binding: AgentSessionLaunchBinding) =>
  renderHook(() => useLaunchAgentSession(binding), { wrapper });

describe("useLaunchAgentSession through real controller authorization", () => {
  beforeEach(() => {
    Object.assign(platform.state, {
      machine,
      pingAcknowledged: true,
      failBinding: false,
      startState: "SUCCEEDED",
      nextId: 1,
    });
    platform.state.sessions.clear();
    platform.state.events.length = 0;
    platform.state.starts.length = 0;
  });

  it("starts a new-Conversation launch only after the machine is saved on the exact session", async () => {
    const { result } = renderLaunch(newConversationBinding);

    let launched;
    await act(async () => {
      launched = await result.current.launch({
        machineId: MACHINE_ID,
        prompt: "Get me started",
      });
    });

    expect(launched).toMatchObject({
      ok: true,
      conversationId: "conversation-new",
      session: { id: "session-1", machineId: MACHINE_ID },
    });
    expect(platform.state.events).toEqual([
      "ping",
      "create",
      "bind",
      "conversation",
      "authorize",
      "start",
    ]);
    expect(platform.state.starts).toHaveLength(1);
    expect(platform.state.starts[0]).toMatchObject({
      agentSessionId: "session-1",
      machineId: MACHINE_ID,
      provider: "claude",
      model: "claude-opus-4-8",
      reasoningEffort: "high",
      fastMode: false,
      config,
      handlerPromptType: "local_onboarding",
      payload: {
        promptType: "local_onboarding",
        userMessage: "Get me started",
        conversationId: "conversation-new",
      },
    });
  });

  it("reuses the attached workflow Conversation and still binds before authorizing", async () => {
    const { result } = renderLaunch(workflowBinding);

    let launched;
    await act(async () => {
      launched = await result.current.launch({
        machineId: MACHINE_ID,
        prompt: "Go",
      });
    });

    expect(launched).toMatchObject({
      ok: true,
      conversationId: "conversation-workflow",
    });
    expect(platform.state.events).toEqual([
      "ping",
      "create",
      "bind",
      "authorize",
      "start",
    ]);
  });

  it("does not authorize or start when the machine cannot be saved on the session", async () => {
    platform.state.failBinding = true;
    const { result } = renderLaunch(workflowBinding);

    let launched;
    await act(async () => {
      launched = await result.current.launch({
        machineId: MACHINE_ID,
        prompt: "Go",
      });
    });

    expect(launched).toMatchObject({ ok: false, stage: "bind_machine" });
    expect(platform.state.events).not.toContain("authorize");
    expect(platform.state.starts).toEqual([]);
  });

  it("does not create anything when the machine does not answer the fresh ping", async () => {
    platform.state.pingAcknowledged = false;
    const { result } = renderLaunch(workflowBinding);

    let launched;
    await act(async () => {
      launched = await result.current.launch({
        machineId: MACHINE_ID,
        prompt: "Go",
      });
    });

    expect(launched).toMatchObject({ ok: false, stage: "ping" });
    expect(platform.state.events).toEqual(["ping"]);
  });

  it("follows the same session and operation when a launch is retried or called concurrently", async () => {
    const { result } = renderLaunch(workflowBinding);

    let first;
    let second;
    await act(async () => {
      [first, second] = await Promise.all([
        result.current.launch({ machineId: MACHINE_ID, prompt: "Go" }),
        result.current.launch({ machineId: MACHINE_ID, prompt: "Go" }),
      ]);
    });
    let third;
    await act(async () => {
      third = await result.current.launch({
        machineId: MACHINE_ID,
        prompt: "Go",
      });
    });

    expect(first).toBe(second);
    expect(third).toMatchObject({ ok: true });
    expect(platform.state.sessions.size).toBe(1);
    expect(platform.state.starts).toHaveLength(1);
  });

  it("keeps the prepared session when a failure before start is retried", async () => {
    const { result } = renderLaunch(workflowBinding);
    platform.state.failBinding = true;
    await act(async () => {
      await result.current.launch({ machineId: MACHINE_ID, prompt: "Go" });
    });

    platform.state.failBinding = false;
    let retried;
    await act(async () => {
      retried = await result.current.launch({
        machineId: MACHINE_ID,
        prompt: "Go",
      });
    });

    expect(retried).toMatchObject({ ok: true });
    expect(platform.state.sessions.size).toBe(1);
    expect(platform.state.starts).toHaveLength(1);
  });

  it("returns a recorded terminal denial instead of starting a replacement", async () => {
    platform.state.startState = "DENIED";
    const { result } = renderLaunch(workflowBinding);

    let denied;
    await act(async () => {
      denied = await result.current.launch({
        machineId: MACHINE_ID,
        prompt: "Go",
      });
    });
    let again;
    await act(async () => {
      again = await result.current.launch({
        machineId: MACHINE_ID,
        prompt: "Go",
      });
    });

    expect(denied).toMatchObject({ ok: false, stage: "start" });
    expect(again).toMatchObject({ ok: false, stage: "start" });
    expect(platform.state.starts).toHaveLength(1);
  });
});
