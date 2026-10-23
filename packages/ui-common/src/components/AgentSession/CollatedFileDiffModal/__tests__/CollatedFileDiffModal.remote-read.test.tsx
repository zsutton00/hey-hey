import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CollatedFileDiffModal } from "../CollatedFileDiffModal";

const readyServiceNames = {
  status: "ready" as const,
  serviceNamesById: new Map<string, string>(),
};

describe("CollatedFileDiffModal remote read states", () => {
  it("renders loading without presenting an empty result", () => {
    render(
      <CollatedFileDiffModal
        open
        onClose={vi.fn()}
        entries={[]}
        selectedIdentity={null}
        onSelect={vi.fn()}
        detail={null}
        detailState={{ status: "loading" }}
        onRetryDetail={vi.fn()}
        readState={{ status: "loading" }}
        onRetry={vi.fn()}
        serviceNamesState={readyServiceNames}
      />
    );

    expect(screen.getByText("Loading changed files…")).toBeVisible();
    expect(
      screen.queryByTestId("collated-file-diff-modal-empty-state")
    ).not.toBeInTheDocument();
  });

  it("renders the typed read error and retries on demand", async () => {
    const onRetry = vi.fn();
    render(
      <CollatedFileDiffModal
        open
        onClose={vi.fn()}
        entries={[]}
        selectedIdentity={null}
        onSelect={vi.fn()}
        detail={null}
        detailState={{ status: "loading" }}
        onRetryDetail={vi.fn()}
        readState={{ status: "error", message: "The CLI read timed out." }}
        onRetry={onRetry}
        serviceNamesState={readyServiceNames}
      />
    );

    expect(screen.getByText("The CLI read timed out.")).toBeVisible();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders a defined empty state for a successful empty response", () => {
    render(
      <CollatedFileDiffModal
        open
        onClose={vi.fn()}
        entries={[]}
        selectedIdentity={null}
        onSelect={vi.fn()}
        detail={null}
        detailState={{ status: "loading" }}
        onRetryDetail={vi.fn()}
        readState={{ status: "ready" }}
        onRetry={vi.fn()}
        serviceNamesState={readyServiceNames}
      />
    );

    expect(
      screen.getByText("No changed files are available for this run.")
    ).toBeVisible();
  });
});
