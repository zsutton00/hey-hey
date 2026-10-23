import React from "react";
import type { AgentSessionDto, MachineDto } from "@hey-hey/ui-common/api";
import { AgentSessionType } from "@hey-hey/ui-common/api";
import {
  AgentConversationView,
  LoadingPanel,
} from "@hey-hey/ui-common/components";
import {
  useAgentSessions,
  useUserPairedMachines,
  usePlatformAdminAccess,
} from "@hey-hey/ui-common/data";
import { Alert } from "@mui/material";
import { DailySessionBriefing } from "./daily-session";

interface DailySessionViewProps {
  organizationId: string;
  projectId: string;
}

const sessionActivityTime = (session: AgentSessionDto): number => {
  const timestamp = Date.parse(
    session.updatedAt ?? session.createdAt ?? session.sessionDate,
  );
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const selectDailySession = (
  sessions: AgentSessionDto[],
  machines: MachineDto[],
): (AgentSessionDto & { conversationId: string; machineId: string }) | null => {
  const pairedMachineIds = new Set(
    machines
      .filter((machine) => !machine.revokedAt)
      .map((machine) => machine.machineId),
  );

  return (
    sessions
      .filter(
        (
          session,
        ): session is AgentSessionDto & {
          conversationId: string;
          machineId: string;
        } =>
          session.type === AgentSessionType.DailySession &&
          Boolean(session.conversationId) &&
          Boolean(session.machineId) &&
          pairedMachineIds.has(session.machineId ?? ""),
      )
      .sort(
        (left, right) =>
          sessionActivityTime(right) - sessionActivityTime(left) ||
          right.id.localeCompare(left.id),
      )[0] ?? null
  );
};

export const DailySessionView: React.FC<DailySessionViewProps> = ({
  organizationId,
  projectId,
}) => {
  const { isPlatformAdmin } = usePlatformAdminAccess();
  const {
    agentSessions,
    error: sessionsError,
    isFetched: sessionsFetched,
    isLoading: sessionsLoading,
  } = useAgentSessions(organizationId, projectId, {
    type: AgentSessionType.DailySession,
    enabled: isPlatformAdmin,
  });
  const {
    machines,
    error: machinesError,
    isFetched: machinesFetched,
    isLoading: machinesLoading,
  } = useUserPairedMachines({ enabled: isPlatformAdmin });

  if (!isPlatformAdmin) {
    return null;
  }

  if (
    sessionsLoading ||
    !sessionsFetched ||
    machinesLoading ||
    !machinesFetched
  ) {
    return <LoadingPanel label="Loading daily session..." />;
  }

  const discoveryError = sessionsError ?? machinesError;
  if (discoveryError) {
    return (
      <Alert severity="error">
        {discoveryError.message || "Unable to load daily session."}
      </Alert>
    );
  }

  const agentSession = selectDailySession(agentSessions, machines);

  if (!agentSession) {
    return (
      <DailySessionBriefing
        organizationId={organizationId}
        projectId={projectId}
      />
    );
  }

  return (
    <AgentConversationView
      organizationId={organizationId}
      projectId={projectId}
      agentSessionId={agentSession.id}
      conversationId={agentSession.conversationId}
      sessionResumability="resumable"
    />
  );
};
