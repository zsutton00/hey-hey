import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AgentSessionType,
  EntityType,
  type AgentSessionDto,
  type GoalPmRoutingCreation,
  type GoalPmRoutingSelectionPayload,
  type GoalPmRoutingEnactmentResponse,
  type LocalGoalPmConversationInventoryItem,
  type TaskResponseDto,
} from "@hey-hey/ui-common/api";
import {
  EntityConversationChat,
  ChatSessionPendingPlaceholder,
  RuntimeModelSelector,
  bindGraphConversationAgentSessionMachine,
  buildEntityConversationSessionConfig,
  isMachineExecutionReady,
  resolveEntityConversationRuntimeSelection,
  updateAgentSessionRecord,
  type GoalPmConversationLink,
  type ModelSelectorMachineSelectionProps,
  type SurfaceSelection,
} from "@hey-hey/ui-common/components";
import { TrackingProvider } from "@hey-hey/ui-common/context";
import { WebPathService } from "@hey-hey/ui-common/services";
import {
  useAgentSessions,
  useCreateAgentSession,
} from "@hey-hey/ui-common/data";
import { Alert, Box, CircularProgress, Stack } from "@mui/material";

export interface GoalPrimaryConversationProps {
  organizationId: string;
  projectId: string;
  goalId: string;
  goalTask: TaskResponseDto;
  onConversationReady?: (conversationId: string) => void;
  initialUserMessage?: string;
  onInitialUserMessageSent?: () => void;
  runtimeSelection: SurfaceSelection | null;
  onRuntimeSelectionChange: (selection: SurfaceSelection) => void;
  machineSelection: ModelSelectorMachineSelectionProps;
  selectedAgentSessionId?: string | null;
  initialDraft?: string;
  goalPm?: {
    conversationInventory: LocalGoalPmConversationInventoryItem[];
  };
  onGoalPmAction?: (
    action: GoalPmRoutingSelectionPayload,
    sourceConversationId: string,
    draftText?: string,
    creation?: GoalPmRoutingCreation,
  ) => Promise<GoalPmRoutingEnactmentResponse>;
  onGoalPmRequestSubmitted?: (request: string) => void;
  goalPmConversationLink?: GoalPmConversationLink;
}

const extractDescription = (goalTask: TaskResponseDto): string => {
  const section = goalTask.sections?.find((s) => s.key === "description");
  const text = section?.materializedMarkdown?.trim();
  return text ?? "";
};

const LoadingSpinner: React.FC = () => (
  <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
    <CircularProgress size={28} />
  </Box>
);

export const GoalPrimaryConversation: React.FC<
  GoalPrimaryConversationProps
