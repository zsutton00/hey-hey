import {
  DiscussModal,
  type GraphConversationLaunchInput,
  useEntityConversationLauncher,
} from "@hey-hey/ui-common/components";
import { EntityType } from "@hey-hey/ui-common/api";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import { Button } from "@mui/material";
import React, { useCallback, useState } from "react";

export interface ServiceSessionLaunchButtonProps {
  organizationId: string;
  projectId: string;
  serviceId: string;
  serviceName: string;
}

export const ServiceSessionLaunchButton: React.FC<
  ServiceSessionLaunchButtonProps
> = ({ organizationId, projectId, serviceId, serviceName }) => {
  const [open, setOpen] = useState(false);
  const launcher = useEntityConversationLauncher({
    organizationId,
    projectId,
  });

  const handleSubmit = useCallback(
    async (submission: GraphConversationLaunchInput): Promise<boolean> => {
      const launched = await launcher.launch({
        ...submission,
        serviceId,
        context: {
          entityId: serviceId,
          entityType: EntityType.Service,
          entityTitle: serviceName,
        },
      });
      if (launched) {
        setOpen(false);
      }
      return launched;
    },
    [launcher, serviceId, serviceName]
  );

  return (
    <>
      <Button
        variant="contained"
        startIcon={<ChatBubbleOutlineIcon />}
        onClick={() => setOpen(true)}
        disabled={launcher.isLoading}
        data-testid="start-service-session"
      >
        Start Service Session
      </Button>
      {open && (
        <DiscussModal
          open
          onClose={() => setOpen(false)}
          onSubmit={handleSubmit}
          walkthroughEntity={null}
          submitError={launcher.error}
          onClearSubmitError={launcher.clearError}
          isLoading={launcher.isLoading}
          entityTitle={serviceName}
          organizationId={organizationId}
          projectId={projectId}
          fixedServiceScope={{ serviceId, serviceName }}
          focalEntity={{
            kind: "entity",
            entityType: EntityType.Service,
            entityId: serviceId,
          }}
          fileReferenceScope={null}
        />
      )}
    </>
  );
};
