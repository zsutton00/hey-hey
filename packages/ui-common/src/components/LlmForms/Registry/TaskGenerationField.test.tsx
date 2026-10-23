import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TaskGenerationField } from "./TaskGenerationField";
import type { FieldConfig } from "./types";
import type { SmartTextAreaCardProps } from "../../SmartTextAreaCard";

vi.mock("../../SmartTextAreaCard", () => ({
  SmartTextAreaCard: ({
    value,
    onChange,
    disabled,
    placeholder,
  }: SmartTextAreaCardProps) => (
    <div>
      <textarea
        data-testid="task-generation-textarea"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
      />
    </div>
  ),
}));

const mockConfig: FieldConfig = {
  field: "test-field",
  description: "Test task generation field",
  type: "task_generation",
  required: false,
  placeholder: "Enter your message...",
};

const mockContext = {
  conversationId: "test-conversation",
  projectId: "test-project",
  organizationId: "test-org",
};

describe("TaskGenerationField", () => {
  it("should render the component with description", () => {
    render(
      <TaskGenerationField
        config={mockConfig}
        isSubmitted={false}
        context={mockContext}
      />
    );

    expect(screen.getByText(mockConfig.description!)).toBeInTheDocument();
    expect(
      screen.getByTestId(`task-generation-field-${mockConfig.field}`)
    ).toBeInTheDocument();
  });

  it("should render with default description when not provided", () => {
    const configWithoutDescription = { ...mockConfig, description: "" };
    render(
      <TaskGenerationField
        config={configWithoutDescription}
        isSubmitted={false}
        context={mockContext}
      />
    );

    expect(
      screen.getByText(
        "I can help you generate tasks or just talk them through..."
      )
    ).toBeInTheDocument();
  });

  it("should render text area and buttons", () => {
    render(
      <TaskGenerationField
        config={mockConfig}
        isSubmitted={false}
        context={mockContext}
      />
    );

    expect(screen.getByTestId("task-generation-textarea")).toBeInTheDocument();
  });

  it("should handle text input changes", () => {
    const mockOnChange = vi.fn();
    render(
      <TaskGenerationField
        config={mockConfig}
        onChange={mockOnChange}
        isSubmitted={false}
        context={mockContext}
      />
    );

    const input = screen.getByTestId("task-generation-textarea");
    fireEvent.change(input, { target: { value: "Test message" } });

    expect(mockOnChange).toHaveBeenCalledWith("Test message");
  });

  it("should render submitted message with empty placeholder when submitted", () => {
    render(
      <TaskGenerationField
        config={mockConfig}
        value="Submitted message"
        isSubmitted={true}
        context={mockContext}
      />
    );

    expect(screen.getByDisplayValue("Submitted message")).toBeInTheDocument();
    expect(screen.getByTestId("task-generation-textarea")).toHaveAttribute(
      "placeholder",
      ""
    );
  });
});
