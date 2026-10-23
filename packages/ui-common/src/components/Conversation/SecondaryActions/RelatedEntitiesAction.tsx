import { Alert, Box } from "@mui/material";
import React from "react";
import { isRelatedEntitiesPayload } from "../../../types/secondaryActions";
import { log } from "../../../utils/logger";
import type {
  SecondaryActionConfigWithHandler,
  SecondaryActionContext,
} from "../../LlmForms/Registry/types";
import { RelatedEntities } from "./RelatedEntities";

interface RelatedEntitiesActionProps {
  action: SecondaryActionConfigWithHandler;
  context: SecondaryActionContext;
}

export const RelatedEntitiesAction: React.FC<RelatedEntitiesActionProps> = ({
  action,
  context,
}) => {
  if (!isRelatedEntitiesPayload(action.payload)) {
    log.warn("ui", "Invalid payload for related_entities handler", {
      actionId: action.id,
      handler: action.handler,
      payload: action.payload,
    });
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        Invalid payload for related_entities handler
      </Alert>
    );
  }

  const debugMessageId = context.parentMessageId;

  return (
    <Box sx={{ mb: 2 }}>
      <RelatedEntities
        entities={action.payload.relatedEntities}
        organizationId={context.organizationId}
        projectId={context.projectId}
        messageId={debugMessageId}
        label={action.label}
      />
    </Box>
  );
};
