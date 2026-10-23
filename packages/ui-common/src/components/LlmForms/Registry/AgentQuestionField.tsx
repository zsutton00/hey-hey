import {
  Alert,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  Radio,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React from "react";
import { type AgentQuestion, type AgentQuestionPayload } from "../../../api";
import { useSubmitControllerAuthorizedQuestionAnswer } from "../../../data/hooks/useSubmitControllerAuthorizedQuestionAnswer";
import type { FieldComponentProps, FieldConfig } from "./types";

const OTHER_OPTION = "__other__";
const MULTI_SELECT_SEPARATOR = ", ";

interface QuestionSelection {
  selected: string[];
  otherText: string;
}

interface AgentQuestionFieldConfig extends Omit<FieldConfig, "payload"> {
  payload: AgentQuestionPayload;
}

export interface AgentQuestionFieldProps extends Omit<
  FieldComponentProps<AgentQuestionPayload>,
  "config"
> {
  config: AgentQuestionFieldConfig;
}

const emptySelection = (): QuestionSelection => ({
  selected: [],
  otherText: "",
});

const resolveQuestionAnswer = (selection: QuestionSelection): string | null => {
  const otherText = selection.otherText.trim();
  const parts = selection.selected.flatMap((label) =>
    label === OTHER_OPTION ? (otherText ? [otherText] : []) : [label],
  );
  return parts.length > 0 ? parts.join(MULTI_SELECT_SEPARATOR) : null;
};

const toggleSelection = (
  question: AgentQuestion,
  selection: QuestionSelection,
  label: string,
): QuestionSelection => {
  if (!question.multiSelect) {
    return { ...selection, selected: [label] };
  }
  const selected = selection.selected.includes(label)
    ? selection.selected.filter((candidate) => candidate !== label)
    : [...selection.selected, label];
  return { ...selection, selected };
};

export const AgentQuestionField: React.FC<AgentQuestionFieldProps> = ({
  config,
  context,
  disabled = false,
  isSubmitted = false,
}) => {
  const { organizationId, projectId, agentSessionId } = context;
  const payload = config.payload;
  const { submit } = useSubmitControllerAuthorizedQuestionAnswer(
    organizationId,
    projectId,
    agentSessionId,
  );
  const [selections, setSelections] = React.useState<QuestionSelection[]>(() =>
    payload.questions.map(emptySelection),
  );
  const [submittedAnswers, setSubmittedAnswers] = React.useState<Record<
    string,
    string
  > | null>(null);
  const [isSending, setIsSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // The persisted answers are the source of truth; the local copy covers the
  // window before the message update round-trips.
  const resolvedAnswers = payload.answers ?? submittedAnswers;
  const answers = payload.questions.map((_, index) =>
    resolveQuestionAnswer(selections[index] ?? emptySelection()),
  );
  const isComplete = answers.every((answer) => answer !== null);
  const isLocked =
    disabled || isSubmitted || isSending || resolvedAnswers !== null;

  const updateSelection = (
    index: number,
    update: (selection: QuestionSelection) => QuestionSelection,
  ) => {
    setSelections((current) =>
      current.map((selection, candidate) =>
        candidate === index ? update(selection) : selection,
      ),
    );
  };

  const handleSubmit = async () => {
    if (isLocked || !isComplete) {
      return;
    }
    const answerRecord = Object.fromEntries(
      payload.questions.map((question, index) => [
        question.question,
        answers[index] as string,
      ]),
    );

    setError(null);
    setIsSending(true);
    try {
      await submit({
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        agentType: payload.agentType,
        answers: answerRecord,
        idempotencyToken: payload.idempotencyToken,
      });
      setSubmittedAnswers(answerRecord);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to send answers.",
      );
    } finally {
      setIsSending(false);
    }
  };

  if (resolvedAnswers) {
    return (
      <Stack
        spacing={1.5}
        data-testid={`agent-question-answered-${payload.requestId}`}
      >
        {payload.questions.map((question, index) => (
          <Stack key={`${question.question}-${String(index)}`} spacing={0.5}>
            {question.header ? (
              <Chip
                label={question.header}
                size="small"
                sx={{ alignSelf: "flex-start" }}
              />
            ) : null}
            <Typography variant="subtitle2">{question.question}</Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              data-testid={`agent-question-answer-${String(index)}`}
            >
              {resolvedAnswers[question.question] ?? "—"}
            </Typography>
          </Stack>
        ))}
      </Stack>
    );
  }

  return (
    <Stack
      spacing={2}
      data-testid={`agent-question-field-${payload.requestId}`}
    >
      {payload.questions.map((question, index) => {
        const selection = selections[index] ?? emptySelection();
        const Control = question.multiSelect ? Checkbox : Radio;
        const otherSelected = selection.selected.includes(OTHER_OPTION);
        return (
          <Stack
            key={`${question.question}-${String(index)}`}
            spacing={0.5}
            data-testid={`agent-question-${String(index)}`}
          >
            {question.header ? (
              <Chip
                label={question.header}
                size="small"
                sx={{ alignSelf: "flex-start" }}
              />
            ) : null}
            <Typography variant="subtitle2">{question.question}</Typography>
            {question.options.map((option) => (
              <FormControlLabel
                key={option.label}
                disabled={isLocked}
                control={
                  <Control
                    checked={selection.selected.includes(option.label)}
                    onChange={() => {
                      updateSelection(index, (current) =>
                        toggleSelection(question, current, option.label),
                      );
                    }}
                  />
                }
                label={
                  <Stack>
                    <Typography variant="body2">{option.label}</Typography>
                    {option.description ? (
                      <Typography variant="caption" color="text.secondary">
                        {option.description}
                      </Typography>
                    ) : null}
                  </Stack>
                }
              />
            ))}
            <FormControlLabel
              disabled={isLocked}
              control={
                <Control
                  checked={otherSelected}
                  onChange={() => {
                    updateSelection(index, (current) =>
                      toggleSelection(question, current, OTHER_OPTION),
                    );
                  }}
                />
              }
              label={<Typography variant="body2">Other</Typography>}
            />
            {otherSelected ? (
              <TextField
                size="small"
                placeholder="Type your answer"
                value={selection.otherText}
                disabled={isLocked}
                onChange={(event) => {
                  const otherText = event.target.value;
                  updateSelection(index, (current) => ({
                    ...current,
                    otherText,
                  }));
                }}
                inputProps={{
                  "data-testid": `agent-question-other-${String(index)}`,
                }}
              />
            ) : null}
          </Stack>
        );
      })}

      <Button
        variant="contained"
        sx={{ alignSelf: "flex-start" }}
        disabled={isLocked || !isComplete}
        onClick={() => {
          void handleSubmit();
        }}
        data-testid={`agent-question-submit-${payload.requestId}`}
      >
        Submit answers
      </Button>

      {error ? (
        <Alert
          severity="error"
          data-testid={`agent-question-error-${payload.requestId}`}
        >
          {error}
        </Alert>
      ) : null}
    </Stack>
  );
};
