import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  history: vi.fn(),
  retry: vi.fn(),
  report: vi.fn(),
}));
vi.mock("../../data/hooks/useProjectReportHistory", () => ({
  useProjectReportHistory: mocks.history,
}));
vi.mock("../../data/hooks/useCreateProjectReportRequest", () => ({
  useRetryProjectReportRequest: () => ({
    mutate: mocks.retry,
    isPending: false,
    isError: false,
  }),
}));
vi.mock("../../data/hooks/useReport", () => ({ useReport: mocks.report }));
import { ProjectReportHistory } from "./ProjectReportHistory";

describe("ProjectReportHistory", () => {
  beforeEach(() => {
    mocks.history.mockReset();
    mocks.retry.mockReset().mockResolvedValue({});
    mocks.report.mockReturnValue({
      data: { title: "Saved weekly report" },
      isLoading: false,
    });
  });

  it("opens only the persisted report identity and retries the latest failed attempt", async () => {
    const refetch = vi.fn();
    mocks.history.mockReturnValue({
      page: {
        total: 3,
        entries: [
          {
            type: "SAVED_REPORT",
            reportId: "saved-report",
            createdAt: "2026-10-01T12:00:00Z",
          },
          {
            type: "REQUEST",
            requestId: "request-id",
            kind: "PROJECT_REPORT",
            submission: {
              question: "What changed this week?",
              scope: {},
              exclusions: [],
              launch: {},
              idempotencyKey: "original-key",
            },
            status: "FAILED",
            latestAttempt: {
              id: "attempt-id",
              attemptNumber: 2,
              status: "FAILED",
              idempotencyKey: "attempt-key",
              createdAt: "2026-10-01T12:00:00Z",
              failure: {
                stage: "GENERATION",
                code: "GENERATION_FAILED",
                message: "Generation did not finish.",
                retryable: true,
              },
            },
            createdAt: "2026-10-01T11:00:00Z",
          },
          {
            type: "REQUEST",
            requestId: "completed-request",
            kind: "PROJECT_REPORT",
            submission: {
              question: "Summarize the month.",
              scope: {},
              exclusions: [],
              launch: {},
              idempotencyKey: "completed-key",
            },
            status: "COMPLETED",
            latestAttempt: {
              id: "completed-attempt",
              attemptNumber: 1,
              status: "COMPLETED",
              idempotencyKey: "completed-attempt-key",
              createdAt: "2026-10-01T12:00:00Z",
              reportId: "completed-report",
            },
            createdAt: "2026-10-01T10:00:00Z",
          },
        ],
      },
      isFetched: true,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch,
    });
    render(
      <MemoryRouter>
        <ProjectReportHistory
          organizationId="org"
          projectId="project"
          offset={0}
          onOffsetChange={vi.fn()}
          onCreate={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("What changed this week?")).toBeInTheDocument();
    expect(screen.getByText("Generation did not finish.")).toBeInTheDocument();
    const reportLinks = screen.getAllByRole("link", {
      name: "Saved weekly report",
    });
    expect(reportLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/projects/project/reports/saved-report",
      "/projects/project/reports/completed-report",
    ]);
    expect(
      screen.queryByRole("button", { name: "Open report" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry report" }));

    await waitFor(() =>
      expect(mocks.retry).toHaveBeenCalledWith({
        organizationId: "org",
        projectId: "project",
        requestId: "request-id",
        retry: expect.objectContaining({ expectedAttemptId: "attempt-id" }),
      }),
    );
    expect(mocks.retry.mock.calls[0][0].retry.idempotencyKey).not.toBe(
      "original-key",
    );
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });
});
