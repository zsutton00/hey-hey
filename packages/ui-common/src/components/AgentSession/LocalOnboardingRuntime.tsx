import { useTranslation } from "react-i18next";
import { AgentSessionMetadata } from "./AgentSessionMetadata";
import { buildDirectTriggerInput } from "./runtime/hooks/directTriggerInput";
import { Alert, Button, Stack } from "@mui/material";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AgentSessionType,
  AgentSessionConfigV2TypeEnum,
  AgentSessionConfigV2VersionEnum,
  ConversationStartRunRequestDtoReasoningEffortEnum,
  MessageType,
  type AgentSessionConfigV2,
  type AgentSessionDto,
  type RunCreatePayloadLocalOnboarding,
} from "../../api";
import { useAgentSessions } from "../../data/hooks/useAgentSessions";
import { useCreateAgentSession } from "../../data/hooks/useCreateAgentSession";
import {
  CatalogNotices,
  CatalogUnavailableAlert,
  RuntimeModelSelector,
} from "./RuntimeModelSelector";
import { useRuntimeModelCatalog } from "./useRuntimeModelCatalog";
import { useMachineResolution } from "./runtime/coding/useMachineResolution";
import { resolveAgentBridgeRecoveryState } from "./agentBridgeRecoveryState";
import { useAgentSessionInteractionAccessResolver } from "./operations/useAgentSessionInteractionAccess";
import {
  readSurfaceSelection,
  writeSurfaceSelection,
  reconcileSurfaceSelection,
  type SurfaceSelection,
} from "./surfaceSelectionMemory";

function isEffort(
  value: string,
): value is ConversationStartRunRequestDtoReasoningEffortEnum {
  return Object.values(ConversationStartRunRequestDtoReasoningEffortEnum).some(
    (effort) => effort === value,
  );
}

