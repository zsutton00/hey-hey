import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalStatus } from "../../api";
import { ProposalStatusPresentation } from "../ProposalStatusPresentation";

const originalMatchMedia = window.matchMedia;

const setViewport = (matches: boolean): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

describe("ProposalStatusPresentation", () => {
  beforeEach(() => setViewport(false));

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("renders status labels on wider layouts", () => {
    render(
      <ProposalStatusPresentation
        status={ProposalStatus.Approved}
        data-testid="approved-status"
      />
    );

    expect(screen.getByText("Approved")).toBeVisible();
    expect(screen.getByTestId("approved-status")).toHaveAttribute(
      "aria-label",
      "Approved"
    );
  });

  it("uses accessible icon-only statuses for approved and rejected mobile rows", () => {
    setViewport(true);
    render(
      <>
        <ProposalStatusPresentation
          status={ProposalStatus.Approved}
          data-testid="approved-status"
        />
        <ProposalStatusPresentation
          status={ProposalStatus.Rejected}
          data-testid="rejected-status"
        />
      </>
    );

    expect(screen.getByTestId("approved-status")).toHaveAttribute(
      "aria-label",
      "Approved"
    );
    expect(screen.getByTestId("rejected-status")).toHaveAttribute(
      "aria-label",
      "Rejected"
    );
    expect(screen.getByTestId("approved-status")).toHaveStyle({
      borderRadius: "50%",
      padding: "0px",
    });
    expect(screen.queryByText("Approved")).not.toBeInTheDocument();
    expect(screen.queryByText("Rejected")).not.toBeInTheDocument();
  });
});
