import React from "react";
import {
  useSubmitControllerAuthorizedPermissionDecision,
  type BrowserPermissionDecisionRequest,
} from "../../../data/hooks/useSubmitControllerAuthorizedPermissionDecision";
import type { FieldComponentContext } from "./types";

type AccessRequest = Pick<
  BrowserPermissionDecisionRequest,
  "sessionId" | "agentType" | "idempotencyToken"
> & { id: string; reason: string };

type DeliveryState = "idle" | "submitting" | "delivered" | "failed";

/** Posts the user's decision on a card that holds a coding session paused. */
export const useAccessRequestDecision = ({
  context,
  request,
  locked,
  subject,
}: {
  context: FieldComponentContext;
  request: AccessRequest;
  /** True when the card itself can no longer be answered. */
  locked: boolean;
  /** Names the request in failure messages. */
  subject: string;
}) => {
  const { organizationId, projectId, agentSessionId } = context;
  const { submit: submitControllerDecision } =
    useSubmitControllerAuthorizedPermissionDecision(
      organizationId,
      projectId,
      agentSessionId,
    );
  const [deliveryState, setDeliveryState] =
    React.useState<DeliveryState>("idle");
  const [deliveryError, setDeliveryError] = React.useState<string | null>(null);
  const disabledButtons =
    locked || deliveryState === "submitting" || deliveryState === "delivered";

  const submit = async (
    decision: "approve" | "deny",
    extra: Pick<BrowserPermissionDecisionRequest, "servicePlaceChoices"> = {},
  ): Promise<void> => {
    if (disabledButtons) {
      return;
    }

    if (!agentSessionId) {
      setDeliveryError(
        `Missing agent session id — cannot route ${subject} decision.`,
      );
      setDeliveryState("failed");
      return;
    }

    setDeliveryError(null);
    setDeliveryState("submitting");
    try {
      await submitControllerDecision({
        decision,
        requestId: request.id,
        sessionId: request.sessionId,
        agentType: request.agentType,
        reason: request.reason,
        idempotencyToken: request.idempotencyToken,
        ...extra,
      });
      setDeliveryState("delivered");
    } catch (submissionError) {
      console.error(`Failed to route ${subject} decision:`, submissionError);
      setDeliveryError(
        submissionError instanceof Error
          ? submissionError.message
          : `Failed to route ${subject} decision.`,
      );
      setDeliveryState("failed");
    }
  };

  return { submit, disabledButtons, deliveryError };
};
