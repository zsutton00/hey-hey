import { Box, Button, Typography } from "@mui/material";
import React from "react";
import type {
  ConversationCardRole,
  ConversationCardSeverity,
} from "../../../contexts/ThemeContext";

export type ConversationCardToneSelector =
  { role: ConversationCardRole } | { severity: ConversationCardSeverity };

export interface ConversationCardAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}

export interface ConversationCardActionsFooter {
  primary: ConversationCardAction;
  secondary?: readonly ConversationCardAction[];
}

/** Host-owned footer content, for actions the shell can't draw itself. */
export interface ConversationCardContentFooter {
  content: React.ReactNode;
}

export type ConversationCardFooter =
  ConversationCardActionsFooter | ConversationCardContentFooter;

export interface ConversationCardProps {
  tone: ConversationCardToneSelector;
  icon: React.ReactNode;
  kindLabel: string;
  /** Rendered right-aligned in the header strip. */
  chips?: React.ReactNode;
  /** One-sentence summary under the header. */
  lead?: React.ReactNode;
  /** Sections and related rows. */
  children?: React.ReactNode;
  /** Thin divider under the header; defaults to on. */
  headerDivider?: boolean;
  footer?: ConversationCardFooter;
  "data-testid"?: string;
}

/**
 * Shared shell for structured conversation cards. Fixed order: header strip,
 * lead, body, footer. Color appears only on the full border, the header icon
 * and the primary button; the body stays on the card surface.
 */
export const ConversationCard: React.FC<ConversationCardProps> = ({
  tone,
  icon,
  kindLabel,
  chips,
  lead,
  children,
  headerDivider = true,
  footer,
  "data-testid": dataTestId,
}) => {
  const toneKey = "role" in tone ? tone.role : tone.severity;
  const leadNode = lead ? (
    <Typography
      component="div"
      data-testid="conversation-card-lead"
      variant="body1"
      sx={{ fontWeight: 600 }}
    >
      {lead}
    </Typography>
  ) : null;

  return (
    <Box
      data-testid={dataTestId ?? "conversation-card"}
      data-tone={toneKey}
      sx={(theme) => {
        const palette = theme.palette.conversationCard;
        const colors =
          "role" in tone
            ? palette.roles[tone.role]
            : palette.severities[tone.severity];

        return {
          border: `2px solid ${colors.main}`,
          borderRadius: "12px",
          overflow: "hidden",
          backgroundColor: theme.palette.background.paper,
          color: theme.palette.text.primary,
          "--card-main": colors.main,
          "--card-soft": colors.soft,
          "--card-contrast": colors.contrastText,
        };
      }}
    >
      <Box
        data-testid="conversation-card-header"
        sx={(theme) => ({
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 1,
          borderBottom: headerDivider
            ? `1px solid ${theme.palette.divider}`
            : "none",
        })}
      >
        <Box sx={{ display: "inline-flex", color: "text.primary" }}>{icon}</Box>
        <Typography
          variant="body2"
          sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}
        >
          {kindLabel}
        </Typography>
        {chips ? (
          <Box sx={{ display: "flex", gap: 0.75, alignItems: "center" }}>
            {chips}
          </Box>
        ) : null}
      </Box>

      {lead ? <Box sx={{ px: 1.5, pt: 1.5 }}>{leadNode}</Box> : null}
      <Box
        data-testid="conversation-card-body"
        sx={{
          px: 1.5,
          py: 1.5,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {children}
      </Box>

      {footer ? (
        <Box
          data-testid="conversation-card-footer"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1.5,
            pb: 1.5,
          }}
        >
          {"content" in footer ? (
            footer.content
          ) : (
            <>
              <Button
                variant="contained"
                size="small"
                disableElevation
                data-testid={
                  footer.primary.testId ?? "conversation-card-primary"
                }
                disabled={footer.primary.disabled}
                onClick={footer.primary.onClick}
                sx={(theme) => ({
                  backgroundColor: "var(--card-main)",
                  color: "var(--card-contrast)",
                  "&:hover": {
                    backgroundColor: "var(--card-main)",
                    filter: "brightness(0.92)",
                  },
                  "&.Mui-disabled": {
                    backgroundColor: theme.palette.action.disabledBackground,
                    color: theme.palette.action.disabled,
                  },
                })}
              >
                {footer.primary.label}
              </Button>
              {footer.secondary?.map((action) => (
                <Button
                  key={action.label}
                  variant="text"
                  size="small"
                  data-testid={action.testId}
                  disabled={action.disabled}
                  onClick={action.onClick}
                  sx={{ color: "text.secondary" }}
                >
                  {action.label}
                </Button>
              ))}
            </>
          )}
        </Box>
      ) : null}
    </Box>
  );
};
