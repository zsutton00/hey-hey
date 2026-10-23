import { Alert, Box, Button, Chip, Stack, Typography } from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  SubmitTaskMonitorCommandResponseDtoStatusEnum,
  TaskMonitorHumanDecisionCommandCauseEnum,
  TaskMonitorHumanDecisionCommandResolutionEnum,
  type TaskMonitorHumanDecisionRequestCommand,
  type TaskMonitorInterventionChoice,
  type TaskMonitorInterventionSystemMessageData,
} from "../../../api";
import { useConversation } from "../../../data/hooks/useConversation";
import { useConversationMessages } from "../../../data/hooks/useConversationMessages";
import { useSubmitTaskMonitorCommand } from "../../../data/hooks/useSubmitTaskMonitorCommand";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import { useConversationContext } from "./ConversationContext";

interface TaskMonitorInterventionMessageProps {
  data: TaskMonitorInterventionSystemMessageData;
}

interface DecisionRequestCache {
  interventionId: string;
  requests: Partial<Record<TaskMonitorInterventionChoice, DecisionRequest>>;
}

interface DecisionRequest {
  requestId: string;
  command: TaskMonitorHumanDecisionRequestCommand;
}

const assertNever = (value: never): never => {
  throw new Error(`Unsupported Task Monitor intervention choice: ${value}`);
};

const getChoicePresentation = (choice: TaskMonitorInterventionChoice) => {
  switch (choice) {
    case TaskMonitorHumanDecisionCommandResolutionEnum.Approve:
      return { label: "Approve", color: "primary" as const };
    case TaskMonitorHumanDecisionCommandResolutionEnum.Deny:
      return { label: "Deny", color: "error" as const };
    default:
      return assertNever(choice);
  }
};

const buildDecisionCommand = (
  data: TaskMonitorInterventionSystemMessageData,
  resolution: TaskMonitorInterventionChoice
): TaskMonitorHumanDecisionRequestCommand => ({
  cause: TaskMonitorHumanDecisionCommandCauseEnum.HumanDecision,
  interventionId: data.interventionId,
  providerActionId: data.providerActionId,
  runId: data.runId,
  agentSessionId: data.agentSessionId,
  fingerprint: data.fingerprint,
  resolution,
});

const createDecisionRequest = (
  data: TaskMonitorInterventionSystemMessageData,
  resolution: TaskMonitorInterventionChoice
): DecisionRequest => ({
  requestId: crypto.randomUUID(),
  command: buildDecisionCommand(data, resolution),
});

