import { alpha, Box, Paper, Stack, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import React from "react";

export const NEEDS_YOUR_ANSWER_LABEL = "Needs your answer";

/** Soft Discuss-blue surface shared by question frames and option cards. */
export const discussSoftSurface = (theme: Theme) =>
  alpha(
    theme.palette.actionable.main,
    theme.palette.mode === "dark" ? 0.16 : 0.07,
  );

export const discussOutline = (theme: Theme) =>
  alpha(theme.palette.actionable.main, 0.45);

export interface QuestionFrameProps {
  testId: string;
  /** Right-aligned header content, e.g. severity and category. */
  headerEnd?: React.ReactNode;
  /** Show the "Needs your answer" band label. Reports omit it. */
  showAnswerBand?: boolean;
  children: React.ReactNode;
}

export const QuestionFrame: React.FC<QuestionFrameProps> = ({
  testId,
  headerEnd,
  showAnswerBand = true,
  children,
}) => (
  <Paper
    data-testid={testId}
    variant="outlined"
    sx={(theme) => ({
      overflow: "hidden",
      borderWidth: 2,
      borderColor: theme.palette.actionable.main,
      boxShadow: `0 0 0 3px ${alpha(theme.palette.actionable.main, 0.18)}`,
    })}
  >
    <Stack
      alignItems="center"
      direction="row"
      spacing={1}
      sx={(theme) => ({
        px: 1.5,
        py: 0.75,
        backgroundColor: theme.palette.actionable.main,
        color: theme.palette.actionable.contrastText,
      })}
    >
      <Box
        aria-hidden
        sx={(theme) => ({
          width: 20,
          height: 20,
          borderRadius: "50%",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 700,
          flexShrink: 0,
          backgroundColor: theme.palette.actionable.contrastText,
          color: theme.palette.actionable.main,
        })}
      >
        ?
      </Box>
      {showAnswerBand ? (
        <Typography
          data-testid={`${testId}-needs-your-answer`}
          variant="caption"
          fontWeight="bold"
          sx={{ flexGrow: 1 }}
        >
          {NEEDS_YOUR_ANSWER_LABEL}
        </Typography>
      ) : (
        <Box sx={{ flexGrow: 1 }} />
      )}
      {headerEnd}
    </Stack>
    <Box sx={{ p: 1.5 }}>{children}</Box>
  </Paper>
);

export interface NumberedOptionCardProps {
  index: number;
  selected?: boolean;
  children: React.ReactNode;
}

/** Option card with a Discuss-blue number badge. */
export const NumberedOptionCard: React.FC<NumberedOptionCardProps> = ({
  index,
  selected = false,
  children,
}) => (
  <Stack
    alignItems="flex-start"
    direction="row"
    spacing={1}
    sx={(theme) => ({
      px: 1,
      py: 0.75,
      borderRadius: 1,
      border: `1px solid ${selected ? theme.palette.actionable.main : discussOutline(theme)}`,
      backgroundColor: selected
        ? discussSoftSurface(theme)
        : theme.palette.background.paper,
    })}
  >
    <Box
      aria-hidden
      sx={(theme) => ({
        mt: 0.25,
        width: 20,
        height: 20,
        borderRadius: "50%",
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 700,
        backgroundColor: theme.palette.actionable.main,
        color: theme.palette.actionable.contrastText,
      })}
    >
      {index + 1}
    </Box>
    <Box sx={{ minWidth: 0, flexGrow: 1, overflowWrap: "anywhere" }}>
      {children}
    </Box>
  </Stack>
);
