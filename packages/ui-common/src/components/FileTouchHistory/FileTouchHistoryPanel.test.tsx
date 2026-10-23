import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileTouchHistoryPanel } from "./FileTouchHistoryPanel";
import type { FileTaskHistoryState } from "../../data/hooks/useFileTouchHistory";

const { useFileTaskHistoryMock } = vi.hoisted(() => ({
  useFileTaskHistoryMock: vi.fn<() => FileTaskHistoryState>(),
}));

vi.mock("../../data/hooks/useFileTouchHistory", () => ({
  useFileTaskHistory: useFileTaskHistoryMock,
}));

const renderPanel = (onClose = vi.fn()) =>
  render(
    <MemoryRouter>
      <FileTouchHistoryPanel
        open
        onClose={onClose}
        organizationId="org-1"
        projectId="project-1"
        serviceId="service-1"
        normalizedPath="src/index.ts"
      />
    </MemoryRouter>
  );

describe("FileTouchHistoryPanel", () => {
  beforeEach(() => {
    useFileTaskHistoryMock.mockReset();
  });

  it("links every matching task by title and closes on navigation", () => {
    useFileTaskHistoryMock.mockReturnValue({
      status: "ready",
      isFetching: false,
      entries: [
        {
          taskId: "opaque-task-identifier",
          taskName: "Add file history",
          taskType: "STANDARD",
          directFeatureId: "feature-1",
          directFeatureName: "Work Item Page",
          touchCount: 2,
          firstTouchedAt: "2026-08-01T00:00:00.000Z",
          lastTouchedAt: "2026-08-02T00:00:00.000Z",
          evidence: [
            {
              reportId: "report-1",
              agentSessionId: "session-1",
              agentSessionTitle: "Implement file history",
              createdAt: "2026-08-01T00:00:00.000Z",
            },
            {
              reportId: "report-2",
              agentSessionId: "session-2",
              agentSessionTitle: "Verify file history",
              createdAt: "2026-08-02T00:00:00.000Z",
            },
          ],
        },
      ],
    });

    const onClose = vi.fn();
    renderPanel(onClose);

    const taskLink = screen.getByRole("link", { name: "Add file history" });
    expect(taskLink).toHaveAttribute(
      "href",
      "/projects/project-1/tasks/opaque-task-identifier"
    );
    expect(taskLink).toHaveAttribute(
      "data-testid",
      "file-task-history-task-link"
    );
    fireEvent.click(taskLink);
    expect(onClose).toHaveBeenCalledOnce();
    expect(
      screen.queryByText("opaque-task-identifier")
    ).not.toBeInTheDocument();
    expect(screen.getByText("STANDARD · 2 touches")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Implement file history" })
    ).toHaveAttribute(
      "href",
      "/projects/project-1/resolve-agent-session-by-id/session-1"
    );
    expect(
      screen.getByRole("link", { name: "Verify file history" })
    ).toHaveAttribute(
      "href",
      "/projects/project-1/resolve-agent-session-by-id/session-2"
    );
    expect(screen.queryByText(/report-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/session-1/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/persisted IMPLEMENT report evidence/)
    ).not.toBeInTheDocument();
    expect(useFileTaskHistoryMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      serviceId: "service-1",
      normalizedPath: "src/index.ts",
      active: true,
    });
  });

  it("renders explicit loading, empty, and error states", () => {
    useFileTaskHistoryMock.mockReturnValue({
      status: "loading",
      entries: [],
      isFetching: true,
    });
    const { rerender } = renderPanel();
    expect(screen.getByLabelText("Loading task history")).toBeInTheDocument();

    useFileTaskHistoryMock.mockReturnValue({
      status: "empty",
      entries: [],
      isFetching: false,
    });
    rerender(
      <FileTouchHistoryPanel
        open
        onClose={vi.fn()}
        organizationId="org-1"
        projectId="project-1"
        serviceId="service-1"
        normalizedPath="src/index.ts"
      />
    );
    expect(
      screen.getByText("No tasks have historical evidence for this file.")
    ).toBeInTheDocument();

    useFileTaskHistoryMock.mockReturnValue({
      status: "error",
      entries: [],
      isFetching: false,
      error: new Error("history unavailable"),
    });
    rerender(
      <FileTouchHistoryPanel
        open
        onClose={vi.fn()}
        organizationId="org-1"
        projectId="project-1"
        serviceId="service-1"
        normalizedPath="src/index.ts"
      />
    );
    expect(screen.getByText(/history unavailable/)).toBeInTheDocument();
  });
});