export function LocalOnboardingRuntime({
  organizationId,
  projectId,
  conversationId,
  workflowId,
  onLaunchReady,
  children,
}: {
  children: ReactNode;
  organizationId: string;
  projectId: string;
  conversationId: string;
  workflowId: string;
  onLaunchReady: (launch: (() => Promise<boolean>) | null) => void;
}) {
  const { t } = useTranslation();
  const sessions = useAgentSessions(organizationId, projectId, {
    conversationId,
  });
  const [createdSession, setCreatedSession] = useState<AgentSessionDto | null>(
    null,
  );
  const existing =
    sessions.agentSessions.find(
      (session) => session.id === createdSession?.id,
    ) ??
    createdSession ??
    sessions.agentSessions[0];
  const machine = useMachineResolution(existing?.machineId ?? null);
  const accessResolver = useAgentSessionInteractionAccessResolver();
  const createSession = useCreateAgentSession();
  const [selection, setSelection] = useState<SurfaceSelection | null>(() =>
    readSurfaceSelection("onboarding"),
  );
  const launched = useRef(false);
  const pendingLaunch = useRef<Promise<boolean> | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const source = useMemo(
    () =>
      existing?.machineId || machine.selectedMachine
        ? {
            organizationId,
            projectId,
            machineId:
              existing?.machineId ?? machine.selectedMachine!.machineId,
          }
        : null,
    [organizationId, projectId, machine.selectedMachine, existing?.machineId],
  );
  const catalog = useRuntimeModelCatalog(source);
  const persisted = existing?.config;
  const runtime: SurfaceSelection | null =
    existing &&
    persisted?.type === "CODING_SESSION" &&
    persisted.version === "v2" &&
    existing.provider
      ? {
          provider: existing.provider,
          model: persisted.model,
          reasoningEffort:
            persisted.effort && isEffort(persisted.effort)
              ? persisted.effort
              : null,
          fastMode: persisted.fastMode,
        }
      : selection;
  const reconciled =
    runtime && catalog.status === "ready"
      ? reconcileSurfaceSelection(runtime)
      : null;
  const providerReady =
    !!runtime &&
    !!reconciled &&
    runtime.provider === reconciled.provider &&
    runtime.model === reconciled.model &&
    runtime.reasoningEffort === reconciled.reasoningEffort &&
    (runtime.fastMode ?? false) === (reconciled.fastMode ?? false);
  const machineId = existing?.machineId ?? machine.selectedMachine?.machineId;
  const access = accessResolver.getAccess(machineId);
  const change = useCallback(
    (patch: Partial<SurfaceSelection>) =>
      setSelection((current) => {
        const next = {
          provider: patch.provider ?? current?.provider ?? null,
          model: patch.model ?? current?.model ?? "",
          reasoningEffort:
            patch.reasoningEffort !== undefined
              ? patch.reasoningEffort
              : (current?.reasoningEffort ?? null),
          fastMode: patch.fastMode ?? current?.fastMode ?? false,
        };
        if (!next.provider) {
          return current;
        }
        const value: SurfaceSelection = { ...next, provider: next.provider };
        writeSurfaceSelection("onboarding", value);
        return value;
      }),
    [],
  );
  const handleLaunch = async (): Promise<boolean> => {
    if (
      !providerReady ||
      !runtime ||
      !access.isDeviceEnabled ||
      !machineId ||
      launching
    ) {
      return false;
    }
    setLaunching(true);
    setError(null);
    try {
      const config = {
        type: AgentSessionConfigV2TypeEnum.CodingSession,
        version: AgentSessionConfigV2VersionEnum.V2,
        model: runtime.model,
        ...(runtime.reasoningEffort ? { effort: runtime.reasoningEffort } : {}),
        ...(runtime.fastMode !== undefined
          ? { fastMode: runtime.fastMode }
          : {}),
      } satisfies AgentSessionConfigV2;
      const session =
        existing ??
        (await createSession.mutate({
          organizationId,
          agentSession: {
            projectId,
            sessionDate: new Date().toISOString(),
            type: AgentSessionType.Coding,
            provider: runtime.provider,
            config,
            existingWorkflowBinding: { conversationId, workflowId },
          },
        }));
      setCreatedSession(session);
      const payload = {
        promptType: "local_onboarding",
        userMessage: "",
        conversationId,
      } satisfies RunCreatePayloadLocalOnboarding;
      const result =
        existing && existing.status !== "NOT_STARTED"
          ? await access.interactions.submitMessage(
              buildDirectTriggerInput({
                organizationId,
                projectId,
                agentSessionId: existing.id,
                conversationId,
                data: {
                  agentInput: {
                    promptType: "local_onboarding",
                    conversationId,
                    userMessage: "",
                  },
                },
              }),
            )
          : await access.interactions.startSession({
              organizationId,
              projectId,
              conversationId,
              agentSessionId: session.id,
              intent: {
                handlerPromptType: "local_onboarding",
                payload,
                provider: runtime.provider,
                model: runtime.model,
                ...(runtime.reasoningEffort
                  ? { reasoningEffort: runtime.reasoningEffort }
                  : {}),
                fastMode: runtime.fastMode,
                config,
                initialMessage: { role: MessageType.User },
                contextMetadata: {
                  capturedAt: new Date().toISOString(),
                  organizationId,
                  projectId,
                  agentSessionId: session.id,
                  userComments: [],
                  fileReferences: { resolved: [], unresolved: [] },
                },
              },
            });
      if (result.state !== "succeeded" && result.state !== "accepted") {
        throw new Error(
          result.state === "cancelled"
            ? t("onboarding.local.cancelled")
            : result.message,
        );
      }
      launched.current = true;
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : t("onboarding.local.failed"),
      );
      return false;
    } finally {
      setLaunching(false);
    }
  };
  useEffect(() => {
    onLaunchReady(() => {
      if (launched.current || existing?.status === "IN_PROGRESS") {
        return Promise.resolve(true);
      }
      if (pendingLaunch.current) {
        return pendingLaunch.current;
      }
      const launch = handleLaunch();
      pendingLaunch.current = launch;
      void launch.finally(() => {
        pendingLaunch.current = null;
      });
      return launch;
    });
    return () => onLaunchReady(null);
  });
  return (
    <Stack spacing={2} data-testid="local-onboarding-runtime">
      {!existing && (
        <RuntimeModelSelector
          disabled={launching || launched.current || sessions.isLoading}
          provider={selection?.provider ?? null}
          model={selection?.model ?? null}
          reasoningEffort={selection?.reasoningEffort ?? null}
          fastMode={selection?.fastMode ?? false}
          onProviderChange={(provider) => change({ provider })}
          onModelChange={(model) => change({ model })}
          onReasoningEffortChange={(reasoningEffort) =>
            change({ reasoningEffort })
          }
          onFastModeChange={(fastMode) => change({ fastMode })}
          catalogSource={source}
          machineSelection={{
            machines: machine.machines,
            machineMode: machine.mode,
            selectedMachineId: machine.selectedMachine?.machineId ?? null,
            onSelectMachine: machine.setSelectedMachineId,
            recoveryState: resolveAgentBridgeRecoveryState({
              type: "inventory",
              isLoading: !machine.isReady,
              machines: machine.machines,
              selectedMachineId: machine.selectedMachine?.machineId ?? null,
            }),
          }}
          testIdPrefix="onboarding-model"
        />
      )}
      {existing && !access.isDeviceEnabled && (
        <Alert severity="warning">{access.unavailable.message}</Alert>
      )}
      {existing && catalog.status === "error" && (
        <CatalogUnavailableAlert
          testIdPrefix="onboarding-model"
          error={catalog.error}
        />
      )}
      {existing && catalog.status === "ready" && (
        <CatalogNotices testIdPrefix="onboarding-model" />
      )}
      {existing && catalog.status === "ready" && !providerReady && (
        <Alert severity="error">
          {t("onboarding.local.runtimeUnavailable")}
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      <Button
        data-testid="local-onboarding-launch"
        disabled={
          launching ||
          sessions.isLoading ||
          !providerReady ||
          !access.isDeviceEnabled
        }
        onClick={handleLaunch}
      >
        {t(existing ? "onboarding.local.resume" : "onboarding.local.start")}
      </Button>
      {children}
      {existing && runtime && (
        <AgentSessionMetadata
          placement="below-conversation"
          provider={runtime.provider}
          model={runtime.model}
          {...(runtime.reasoningEffort
            ? { effort: runtime.reasoningEffort }
            : {})}
          {...(runtime.fastMode !== undefined
            ? { fastMode: runtime.fastMode }
            : {})}
        />
      )}
    </Stack>
  );
}
