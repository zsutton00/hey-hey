import { restoreModalWork } from "../../Modals/modalWorkRegistry";
import React, { useCallback, useMemo, useState } from "react";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import { useTheme } from "@mui/material";
import { CapsuleAction } from "../CapsuleAction";
import { DiscussModal } from "../../InteractionComponent/DiscussModal";
import { useEntityConversationLauncher } from "../../InteractionComponent/useEntityConversationLauncher";
import { useWorkItem } from "../../../data/hooks/useWorkItem";
import type { DiscussModalSubmitInput } from "../../InteractionComponent/DiscussModal";
import { EntityType, type TargetEntityType } from "../../../api";
import { normalizeEntityType } from "../../entityTypeUtils";
import { resolveFileReferenceScope } from "../../SmarterTextAreaCard/fileReferences/types";
import { getGoalSnapshotFromWorkItem } from "../../InteractionComponent/goalSnapshot";
import {
  toGuidableEntityFromExplorer,
  type GuidableTargetAddress,
} from "../../GuidedWalkthrough/types";

export interface DiscussCapsuleActionProps {
  entityId: string;
  entityType: EntityType | TargetEntityType;
  entityTitle?: string;
  organizationId: string;
  projectId: string;
  enabled?: boolean;
  order?: number;
}

const DEFAULT_ORDER = 90;

export const DiscussCapsuleAction: React.FC<DiscussCapsuleActionProps> = ({
  entityId,
  entityType,
  entityTitle,
  organizationId,
  projectId,
  enabled = true,
  order = DEFAULT_ORDER,
}) => {
  const theme = useTheme();
  const [discussOpen, setDiscussOpen] = useState(false);
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
      enabled:
        !!organizationId && entityType === EntityType.Task && discussOpen,
    },
  );
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
  const discussTarget = useMemo<GuidableTargetAddress | undefined>(
    () =>
      walkthroughEntity
        ? { name: "discuss-action", entity: walkthroughEntity }
        : undefined,
    [walkthroughEntity],
  );

  const handleOpen = useCallback(() => {
    if (!restoreModalWork(`discuss:${normalizedFocalEntityType}:${entityId}`))
      setDiscussOpen(true);
  }, [normalizedFocalEntityType, entityId]);

  const handleClose = useCallback(() => {
    if (!launcher.isLoading) {
      setDiscussOpen(false);
    }
  }, [launcher.isLoading]);

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
        setDiscussOpen(false);
      }
      return ok;
    },
    [entityId, entityType, isFetching, launcher, refetch, workItem],
  );

  const clearSubmitError = useCallback(() => {
    setGoalContextError(null);
    launcher.clearError();
  }, [launcher]);

  if (!enabled || !organizationId || !projectId) {
    return null;
  }

  return (
    <>
      <CapsuleAction
        id="discuss"
        label="Discuss"
        icon={ChatBubbleOutlineIcon}
        actionGroup="page"
        tier="page"
        order={order}
        behavior="click"
        onClick={handleOpen}
        guidableTarget={discussTarget}
        inProgress={launcher.isLoading}
        iconStyle={{
          backgroundColor: theme.palette.actionable.main,
          color: theme.palette.actionable.contrastText,
        }}
      />
      {discussOpen && (
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
        />
      )}
    </>
  );
};
