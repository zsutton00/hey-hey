import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import React from "react";
import {
  AgentSessionServicePlaceKind,
  type AgentRequestWorktreeAttachPayload,
  type AgentSessionServiceLocation,
} from "../../../api";
import { invalidateAgentSessionDetail } from "../../../data/collections/agentSessions";
import { useAgentSession } from "../../../data/hooks/useAgentSession";
import { useServices } from "../../../data/hooks/useServices";
import { describeServiceLocation } from "../../AgentSession/describeServiceLocation";
import type { FieldComponentProps, FieldConfig } from "./types";
import { useAccessRequestDecision } from "./useAccessRequestDecision";

type WorktreeAttachFieldConfig = Omit<FieldConfig, "payload"> & {
  payload: AgentRequestWorktreeAttachPayload;
};

export interface AgentWorktreeAttachRequestFieldProps extends Omit<
  FieldComponentProps<AgentRequestWorktreeAttachPayload>,
  "config"
> {
  config: WorktreeAttachFieldConfig;
}

const Path: React.FC<{ children: string }> = ({ children }) => (
  <Box component="span" sx={{ fontFamily: "monospace" }}>
    {children}
  </Box>
);

const CurrentPlace: React.FC<{
  place: AgentSessionServiceLocation;
  planBranch: string | null | undefined;
}> = ({ place, planBranch }) => {
  if (place.kind !== AgentSessionServicePlaceKind.Worktree) {
    return <>{describeServiceLocation(place)}</>;
  }

  const onPlanBranch = place.branch === planBranch;

  return (
    <>
      <Path>{place.worktreePath ?? ""}</Path>
      {onPlanBranch ? " · plan branch" : ` · branch ${place.branch}`}
    </>
  );
};

const Fact: React.FC<{
  label: string;
  testId: string;
  children: React.ReactNode;
}> = ({ label, testId, children }) => (
  <>
    <Typography component="dt" variant="body2" color="text.secondary">
      {label}
    </Typography>
    <Typography
      component="dd"
      variant="body2"
      data-testid={testId}
      sx={{ m: 0, minWidth: 0, overflowWrap: "anywhere" }}
    >
      {children}
    </Typography>
  </>
);

export const AgentWorktreeAttachRequestField: React.FC<
  AgentWorktreeAttachRequestFieldProps
