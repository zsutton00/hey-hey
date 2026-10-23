import React, { useCallback, useMemo } from "react";
import { EntityType, type AgentSessionDto } from "../../../api";
import { useAgentSessions } from "../../../data/hooks/useAgentSessions";
import type { Stable } from "../../../types";
import { AlignmentCheckContent } from "./AlignmentCheckContent";

export interface UseAlignmentCheckCapsuleActionProps {
  organizationId: string;
  projectId: string;
  designDocIds: string[];
  initiativeId?: string;
  taskId?: string;
  inferredServiceId?: string;
  onSessionCreated?: (session: AgentSessionDto) => void;
  buildSessionPath?: (sessionId: string) => string;
  actionId?: string;
  label?: string;
  title?: string;
  enabled?: boolean;
}

export interface UseAlignmentCheckCapsuleActionResult {
  behavior: "expand";
  actionId: string;
  label: string;
  title: string;
  renderContent: Stable<() => React.ReactNode>;
  inProgress: boolean;
  resumable: boolean;
  expandable: boolean;
  disabled: boolean;
}

export const useAlignmentCheckCapsuleAction = (
  props: UseAlignmentCheckCapsuleActionProps
): UseAlignmentCheckCapsuleActionResult => {
  const {
    organizationId,
    projectId,
    designDocIds,
    inferredServiceId,
    onSessionCreated,
    buildSessionPath,
    actionId = "check-alignment",
    label = "Check Alignment",
    title = "Check Alignment",
    enabled = true,
  } = props;

  const primaryDesignDocId = designDocIds[0] ?? undefined;

  const { agentSessions } = useAgentSessions(organizationId, projectId, {
    entityType: EntityType.DesignDoc,
    entityId: primaryDesignDocId,
    enabled: enabled && !!organizationId && !!projectId && !!primaryDesignDocId,
  });

  const previousSession = useMemo(() => {
    if (!agentSessions.length) return null;
    return agentSessions[0];
  }, [agentSessions]);

  const hasExistingSessions = agentSessions.length > 0;

  const renderContent = useCallback(() => {
    return (
      <AlignmentCheckContent
        organizationId={organizationId}
        projectId={projectId}
        designDocIds={designDocIds}
        inferredServiceId={inferredServiceId}
        previousSession={previousSession}
        onSessionCreated={onSessionCreated}
        buildSessionPath={buildSessionPath}
      />
    );
  }, [
    organizationId,
    projectId,
    designDocIds,
    inferredServiceId,
    previousSession,
    onSessionCreated,
    buildSessionPath,
  ]);

  return {
    behavior: "expand",
    actionId,
    label,
    title,
    renderContent,
    inProgress: hasExistingSessions,
    resumable: true,
    expandable: true,
    disabled: designDocIds.length === 0,
  };
};
