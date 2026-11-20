import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { SolidAlert } from "../Card/SolidAlert";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { TaskMonitorResponsePresentationContext } from "../../TaskMonitor/TaskMonitorResponsePresentationContext";
import logger from "../../../utils/logger";
import {
  SubmitTaskMonitorCommandResponseDtoStatusEnum,
  TaskMonitorHumanDecisionCommandCauseEnum,
  TaskMonitorHumanDecisionCommandResolutionEnum,
  type MessageResponseDto,
  type SystemMessage,
  type TaskMonitorPermissionAnswerResultSystemMessageData,
  type TaskMonitorHumanDecisionRequestCommand,
  type TaskMonitorInterventionChoice,
  type TaskMonitorInterventionSystemMessageData,
} from "../../../api";
import { useSubmitControllerAuthorizedPermissionDecision } from "../../../data/hooks/useSubmitControllerAuthorizedPermissionDecision";
import { useProjectWorkItemExecutionState } from "../../../data/hooks/useWorkItemExecutionState";
import { useConversation } from "../../../data/hooks/useConversation";
import { useConversationMessages } from "../../../data/hooks/useConversationMessages";
import { useSubmitTaskMonitorCommand } from "../../../data/hooks/useSubmitTaskMonitorCommand";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import { useConversationContext } from "./ConversationContext";

type InterventionCardData = Pick<
  TaskMonitorInterventionSystemMessageData,
  | "interventionId"
  | "providerActionId"
  | "runId"
  | "agentSessionId"
  | "fingerprint"
  | "action"
  | "target"
  | "choices"
  | "response"
  | "expiresAt"
>;

interface TaskMonitorInterventionMessageProps {
  data: InterventionCardData;
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

function isPermissionAnswerReceipt(
  message: MessageResponseDto,
): message is SystemMessage & {
  type: "SYSTEM";
  data: TaskMonitorPermissionAnswerResultSystemMessageData;
} {
  return (
    message.type === "SYSTEM" &&
    message.data.type === "TASK_MONITOR_SUPERVISION" &&
    "outcome" in message.data &&
    message.data.outcome === "PERMISSION_ANSWER_RESULT"
  );
}

function recordedDecision(
  messages: readonly MessageResponseDto[],
  interventionId: string,
) {
  let decided = false;
  for (const message of messages) {
    if (!isPermissionAnswerReceipt(message)) {
      continue;
    }
    const receipt = message.data;
    if (receipt.interventionId !== interventionId) {
      continue;
    }
    if (receipt.result === "APPLIED") {
      return receipt.answer === "deny" ? "Denied" : "Approved";
    }
    if (receipt.result === "ALREADY_DECIDED") {
      decided = true;
    }
  }
  return decided ? "Already decided" : null;
}

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
  data: InterventionCardData,
  resolution: TaskMonitorInterventionChoice,
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
  data: InterventionCardData,
  resolution: TaskMonitorInterventionChoice,
): DecisionRequest => ({
  requestId: crypto.randomUUID(),
  command: buildDecisionCommand(data, resolution),
});

export const TaskMonitorInterventionMessage = ({
  data,
}: TaskMonitorInterventionMessageProps) => {
  const { activeConversation, project, taskMonitorId } =
    useConversationContext();
  const messagesQuery = useConversationMessages(
    project.organizationId,
    project.id,
    activeConversation.id,
    { refetchOnMount: false },
  );
  const decision = useMemo(
    () => recordedDecision(messagesQuery.orderedData, data.interventionId),
    [messagesQuery.orderedData, data.interventionId],
  );
  if (decision) {
    return (
      <Stack
        spacing={1}
        data-testid="task-monitor-intervention-message"
        data-intervention-id={data.interventionId}
      >
        <Chip label={decision} size="small" sx={{ alignSelf: "flex-start" }} />
        <Typography>
          {data.action} · {data.target}
        </Typography>
      </Stack>
    );
  }

  if (!taskMonitorId) {
    return (
      <SolidAlert severity="warning">
        The owning Task Monitor could not be resolved for this request.{" "}
        {data.action} · {data.target}
      </SolidAlert>
    );
  }

  return (
    <OwnedIntervention
      data={data}
      taskMonitorId={taskMonitorId}
      refetchMessages={messagesQuery.refetch}
    />
  );
};

