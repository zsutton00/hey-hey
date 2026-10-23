import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CliAvailabilityIndicator } from "../CliAvailabilityIndicator";

describe("CliAvailabilityIndicator", () => {
  it("shows loading spinner when status is loading", () => {
    render(
      <CliAvailabilityIndicator
        status="loading"
        error={null}
        onSync={vi.fn()}
      />
    );
    expect(screen.getByText("Checking CLI availability…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("shows Think with Code button when available", () => {
    render(
      <CliAvailabilityIndicator
        status="available"
        error={null}
        onSync={vi.fn()}
      />
    );
    expect(screen.getByTestId("think-with-code-button")).toBeInTheDocument();
    expect(screen.getByText("Think with Code")).toBeInTheDocument();
  });

  it("calls onSync when button is clicked", async () => {
    const onSync = vi.fn();
    render(
      <CliAvailabilityIndicator
        status="available"
        error={null}
        onSync={onSync}
      />
    );
    await userEvent.click(screen.getByTestId("think-with-code-button"));
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it("disables button when syncDisabled is true", () => {
    render(
      <CliAvailabilityIndicator
        status="available"
        error={null}
        onSync={vi.fn()}
        syncDisabled
      />
    );
    expect(screen.getByTestId("think-with-code-button")).toBeDisabled();
  });

  it("renders nothing when unavailable", () => {
    const { container } = render(
      <CliAvailabilityIndicator
        status="unavailable"
        error={null}
        onSync={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows error alert with guidance when status is error", () => {
    render(
      <CliAvailabilityIndicator
        status="error"
        error="Connection timeout"
        onSync={vi.fn()}
      />
    );
    expect(screen.getByText(/Unable to detect CLI/)).toBeInTheDocument();
    expect(screen.getByText(/Connection timeout/)).toBeInTheDocument();
    expect(screen.getByText(/pnpm dev/)).toBeInTheDocument();
  });

  it("shows error alert without specific error message", () => {
    render(
      <CliAvailabilityIndicator status="error" error={null} onSync={vi.fn()} />
    );
    expect(screen.getByText(/Unable to detect CLI/)).toBeInTheDocument();
  });
});
