import { Box, Typography } from "@mui/material";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type {
  QuestionsGroupPayload,
  QuestionsGroupUserMessage,
} from "../../../api";
import { QuestionGroup, type QuestionAnswer } from "../../QuestionGroup";
import type { FieldComponentProps } from "./types";

export interface QuestionGroupFieldProps
  extends Omit<FieldComponentProps<QuestionsGroupUserMessage>, "onChange"> {
  value?: QuestionsGroupUserMessage;
  onChange?: (value: QuestionsGroupUserMessage) => void;
}

const isQuestionsGroupPayload = (
  payload: unknown
): payload is QuestionsGroupPayload =>
  payload !== null &&
  typeof payload === "object" &&
  "questions" in payload &&
  Array.isArray((payload as QuestionsGroupPayload).questions);

export const QuestionGroupField: React.FC<QuestionGroupFieldProps> = ({
  config,
  value,
  onChange,
  error,
  disabled = false,
  isSubmitted = false,
}) => {
  const payload = config.payload;
  const questions = useMemo(
    () => (isQuestionsGroupPayload(payload) ? payload.questions : []),
    [payload]
  );

  const [fieldValue, setFieldValue] = useState<QuestionsGroupUserMessage>(
    () => value ?? { clarifyingAnswers: [] }
  );

  useEffect(() => {
    if (
      questions.length > 0 &&
      (!fieldValue.clarifyingAnswers ||
        fieldValue.clarifyingAnswers.length === 0)
    ) {
      const initialValue: QuestionsGroupUserMessage = {
        clarifyingAnswers: questions.map((q) => ({
          question: q,
          answer: "",
        })),
      };
      setFieldValue(initialValue);
      onChange?.(initialValue);
    }
  }, [questions, fieldValue.clarifyingAnswers, onChange]);

  const handleAnswersChange = useCallback(
    (answers: QuestionAnswer[]) => {
      const newValue: QuestionsGroupUserMessage = {
        clarifyingAnswers: answers,
      };
      setFieldValue(newValue);
      onChange?.(newValue);
    },
    [onChange]
  );

  if (questions.length === 0) {
    return (
      <Box sx={{ p: 2, color: "error.main" }}>
        <Typography>Error: No questions provided</Typography>
      </Box>
    );
  }

  if (isSubmitted) {
    return (
      <Box sx={{ mb: 2 }}>
        <QuestionGroup
          questions={questions}
          answers={fieldValue.clarifyingAnswers ?? []}
          onChange={() => {}}
          disabled
        />
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 2 }} data-testid={`question-group-field-${config.field}`}>
      <QuestionGroup
        questions={questions}
        answers={fieldValue.clarifyingAnswers ?? []}
        onChange={handleAnswersChange}
        disabled={disabled}
      />

      {error && (
        <Typography variant="body2" color="error" sx={{ mt: 1 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
};
