import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestionGroupField } from "./QuestionGroupField";
import type { FieldComponentContext, FieldConfig } from "./types";

vi.mock("../../SmarterTextAreaCard", () => ({
  SmarterTextAreaCard: ({
    value,
    onChange,
    headerText,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    headerText: string;
    placeholder: string;
  }) => (
    <label>
      {headerText}
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  ),
}));

const context = {
  conversationId: "conversation",
  projectId: "project",
  organizationId: "organization",
  interaction: {},
} as FieldComponentContext;

describe("QuestionGroupField repository Feature enrichment compatibility", () => {
  it("renders three generated questions and preserves answer order", async () => {
    const onChange = vi.fn();
    const questions = [
      "Who uses the import review?",
      "Which detail is authoritative?",
      "What remains uncertain?",
    ];
    const config: FieldConfig = {
      field: "repository_feature_enrichment_questions",
      description: "Feature details",
      type: "question_group",
      payload: { questions },
    };

    render(
      <QuestionGroupField
        config={config}
        context={context}
        onChange={onChange}
        isSubmitted={false}
      />
    );

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        clarifyingAnswers: questions.map((question) => ({
          question,
          answer: "",
        })),
      })
    );

    const inputs = screen.getAllByPlaceholderText("Add your answer...");
    fireEvent.change(inputs[0], { target: { value: "Operators" } });
    expect(onChange).toHaveBeenLastCalledWith({
      clarifyingAnswers: [
        { question: questions[0], answer: "Operators" },
        { question: questions[1], answer: "" },
        { question: questions[2], answer: "" },
      ],
    });
  });
});
