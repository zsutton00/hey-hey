import { Box, Typography } from "@mui/material";
import React from "react";

export interface ConversationCardSectionProps {
  label: string;
  children: React.ReactNode;
}

/** A body section introduced by a small muted uppercase label. */
export const ConversationCardSection: React.FC<
  ConversationCardSectionProps
> = ({ label, children }) => (
  <Box data-testid="conversation-card-section">
    <Typography
      component="div"
      data-testid="conversation-card-section-label"
      sx={{
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "text.secondary",
        mb: 0.75,
      }}
    >
      {label}
    </Typography>
    {children}
  </Box>
);
