import { Box, Typography } from "@mui/material";
import React from "react";
import type { EntityMention } from "../../SmarterTextAreaCard/types";
import { MentionBadgeInner } from "../../SmarterTextAreaCard/MentionBadge";

export interface ConversationCardRelatedRow {
  key: string;
  mention?: EntityMention;
  /** Why this item matters. */
  reason?: React.ReactNode;
  /** Trailing marker such as "your decision". */
  state?: { label: string; emphasis: "needsAnswer" | "default" };
}

export interface ConversationCardRelatedRowsProps {
  numbered?: boolean;
  /** Rule between rows; defaults to on. */
  dividers?: boolean;
  rows: readonly ConversationCardRelatedRow[];
}

/**
 * Related items as list rows: entity chip, dash, short reason, optional state
 * marker. A chip-only row is still a list row.
 */
export const ConversationCardRelatedRows: React.FC<
  ConversationCardRelatedRowsProps
> = ({ numbered, dividers = true, rows }) => (
  <Box
    component={numbered ? "ol" : "ul"}
    data-testid="conversation-card-related-rows"
    sx={{ listStyle: "none", m: 0, p: 0 }}
  >
    {rows.map((row, index) => (
      <Box
        component="li"
        key={row.key}
        data-testid="conversation-card-related-row"
        sx={(theme) => ({
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 0.75,
          py: 0.75,
          borderTop: dividers ? `1px solid ${theme.palette.divider}` : "none",
          "&:first-of-type": { borderTop: "none" },
        })}
      >
        {numbered ? (
          <Typography
            component="span"
            data-testid="conversation-card-row-number"
            variant="body2"
            sx={{ color: "text.secondary", minWidth: 20 }}
          >
            {index + 1}.
          </Typography>
        ) : null}
        {row.mention ? <MentionBadgeInner mention={row.mention} /> : null}
        {row.mention && row.reason ? (
          <Typography
            component="span"
            data-testid="conversation-card-row-dash"
            variant="body2"
            sx={{ color: "text.secondary" }}
          >
            —
          </Typography>
        ) : null}
        {row.reason ? (
          <Typography
            component="span"
            data-testid="conversation-card-row-reason"
            variant="body2"
            sx={{ flex: 1, minWidth: 0 }}
          >
            {row.reason}
          </Typography>
        ) : (
          <Box sx={{ flex: 1 }} />
        )}
        {row.state ? (
          <Box
            component="span"
            data-testid="conversation-card-row-state"
            sx={(theme) => {
              const color =
                row.state?.emphasis === "needsAnswer"
                  ? theme.palette.conversationCard.roles.needsAnswer.main
                  : theme.palette.text.secondary;

              return {
                fontSize: 11,
                px: 1,
                py: 0.25,
                borderRadius: 999,
                border: `1px solid ${color}`,
                color,
                whiteSpace: "nowrap",
              };
            }}
          >
            {row.state.label}
          </Box>
        ) : null}
      </Box>
    ))}
  </Box>
);
