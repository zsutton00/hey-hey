import type {
  ContextRelatedEntityDto,
  EntityContextDtoProposalsInner,
} from "@hey-hey/ui-common/api";
import {
  MOCKUP_TYPE_KEY,
  type StructuralChild,
  VisualArtifactCard,
  selectVisualArtifacts,
} from "@hey-hey/ui-common/components";
import { useWorkItems } from "@hey-hey/ui-common/data";
import React, { useMemo } from "react";

import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import { HistoryCard } from "../HistoryCard";
import { RelatedCard } from "../RelatedCard";

export interface ContextRailCardsProps {
  proposals: EntityContextDtoProposalsInner[];
  relatedEntities: ContextRelatedEntityDto[];
  organizationId: string;
  projectId: string;
  conversationPathForId: (conversationId: string) => string;
  /**
   * The page's work item. Its direct Mockup and Diagram children lead the
   * visual cards. Omit for hosts that cannot parent work items.
   */
  parentWorkItemId?: string;
  /** Prefix for card test ids, e.g. `task-sidebar`. */
  dataTestIdPrefix: string;
  /**
   * Holds only the Related card, which sits below the host's Feature Tree and
   * would jump as the tree settles. History and visual cards never wait.
   */
  relatedLoading?: boolean;
}

const useStructuralVisualChildren = (
  organizationId: string,
  projectId: string,
  parentWorkItemId: string | undefined
): StructuralChild[] => {
  const options = (taskType: string) => ({
    parentTaskId: parentWorkItemId,
    taskType,
    enabled: !!parentWorkItemId,
  });
  const mockups = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    options(MOCKUP_TYPE_KEY)
  );
  const diagrams = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    options(WORK_ITEM_TYPE_KEYS.Diagram)
  );
  return useMemo(
    () =>
      [...mockups.workItems, ...diagrams.workItems]
        .filter((item) => item.parentTaskId === parentWorkItemId)
        .map((item) => ({ id: item.id, type: item.type, name: item.name })),
    [mockups.workItems, diagrams.workItems, parentWorkItemId]
  );
};

/**
 * The context rail's card set below Feature Tree: History, one visual card per
 * related Mockup or Diagram, then Related. Every rail host renders this so the
 * set and order cannot drift between pages.
 */
export const ContextRailCards: React.FC<ContextRailCardsProps> = ({
  proposals,
  relatedEntities,
  organizationId,
  projectId,
  conversationPathForId,
  parentWorkItemId,
  dataTestIdPrefix,
  relatedLoading = false,
}) => {
  const structuralChildren = useStructuralVisualChildren(
    organizationId,
    projectId,
    parentWorkItemId
  );
  const artifacts = useMemo(
    () => selectVisualArtifacts(structuralChildren, relatedEntities),
    [structuralChildren, relatedEntities]
  );

  return (
    <>
      <HistoryCard
        proposals={proposals}
        relatedEntities={relatedEntities}
        organizationId={organizationId}
        projectId={projectId}
        conversationPathForId={conversationPathForId}
        dataTestId={`${dataTestIdPrefix}-history-card`}
      />
      {artifacts.map((artifact) => (
        <VisualArtifactCard
          key={artifact.entityId}
          artifact={artifact}
          organizationId={organizationId}
          projectId={projectId}
        />
      ))}
      <RelatedCard
        proposals={proposals}
        relatedEntities={relatedEntities}
        organizationId={organizationId}
        projectId={projectId}
        dataTestId={`${dataTestIdPrefix}-related-card`}
        loading={relatedLoading}
      />
    </>
  );
};

ContextRailCards.displayName = "ContextRailCards";
