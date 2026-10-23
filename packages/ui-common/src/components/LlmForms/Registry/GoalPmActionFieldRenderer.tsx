import { Alert } from "@mui/material";
import { useRef, useState } from "react";
import type {
  GoalPmRoutingCreation,
  GoalPmRoutingPayload,
  GoalPmRoutingOption,
  UIElementPayload,
} from "../../../api";
import { useConversationContext } from "../../Conversation/Components/ConversationContext";
import { goalPmAnswer } from "./goalPmAnswer";
import { GoalPmActionField } from "./GoalPmActionField";
import type { FieldComponentProps } from "./types";

const isGoalPmRoutingPayload = (
  payload: UIElementPayload | undefined,
): payload is GoalPmRoutingPayload => {
  if (typeof payload !== "object" || payload === null) return false;
  return (
    "goalId" in payload &&
    typeof payload.goalId === "string" &&
    "options" in payload &&
    Array.isArray(payload.options)
  );
};

export function GoalPmActionFieldRenderer({
  config,
  context,
  disabled,
  isSubmitted,
  value,
  onChange,
}: FieldComponentProps) {
  const {
    activeConversation,
    onGoalPmAction,
    goalPmConversationLink,
    suggestionDecisions,
    isReadOnly,
    isCliInputDisabled,
  } = useConversationContext();
  const executing = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payload = config.payload;
  if (!isGoalPmRoutingPayload(payload))
    return <Alert severity="error">Routing choices are unavailable.</Alert>;
  if (!context.messageId)
    return (
      <Alert severity="error">Routing choice recording is unavailable.</Alert>
    );

  const answer = goalPmAnswer(value);
  const enact = async (
    option: GoalPmRoutingOption,
    creation?: GoalPmRoutingCreation,
  ) => {
    if (
      executing.current ||
      isReadOnly ||
      isCliInputDisabled ||
      !onGoalPmAction ||
      answer?.state === "COMPLETED"
    )
      return;
    executing.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await onGoalPmAction(
        {
          sourceMessageId: context.messageId!,
          uiElementId: config.field,
          selectedOptionId: option.optionId,
        },
        activeConversation.id,
        creation,
      );
      onChange?.(result.answer);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to apply this choice. Retry to recover the same result.",
      );
    } finally {
      executing.current = false;
      setPending(false);
    }
  };

  return (
    <GoalPmActionField
      key={`${context.conversationId}:${context.messageId}:${config.field}`}
      organizationId={context.organizationId}
      projectId={context.projectId}
      payload={payload}
      answer={answer}
      legacy={
        !!suggestionDecisions.getRoutingDecision(
          context.messageId,
          config.field,
        )
      }
      onSelect={(option, creation) => void enact(option, creation)}
      disabled={disabled || isSubmitted || !onGoalPmAction}
      pending={pending}
      canRetry={!isReadOnly && !isCliInputDisabled && !!onGoalPmAction}
      error={error}
      conversationHref={goalPmConversationLink?.href}
      onOpenConversation={goalPmConversationLink?.onOpen}
    />
  );
}
