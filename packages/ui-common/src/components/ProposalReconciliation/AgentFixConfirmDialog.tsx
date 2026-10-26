import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Alert, Box, Button, Paper, Stack, Typography } from "@mui/material";
import type { ProposalResponseDto, ProposalAgentFixRequest } from "../../api";
import { AgentConversationView } from "../AgentSession/AgentConversationView";
import { useUserIdentity } from "../../hooks";
import { resolveAgentBridgeRecoveryState } from "../AgentSession/agentBridgeRecoveryState";
import { RuntimeModelSelector } from "../AgentSession/RuntimeModelSelector";
import { useMachineResolution } from "../AgentSession/runtime/coding/useMachineResolution";
import {
  PROPOSAL_AGENT_FIX_SURFACE_ID,
  writeSurfaceSelection,
} from "../AgentSession/surfaceSelectionMemory";
import { useSurfaceSelection } from "../AgentSession/useSurfaceSelection";
import { ProjectReportMachineSection } from "../ProjectReports/ProjectReportLaunchStatus";
import { useProposalAgentFixLaunch } from "./useProposalAgentFixLaunch";

/**
 * Agent fix starts with the saved machine/model selection and keeps its
 * conversation alongside the proposal. Missing configuration can be selected here. A failed
 * launch stays here with its error and a Retry. Confirming never applies
 * anything. Mounted only while open, so proposal cards look up no machines.
 */
export function AgentFixConfirmDialog({
  proposal,
  onClose,
}: {
  proposal: ProposalResponseDto;
  onClose: () => void;
}) {
  const projectId = proposal.projectId;
  const [session, setSession] = useState<ProposalAgentFixRequest | null>(null);
  const { launch, isPending, error } = useProposalAgentFixLaunch();
  const organizationId = useUserIdentity()?.currentOrgId ?? "";
  const { machines, isReady, mode, selectedMachine, setSelectedMachineId } =
    useMachineResolution(null);
  const machineId = selectedMachine?.machineId ?? null;
  const recoveryState = useMemo(
    () =>
      resolveAgentBridgeRecoveryState({
        type: "inventory",
        isLoading: !isReady,
        machines,
        selectedMachineId: machineId,
      }),
    [isReady, machines, machineId],
  );
  const catalogSource = useMemo(
    () => (machineId ? { organizationId, projectId, machineId } : null),
    [machineId, organizationId, projectId],
  );
  const { selection, updateSelection } = useSurfaceSelection({
    surfaceId: PROPOSAL_AGENT_FIX_SURFACE_ID,
    catalogSource,
    resetKey: null,
  });
  const edit = (patch: Partial<NonNullable<typeof selection>>) =>
    updateSelection((current) => ({ ...current, ...patch }));
  const canStart = !isPending && !!machineId && !!selection?.reasoningEffort;
  const autoStarted = useRef(false);
  const handleConfirm = useCallback(async () => {
    if (!machineId || !selection?.reasoningEffort) return;
    writeSurfaceSelection(PROPOSAL_AGENT_FIX_SURFACE_ID, selection);
    const request = await launch(proposal, {
      machineId,
      provider: selection.provider,
      model: selection.model,
      reasoningEffort: selection.reasoningEffort,
      fastMode: selection.fastMode,
    });
    if (!request) return;
    setSession(request);
  }, [machineId, selection, launch, proposal]);
  useEffect(() => {
    if (!autoStarted.current && canStart && isReady) {
      autoStarted.current = true;
      void handleConfirm();
    }
  }, [canStart, isReady, handleConfirm]);
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, minWidth: 0 }}
      data-testid="proposal-agent-fix-confirm"
    >
      <Typography variant="h6">Agent help</Typography>
      {session ? (
        <Box sx={{ height: 600 }} data-testid="proposal-agent-fix-conversation">
          <AgentConversationView
            organizationId={session.organizationId}
            projectId={session.projectId}
            agentSessionId={session.agentSessionId}
            conversationId={session.conversationId}
            scrollable
          />
        </Box>
      ) : (
        <>
          <Stack spacing={2}>
            <Typography variant="body2">
              Agent fix starts an agent session on your machine. The agent
              prepares a reconciled result, asks you about real conflicts, and
              never applies it on its own. You review the result before anything
              changes.
            </Typography>
            <RuntimeModelSelector
              testIdPrefix="proposal-agent-fix"
              catalogSource={catalogSource}
              provider={selection?.provider ?? null}
              model={selection?.model ?? null}
              reasoningEffort={selection?.reasoningEffort ?? null}
              fastMode={selection?.fastMode ?? false}
              disabled={isPending}
              onProviderChange={(provider) => edit({ provider })}
              onModelChange={(model) => edit({ model })}
              onReasoningEffortChange={(reasoningEffort) =>
                edit({ reasoningEffort })
              }
              onFastModeChange={(fastMode) => edit({ fastMode })}
            />
            <Box>
              <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>
                Runs on
              </Typography>
              <ProjectReportMachineSection
                isReady={isReady}
                mode={mode}
                machines={machines}
                selectedMachine={selectedMachine}
                recoveryState={recoveryState}
                disabled={isPending}
                onSelectMachine={setSelectedMachineId}
              />
            </Box>
            {error ? (
              <Alert severity="error" data-testid="proposal-agent-fix-error">
                {error}
              </Alert>
            ) : null}
          </Stack>
        </>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        <Button onClick={onClose} disabled={isPending}>
          {session ? "Close agent help" : "Cancel"}
        </Button>
        {!session && (
          <Button
            variant="contained"
            data-testid="proposal-agent-fix-start"
            disabled={!canStart}
            onClick={() => void handleConfirm()}
          >
            {error ? "Retry" : "Start agent session"}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
