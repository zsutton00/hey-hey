import { useCallback, useMemo, useState } from "react";
import { DiscussModal, type DiscussModalSubmitInput } from "./DiscussModal";
import { useEntityConversationLauncher } from "./useEntityConversationLauncher";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { useAgentSession } from "../../data/hooks/useAgentSession";
import { EntityType } from "../../api";
import type { DiscussOpeningRequest } from "../../contexts/types/persistentModalRequest";
import { normalizeEntityType } from "../entityTypeUtils";
import { resolveFileReferenceScope } from "../SmarterTextAreaCard/fileReferences/types";
import { getGoalSnapshotFromWorkItem } from "./goalSnapshot";
import { toGuidableEntityFromExplorer } from "../GuidedWalkthrough/types";

export function HostedDiscussOwner({
  request,
  onClose,
}: {
  request: DiscussOpeningRequest;
  onClose: () => void;
}) {
  const {
    organizationId,
    projectId,
    entityId,
    entityType,
    entityTitle: requestedEntityTitle,
    initialValue,
    contextPreview,
  } = request;
  const [goalContextError, setGoalContextError] = useState<{
    code: null;
    message: string;
  } | null>(null);
  const launcher = useEntityConversationLauncher({
    organizationId,
    projectId,
  });

  // Resolve the work item for goal context and file-reference scope. Discuss
  // is graph-only, so this query intentionally does not request service
  // relations.
  const { workItem, isFetching, refetch } = useWorkItem(
    organizationId,
    "task",
    entityId,
    {
      projectId,
      enabled: !!organizationId && entityType === EntityType.Task,
    },
  );
  // A session-scoped discussion is about that session, so title it with the
  // session rather than leaving the subject blank.
  const { agentSession } = useAgentSession(
    organizationId,
    projectId,
    entityId,
    { enabled: entityType === EntityType.AgentSession },
  );
  const entityTitle =
    requestedEntityTitle ??
    (entityType === EntityType.AgentSession
      ? agentSession?.title || undefined
      : undefined);
  const fileReferenceScope = resolveFileReferenceScope(
    workItem?.type,
    entityId,
  );
  const normalizedFocalEntityType = normalizeEntityType(entityType);
  const focalEntity = normalizedFocalEntityType
    ? {
        kind: "entity" as const,
        entityType: normalizedFocalEntityType,
        entityId,
      }
    : { kind: "none" as const };

  const walkthroughEntity = useMemo(
    () =>
      toGuidableEntityFromExplorer({
        entityId,
        entityType,
        ...(workItem?.type ? { entitySubtype: workItem.type } : {}),
      }),
    [entityId, entityType, workItem?.type],
  );
  const handleClose = useCallback(() => {
    if (!launcher.isLoading) onClose();
  }, [launcher.isLoading, onClose]);

  const handleSubmit = useCallback(
    async (submission: DiscussModalSubmitInput): Promise<boolean> => {
      const needsCurrentWorkItem =
        entityType === EntityType.Task && (isFetching || !workItem);
      let currentWorkItem = workItem;
      if (needsCurrentWorkItem) {
        try {
          currentWorkItem = await refetch();
        } catch {
          currentWorkItem = null;
        }
      }
      if (entityType === EntityType.Task && !currentWorkItem) {
        setGoalContextError({
          code: null,
          message: "Unable to load the current work item context.",
        });
        return false;
      }
      const currentGoalSnapshot = getGoalSnapshotFromWorkItem(currentWorkItem);
      const context = {
        entityId,
        entityType,
        ...(entityTitle ? { entityTitle } : {}),
        ...(entityType === EntityType.Task && currentWorkItem?.type
          ? { entitySubtype: currentWorkItem.type }
          : {}),
        ...(currentGoalSnapshot ? { goalSnapshot: currentGoalSnapshot } : {}),
      };
      const ok = await launcher.launch({
        ...submission,
        context,
      });
      if (ok) {
        onClose();
      }
      return ok;
    },
    [
      entityId,
      entityTitle,
      entityType,
      isFetching,
      launcher,
      refetch,
      workItem,
      onClose,
    ],
  );

  const clearSubmitError = useCallback(() => {
    setGoalContextError(null);
    launcher.clearError();
  }, [launcher]);

  return (
    <DiscussModal
      open
      onClose={handleClose}
      onSubmit={handleSubmit}
      submitError={goalContextError ?? launcher.error}
      onClearSubmitError={clearSubmitError}
      isLoading={launcher.isLoading}
      entityTitle={entityTitle}
      organizationId={organizationId}
      projectId={projectId}
      focalEntity={focalEntity}
      walkthroughEntity={walkthroughEntity}
      fileReferenceScope={fileReferenceScope}
      initialValue={initialValue}
      contextPreview={contextPreview}
      placeholder={
        contextPreview
          ? "Add your own message about this (optional)..."
          : undefined
      }
    />
  );
}