const OwnedIntervention = ({
  data,
  taskMonitorId,
  refetchMessages,
}: TaskMonitorInterventionMessageProps & {
  taskMonitorId: string;
  refetchMessages: ReturnType<typeof useConversationMessages>["refetch"];
}) => {
  const { activeConversation, project, isReadOnly } = useConversationContext();
  const state = useProjectWorkItemExecutionState(
    project.organizationId,
    project.id,
    taskMonitorId,
  );
  const live =
    state.status === "retained" &&
    state.freshness.status === "CURRENT" &&
    state.delivery === "LIVE";
  const projection = live ? state.state.projection : null;
  const outstanding = projection?.outstandingPermissions?.find(
    (request) => request.interventionId === data.interventionId,
  );
  const judgment = outstanding ?? projection?.pendingJudgment;
  const actionable =
    outstanding?.answerable !== false &&
    judgment?.interventionId === data.interventionId &&
    judgment.agentSessionId === data.agentSessionId &&
    judgment.runId === data.runId &&
    judgment.providerActionId === data.providerActionId &&
    judgment.fingerprint === data.fingerprint;
  const status = actionable
    ? "Action required"
    : outstanding
      ? outstanding.owner === "HUMAN"
        ? "Awaiting your decision · temporarily unavailable"
        : outstanding.owner === "MONITOR"
          ? "Awaiting the Task Monitor"
          : "Current request ownership is unavailable"
      : projection?.outstandingPermissions
        ? "No longer pending"
        : "Current request ownership is unavailable";
  const permissionDecision = useSubmitControllerAuthorizedPermissionDecision(
    project.organizationId,
    project.id,
    data.agentSessionId,
  );
  const submitMonitorCommand = useSubmitTaskMonitorCommand();
  const onAnswered = useContext(TaskMonitorResponsePresentationContext);
  const conversationQuery = useConversation(
    project.organizationId,
    project.id,
    { conversationId: activeConversation.id },
    {
      enablePolling: false,
      refetchOnMount: false,
    },
  );
  const [pendingRequest, setPendingRequest] = useState<DecisionRequest | null>(
    null,
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
    !actionable ||
    permissionDecision.isPending ||
    submitMonitorCommand.isPending ||
    isRefreshing;

  const submitDecision = async (resolution: TaskMonitorInterventionChoice) => {
    if (controlsUnavailable) {
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
      if (outstanding && permissionDecision.provider) {
        await permissionDecision.submit({
          sessionId: outstanding.providerSessionId,
          requestId: outstanding.providerActionId,
          agentType: permissionDecision.provider,
          decision: resolution === "APPROVE" ? "approve" : "deny",
          reason: null,
          idempotencyToken: request.requestId,
          replyConversationId: activeConversation.id,
        });
      } else {
        outcome = await submitMonitorCommand.mutate({
          organizationId: project.organizationId,
          projectId: project.id,
          monitorId: taskMonitorId,
          request,
        });
      }
    } catch (error) {
      logger.warn("data_hooks", "Task Monitor intervention submission failed", {
        code: "TASK_MONITOR_INTERVENTION_SUBMISSION_FAILED",
        interventionId: data.interventionId,
        cause: error instanceof Error ? error.message : String(error),
      });
      if (activeInterventionIdRef.current === data.interventionId) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "The decision could not be delivered.",
        );
      }
      return;
    }

    setIsRefreshing(true);
    try {
      await Promise.all([conversationQuery.refetch(), refetchMessages()]);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      logger.warn("data_hooks", "Task Monitor intervention refresh failed", {
        code: "TASK_MONITOR_INTERVENTION_REFRESH_FAILED",
        interventionId: data.interventionId,
        cause,
      });
      if (activeInterventionIdRef.current === data.interventionId) {
        setErrorMessage(
          `The decision was acknowledged, but the canonical conversation could not be refreshed. ${cause}`,
        );
      }
      return;
    } finally {
      setIsRefreshing(false);
    }

    if (
      activeInterventionIdRef.current === data.interventionId &&
      outcome?.status === SubmitTaskMonitorCommandResponseDtoStatusEnum.Rejected
    ) {
      logger.warn("data_hooks", "Task Monitor intervention decision rejected", {
        code: outcome.reason ?? "TASK_MONITOR_DECISION_REJECTED",
        stage: outcome.stage,
        interventionId: data.interventionId,
        cause: outcome.message,
      });
      setErrorMessage(
        outcome.message ?? "The Task Monitor rejected the decision.",
      );
      return;
    }
    if (activeInterventionIdRef.current === data.interventionId) {
      onAnswered?.(taskMonitorId);
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
          label={status}
          size="small"
          sx={{ alignSelf: "flex-start" }}
        />
        {actionable && (
          <Typography component="div">
            <MarkdownRenderer allowMentionEscapes>
              {data.response}
            </MarkdownRenderer>
          </Typography>
        )}
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
        {data.expiresAt !== null && (
          <Typography color="text.secondary" variant="caption">
            Expires {new Date(data.expiresAt).toLocaleString()}
          </Typography>
        )}
        {actionable && errorMessage ? (
          <SolidAlert
            severity="error"
            data-testid="task-monitor-intervention-error"
          >
            {errorMessage}
          </SolidAlert>
        ) : null}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {actionable &&
            choices.map((choice) => {
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
