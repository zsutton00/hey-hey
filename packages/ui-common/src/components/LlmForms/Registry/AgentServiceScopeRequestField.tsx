import { Alert, Button, Stack, Typography } from "@mui/material";
import React from "react";
import { useServices } from "../../../data/hooks/useServices";
import { useAgentSession } from "../../../data/hooks/useAgentSession";
import { useWorkItem } from "../../../data/hooks/useWorkItem";
import { ServicesWorkIn } from "../../AgentSession/ServicesWorkIn";
import { useOpenNameFields } from "../../AgentSession/useOpenNameFields";
import { resolveChoice } from "../../AgentSession/resolveChoice";
import {
  EntityType,
  type AgentRequestServiceScopePayload,
  type ServicePlaceChoice,
} from "../../../api";
import type { FieldComponentProps, FieldConfig } from "./types";
import { useAccessRequestDecision } from "./useAccessRequestDecision";
type ServiceScopeFieldConfig = Omit<FieldConfig, "payload"> & {
  payload: AgentRequestServiceScopePayload;
};
export interface AgentServiceScopeRequestFieldProps extends Omit<
  FieldComponentProps<AgentRequestServiceScopePayload>,
  "config"
> {
  config: ServiceScopeFieldConfig;
}
const namesFor = (
  ids: readonly string[],
  services: readonly { id: string; name: string }[],
): string[] =>
  ids.map((id) => services.find((service) => service.id === id)?.name ?? id);
export const AgentServiceScopeRequestField: React.FC<
  AgentServiceScopeRequestFieldProps
> = ({ config, context, disabled = false, isSubmitted = false }) => {
  const { organizationId, projectId, agentSessionId } = context;
  const { services, isLoading, error } = useServices(organizationId, {
    projectId,
    status: "ACTIVE",
  });
  const { agentSession } = useAgentSession(
    organizationId,
    projectId,
    agentSessionId,
  );
  const attachedWorkItemId =
    agentSession?.entityType === EntityType.Task
      ? agentSession.entityId
      : undefined;
  const { workItem } = useWorkItem(
    organizationId,
    "task",
    attachedWorkItemId ?? "",
    { projectId, enabled: Boolean(attachedWorkItemId) },
  );
  const { nameOpen, registerOpenNameField } = useOpenNameFields();
  const [changedChoices, setChangedChoices] = React.useState<
    Record<string, ServicePlaceChoice>
  >({});
  const [placesUnavailable, setPlacesUnavailable] = React.useState(false);
  const payload = config.payload;
  const request = payload.serviceScopeRequest;
  const currentNames = React.useMemo(
    () => namesFor(request.currentServiceIds, services),
    [request.currentServiceIds, services],
  );
  const requestedNames = React.useMemo(
    () => namesFor(request.requestedServiceIds, services),
    [request.requestedServiceIds, services],
  );
  const unresolvedIds = React.useMemo(
    () =>
      request.requestedServiceIds.filter(
        (id) => !services.some((service) => service.id === id),
      ),
    [request.requestedServiceIds, services],
  );
  const serviceResolutionUnavailable =
    Boolean(error) || unresolvedIds.length > 0;
  // Only Services the request adds get a choice; the others are already granted.
  const addedServiceIds = React.useMemo(
    () =>
      request.requestedServiceIds.filter(
        (id) => !request.currentServiceIds.includes(id),
      ),
    [request.currentServiceIds, request.requestedServiceIds],
  );
  // Starts from the proposed place. An older CLI sends no proposal list, so the
  // main folder. A list that omits a Service left it unproposed on purpose
  // (unknown launch branch): the reviewer must choose.
  const choices = React.useMemo(() => {
    const byServiceId: Record<string, ServicePlaceChoice> = {};
    for (const serviceId of addedServiceIds) {
      const proposed = request.proposedPlaces?.find(
        (place) => place.serviceId === serviceId,
      );
      const choice =
        changedChoices[serviceId] ??
        proposed ??
        (request.proposedPlaces === undefined
          ? resolveChoice(serviceId, null)
          : null);
      if (choice) {
        byServiceId[serviceId] = choice;
      }
    }

    return byServiceId;
  }, [addedServiceIds, changedChoices, request.proposedPlaces]);
  const unchosenServiceIds = addedServiceIds.filter((id) => !choices[id]);
  const machineId = agentSession?.machineId ?? null;
  const settled = payload.decision !== undefined && payload.decision !== null;
  const { submit, disabledButtons, deliveryError } = useAccessRequestDecision({
    context,
    request,
    locked: disabled || isSubmitted || settled,
    subject: "Service-scope",
  });
  const approveBlocked =
    serviceResolutionUnavailable ||
    placesUnavailable ||
    nameOpen ||
    unchosenServiceIds.length > 0;
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
      {machineId && unresolvedIds.length === 0 && addedServiceIds.length > 0 ? (
        <ServicesWorkIn
          organizationId={organizationId}
          projectId={projectId}
          machineId={machineId}
          services={addedServiceIds.map((serviceId) => ({
            serviceId,
            name: namesFor([serviceId], services)[0],
            requireChoice: request.proposedPlaces !== undefined,
          }))}
          choices={choices}
          disabled={disabledButtons}
          workItemName={workItem?.name ?? null}
          registerOpenNameField={registerOpenNameField}
          onUnavailableChange={setPlacesUnavailable}
          onChange={(choice) =>
            setChangedChoices((current) => ({
              ...current,
              [choice.serviceId]: choice,
            }))
          }
        />
      ) : null}
      {unchosenServiceIds.length > 0 ? (
        <Alert
          severity="info"
          data-testid={`agent-service-scope-choice-needed-${request.id}`}
        >
          Choose where {namesFor(unchosenServiceIds, services).join(", ")}{" "}
          should work before approving: its launch branch is unknown.
        </Alert>
      ) : null}
      <Typography variant="caption" color="text.secondary">
        Reading code still needs no access; this only sets where changes are
        made.
      </Typography>
      {settled && payload.failureReason ? (
        <Alert
          severity="error"
          data-testid="agent-service-scope-failure-reason"
        >
          Approval failed, nothing was granted: {payload.failureReason}
        </Alert>
      ) : null}
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
          disabled={disabledButtons || approveBlocked}
          onClick={() =>
            void submit("approve", {
              servicePlaceChoices: Object.values(choices),
            })
          }
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
