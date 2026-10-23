import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DueDateSelector } from "../DueDateSelector";

vi.mock("@mui/x-date-pickers/DatePicker", () => ({
  DatePicker: ({
    value,
    onChange,
    open,
    slotProps,
  }: {
    value: Date | null;
    onChange: (value: Date | null) => void;
    open: boolean;
    slotProps: {
      textField: {
        onFocus: () => void;
        onClick: () => void;
        helperText?: string;
        InputProps?: { endAdornment?: React.ReactNode };
      };
    };
  }) => (
    <div>
      <input
        aria-label="Due Date"
        data-open={String(open)}
        value={value?.toISOString().slice(0, 10) ?? ""}
        onChange={() => undefined}
        onFocus={slotProps.textField.onFocus}
        onClick={slotProps.textField.onClick}
      />
      {slotProps.textField.InputProps?.endAdornment}
      <span>{slotProps.textField.helperText}</span>
      <button type="button" onClick={() => onChange(new Date(2026, 7, 20))}>
        Select date
      </button>
      <button type="button" onClick={() => onChange(null)}>
        Picker clear
      </button>
    </div>
  ),
}));

describe("DueDateSelector", () => {
  it("opens immediately for focus and pointer activation", async () => {
    const user = userEvent.setup();
    render(<DueDateSelector value={null} onChange={vi.fn()} />);

    const input = screen.getByRole("textbox", { name: "Due Date" });
    await user.tab();
    expect(input).toHaveAttribute("data-open", "true");

    await user.click(input);
    expect(input).toHaveAttribute("data-open", "true");
  });

  it("synchronizes the displayed date when the controlled value changes", () => {
    const { rerender } = render(
      <DueDateSelector value="2026-08-13" onChange={vi.fn()} />
    );

    expect(screen.getByRole("textbox", { name: "Due Date" })).toHaveValue(
      "2026-08-13"
    );

    rerender(<DueDateSelector value="2026-09-02" onChange={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "Due Date" })).toHaveValue(
      "2026-09-02"
    );
  });

  it("forwards replacements but rejects clears when the date is required", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DueDateSelector
        value="2026-08-13"
        onChange={onChange}
        allowClear={false}
      />
    );

    expect(
      screen.queryByRole("button", { name: "Clear due date" })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Picker clear" }));
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Select date" }));
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 7, 20).toISOString());
  });
  it("supports setting, changing and clearing an optional target date", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <DueDateSelector
        value={null}
        onChange={onChange}
      />,
    );
    expect(screen.queryByTestId("due-date-clear")).not.toBeInTheDocument();
    await user.click(screen.getByRole("textbox"));
    expect(screen.getByRole("textbox")).toHaveAttribute("data-open", "true");
    await user.click(screen.getByRole("button", { name: "Select date" }));
    expect(onChange).toHaveBeenLastCalledWith(
      new Date(2026, 7, 20).toISOString(),
    );
    rerender(
      <DueDateSelector
        value="2026-08-20"
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("textbox"));
    await user.click(screen.getByRole("button", { name: "Select date" }));
    expect(screen.queryByText(/Due in|Due today|Due tomorrow|days overdue/)).not.toBeInTheDocument();
    expect(screen.getByTestId("due-date-clear")).toHaveAccessibleName("Clear due date");
    await user.click(screen.getByTestId("due-date-clear"));
    expect(onChange).toHaveBeenLastCalledWith(null);
    rerender(
      <DueDateSelector
        value={null}
        onChange={onChange}
      />,
    );
    expect(screen.queryByTestId("due-date-clear")).not.toBeInTheDocument();
  });
});

it("hides inline clear while disabled and preserves explicit helper text", () => {
  render(<DueDateSelector value="2026-08-20" onChange={vi.fn()} disabled helperText="Date guidance" />);
  expect(screen.queryByTestId("due-date-clear")).not.toBeInTheDocument();
  expect(screen.getByText("Date guidance")).toBeInTheDocument();
});
