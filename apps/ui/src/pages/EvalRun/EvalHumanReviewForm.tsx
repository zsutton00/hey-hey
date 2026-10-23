import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Rating,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  useEvalHumanReviews,
  useSaveEvalHumanReview,
  type EvalAttemptReport,
  type EvalHumanReviewReport,
} from "@hey-hey/ui-common/data";

const MAX_SCORE = 5;

const PreviousReview: React.FC<{ review: EvalHumanReviewReport }> = ({
  review,
}) => {
  const { t } = useTranslation();
  const { score, comment, challengeCase } = review.payload;
  return (
    <Box
      data-testid={`eval-human-review-${review.id}`}
      sx={{ borderTop: 1, borderColor: "divider", pt: 1 }}
    >
      <Typography variant="body2">
        {t("eval.results.review.scoreValue", { score })}
        {" · "}
        <Typography component="span" variant="caption" color="text.secondary">
          {new Date(review.createdAt).toLocaleString()}
        </Typography>
      </Typography>
      {comment && (
        <Typography variant="body2" color="text.secondary">
          {comment}
        </Typography>
      )}
      {challengeCase && (
        <Typography variant="caption" color="warning.main">
          {t("eval.results.review.challenged")}
        </Typography>
      )}
    </Box>
  );
};

export interface EvalHumanReviewFormProps {
  organizationId: string;
  projectId: string;
  evalId: string;
  attempt: EvalAttemptReport;
}

/**
 * A person's score, comment and challenge flag, saved as a separate review
 * record beside the attempt; the automated assessment is never edited.
 */
export const EvalHumanReviewForm: React.FC<EvalHumanReviewFormProps> = ({
  organizationId,
  projectId,
  evalId,
  attempt,
}) => {
  const { t } = useTranslation();
  const reviews = useEvalHumanReviews(organizationId, attempt.id);
  const save = useSaveEvalHumanReview();
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [challengeCase, setChallengeCase] = useState(false);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (score === null) return;
      const trimmed = comment.trim();
      try {
        await save.mutate({
          organizationId,
          projectId,
          evalId,
          attemptId: attempt.id,
          score,
          comment: trimmed.length > 0 ? trimmed : null,
          challengeCase,
          summary: t("eval.results.review.summary", { score }),
        });
      } catch {
        // The failure is shown from save.error; the draft stays for a retry.
        return;
      }
      setScore(null);
      setComment("");
      setChallengeCase(false);
    },
    [
      attempt,
      challengeCase,
      comment,
      evalId,
      organizationId,
      projectId,
      save,
      score,
      t,
    ],
  );

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      data-testid="eval-human-review-form"
    >
      <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
        {t("eval.results.review.title")}
      </Typography>
      <Stack spacing={1.5}>
        <Box>
          <Typography variant="body2" id={`eval-review-score-${attempt.id}`}>
            {t("eval.results.review.score")}
          </Typography>
          <Rating
            max={MAX_SCORE}
            value={score}
            onChange={(_event, value) => setScore(value)}
            slotProps={{
              root: {
                "aria-labelledby": `eval-review-score-${attempt.id}`,
              },
            }}
            data-testid="eval-human-review-score"
          />
        </Box>
        <TextField
          label={t("eval.results.review.comment")}
          multiline
          minRows={2}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          slotProps={{
            htmlInput: { "data-testid": "eval-human-review-comment" },
          }}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={challengeCase}
              onChange={(event) => setChallengeCase(event.target.checked)}
              slotProps={{
                input: {
                  // @ts-expect-error data-testid is forwarded to the input element
                  "data-testid": "eval-human-review-challenge",
                },
              }}
            />
          }
          label={t("eval.results.review.challenge")}
        />
        {save.error && (
          <Alert severity="error" data-testid="eval-human-review-error">
            {t("eval.results.review.saveError", {
              message: save.error.message,
            })}
          </Alert>
        )}
        <Box>
          <Button
            type="submit"
            variant="contained"
            size="small"
            disabled={score === null || save.isPending}
            data-testid="eval-human-review-save"
          >
            {t("eval.results.review.save")}
          </Button>
        </Box>
        <Typography variant="caption" color="text.secondary">
          {t("eval.results.review.note")}
        </Typography>
        {reviews.data.length > 0 && (
          <Stack spacing={1} data-testid="eval-human-review-list">
            <Typography variant="caption" color="text.secondary">
              {t("eval.results.review.previous")}
            </Typography>
            {reviews.data.map((review) => (
              <PreviousReview key={review.id} review={review} />
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  );
};
