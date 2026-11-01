import React, { useCallback, useMemo } from "react";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import { useTheme } from "@mui/material";
import { CapsuleAction } from "../CapsuleAction";
import { useWorkItem } from "../../../data/hooks/useWorkItem";
import { useModal } from "../../../contexts/ModalContext";
import { EntityType, type TargetEntityType } from "../../../api";
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
export const DiscussCapsuleAction: React.FC<DiscussCapsuleActionProps> = ({
  entityId,
  entityType,
  entityTitle,
  organizationId,
  projectId,
  enabled = true,
  order = 90,
}) => {
  const theme = useTheme();
  const modal = useModal();
  // Read already-loaded presentation for walkthrough targeting. The retained
  // owner independently loads authoritative context after opening.
  const { workItem } = useWorkItem(organizationId, "task", entityId, {
    projectId,
    enabled: false,
  });
  const discussTarget = useMemo<GuidableTargetAddress | undefined>(() => {
    const entity = toGuidableEntityFromExplorer({
      entityId,
      entityType,
      ...(workItem?.type ? { entitySubtype: workItem.type } : {}),
    });
    return entity ? { name: "discuss-action", entity } : undefined;
  }, [entityId, entityType, workItem?.type]);
  const handleOpen = useCallback(() => {
    modal?.openModal({
      type: "discuss",
      organizationId,
      projectId,
      entityId,
      entityType,
      entityTitle,
    });
  }, [
    modal?.openModal,
    organizationId,
    projectId,
    entityId,
    entityType,
    entityTitle,
  ]);
  if (!enabled || !organizationId || !projectId) return null;
  return (
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
      disabled={!modal}
      iconStyle={{
        backgroundColor: theme.palette.actionable.main,
        color: theme.palette.actionable.contrastText,
      }}
    />
  );
};
