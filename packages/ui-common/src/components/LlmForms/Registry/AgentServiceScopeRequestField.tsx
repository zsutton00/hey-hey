import { Alert, Button, Stack, Typography } from "@mui/material";
import React from "react";
import { useServices } from "../../../data/hooks/useServices";
import { useSubmitControllerAuthorizedPermissionDecision } from "../../../data/hooks/useSubmitControllerAuthorizedPermissionDecision";
import type { AgentRequestServiceScopePayload } from "../../../api";
import type { FieldComponentProps, FieldConfig } from "./types";
type ServiceScopeFieldConfig = Omit<FieldConfig, "payload"> & {
  payload: AgentRequestServiceScopePayload;
};
export interface AgentServiceScopeRequestFieldProps
  extends Omit<FieldComponentProps<AgentRequestServiceScopePayload>, "config"> {
  config: ServiceScopeFieldConfig;
}
type DeliveryState = "idle" | "submitting" | "delivered" | "failed";
const namesFor = (
  ids: readonly string[],
  services: readonly { id: string; name: string }[]
): string[] =>
  ids.map((id) => services.find((service) => service.id === id)?.name ?? id);
export const AgentServiceScopeRequestField: React.FC<
  AgentServiceScopeRequestFieldProps
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
  const request = payload.serviceScopeRequest;
  const currentNames = React.useMemo(
    () => namesFor(request.currentServiceIds, services),
    [request.currentServiceIds, services]
  );
  const requestedNames = React.useMemo(
    () => namesFor(request.requestedServiceIds, services),
    [request.requestedServiceIds, services]
  );
  const unresolvedIds = React.useMemo(
    () =>
      request.requestedServiceIds.filter(
        (id) => !services.some((service) => service.id === id)
      ),
    [request.requestedServiceIds, services]
  );
  const serviceResolutionUnavailable =
    Boolean(error) || unresolvedIds.length > 0;
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
          "Missing agent session id — cannot route Service-scope decision."
        );
        setDeliveryState("failed");
        return;
      }
      const decisionRequest = {
        decision,
        requestId: request.id,
        sessionId: request.sessionId,
        agentType: request.agentType,
        reason: request.reason,
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
            : "Failed to route Service-scope decision."
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
      request.reason,
      request.sessionId,
      submitControllerDecision,
    ]
  );
  if (isLoading)
    return (
      <Typography
        role="status"
        data-testid={`agent-service-scope-loading-${request.id}`}
      >
        Loading Services…
      </Typography>
    );
  return (
    <Stack spacing={2} data-testid="agent-service-scope-request">
      <Typography variant="subtitle2">
        Additional Service access requested
      </Typography>
      {error ? (
        <Alert
          severity="error"
          data-testid={`agent-service-scope-error-${request.id}`}
        >
          Unable to load project Services for review. Approve is unavailable;
          deny this request to release the paused coding session.
        </Alert>
      ) : null}
      {unresolvedIds.length > 0 ? (
        <Alert
          severity="error"
          data-testid={`agent-service-scope-unresolved-${request.id}`}
        >
          Some requested Services are no longer available:{" "}
          {unresolvedIds.join(", ")} Approve is unavailable; deny this request
          to release the paused coding session.
        </Alert>
      ) : null}
      <Typography variant="body2">Reason: {request.reason}</Typography>
      <Typography variant="body2">
        Current scope: {currentNames.join(", ")}
      </Typography>
      <Typography variant="body2">
        Proposed scope: {requestedNames.join(", ")}
      </Typography>
      {deliveryError ? (
        <Alert
          severity="error"
          data-testid="agent-service-scope-delivery-error"
        >
          {deliveryError}
        </Alert>
      ) : null}
      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          disabled={disabledButtons || serviceResolutionUnavailable}
          onClick={() => void submit("approve")}
          data-testid="agent-service-scope-approve"
        >
          Approve
        </Button>
        <Button
          variant="outlined"
          disabled={disabledButtons}
          onClick={() => void submit("deny")}
          data-testid="agent-service-scope-deny"
        >
          Deny
        </Button>
      </Stack>
    </Stack>
  );
};
