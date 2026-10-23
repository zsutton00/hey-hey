import React, { memo, useCallback, useMemo } from "react";
import { SmarterTextAreaCard } from "./SmarterTextAreaCard";

export interface QuestionAnswer {
  question: string;
  answer: string;
}

export interface QuestionGroupProps {
  questions: string[];
  answers: QuestionAnswer[];
  onChange: (answers: QuestionAnswer[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

const QuestionGroupComponent: React.FC<QuestionGroupProps> = ({
  questions,
  answers,
  onChange,
  disabled = false,
  placeholder = "Add your answer...",
}) => {
  const mergedAnswers = useMemo(() => {
    const answerMap = new Map(
      answers.map((answer) => [answer.question, answer.answer])
    );
    return questions.map((question) => ({
      question,
      answer: answerMap.get(question) ?? "",
    }));
  }, [answers, questions]);

  const handleChange = useCallback(
    (question: string, value: string) => {
      const updatedAnswers = mergedAnswers.map((item) =>
        item.question === question ? { ...item, answer: value } : item
      );
      onChange(updatedAnswers);
    },
    [mergedAnswers, onChange]
  );

  return (
    <>
      {mergedAnswers.map((item) => (
        <SmarterTextAreaCard
          key={item.question}
          value={item.answer}
          onChange={(nextValue) => handleChange(item.question, nextValue)}
          headerText={item.question}
          placeholder={placeholder}
          saveStatus={disabled ? "complete" : "draft"}
          saveMode={null}
          hasUnsavedChanges={!disabled}
          isSaving={false}
          minInputHeight="60px"
          disabled={disabled}
          minRows={2}
          maxRows={6}
          multiline={true}
          headerSx={{ pb: "5px" }}
        />
      ))}
    </>
  );
};

export const QuestionGroup = memo(QuestionGroupComponent);
