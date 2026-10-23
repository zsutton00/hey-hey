import { Box } from "@mui/material";
import React from "react";
import { EntityIcon } from "../Entity/EntityIcon";

export interface EntityConversationTitleProps {
  conversationTitle: string;
  entityId?: string;
  entityTitle?: string | null;
  entityType?: string;
}

export const EntityConversationTitle: React.FC<
  EntityConversationTitleProps
> = ({ conversationTitle, entityId, entityTitle, entityType }) => {
  const subjectTitle = entityTitle?.trim();

  return (
    <Box
      component="span"
      data-entity-id={entityId}
      data-testid="entity-conversation-title"
      sx={{
        alignItems: "center",
        display: "inline-flex",
        gap: 0.5,
        maxWidth: "100%",
        minWidth: 0,
        verticalAlign: "middle",
      }}
    >
      {subjectTitle && entityType ? (
        <>
          <Box
            component="span"
            data-testid="entity-conversation-subject-icon"
            sx={{
              alignItems: "center",
              display: "inline-flex",
              flexShrink: 0,
              height: 24,
              justifyContent: "center",
              lineHeight: 1,
              width: 24,
            }}
          >
            <EntityIcon entityType={entityType} size={24} />
          </Box>
          <Box
            component="span"
            data-testid="entity-conversation-subject-title"
            sx={{
              minWidth: 0,
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          >
            {subjectTitle}
          </Box>
          <Box
            aria-hidden
            component="span"
            sx={{ flexShrink: 0, px: 0.25 }}
          >
            {" / "}
          </Box>
        </>
      ) : null}
      <Box
        component="span"
        data-testid="entity-conversation-name"
        sx={{
          minWidth: 0,
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {conversationTitle}
      </Box>
    </Box>
  );
};
