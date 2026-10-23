import {
  CapsuleAction,
  DiscussModal,
  discussColor,
  type GraphConversationLaunchInput,
  useFeatureTreeConversationLauncher,
} from "@hey-hey/ui-common/components";
import { EntityType } from "@hey-hey/ui-common/api";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import React, { useCallback, useMemo, useState } from "react";

interface DiscussFeatureTreeActionCapsuleProps {
  organizationId?: string;
  projectId?: string;
}

export const DiscussFeatureTreeActionCapsule: React.FC<
  DiscussFeatureTreeActionCapsuleProps
> = ({ organizationId, projectId }) => {
  const [discussOpen, setDiscussOpen] = useState(false);
  const [isLaunchErrorDismissed, setIsLaunchErrorDismissed] = useState(false);

  const launcher = useFeatureTreeConversationLauncher({
    organizationId: organizationId ?? "",
    projectId: projectId ?? "",
  });

  const handleClick = useCallback(() => {
    setIsLaunchErrorDismissed(false);
    setDiscussOpen(true);
  }, []);

  const submitError = useMemo(
    () =>
      launcher.error && !isLaunchErrorDismissed
        ? { code: null, message: launcher.error }
        : null,
    [isLaunchErrorDismissed, launcher.error],
  );

  const handleClearSubmitError = useCallback(() => {
    setIsLaunchErrorDismissed(true);
  }, []);

  const handleClose = useCallback(() => {
    if (launcher.isLoading) return;
    setDiscussOpen(false);
  }, [launcher.isLoading]);

  const handleSubmit = useCallback(
    async (submission: GraphConversationLaunchInput): Promise<boolean> => {
      setIsLaunchErrorDismissed(false);
      const ok = await launcher.launch(submission);
      if (ok) {
        setDiscussOpen(false);
      }
      return ok;
    },
    [launcher],
  );

  return (
    <>
      <CapsuleAction
        id="discuss-feature-tree"
        behavior="click"
        actionGroup="page"
        tier="page"
        order={10}
        icon={ChatBubbleOutlineIcon}
        label="Discuss"
        title="Discuss feature tree"
        onClick={handleClick}
        disabled={!projectId || !organizationId || launcher.isLoading}
        inProgress={launcher.isLoading}
        iconStyle={{ backgroundColor: discussColor, color: "#fff" }}
      />
      <DiscussModal
        open={discussOpen}
        onClose={handleClose}
        onSubmit={handleSubmit}
        walkthroughEntity={null}
        isLoading={launcher.isLoading}
        organizationId={organizationId}
        projectId={projectId}
        focalEntity={
          projectId
            ? {
                kind: "entity",
                entityType: EntityType.Project,
                entityId: projectId,
              }
            : { kind: "none" }
        }
        fileReferenceScope={null}
        submitError={submitError}
        onClearSubmitError={handleClearSubmitError}
      />
    </>
  );
};
