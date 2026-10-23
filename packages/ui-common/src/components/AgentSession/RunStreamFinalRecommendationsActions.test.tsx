import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RunStreamFinalRecommendationsActions } from "./RunStreamFinalRecommendationsActions";

const buildProps = () => ({
  syncing: false,
  requestingCodeReview: false,
  requestingCommit: false,
  notice: null,
  onSync: vi.fn(),
  onRequestCodeReview: vi.fn(),
  onRequestCommit: vi.fn(),
});

describe("RunStreamFinalRecommendationsActions", () => {
  it("renders cross-service action only when enabled", () => {
    const props = buildProps();
    const { rerender } = render(
      <RunStreamFinalRecommendationsActions {...props} />
    );

    expect(
      screen.queryByTestId("run-stream-cross-service-review-submit")
    ).not.toBeInTheDocument();

    rerender(
      <RunStreamFinalRecommendationsActions
        {...props}
        showCrossServiceReviewAction
        onStartCrossServiceReview={vi.fn()}
      />
    );

    expect(
      screen.getByTestId("run-stream-cross-service-review-submit")
    ).toBeInTheDocument();
  });

  it("invokes cross-service action callback", () => {
    const onStartCrossServiceReview = vi.fn();

    render(
      <RunStreamFinalRecommendationsActions
        {...buildProps()}
        showCrossServiceReviewAction
        onStartCrossServiceReview={onStartCrossServiceReview}
      />
    );

    fireEvent.click(
      screen.getByTestId("run-stream-cross-service-review-submit")
    );

    expect(onStartCrossServiceReview).toHaveBeenCalledTimes(1);
  });

  it("invokes request commit callback", () => {
    const onRequestCommit = vi.fn();

    render(
      <RunStreamFinalRecommendationsActions
        {...buildProps()}
        onRequestCommit={onRequestCommit}
      />
    );

    fireEvent.click(screen.getByTestId("run-stream-commit-submit"));

    expect(onRequestCommit).toHaveBeenCalledTimes(1);
  });

  it("renders cross-service notice and error text", () => {
    render(
      <RunStreamFinalRecommendationsActions
        {...buildProps()}
        showCrossServiceReviewAction
        onStartCrossServiceReview={vi.fn()}
        crossServiceReviewNotice="Session created"
        crossServiceReviewError="Missing mapping"
      />
    );

    expect(screen.getByText("Session created")).toBeInTheDocument();
    expect(screen.getByText("Missing mapping")).toBeInTheDocument();
  });

  it("shows loading text only for the action in flight", () => {
    render(
      <RunStreamFinalRecommendationsActions
        {...buildProps()}
        requestingCodeReview
        requestingCommit={false}
      />
    );

    expect(screen.getByText("Requesting code review...")).toBeInTheDocument();
    expect(screen.getByText("Request commit")).toBeInTheDocument();
    expect(screen.queryByText("Requesting commit...")).not.toBeInTheDocument();
  });

  it("renders all secondary action buttons on mount", () => {
    render(<RunStreamFinalRecommendationsActions {...buildProps()} />);

    expect(
      screen.getByTestId("run-stream-action-sync_with_hey_hey")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("run-stream-action-request_code_review")
    ).toBeInTheDocument();
    expect(screen.getByTestId("run-stream-commit-submit")).toBeInTheDocument();
  });

  it("invokes sync callback through secondary action", async () => {
    const onSync = vi.fn();

    render(
      <RunStreamFinalRecommendationsActions {...buildProps()} onSync={onSync} />
    );

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("run-stream-action-sync_with_hey_hey")
      );
    });

    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it("renders notice as an alert when present", () => {
    render(
      <RunStreamFinalRecommendationsActions
        {...buildProps()}
        notice="Final assessment prompt submitted."
      />
    );

    expect(
      screen.getByTestId("run-stream-final-recommendations-notice")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Final assessment prompt submitted.")
    ).toBeInTheDocument();
  });
});
