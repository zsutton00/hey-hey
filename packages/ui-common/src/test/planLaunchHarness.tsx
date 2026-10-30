import React from "react";
import { beforeEach, vi } from "vitest";
import { createStore, Provider } from "jotai";
import { AgentOperationProvider } from "../components/AgentSession/operations/AgentOperationProvider";
import type { AgentOperationDependencies } from "../components/AgentSession/operations/AgentOperationCoordinator";
import type { AgentOperationSnapshot } from "../components/AgentSession/operations/agentOperationReducer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { agentSessionKeys } from "../data/collections/agentSessions";
import { setCapabilityCatalogForTests } from "../components/AgentSession/capabilityCatalog";
import { EagerIntersectionObserver } from "./eagerIntersectionObserver";
import {
  AgentSessionCurrentState,
  AgentSessionStatus,
  AgentSessionType,
  AuthorizationProtocolVersion,
  ConversationStatus,
  CurrentControllerMachineEligibilityState,
  EntityType,
  InitiationType,
  MachineExecutionReadinessState,
  WorkStatus,
  WorkflowName,
  type AgentSessionDto,
  type ConversationResponseDto,
  type MachineDto,
  type PlanConfigurationV1,
} from "../api";

const launchMocks = vi.hoisted(() => ({
  updatePlan: vi.fn(),
  updateSession: vi.fn(),
  sessions: vi.fn(),
  conversation: vi.fn(),
}));
vi.mock("../clients/client", () => ({ apiClient: { postMessage: vi.fn() } }));
vi.mock(
  "../components/AgentSession/runtime/coding/update-agent-session-record",
  () => ({
    updateAgentSessionRecord: (...args: unknown[]) =>
      launchMocks.updateSession(...args),
  }),
);
vi.mock("../data/hooks/useCanonicalPlanMutations", () => ({
  useCanonicalPlanMutations: () => ({ updatePlan: launchMocks.updatePlan }),
}));
vi.mock("../data/hooks/useAgentSessions", () => ({
  useAgentSessions: () => launchMocks.sessions(),
}));
vi.mock("../data/hooks/useConversation", () => ({
  useConversation: () => launchMocks.conversation(),
}));
vi.mock("../data/hooks/usePlanFromDesignDocConversation", () => ({
  usePlanFromDesignDocConversation: () => ({
    conversation: launchMocks.conversation().data,
    isFetched: true,
    isLoading: false,
    error: null,
    markStale: vi.fn(),
  }),
}));
vi.mock("../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({
    machines: [launchMachine],
    isFetched: true,
    isLoading: false,
    error: null,
  }),
}));
vi.mock(
  "../components/AgentSession/runtime/coding/useMachineResolution",
  () => ({
    useMachineResolution: () => ({
      machines: [launchMachine],
      selectedMachine: launchMachine,
      mode: "single",
      isReady: true,
      setSelectedMachineId: vi.fn(),
    }),
  }),
);
vi.mock("../components/AgentSession/runtime/hooks/useCliRequired", () => ({
  useCliRequired: () => ({ type: "ready", machine: launchMachine }),
}));
vi.mock("../components/AgentSession/usePlanFromDesignDocSeed", () => ({
  usePlanFromDesignDocSeed: () => ({
    seed: null,
    designDocId: null,
    isLoading: false,
    error: null,
  }),
}));
vi.mock("../components/AgentSession/usePlanCreationCreatingState", () => ({
  usePlanCreationCreatingState: () => false,
}));
vi.mock("../components/AgentSession/useAutoAdvanceFeatureSyncIterate", () => ({
  useAutoAdvanceFeatureSyncIterate: () => vi.fn(),
}));
vi.mock("../data/hooks/useProject", () => ({
  useProject: () => ({
    data: { name: "Project" },
    isLoading: false,
    error: null,
  }),
}));
vi.mock("../components/Conversation/ConversationViewer", () => ({
  DISABLED_CONVERSATION_SCROLL_POLICY: { mode: "disabled" },
  ConversationViewer: () => <div data-testid="empty-conversation-history" />,
}));
vi.mock(
  "../components/AgentSession/surfaceSelectionMemory",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../components/AgentSession/surfaceSelectionMemory")
    >()),
    readSurfaceSelection: () => null,
    buildDefaultSurfaceSelection: () => ({
      provider: "claude",
      model: "claude-opus-4-8",
      reasoningEffort: null,
      fastMode: false,
    }),
    writeSurfaceSelection: vi.fn(),
  }),
);

