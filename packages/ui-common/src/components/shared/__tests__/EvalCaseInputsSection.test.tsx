import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { EvalCaseInputsSection } from "../EvalCaseInputsSection";

const text = (value: string) => ({ kind: "text_message", text: value });
const section = (...inputs: object[]) => JSON.stringify({ inputs });

const renderEditor = (content: string) => {
  const onChange = vi.fn();
  render(<EvalCaseInputsSection content={content} onChange={onChange} />);
  return onChange;
};
const lastSaved = (onChange: ReturnType<typeof vi.fn>) =>
  JSON.parse(onChange.mock.calls.at(-1)![0]);

describe("EvalCaseInputsSection", () => {
  it("numbers several messages and marks only the last as judged", () => {
    render(
      <EvalCaseInputsSection
        content={section(text("First"), text("Second"), text("Third"))}
      />,
    );

    expect(screen.getByTestId("inputs-list").tagName).toBe("OL");
    expect(screen.getAllByTestId("input-judged-badge")).toHaveLength(1);
    expect(
      screen
        .getByTestId("input-3")
        .querySelector('[data-testid="input-judged-badge"]'),
    ).not.toBeNull();
    expect(screen.queryByTestId("input-1-edit")).toBeNull();
  });

  it("shows one message as a plain Request without numbering or a judged marker", () => {
    renderEditor(section(text("Only")));

    expect(screen.getByTestId("case-request-single")).toBeInTheDocument();
    expect(screen.queryByTestId("inputs-list")).toBeNull();
    expect(screen.queryByTestId("input-judged-badge")).toBeNull();
    expect(screen.getByTestId("single-input-remove")).toBeDisabled();
    expect(screen.getByTestId("inputs-empty-error")).toBeInTheDocument();
  });

  it("adds, edits, cancels, reorders and removes messages", () => {
    const onChange = renderEditor(section(text("A"), text("B")));

    fireEvent.click(screen.getByTestId("input-1-down"));
    expect(lastSaved(onChange)).toEqual({ inputs: [text("B"), text("A")] });

    fireEvent.click(screen.getByTestId("input-2-remove"));
    expect(lastSaved(onChange)).toEqual({ inputs: [text("A")] });

    fireEvent.click(screen.getByTestId("input-1-edit"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "A2" } });
    fireEvent.click(screen.getByText("eval.case.inputs.cancel"));
    expect(onChange).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId("input-1-edit"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "A2" } });
    fireEvent.click(screen.getByText("eval.case.inputs.done"));
    expect(lastSaved(onChange)).toEqual({ inputs: [text("A2"), text("B")] });

    fireEvent.click(screen.getByTestId("add-input"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "C" } });
    fireEvent.click(screen.getByText("eval.case.inputs.done"));
    expect(lastSaved(onChange)).toEqual({
      inputs: [text("A"), text("B"), text("C")],
    });
  });

  it("will not save a blank message, so the list can't be emptied by editing", () => {
    const onChange = renderEditor(section(text("A"), text("B")));

    fireEvent.click(screen.getByTestId("add-input"));
    expect(screen.getByText("eval.case.inputs.done")).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  " } });
    expect(screen.getByText("eval.case.inputs.done")).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("carries an input of an unknown kind through edits untouched", () => {
    const future = { kind: "button_response", label: "Approve", extra: 1 };
    const onChange = renderEditor(section(text("A"), future));

    expect(screen.getByTestId("input-2-edit")).toBeDisabled();
    fireEvent.click(screen.getByTestId("input-1-edit"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "A2" } });
    fireEvent.click(screen.getByText("eval.case.inputs.done"));

    expect(lastSaved(onChange)).toEqual({ inputs: [text("A2"), future] });
  });
});
