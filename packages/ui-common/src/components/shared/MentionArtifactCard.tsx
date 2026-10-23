import { Box } from "@mui/material";
import React from "react";
import { InteractionComponent } from "../InteractionComponent";
import type { EntityMention } from "../SmarterTextAreaCard/types";
import { formatMention } from "../../utils/mentionFormatting";
import { VisualArtifactCard } from "./VisualArtifactCard";

/** Keeps an inline card a preview, not a full-width stand-in for the inline view. */
const MENTION_CARD_MAX_WIDTH = 360;

/**
 * Card presentation of a visual mention. The card replaces the badge: its
 * title carries the entity icon and name, selecting it opens Preview, and the
 * wrapper keeps the mention's clipboard identity, drag and context menu. The
 * artifact comes from the token alone, so nothing is read until the card
 * nears the viewport.
 */
export const MentionArtifactCard: React.FC<{
  mention: EntityMention;
  typeKey: string;
  organizationId: string;
  projectId: string;
}> = ({ mention, typeKey, organizationId, projectId }) => (
  <Box
    data-testid="mention-artifact-card"
    data-mention-token={formatMention(mention)}
    data-entity-type={mention.entityType}
    data-entity-id={mention.entityId}
    data-entity-name={mention.entityName}
    sx={{
      display: "block",
      width: "100%",
      maxWidth: MENTION_CARD_MAX_WIDTH,
      my: 1,
    }}
  >
    <InteractionComponent
      entityId={mention.entityId}
      entityType={mention.entityType}
      entityTitle={mention.entityName}
      organizationId={organizationId}
      projectId={projectId}
      hasProposalSupport
      draggable
      showIndicator={false}
      idScope="mention"
    >
      <VisualArtifactCard
        artifact={{
          entityId: mention.entityId,
          typeKey,
          displayName: mention.entityName,
        }}
        organizationId={organizationId}
        projectId={projectId}
      />
    </InteractionComponent>
  </Box>
);
