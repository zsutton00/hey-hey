import { Alert, Button, Stack, Typography } from "@mui/material";
import React from "react";
import type { AgentRequestReviewFileScopePayload } from "../../../api";
import { useServices } from "../../../data/hooks/useServices";
import { useSubmitControllerAuthorizedPermissionDecision } from "../../../data/hooks/useSubmitControllerAuthorizedPermissionDecision";
import type { FieldComponentProps, FieldConfig } from "./types";

type ReviewFileScopeFieldConfig = Omit<FieldConfig, "payload"> & {
  payload: AgentRequestReviewFileScopePayload;
};

export interface AgentReviewFileScopeRequestFieldProps
  extends Omit<
    FieldComponentProps<AgentRequestReviewFileScopePayload>,
    "config"
  > {
  config: ReviewFileScopeFieldConfig;
}

type DeliveryState = "idle" | "submitting" | "delivered" | "failed";

export const AgentReviewFileScopeRequestField: React.FC<
  AgentReviewFileScopeRequestFieldProps
> = ({ config, context, disabled = false, isSubmitted = false }) => {
  const { organizationId, projectId, agentSessionId } = context;
  const { submit: submitControllerDecision } =
    useSubmitControllerAuthorizedPermissionDecision(
      organizationId,
      projectId,
      agentSessionId
    );
  const { services, isLoading, error } = useServices(organizationId, {
    projectId,
    status: "ACTIVE",
  });
  const [deliveryState, setDeliveryState] =
    React.useState<DeliveryState>("idle");
  const [deliveryError, setDeliveryError] = React.useState<string | null>(null);
  const payload = config.payload;
  const request = payload.reviewFileScopeRequest;
  const files = React.useMemo(() => Array.from(request.files), [request.files]);
  const serviceNames = React.useMemo(
    () => new Map(services.map((service) => [service.id, service.name])),
    [services]
  );
  const hasUnresolvedService = files.some(
    (file) => !serviceNames.has(file.serviceId)
  );
  const settled = payload.decision !== undefined && payload.decision !== null;
  const disabledButtons =
    disabled ||
    isSubmitted ||
    settled ||
    deliveryState === "submitting" ||
    deliveryState === "delivered";

  const submit = React.useCallback(
    async (decision: "approve" | "deny") => {
      if (disabledButtons) return;
      if (!agentSessionId) {
        setDeliveryError(
          "Missing agent session id — cannot route the Review file decision."
        );
        setDeliveryState("failed");
        return;
      }
      const decisionRequest = {
        decision,
        requestId: request.id,
        sessionId: request.sessionId,
        agentType: request.agentType,
        reason: null,
        idempotencyToken: request.idempotencyToken,
      };
      setDeliveryError(null);
      setDeliveryState("submitting");
      try {
        await submitControllerDecision(decisionRequest);
        setDeliveryState("delivered");
      } catch (submissionError) {
        setDeliveryError(
          submissionError instanceof Error
            ? submissionError.message
            : "Failed to route the Review file decision."
        );
        setDeliveryState("failed");
      }
    },
    [
      agentSessionId,
      disabledButtons,
      request.agentType,
      request.id,
      request.idempotencyToken,
      request.sessionId,
      submitControllerDecision,
    ]
  );

  if (isLoading) {
    return (
      <Typography role="status" data-testid="agent-review-file-scope-loading">
        Loading Services…
      </Typography>
    );
  }

  return (
    <Stack spacing={2} data-testid="agent-review-file-scope-request">
      <Typography variant="subtitle2">
        Additional Review files requested
      </Typography>
      {error || hasUnresolvedService ? (
        <Alert
          severity="error"
          data-testid="agent-review-file-scope-resolution-error"
        >
          One or more Services cannot be resolved. Approval is unavailable;
          denial remains available to release Review.
        </Alert>
      ) : null}
      <Stack spacing={1}>
        {files.map((file) => {
          const serviceName = serviceNames.get(file.serviceId);
          if (!serviceName) return null;
          return (
            <Stack
              key={`${file.serviceId}:${file.filePath}`}
              spacing={0.25}
              data-testid="agent-review-file-scope-file"
              data-file-path={file.filePath}
            >
              <Typography variant="body2">
                {serviceName}: {file.filePath}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {file.reason}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
      {deliveryError ? (
        <Alert
          severity="error"
          data-testid="agent-review-file-scope-delivery-error"
        >
          {deliveryError}
        </Alert>
      ) : null}
      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          disabled={disabledButtons || Boolean(error) || hasUnresolvedService}
          onClick={() => void submit("approve")}
          data-testid="agent-review-file-scope-approve"
        >
          Approve files
        </Button>
        <Button
          variant="outlined"
          disabled={disabledButtons}
          onClick={() => void submit("deny")}
          data-testid="agent-review-file-scope-deny"
        >
          Deny
        </Button>
      </Stack>
    </Stack>
  );
};
