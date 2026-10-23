import { AxiosError } from "axios";
import { useRef, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportProblemDialog } from "./ReportProblemDialog";

const { reportBugMock } = vi.hoisted(() => ({ reportBugMock: vi.fn() }));

vi.mock("@hey-hey/ui-common/clients", () => ({
  unifiedApiClient: { reportBug: reportBugMock },
}));

const Harness = ({ correlationId }: { correlationId?: string }) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={buttonRef} onClick={() => setOpen(true)}>
        Account menu
      </button>
      <ReportProblemDialog
        open={open}
        onClose={() => setOpen(false)}
        productLocation="/projects/project-1/features/feature-1?tab=details"
        correlationId={correlationId}
        returnFocusRef={buttonRef}
      />
    </>
  );
};

describe("ReportProblemDialog", () => {
  beforeEach(() => {
    reportBugMock.mockReset();
  });

  it("opens with predictable focus and enumerates only bounded context", async () => {
    const user = userEvent.setup();
    render(<Harness correlationId="correlation-123" />);

    await user.click(screen.getByRole("button", { name: "Account menu" }));

    expect(
      screen.getByRole("dialog", { name: "Report a problem" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("What happened? *")).toHaveFocus(),
    );
    expect(
      screen.getByText(
        "Product location: /projects/project-1/features/feature-1?tab=details",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Correlation identifier: correlation-123"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Include this product location and correlation identifier with my report.",
      ),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Account menu" })).toHaveFocus(),
    );
  });

  it("keeps validation visible until description and consent are supplied", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Account menu" }));

    await user.click(screen.getByRole("button", { name: "Submit report" }));

    expect(
      screen.getByText("Describe the problem before submitting."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Consent is required before submitting."),
    ).toBeInTheDocument();
    expect(reportBugMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Correlation identifier:/)).not.toBeInTheDocument();
  });

  it("submits once, preserves the exact contract, and confirms durable intake", async () => {
    const user = userEvent.setup();
    let resolveRequest: ((value: unknown) => void) | undefined;
    reportBugMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    render(<Harness correlationId="correlation-123" />);
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.type(screen.getByLabelText("What happened? *"), "Save failed.");
    await user.click(screen.getByRole("checkbox"));
    const submitButton = screen.getByRole("button", { name: "Submit report" });

    await user.dblClick(submitButton);

    expect(reportBugMock).toHaveBeenCalledTimes(1);
    expect(reportBugMock).toHaveBeenCalledWith({
      reportBugRequestDto: {
        description: "Save failed.",
        productLocation: "/projects/project-1/features/feature-1?tab=details",
        correlationId: "correlation-123",
        diagnosticConsent: true,
      },
    });
    expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();

    resolveRequest?.({
      data: {
        data: { bugId: "44444444-4444-4444-8444-444444444444" },
      },
    });
    expect(await screen.findByText("Your problem was reported.")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Submit report" }),
    ).not.toBeInTheDocument();
  });

  it("shows throttling as a failed submission and allows retry", async () => {
    const user = userEvent.setup();
    const throttledError = new AxiosError(
      "Too many requests",
      "429",
      undefined,
      undefined,
      { status: 429, data: {}, statusText: "Too Many Requests", headers: {}, config: {} },
    );
    reportBugMock
      .mockRejectedValueOnce(throttledError)
      .mockResolvedValueOnce({
        data: {
          data: { bugId: "44444444-4444-4444-8444-444444444444" },
        },
      });
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.type(screen.getByLabelText("What happened? *"), "Save failed.");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit report" }));

    expect(
      await screen.findByText(
        "You’ve submitted too many reports. Try again later.",
      ),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Your problem was reported.")).toBeVisible();
    expect(reportBugMock).toHaveBeenCalledTimes(2);
  });
});
