import {
  Alert,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMemo, useState } from "react";
import type {
  StartupPlan,
  StartupPlanDecision,
  StartupPlanReviewPayload,
  StartupPlanSubmission,
} from "../AgentSessions/types.js";

export interface StartupPlanReviewProps {
  plan: StartupPlan;
  submitting: boolean;
  onSubmit: (submission: StartupPlanSubmission) => void;
  onBack?: () => void;
  showBackButton?: boolean;
}

type DiscrepancyDispositionChoice = "accept" | "reject" | null;

const toInitialAnswers = (plan: StartupPlan): string[] =>
  plan.clarificationQuestions.map(() => "");

const toReviewDisposition = (
  choice: Exclude<DiscrepancyDispositionChoice, null>
) => (choice === "accept" ? "acknowledged" : "blocker");

export const StartupPlanReview = ({
  plan,
  submitting,
  onSubmit,
  onBack,
  showBackButton = true,
}: StartupPlanReviewProps) => {
  const [answers, setAnswers] = useState<string[]>(() =>
    toInitialAnswers(plan)
  );
  const [notes, setNotes] = useState<string[]>(() =>
    plan.discrepancies.map(() => "")
  );
  const [dispositions, setDispositions] = useState<
    DiscrepancyDispositionChoice[]
  >(() => plan.discrepancies.map(() => null));
  const [feedback, setFeedback] = useState("");

  const hasQuestions = plan.clarificationQuestions.length > 0;
  const hasDiscrepancies = plan.discrepancies.length > 0;

  const hasEmptyAnswer = useMemo(
    () =>
      plan.clarificationQuestions.some((_, index) => !answers[index]?.trim()),
    [answers, plan.clarificationQuestions]
  );

  const hasUndecidedDiscrepancies = useMemo(
    () => plan.discrepancies.some((_, index) => dispositions[index] == null),
    [dispositions, plan.discrepancies]
  );

  const handleSubmit = (decision: StartupPlanDecision) => {
    const feedbackText = feedback.trim();
    if (decision === "improve" && feedbackText.length === 0) {
      return;
    }

    const review: StartupPlanReviewPayload = {
      responseType: "startup_plan_review_v1",
      originalPlan: plan,
      questionAnswers: plan.clarificationQuestions.map((question, index) => ({
        question: question.question,
        answer: answers[index]?.trim() ?? "",
      })),
      discrepancyDispositions: plan.discrepancies
        .map((_, index) => {
          const choice = dispositions[index];
          if (!choice) {
            return null;
          }

          return {
            discrepancyIndex: index,
            disposition: toReviewDisposition(choice),
            ...(notes[index]?.trim() ? { note: notes[index]?.trim() } : {}),
          };
        })
        .filter(
          (
            entry
          ): entry is {
            discrepancyIndex: number;
            disposition: "acknowledged" | "blocker";
            note?: string;
          } => entry !== null
        ),
    };

    onSubmit({
      decision,
      feedback: feedbackText.length > 0 ? feedbackText : null,
      review,
    });
  };

  const disableSubmit =
    submitting || hasEmptyAnswer || hasUndecidedDiscrepancies;
  const disableImprove = disableSubmit || feedback.trim().length === 0;

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }} data-testid="startup-plan-review">
      <Stack spacing={2}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
        >
          <Typography variant="h6">Startup Plan Review</Typography>
          {showBackButton && onBack ? (
            <Button
              type="button"
              variant="text"
              onClick={onBack}
              disabled={submitting}
            >
              Back
            </Button>
          ) : null}
        </Stack>

        {hasQuestions ? (
          <Stack spacing={1.5}>
            <Typography variant="subtitle1">Clarification Questions</Typography>
            {plan.clarificationQuestions.map((question, index) => (
              <Card
                key={`${question.question}-${String(index)}`}
                variant="outlined"
              >
                <CardContent>
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle2">
                      {question.question}
                    </Typography>
                    {question.reason ? (
                      <Typography variant="body2" color="text.secondary">
                        {question.reason}
                      </Typography>
                    ) : null}
                    <TextField
                      value={answers[index] ?? ""}
                      placeholder="Add your answer..."
                      multiline
                      minRows={3}
                      fullWidth
                      onChange={(event) => {
                        setAnswers((current) => {
                          const next = [...current];
                          next[index] = event.target.value;
                          return next;
                        });
                      }}
                    />
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        ) : null}

        {hasDiscrepancies ? (
          <Stack spacing={1.5}>
            <Typography variant="subtitle1">Discrepancies</Typography>
            {plan.discrepancies.map((discrepancy, index) => (
              <Card
                key={`${discrepancy.discrepancyText}-${String(index)}`}
                variant="outlined"
              >
                <CardContent>
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle2">
                      {discrepancy.discrepancyText}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Severity: {discrepancy.severity}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {discrepancy.reasoning}
                    </Typography>

                    <Stack spacing={0.75}>
                      <Typography variant="body2" color="text.secondary">
                        Disposition
                      </Typography>
                      <ButtonGroup
                        size="small"
                        variant="outlined"
                        aria-label="discrepancy disposition"
                      >
                        <Button
                          type="button"
                          variant={
                            dispositions[index] === "accept"
                              ? "contained"
                              : "outlined"
                          }
                          color="success"
                          onClick={() => {
                            setDispositions((current) => {
                              const next = [...current];
                              next[index] = "accept";
                              return next;
                            });
                          }}
                        >
                          Accept
                        </Button>
                        <Button
                          type="button"
                          variant={
                            dispositions[index] === "reject"
                              ? "contained"
                              : "outlined"
                          }
                          color="warning"
                          onClick={() => {
                            setDispositions((current) => {
                              const next = [...current];
                              next[index] = "reject";
                              return next;
                            });
                          }}
                        >
                          Reject
                        </Button>
                      </ButtonGroup>
                    </Stack>

                    <TextField
                      label="Note (optional)"
                      value={notes[index] ?? ""}
                      placeholder="Optional note for this discrepancy..."
                      multiline
                      minRows={2}
                      fullWidth
                      onChange={(event) => {
                        setNotes((current) => {
                          const next = [...current];
                          next[index] = event.target.value;
                          return next;
                        });
                      }}
                    />
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        ) : null}

        <Stack spacing={1.5}>
          <Typography variant="subtitle1">Plan Feedback</Typography>
          <TextField
            label="Feedback for plan updates"
            value={feedback}
            placeholder="What should be improved before implementation starts?"
            multiline
            minRows={4}
            fullWidth
            onChange={(event) => setFeedback(event.target.value)}
          />
        </Stack>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          alignItems={{ sm: "center" }}
        >
          <Button
            type="button"
            variant="contained"
            disabled={disableSubmit}
            onClick={() => handleSubmit("approve")}
          >
            {submitting ? "Submitting..." : "Approve Plan"}
          </Button>
          <Button
            type="button"
            variant="outlined"
            disabled={disableImprove}
            onClick={() => handleSubmit("improve")}
          >
            {submitting ? "Submitting..." : "Improve Plan"}
          </Button>
        </Stack>

        {hasEmptyAnswer ? (
          <Alert severity="info">
            Answer all clarification questions to continue.
          </Alert>
        ) : null}
        {hasUndecidedDiscrepancies ? (
          <Alert severity="info">
            Choose Accept or Reject for each discrepancy to continue.
          </Alert>
        ) : null}
        {!submitting && feedback.trim().length === 0 ? (
          <Alert severity="info">Add feedback to use Improve Plan.</Alert>
        ) : null}
      </Stack>
    </Paper>
  );
};
