import { supportsFastMode } from "../../AgentSession/capabilityCatalog";
import { Alert, Button, Paper, Stack, TextField } from "@mui/material";
import { useCallback, useMemo, useRef, useState } from "react";
import type { CodingPlanVersion } from "../../../api";
import { useServices } from "../../../data/hooks/useServices";
import { RuntimeModelSelector } from "../../AgentSession/RuntimeModelSelector";
import {
  PLAN_APPROVAL_SURFACE_ID,
  type SurfaceSelection,
  writeSurfaceSelection,
} from "../../AgentSession/surfaceSelectionMemory";
import { useSurfaceSelection } from "../../AgentSession/useSurfaceSelection";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import {
  classifyStartupServiceScope,
  StartupServiceScopeSection,
} from "./StartupPlanStructuredField";
import { useCodingPlanConversation } from "./useCodingPlanConversation";
import type { FieldComponentProps } from "./types";
import { isSubmittedCodingPlanApproval } from "./codingPlanApprovalEvidence";

export function CodingPlanApprovalField({
  config,
  context,
  disabled,
  value,
}: FieldComponentProps) {
  const planning = config.payload as CodingPlanVersion;
  const conversation = useCodingPlanConversation(context);
  const submitted =
    isSubmittedCodingPlanApproval(value) &&
    value.versionMessageId === context.messageId
      ? value
      : undefined;
  const [feedback, setFeedback] = useState("");
  const [approvedMessageId, setApproved] = useState<string | null>(null);
  const approved =
    Boolean(submitted) || approvedMessageId === context.messageId;
  const inFlight = useRef(false);
  const services = useServices(context.organizationId, {
    projectId: context.projectId,
  });
  const scope = classifyStartupServiceScope({
    requiredServiceIds: planning.requiredServiceIds,
    projectServices: services.services,
    selectedServiceIds: conversation.agentSession?.serviceIds ?? [],
    servicesReady: services.isFetched && !services.isLoading,
    servicesError: Boolean(services.error),
  });
  const catalogSource = useMemo(
    () =>
      conversation.agentSession?.machineId
        ? {
            organizationId: context.organizationId,
            projectId: context.projectId,
            machineId: conversation.agentSession.machineId,
          }
        : null,
    [
      context.organizationId,
      context.projectId,
      conversation.agentSession?.machineId,
    ],
  );
  const { selection, updateSelection: patchSelection } = useSurfaceSelection({
    surfaceId: PLAN_APPROVAL_SURFACE_ID,
    catalogSource,
    resetKey: null,
    fallbackProvider:
      (conversation.agentSession?.provider as
        SurfaceSelection["provider"] | undefined) ?? null,
  });
  const updateSelection = useCallback(
    (patch: (prev: SurfaceSelection) => SurfaceSelection) => {
      patchSelection((prev) => {
        const next = patch(prev);
        writeSurfaceSelection(PLAN_APPROVAL_SURFACE_ID, next);
        return next;
      });
    },
    [patchSelection],
  );
  const provider = selection?.provider ?? null;
  const model = selection?.model ?? null;
  const reasoningEffort = selection?.reasoningEffort ?? null;
  const fastMode = selection?.fastMode ?? false;
  const locked =
    disabled ||
    approved ||
    conversation.sending ||
    context.codingPlanVersionMessageId !== context.messageId;
  const approve = async () => {
    if (inFlight.current || !context.messageId) return;
    inFlight.current = true;
    try {
      if (
        await conversation.submit({
          approval: {
            responseType: "coding_plan_version_approval_v1",
            versionMessageId: context.messageId,
            feedback,
            ...(provider && model
              ? {
                  runtime: {
                    provider,
                    model,
                    ...(reasoningEffort ? { reasoningEffort } : {}),
                    ...(supportsFastMode(provider, model) ? { fastMode } : {}),
                  },
                }
              : {}),
          },
        })
      )
        setApproved(context.messageId);
    } finally {
      inFlight.current = false;
    }
  };
  return (
    <Stack spacing={1} data-testid="coding-plan-version">
      <Paper
        variant="outlined"
        data-testid="coding-plan-document"
        sx={{
          p: { xs: 2, sm: 3 },
          bgcolor: "background.paper",
          overflowWrap: "anywhere",
          minWidth: 0,
        }}
      >
        <MarkdownRenderer
          mentionConfig={{
            organizationId: context.organizationId,
            projectId: context.projectId,
          }}
        >
          {planning.markdown}
        </MarkdownRenderer>
      </Paper>
      <StartupServiceScopeSection review={scope} />
      {approved || context.codingPlanVersionMessageId === context.messageId ? (
        <>
          <RuntimeModelSelector
            testIdPrefix="coding-plan-approval"
            catalogSource={catalogSource}
            provider={provider}
            model={model}
            reasoningEffort={reasoningEffort}
            fastMode={fastMode}
            disabled={locked}
            onProviderChange={(value) =>
              updateSelection((current) => ({ ...current, provider: value }))
            }
            onModelChange={(value) =>
              updateSelection((current) => ({ ...current, model: value }))
            }
            onReasoningEffortChange={(value) =>
              updateSelection((current) => ({
                ...current,
                reasoningEffort: value,
              }))
            }
            onFastModeChange={(value) =>
              updateSelection((current) => ({ ...current, fastMode: value }))
            }
          />
          <TextField
            label="Feedback to include with approval"
            multiline
            value={submitted?.feedback ?? feedback}
            onChange={(event) => setFeedback(event.target.value)}
            disabled={locked}
          />
          <Button
            data-testid="coding-plan-approve"
            variant="contained"
            disabled={
              locked ||
              scope.status !== "valid" ||
              Boolean(provider) !== Boolean(model)
            }
            onClick={() => void approve()}
          >
            {approved ? "Approved" : "Approve"}
          </Button>
        </>
      ) : (
        <Alert severity="info" data-testid="coding-plan-version-state">
          {context.codingPlanVersionMessageId === null
            ? "Waiting for a complete replacement plan before approval."
            : "This is a previous plan version. Review the current complete plan to approve."}
        </Alert>
      )}
      {conversation.error && (
        <Alert severity="error">{conversation.error}</Alert>
      )}
    </Stack>
  );
}