export const launchScope = {
  organizationId: "org-launch",
  projectId: "project-launch",
  agentSessionId: "session-launch",
  conversationId: "conversation-launch",
};
const launchMachine: MachineDto = {
  machineId: "machine-launch",
  name: "Local machine",
  pairedAt: "2026-09-01T00:00:00Z",
  active: true,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness: MachineExecutionReadinessState.Ready,
  currentControllerCredentialId: null,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
  bindings: [],
};
export const launchConversation: ConversationResponseDto = {
  restricted: true,
  id: launchScope.conversationId,
  createdBy: null,
  organizationId: launchScope.organizationId,
  projectId: launchScope.projectId,
  initiatedBy: InitiationType.System,
  status: ConversationStatus.NotStarted,
  version: 1,
  workflowName: WorkflowName.PlanFromDesignDoc,
  workflowAboutId: "plan-launch",
  workflowAboutType: "task",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};
export const launchSession: AgentSessionDto = {
  id: launchScope.agentSessionId,
  organizationId: launchScope.organizationId,
  projectId: launchScope.projectId,
  userId: "user-launch",
  machineId: launchMachine.machineId,
  type: AgentSessionType.PlanGeneration,
  status: AgentSessionStatus.InProgress,
  currentState: AgentSessionCurrentState.Idle,
  sessionDate: "2026-09-01T00:00:00Z",
  conversationId: launchScope.conversationId,
  entityType: EntityType.Task,
  entityId: "plan-launch",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  monitoringEnabled: false,
  autoDecide: false,
  hasUnsyncedChanges: false,
  title: "Plan generation",
};
export const launchPlan = {
  id: "plan-launch",
  name: "Launch test plan",
  status: WorkStatus.Backlog,
};
export const launchConfiguration: PlanConfigurationV1 = {
  schemaVersion: "plan-configuration.v1",
  planType: "STANDARD",
  worktreeBranch: null,
};

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const launchCurrentStateKey = () =>
  agentSessionKeys.currentState(
    launchScope.organizationId,
    launchScope.projectId,
    launchScope.agentSessionId,
  );

export function createLaunchHarness() {
  const store = createStore();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(launchCurrentStateKey(), {
    currentState: AgentSessionCurrentState.Idle,
    revision: 1,
    transitionedAt: "2026-09-01T00:00:00Z",
  });
  const completion = deferred<AgentOperationSnapshot>();
  let operation: AgentOperationSnapshot | null = null;
  const dependencies: AgentOperationDependencies = {
    fingerprintStart: vi.fn(async () => "launch-fingerprint"),
    fingerprintMessage: vi.fn(async () => "message-fingerprint"),
    startSession: vi.fn(async ({ operationId, fingerprint }) => {
      operation = {
        operationId,
        fingerprint,
        kind: "start_run",
        state: "dispatch_pending",
      };
      return operation;
    }),
    reconcile: vi.fn(() => completion.promise),
    submitMessage: vi.fn(),
    requestSubagent: vi.fn(),
  };
  return {
    store,
    queryClient,
    dependencies,
    finish(state: "succeeded" | "failed" | "denied") {
      if (!operation) throw new Error("Launch was not dispatched");
      completion.resolve(
        state === "succeeded"
          ? {
              ...operation,
              state,
              messageId: "message-launch",
              triggerMessageId: "trigger-launch",
            }
          : {
              ...operation,
              state,
              code: "LAUNCH_REJECTED",
              message:
                "Launch rejected. Check machine authorization and retry.",
            },
      );
    },
    runtime(currentState: AgentSessionCurrentState, revision: number) {
      queryClient.setQueryData(launchCurrentStateKey(), {
        currentState,
        revision,
        transitionedAt: new Date().toISOString(),
      });
    },
    /** No live revision: consumers fall back to the canonical state. */
    clearRuntime() {
      queryClient.setQueryData(launchCurrentStateKey(), null);
    },
    Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>
            <AgentOperationProvider dependencies={dependencies}>
              {children}
            </AgentOperationProvider>
          </Provider>
        </QueryClientProvider>
      );
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IntersectionObserver", EagerIntersectionObserver);
  setCapabilityCatalogForTests([
    {
      provider: "claude",
      models: [
        {
          id: "claude-opus-4-8",
          label: "Opus",
          efforts: ["low", "medium", "high"],
        },
      ],
    },
  ]);
  launchMocks.updatePlan.mockResolvedValue({
    status: "applied",
    plan: launchPlan,
  });
  launchMocks.updateSession.mockResolvedValue({
    ok: true,
    session: launchSession,
  });
  launchMocks.sessions.mockReturnValue({
    agentSessions: [launchSession],
    isFetched: true,
    error: null,
  });
  launchMocks.conversation.mockReturnValue({
    data: launchConversation,
    isFetched: true,
    isLoading: false,
    error: null,
  });
});

export { launchMocks };
