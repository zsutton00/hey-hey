import { useEffect, useState } from "react";
import { Box, Paper, Stack, Typography, useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";

import {
  FOLLOWUPS_QUESTIONS,
  FOLLOWUPS_RESPONSE_TEXT,
  FOLLOWUPS_SKIP_HINT,
  type FollowupsQuestion,
} from "../newOrgLandingFixture";

const QUESTION_REVEAL_INTERVAL_MS = 700;

interface FollowupsSceneProps {
  /** Natural width of the scene; matches the surrounding `MiniDemoPlayer`. */
  sceneWidth: number;
  /** Natural height of the scene; matches the surrounding `MiniDemoPlayer`. */
  sceneHeight: number;
  /** Override the per-question reveal cadence for tests using fake timers. */
  questionRevealIntervalMs?: number;
}

interface FollowupQuestionCardProps {
  question: FollowupsQuestion;
  skipHint: string;
}

const FollowupQuestionCard: React.FC<FollowupQuestionCardProps> = ({
  question,
  skipHint,
}) => {
  const theme = useTheme();
  return (
    <Paper
      elevation={0}
      data-testid={`new-org-landing-followups-question-${question.id}`}
      sx={{
        borderRadius: `${theme.shape.borderRadius}px`,
        overflow: "hidden",
        border: `1px solid ${theme.palette.divider}`,
        bgcolor: "background.paper",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 2,
          py: 1.25,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Typography
          sx={{
            fontSize: "1.25rem",
            fontWeight: 700,
            color: theme.palette.heyhey?.main ?? "rgb(8, 126, 139)",
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          Q
        </Typography>
        <Typography
          variant="body2"
          color="text.primary"
          sx={{ flex: 1, fontSize: "0.95rem", fontWeight: 600 }}
        >
          {question.label}
        </Typography>
      </Box>
      <Box sx={{ px: 2, py: 1.25 }}>
        <Typography
          variant="caption"
          data-testid={`new-org-landing-followups-skip-hint-${question.id}`}
          color="text.secondary"
          sx={{ display: "block", fontSize: "0.8rem" }}
        >
          {skipHint}
        </Typography>
      </Box>
    </Paper>
  );
};

export const FollowupsScene: React.FC<FollowupsSceneProps> = ({
  sceneWidth,
  sceneHeight,
  questionRevealIntervalMs = QUESTION_REVEAL_INTERVAL_MS,
}) => {
  const { t } = useTranslation();
  const totalQuestions = FOLLOWUPS_QUESTIONS.length;
  const [revealedQuestionCount, setRevealedQuestionCount] = useState(0);

  useEffect(() => {
    setRevealedQuestionCount(0);
    let cancelled = false;
    let nextIndex = 0;
    const intervalId = window.setInterval(() => {
      if (cancelled) return;
      nextIndex += 1;
      setRevealedQuestionCount(nextIndex);
      if (nextIndex >= totalQuestions) {
        window.clearInterval(intervalId);
      }
    }, questionRevealIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [questionRevealIntervalMs, totalQuestions]);

  const responseText = t(
    "newOrgLanding.followups.responseIntro",
    FOLLOWUPS_RESPONSE_TEXT,
  );
  const skipHint = t(
    "newOrgLanding.followups.skipHint",
    FOLLOWUPS_SKIP_HINT,
  );

  return (
    <Box
      data-testid="new-org-landing-followups-scene"
      data-revealed-question-count={revealedQuestionCount}
      sx={{
        width: sceneWidth,
        height: sceneHeight,
        pointerEvents: "none",
        overflow: "hidden",
        backgroundColor: "background.default",
        px: 6,
        py: 4,
      }}
    >
      <Stack spacing={2.5} sx={{ maxWidth: 980, mx: "auto" }}>
        <Typography
          variant="body1"
          data-testid="new-org-landing-followups-response"
          color="text.primary"
          sx={{ fontSize: "1rem", lineHeight: 1.55 }}
        >
          {responseText}
        </Typography>
        <Stack spacing={1.5}>
          {FOLLOWUPS_QUESTIONS.slice(0, revealedQuestionCount).map(
            (question) => (
              <FollowupQuestionCard
                key={question.id}
                question={question}
                skipHint={skipHint}
              />
            ),
          )}
        </Stack>
      </Stack>
    </Box>
  );
};