> = ({ config, context, disabled = false, isSubmitted = false }) => {
  const { organizationId, projectId, agentSessionId } = context;
  const {
    worktreeAttachRequest: request,
    decision,
    failureReason,
  } = config.payload;
  const settled = Boolean(decision) || Boolean(failureReason);
  const { services, isLoading, error } = useServices(organizationId, {
    projectId,
    status: "ACTIVE",
  });
  const { agentSession } = useAgentSession(
    organizationId,
    projectId,
    agentSessionId,
  );
  const { submit, disabledButtons, deliveryError } = useAccessRequestDecision({
    context,
    request,
    locked: disabled || isSubmitted || settled,
    subject: "worktree",
  });

  const serviceName = services.find(
    (service) => service.id === request.serviceId,
  )?.name;
  const attached =
    agentSession?.servicePlaces?.some(
      (place) =>
        place.serviceId === request.serviceId &&
        place.branch === request.branch &&
        place.worktreePath === request.worktreePath,
    ) ?? false;

  // The platform announces no event when a recorded place changes, and the
  // approval is saved on this card before the place is. So until the session
  // shows the worktree, read it again each time the agent's state moves on.
  const queryClient = useQueryClient();
  const awaitingPlace = decision === "approve" && !failureReason && !attached;
  const currentState = agentSession?.currentState;
  React.useEffect(() => {
    if (!awaitingPlace || !agentSessionId) {
      return;
    }

    void invalidateAgentSessionDetail(
      queryClient,
      organizationId,
      projectId,
      agentSessionId,
    );
  }, [
    agentSessionId,
    awaitingPlace,
    currentState,
    organizationId,
    projectId,
    queryClient,
  ]);

  if (isLoading) {
    return (
      <Typography
        role="status"
        data-testid="agent-worktree-attach-loading"
        data-request-id={request.id}
      >
        Loading Services…
      </Typography>
    );
  }

  // A Service that can't be resolved can't be reviewed, so only Deny remains.
  const serviceUnavailable = Boolean(error) || serviceName === undefined;
  const mainFolderBranch =
    request.currentPlace.kind === AgentSessionServicePlaceKind.MainFolder
      ? request.currentPlace.branch
      : null;

  const renderOutcome = () => {
    if (failureReason) {
      return (
        <Alert severity="error" data-testid="agent-worktree-attach-failed">
          <Box sx={{ overflowWrap: "anywhere" }}>
            Couldn't attach: {failureReason}
          </Box>
          <Box>Nothing changed.</Box>
        </Alert>
      );
    }

    if (decision === "deny") {
      return (
        <Alert severity="info" data-testid="agent-worktree-attach-denied">
          Denied · still working in{" "}
          {describeServiceLocation(request.currentPlace)}
        </Alert>
      );
    }

    // Approval alone doesn't prove the move; the session's place does.
    return (
      <Alert
        severity={attached ? "success" : "info"}
        data-testid="agent-worktree-attach-approved"
      >
        {attached
          ? `Approved · the agent continued in ${request.branch}`
          : "Approved"}
      </Alert>
    );
  };

  return (
    <Stack spacing={2} data-testid="agent-worktree-attach-request">
      <Typography variant="subtitle2">Worktree request</Typography>
      <Typography variant="body2" fontWeight={600}>
        The agent wants to keep working in another worktree
        {serviceName ? ` of ${serviceName}` : ""}
      </Typography>
      {serviceUnavailable && !settled ? (
        <Alert severity="error" data-testid="agent-worktree-attach-unresolved">
          Unable to load this Service for review. Approve is unavailable; deny
          this request to release the paused coding session.
        </Alert>
      ) : null}
      <Box
        component="dl"
        sx={{
          display: "grid",
          gridTemplateColumns: "max-content minmax(0, 1fr)",
          columnGap: 2,
          rowGap: 0.75,
          m: 0,
        }}
      >
        <Fact label="Service" testId="agent-worktree-attach-service">
          {serviceName ?? "Unavailable"}
        </Fact>
        <Fact label="Works in now" testId="agent-worktree-attach-current">
          <CurrentPlace
            place={request.currentPlace}
            planBranch={request.planBranch}
          />
        </Fact>
        <Fact label="Will work in" testId="agent-worktree-attach-target">
          <Path>{request.worktreePath}</Path> · branch{" "}
          <strong>{request.branch}</strong>
        </Fact>
      </Box>
      <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
        Reason: {request.reason}
      </Typography>
      {deliveryError ? (
        <Alert
          severity="error"
          data-testid="agent-worktree-attach-delivery-error"
        >
          {deliveryError}
        </Alert>
      ) : null}
      {settled ? (
        renderOutcome()
      ) : (
        <>
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="agent-worktree-attach-effect"
          >
            The agent will continue working in this worktree for this Service.
            No files are moved: uncommitted changes stay in the folder they are
            in now.{" "}
            {mainFolderBranch
              ? `Your main folder stays on ${mainFolderBranch}. `
              : null}
            The agent can already read every worktree.
          </Typography>
          {request.planBranch ? (
            <Alert
              severity="info"
              data-testid="agent-worktree-attach-plan-note"
            >
              This plan works on <strong>{request.planBranch}</strong>.
              Approving changes the branch for this session only; the plan keeps
              its branch.
            </Alert>
          ) : null}
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              disabled={disabledButtons || serviceUnavailable}
              onClick={() => void submit("approve")}
              data-testid="agent-worktree-attach-approve"
            >
              Approve
            </Button>
            <Button
              variant="outlined"
              disabled={disabledButtons}
              onClick={() => void submit("deny")}
              data-testid="agent-worktree-attach-deny"
            >
              Deny
            </Button>
          </Stack>
        </>
      )}
    </Stack>
  );
};
