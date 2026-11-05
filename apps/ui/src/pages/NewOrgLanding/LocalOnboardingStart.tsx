import { useCallback, useMemo, useState } from "react";
import { Alert, Stack } from "@mui/material";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router-dom";
import {
  AgentSessionStatus,
  AgentSessionType,
  type AgentSessionDto,
} from "@hey-hey/ui-common/api";
import {
  AgentSessionMetadata,
  CatalogNotices,
  CatalogUnavailableAlert,
  ModelSelectorMachineSelection,
  RuntimeModelSelector,
  readSurfaceSelection,
  reconcileSurfaceSelection,
  resolveAgentBridgeRecoveryState,
  useAgentSessionInteractionAccessResolver,
  useMachineResolution,
  useRuntimeModelCatalog,
  writeSurfaceSelection,
  type SurfaceSelection,
} from "@hey-hey/ui-common/components";
import { useAgentSessions } from "@hey-hey/ui-common/data";
import { WebPathService } from "@hey-hey/ui-common/services";

import {
  LOCAL_ONBOARDING_SURFACE_ID,
  savedOnboardingRuntime,
} from "../LocalOnboarding/localOnboardingRuntime";
import { LocalOnboardingLaunchButton } from "./LocalOnboardingLaunchButton";
import {
  buildLocalOnboardingBinding,
  type LocalOnboardingTarget,
} from "./useLocalOnboardingLaunch";

const isSameRuntime = (a: SurfaceSelection, b: SurfaceSelection): boolean =>
  a.provider === b.provider &&
  a.model === b.model &&
  a.reasoningEffort === b.reasoningEffort &&
  (a.fastMode ?? false) === (b.fastMode ?? false);

/**
 * The local `/welcome` choice of machine, provider and model, and the start
 * of onboarding with exactly that choice. A choice is fixed once its session
 * is saved; only the machine can still change.
 */
export function LocalOnboardingStart({
  target,
}: {
  target: LocalOnboardingTarget;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { organizationId, projectId, conversationId } = target;

  const sessions = useAgentSessions(organizationId, projectId, {
    conversationId,
    type: AgentSessionType.Coding,
  });
  const [createdSession, setCreatedSession] = useState<AgentSessionDto | null>(
    null,
  );
  const savedSession = sessions.agentSessions[0] ?? createdSession;

  const [selection, setSelection] = useState<SurfaceSelection | null>(() =>
    readSurfaceSelection(LOCAL_ONBOARDING_SURFACE_ID),
  );
  const runtime = useMemo(
    () => (savedSession ? savedOnboardingRuntime(savedSession) : selection),
    [savedSession, selection],
  );

  const machine = useMachineResolution(savedSession?.machineId ?? null);
  const machineId = machine.selectedMachine?.machineId ?? null;
  const catalogSource = useMemo(
    () => (machineId ? { organizationId, projectId, machineId } : null),
    [organizationId, projectId, machineId],
  );
  const catalog = useRuntimeModelCatalog(catalogSource);
  const access =
    useAgentSessionInteractionAccessResolver().getAccess(machineId);

  const reconciled =
    runtime && catalog.status === "ready"
      ? reconcileSurfaceSelection(runtime)
      : null;
  const providerReady =
    !!runtime && !!reconciled && isSameRuntime(runtime, reconciled);
  const readyMachineId =
    providerReady && access.isDeviceEnabled && !sessions.isLoading
      ? machineId
      : null;

  const binding = useMemo(
    () => (runtime ? buildLocalOnboardingBinding(target, runtime) : null),
    [target, runtime],
  );

  const handleSelectionChange = useCallback(
    (patch: Partial<SurfaceSelection>) =>
      setSelection((current) => {
        const provider = patch.provider ?? current?.provider;
        if (!provider) {
          return current;
        }
        const next: SurfaceSelection = {
          provider,
          model: patch.model ?? current?.model ?? "",
          reasoningEffort:
            patch.reasoningEffort !== undefined
              ? patch.reasoningEffort
              : (current?.reasoningEffort ?? null),
          fastMode: patch.fastMode ?? current?.fastMode ?? false,
        };
        writeSurfaceSelection(LOCAL_ONBOARDING_SURFACE_ID, next);
        return next;
      }),
    [],
  );
  const handleStarted = useCallback(() => {
    navigate(WebPathService.onboarding({ projectId, isNew: true }));
  }, [navigate, projectId]);

  if (savedSession && savedSession.status !== AgentSessionStatus.NotStarted) {
    return <Navigate to={WebPathService.onboarding({ projectId })} replace />;
  }

  const machineSelection = {
    machines: machine.machines,
    machineMode: machine.mode,
    selectedMachineId: machineId,
    onSelectMachine: machine.setSelectedMachineId,
    recoveryState: resolveAgentBridgeRecoveryState({
      type: "inventory",
      isLoading: !machine.isReady,
      machines: machine.machines,
      selectedMachineId: machineId,
    }),
  };

  return (
    <Stack spacing={2} data-testid="local-onboarding-start">
      {savedSession ? (
        <>
          <ModelSelectorMachineSelection
            testIdPrefix="onboarding-machine"
            machineSelection={machineSelection}
          />
          {runtime && (
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
          {catalog.status === "error" && (
            <CatalogUnavailableAlert
              testIdPrefix="onboarding-model"
              error={catalog.error}
            />
          )}
          {catalog.status === "ready" && (
            <CatalogNotices testIdPrefix="onboarding-model" />
          )}
          {catalog.status === "ready" && !providerReady && (
            <Alert severity="error">
              {t("onboarding.local.runtimeUnavailable")}
            </Alert>
          )}
        </>
      ) : (
        <RuntimeModelSelector
          disabled={sessions.isLoading}
          provider={selection?.provider ?? null}
          model={selection?.model ?? null}
          reasoningEffort={selection?.reasoningEffort ?? null}
          fastMode={selection?.fastMode ?? false}
          onProviderChange={(provider) => handleSelectionChange({ provider })}
          onModelChange={(model) => handleSelectionChange({ model })}
          onReasoningEffortChange={(reasoningEffort) =>
            handleSelectionChange({ reasoningEffort })
          }
          onFastModeChange={(fastMode) => handleSelectionChange({ fastMode })}
          catalogSource={catalogSource}
          machineSelection={machineSelection}
          testIdPrefix="onboarding-model"
        />
      )}
      {sessions.error && (
        <Alert severity="error">{sessions.error.message}</Alert>
      )}
      {machineId && !access.isDeviceEnabled && (
        <Alert severity="warning">{access.unavailable.message}</Alert>
      )}
      {binding && (
        <LocalOnboardingLaunchButton
          binding={binding}
          machineId={readyMachineId}
          onSessionSaved={setCreatedSession}
          onStarted={handleStarted}
        />
      )}
    </Stack>
  );
}
