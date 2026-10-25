import { useAtom } from "jotai";
import { codingPlanRuntimeChoice } from "./codingPlanRuntimeChoice";
import { supportsFastMode } from "../../AgentSession/capabilityCatalog";
import { Alert, Button, Paper, Stack, TextField } from "@mui/material";
import { useMemo, useRef, useState } from "react";
import type { CodingPlanVersion } from "../../../api";
import { useServices } from "../../../data/hooks/useServices";
import { RuntimeModelSelector } from "../../AgentSession/RuntimeModelSelector";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import {
  classifyStartupServiceScope,
  StartupServiceScopeSection,
} from "./StartupPlanStructuredField";
import { useCodingPlanConversation } from "./useCodingPlanConversation";
import type { FieldComponentProps } from "./types";

export function CodingPlanApprovalField({
  config,
  context,
  disabled,
}: FieldComponentProps) {
  const planning = config.payload as CodingPlanVersion;
  const conversation = useCodingPlanConversation(context);
  const [feedback, setFeedback] = useState("");
  const [runtimeChoice, setRuntimeChoice] = useAtom(
    codingPlanRuntimeChoice(context.conversationId),
  );
  const { provider, model, reasoningEffort, fastMode } = runtimeChoice;
  const [approved, setApproved] = useState(false);
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
        setApproved(true);
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
      {context.codingPlanVersionMessageId === context.messageId ? (
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
              setRuntimeChoice((current) => ({ ...current, provider: value }))
            }
            onModelChange={(value) =>
              setRuntimeChoice((current) => ({ ...current, model: value }))
            }
            onReasoningEffortChange={(value) =>
              setRuntimeChoice((current) => ({
                ...current,
                reasoningEffort: value,
              }))
            }
            onFastModeChange={(value) =>
              setRuntimeChoice((current) => ({ ...current, fastMode: value }))
            }
          />
          <TextField
            label="Feedback to include with approval"
            multiline
            value={feedback}
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
