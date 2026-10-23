import React from "react";
import SyncIcon from "@mui/icons-material/Sync";
import { CapsuleAction } from "../CapsuleAction";
import {
  useAlignmentCheckCapsuleAction,
  type UseAlignmentCheckCapsuleActionProps,
} from "./useAlignmentCheckCapsuleAction";

export interface AlignmentCheckCapsuleActionProps
  extends UseAlignmentCheckCapsuleActionProps {
  enabled?: boolean;
}

export const AlignmentCheckCapsuleAction: React.FC<
  AlignmentCheckCapsuleActionProps
> = ({ enabled = true, ...hookProps }) => {
  const action = useAlignmentCheckCapsuleAction(hookProps);

  if (
    !enabled ||
    hookProps.designDocIds.length === 0 ||
    !hookProps.organizationId
  ) {
    return null;
  }

  return (
    <CapsuleAction
      id={action.actionId}
      label={action.label}
      icon={SyncIcon}
      actionGroup="page"
      behavior="expand"
      renderContent={action.renderContent}
      title={action.title}
      inProgress={action.inProgress}
      resumable={action.resumable}
      expandable={action.expandable}
      disabled={action.disabled}
    />
  );
};