export const TaskMonitorInterventionMessage = ({
  data,
}: TaskMonitorInterventionMessageProps) => {
  const { activeConversation, project, taskMonitorId, isReadOnly } =
    useConversationContext();
  const submitMonitorCommand = useSubmitTaskMonitorCommand();
  const messagesQuery = useConversationMessages(
    project.organizationId,
    project.id,
    activeConversation.id,
    { refetchOnMount: false }
  );
  const conversationQuery = useConversation(
    project.organizationId,
    project.id,
    { conversationId: activeConversation.id },
    {
      enablePolling: false,
      refetchOnMount: false,
    }
  );
  const [pendingRequest, setPendingRequest] = useState<DecisionRequest | null>(
    null
  );
  const decisionRequestCacheRef = useRef<DecisionRequestCache | null>(null);
  const activeInterventionIdRef = useRef(data.interventionId);
  activeInterventionIdRef.current = data.interventionId;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    decisionRequestCacheRef.current = null;
    setPendingRequest(null);
    setErrorMessage(null);
  }, [data.interventionId]);

  const choices = useMemo(() => Array.from(data.choices), [data.choices]);
  const controlsUnavailable =
    isReadOnly ||
    !taskMonitorId ||
    submitMonitorCommand.isPending ||
    isRefreshing;

  const submitDecision = async (resolution: TaskMonitorInterventionChoice) => {
    if (!taskMonitorId) {
      return;
    }

    const retainedCache = decisionRequestCacheRef.current;
    const cache =
      retainedCache?.interventionId === data.interventionId
        ? retainedCache
        : { interventionId: data.interventionId, requests: {} };
    const request =
      cache.requests[resolution] ?? createDecisionRequest(data, resolution);
    cache.requests[resolution] = request;
    decisionRequestCacheRef.current = cache;
    setPendingRequest(request);
    setErrorMessage(null);

    let outcome;
    try {
      outcome = await submitMonitorCommand.mutate({
        organizationId: project.organizationId,
        projectId: project.id,
        monitorId: taskMonitorId,
        request,
      });
    } catch (error) {
      if (activeInterventionIdRef.current === data.interventionId) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "The decision could not be delivered."
        );
      }
      return;
    }

    setIsRefreshing(true);
    try {
      await Promise.all([conversationQuery.refetch(), messagesQuery.refetch()]);
    } catch {
      if (activeInterventionIdRef.current === data.interventionId) {
        setErrorMessage(
          "The decision was acknowledged, but the canonical conversation could not be refreshed."
        );
      }
      return;
    } finally {
      setIsRefreshing(false);
    }

    if (
      activeInterventionIdRef.current === data.interventionId &&
      outcome.status === SubmitTaskMonitorCommandResponseDtoStatusEnum.Rejected
    ) {
      setErrorMessage(
        outcome.message ?? "The Task Monitor rejected the decision."
      );
    }
  };

  return (
    <Box
      data-testid="task-monitor-intervention-message"
      data-intervention-id={data.interventionId}
      sx={(theme) => ({
        border: 1,
        borderColor: "warning.main",
        borderRadius: 1,
        p: theme.spacing(2),
      })}
    >
      <Stack spacing={1.5}>
        <Chip
          color="warning"
          data-testid="task-monitor-intervention-status"
          label="Action required"
          size="small"
          sx={{ alignSelf: "flex-start" }}
        />
        <Typography component="div">
          <MarkdownRenderer allowMentionEscapes>
            {data.response}
          </MarkdownRenderer>
        </Typography>
        <Stack spacing={0.5} data-testid="task-monitor-intervention-action">
          <Typography color="text.secondary" variant="caption">
            Exact action
          </Typography>
          <Typography component="div">
            <MarkdownRenderer allowMentionEscapes>
              {data.action}
            </MarkdownRenderer>
          </Typography>
        </Stack>
        <Stack spacing={0.5} data-testid="task-monitor-intervention-target">
          <Typography color="text.secondary" variant="caption">
            Target
          </Typography>
          <Typography component="div">
            <MarkdownRenderer allowMentionEscapes>
              {data.target}
            </MarkdownRenderer>
          </Typography>
        </Stack>
        <Typography color="text.secondary" variant="caption">
          Expires {new Date(data.expiresAt).toLocaleString()}
        </Typography>
        {errorMessage ? (
          <Alert severity="error" data-testid="task-monitor-intervention-error">
            {errorMessage}
          </Alert>
        ) : null}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {choices.map((choice) => {
            const presentation = getChoicePresentation(choice);
            const isRetry = pendingRequest?.command.resolution === choice;
            return (
              <Button
                key={choice}
                color={presentation.color}
                variant={
                  choice ===
                  TaskMonitorHumanDecisionCommandResolutionEnum.Approve
                    ? "contained"
                    : "outlined"
                }
                disabled={controlsUnavailable}
                onClick={() => void submitDecision(choice)}
                data-testid={
                  choice ===
                  TaskMonitorHumanDecisionCommandResolutionEnum.Approve
                    ? "task-monitor-intervention-approve"
                    : "task-monitor-intervention-deny"
                }
              >
                {isRetry
                  ? `Retry ${presentation.label.toLowerCase()}`
                  : presentation.label}
              </Button>
            );
          })}
        </Stack>
      </Stack>
    </Box>
  );
};