> = ({
  organizationId,
  projectId,
  goalId,
  goalTask,
  onConversationReady,
  initialUserMessage,
  onInitialUserMessageSent,
  selectedAgentSessionId = null,
  initialDraft,
  runtimeSelection,
  onRuntimeSelectionChange,
  machineSelection,
  goalPm,
  onGoalPmAction,
  onGoalPmRequestSubmitted,
  goalPmConversationLink,
}) => {
  const goalDescription = extractDescription(goalTask);
  const goalSnapshot = React.useMemo(
    () => ({
      description: goalDescription,
      ...(goalTask.dueDate ? { dueDate: goalTask.dueDate } : {}),
      ...(goalTask.trackedEntities
        ? { trackedEntities: goalTask.trackedEntities }
        : {}),
    }),
    [goalDescription, goalTask.dueDate, goalTask.trackedEntities],
  );
  const { agentSessions, isFetched } = useAgentSessions(
    organizationId,
    projectId,
    {
      entityType: EntityType.Task,
      entityId: goalId,
      type: AgentSessionType.EntityConversation,
      enabled: !!organizationId && !!projectId && !!goalId,
    },
  );

  const existingSession = selectedAgentSessionId
    ? (agentSessions.find((session) => session.id === selectedAgentSessionId) ??
      null)
    : null;

  const createdSessionRef = useRef<AgentSessionDto | null>(null);
  const [createdSession, setCreatedSession] = useState<AgentSessionDto | null>(
    null,
  );
  const [isStarting, setIsStarting] = useState(false);
  const activeSession =
    existingSession ?? createdSession ?? createdSessionRef.current;
  const hydratedSelectionSessionIdRef = useRef<string | null>(null);
  const displayedSelection = runtimeSelection
    ? activeSession
      ? resolveEntityConversationRuntimeSelection(
          activeSession,
          runtimeSelection,
        )
      : runtimeSelection
    : null;
  const displayedSelectionRef = useRef(displayedSelection);
  displayedSelectionRef.current = displayedSelection;
  const updateDisplayedSelection = useCallback(
    (updates: Partial<SurfaceSelection>) => {
      if (activeSession || isStarting) return;
      const selection = displayedSelectionRef.current;
      if (!selection) return;
      const nextSelection = {
        ...selection,
        ...updates,
      };
      displayedSelectionRef.current = nextSelection;
      onRuntimeSelectionChange(nextSelection);
    },
    [activeSession, isStarting, onRuntimeSelectionChange],
  );

  useEffect(() => {
    if (!activeSession) {
      hydratedSelectionSessionIdRef.current = null;
      return;
    }
    if (!runtimeSelection) return;
    if (hydratedSelectionSessionIdRef.current === activeSession.id) return;
    const selection = resolveEntityConversationRuntimeSelection(
      activeSession,
      runtimeSelection,
    );
    if (!selection) return;
    hydratedSelectionSessionIdRef.current = activeSession.id;
    onRuntimeSelectionChange(selection);
  }, [activeSession, onRuntimeSelectionChange, runtimeSelection]);

  // Apply the persisted machine as the initial preference when it is still
  // ready. This happens once per session; a later invalidation remains cleared
  // until the user explicitly chooses another machine.
  const preferredMachineSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeSession?.machineId) return;
    if (preferredMachineSessionIdRef.current === activeSession.id) return;
    const preferredMachine = machineSelection.machines.find(
      (machine) => machine.machineId === activeSession.machineId,
    );
    if (!preferredMachine || !isMachineExecutionReady(preferredMachine)) return;
    preferredMachineSessionIdRef.current = activeSession.id;
    if (machineSelection.selectedMachineId !== preferredMachine.machineId) {
      machineSelection.onSelectMachine(preferredMachine.machineId);
    }
  }, [activeSession, machineSelection]);

  const { mutate: createSession } = useCreateAgentSession();

  const [firstMessage, setFirstMessage] = useState<string>();
  const creationRef = useRef<Promise<void> | null>(null);
  const handleFirstSubmit = useCallback(
    (text: string): Promise<void> => {
      if (creationRef.current) return creationRef.current;
      if (!displayedSelection) {
        return Promise.reject(
          new Error("Runtime provider choices are still loading."),
        );
      }
      const machineId = machineSelection.selectedMachineId;
      if (!machineId)
        return Promise.reject(
          new Error("Select an execution-ready CLI machine before sending."),
        );
      setIsStarting(true);
      const promise = (async () => {
        const created =
          createdSessionRef.current ??
          (await createSession({
            organizationId,
            agentSession: {
              projectId,
              sessionDate: new Date().toISOString(),
              type: AgentSessionType.EntityConversation,
              entityType: EntityType.Task,
              entityId: goalId,
              provider: displayedSelection.provider,
              config: buildEntityConversationSessionConfig(displayedSelection),
            },
          }));
        createdSessionRef.current = created;
        const bound = await bindGraphConversationAgentSessionMachine({
          organizationId,
          projectId,
          agentSessionId: created.id,
          machineId,
        });
        setFirstMessage(text);
        setCreatedSession(bound);
      })();
      creationRef.current = promise;
      void promise
        .finally(() => {
          creationRef.current = null;
          setIsStarting(false);
        })
        .catch(() => undefined);
      return promise;
    },
    [
      createSession,
      organizationId,
      projectId,
      goalId,
      displayedSelection,
      machineSelection.selectedMachineId,
    ],
  );
  const sessionForChat = selectedAgentSessionId
    ? (existingSession ??
      (createdSession?.id === selectedAgentSessionId ? createdSession : null))
    : createdSession;
  const persistMachineSelection = useCallback(async () => {
    if (!sessionForChat || !machineSelection.selectedMachineId) {
      throw new Error("Select an execution-ready CLI machine before sending.");
    }
    const result = await updateAgentSessionRecord({
      organizationId,
      projectId,
      agentSessionId: sessionForChat.id,
      machineId: machineSelection.selectedMachineId,
    });
    if (!result.ok || result.session.id !== sessionForChat.id) {
      throw new Error(
        result.ok
          ? "The Agent Session update response did not match the selected session."
          : result.error,
      );
    }
  }, [
    machineSelection.selectedMachineId,
    organizationId,
    projectId,
    sessionForChat,
  ]);

  const selector = (
    <RuntimeModelSelector
      disabled={isStarting || !!activeSession}
      testIdPrefix="goal-conversation"
      provider={displayedSelection?.provider ?? null}
      model={displayedSelection?.model ?? null}
      reasoningEffort={displayedSelection?.reasoningEffort ?? null}
      catalogSource={
        machineSelection.selectedMachineId
          ? {
              organizationId,
              projectId,
              machineId: machineSelection.selectedMachineId,
            }
          : null
      }
      fastMode={displayedSelection?.fastMode ?? false}
      onFastModeChange={(fastMode) => updateDisplayedSelection({ fastMode })}
      onProviderChange={(provider) => updateDisplayedSelection({ provider })}
      onModelChange={(model) => updateDisplayedSelection({ model })}
      onReasoningEffortChange={(reasoningEffort) =>
        updateDisplayedSelection({ reasoningEffort })
      }
      machineSelection={machineSelection}
    />
  );

  if (!isFetched || (selectedAgentSessionId && !sessionForChat)) {
    return <LoadingSpinner />;
  }

  if (!sessionForChat) {
    return (
      <Stack spacing={2}>
        <ChatSessionPendingPlaceholder
          message={`Ready to get started on your goal, ${goalTask.name}? I can help create tasks, answers questions, and start new conversations. All new conversations will be in the table of contents and you can always return here to start new ones`}
          onSubmit={handleFirstSubmit}
        />
        {!runtimeSelection && (
          <Alert severity="info">Loading runtime provider choices.</Alert>
        )}
        {selector}
      </Stack>
    );
  }

  if (!displayedSelection) {
    return (
      <Stack spacing={2}>
        <Alert severity="info">Loading runtime provider choices.</Alert>
        {selector}
      </Stack>
    );
  }

  // History stays readable without a machine; only sending requires one
  // (persistMachineSelection rejects the send until a machine is chosen).
  const machineRequiredNotice = !machineSelection.selectedMachineId ? (
    <Stack spacing={2} sx={{ mb: 2 }}>
      {selector}
      <Alert severity="info">
        Select an execution-ready CLI machine to continue this conversation.
      </Alert>
    </Stack>
  ) : null;

  return (
    <>
      {machineRequiredNotice}
      <TrackingProvider
        context={{
          page: {
            name: "goal-conversation",
            path: WebPathService.task({ projectId, taskId: goalId }),
            section: "conversation",
          },
          workflow: {
            id: sessionForChat.id,
            name: "entity-conversation",
          },
        }}
      >
        <EntityConversationChat
          key={sessionForChat.id}
          organizationId={organizationId}
          projectId={projectId}
          agentSession={sessionForChat}
          entityId={goalId}
          entityType="task"
          scrollable
          entityName={goalTask.name}
          entitySummary={goalDescription || undefined}
          goalSnapshot={goalSnapshot}
          runtimeSelection={displayedSelection}
          machineId={machineSelection.selectedMachineId ?? undefined}
          onBeforeLocalExecution={persistMachineSelection}
          onConversationReady={onConversationReady}
          initialUserMessage={firstMessage ?? initialUserMessage}
          onInitialUserMessageSent={() => {
            setFirstMessage(undefined);
            onInitialUserMessageSent?.();
          }}
          initialDraft={initialDraft}
          goalPm={goalPm}
          onGoalPmAction={onGoalPmAction}
          onGoalPmRequestSubmitted={onGoalPmRequestSubmitted}
          goalPmConversationLink={goalPmConversationLink}
        />
      </TrackingProvider>
    </>
  );
};
