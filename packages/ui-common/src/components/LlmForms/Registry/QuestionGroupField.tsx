import { Box, Typography } from "@mui/material";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type {
  QuestionsGroupPayload,
  QuestionsGroupUserMessage,
} from "../../../api";
import { QuestionGroup, type QuestionAnswer } from "../../QuestionGroup";
import { SmarterTextAreaCard } from "../../SmarterTextAreaCard";
import type { FieldComponentProps } from "./types";

export interface QuestionGroupFieldProps extends Omit<
  FieldComponentProps<QuestionsGroupUserMessage>,
  "onChange"
> {
  value?: QuestionsGroupUserMessage;
  onChange?: (value: QuestionsGroupUserMessage) => void;
}

export const isQuestionsGroupPayload = (
  payload: unknown,
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
    [payload],
  );

  const conversationReply = isQuestionsGroupPayload(payload)
    ? payload.conversationReply
    : undefined;

  const [fieldValue, setFieldValue] = useState<QuestionsGroupUserMessage>(
    () => value ?? { clarifyingAnswers: [] },
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
        ...fieldValue,
        clarifyingAnswers: answers,
      };
      setFieldValue(newValue);
      onChange?.(newValue);
    },
    [fieldValue, onChange],
  );

  const handleNoteChange = useCallback(
    (note: string) => {
      const newValue: QuestionsGroupUserMessage = { ...fieldValue, note };
      setFieldValue(newValue);
      onChange?.(newValue);
    },
    [fieldValue, onChange],
  );

  const noteField = conversationReply ? (
    <SmarterTextAreaCard
      value={fieldValue.note ?? ""}
      onChange={handleNoteChange}
      headerText={conversationReply.noteLabel}
      placeholder={conversationReply.notePlaceholder}
      disabled={disabled || isSubmitted}
      saveStatus={disabled || isSubmitted ? "complete" : "draft"}
      saveMode={null}
      hasUnsavedChanges={false}
      minRows={2}
      maxRows={6}
      multiline={true}
      headerSx={{ pb: "5px" }}
    />
  ) : null;

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
        {noteField}
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
      {noteField}

      {error && (
        <Typography variant="body2" color="error" sx={{ mt: 1 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
};
