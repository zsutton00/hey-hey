import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceFilesTab } from "./ServiceFilesTab";

const mocks = vi.hoisted(() => ({
  historyPanel: vi.fn(),
  useServiceFileHistory: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  FileTouchHistoryPanel: (props: unknown) => {
    mocks.historyPanel(props);
    return <div>Task history panel</div>;
  },
}));

vi.mock(
  "@hey-hey/ui-common/components/SmarterTextAreaCard/fileReferences/FileReferenceLink",
  () => ({
    FileReferenceLink: ({ value }: { value: { normalizedPath: string } }) => (
      <span>{value.normalizedPath}</span>
    ),
  })
);

vi.mock("@hey-hey/ui-common/data", () => ({
  FileTouchServiceHistorySortBy: {
    NormalizedPath: "normalizedPath",
    LastTouchedAt: "lastTouchedAt",
    TouchCount: "touchCount",
  },
  FileTouchServiceHistorySortOrder: { Asc: "ASC", Desc: "DESC" },
  useServiceFileHistory: mocks.useServiceFileHistory,
}));

const file = {
  serviceId: "service-1",
  serviceName: "UI",
  normalizedPath: "src/index.ts",
  touchCount: 2,
  firstTouchedAt: "2026-08-01T00:00:00.000Z",
  lastTouchedAt: "2026-08-02T00:00:00.000Z",
  latestTaskId: "task-1",
  latestTaskName: "Add file history",
  latestTaskType: "STANDARD",
  latestAgentSessionId: "session-1",
  latestAgentSessionTitle: "Implementation session",
  latestReportId: "report-1",
};

const renderTab = () =>
  render(
    <MemoryRouter>
      <ServiceFilesTab
        organizationId="org-1"
        projectId="project-1"
        serviceId="service-1"
        active
      />
    </MemoryRouter>
  );

describe("ServiceFilesTab", () => {
  beforeEach(() => {
    mocks.historyPanel.mockReset();
    mocks.useServiceFileHistory.mockReset();
  });

  it.each([
    ["loading", "Loading Service files"],
    ["empty", "No historical files match this Service and filter."],
    ["error", "Couldn’t load historical files: failed"],
  ])("renders the %s state", (status, expected) => {
    mocks.useServiceFileHistory.mockReturnValue(
      status === "error"
        ? {
            status,
            files: [],
            nextCursor: null,
            isFetching: false,
            error: new Error("failed"),
          }
        : {
            status,
            files: [],
            nextCursor: null,
            isFetching: status === "loading",
          }
    );

    renderTab();

    expect(
      status === "loading"
        ? screen.getByLabelText(expected)
        : screen.getByText(expected)
    ).toBeInTheDocument();
  });

  it("renders portable file evidence and opens shared task history", () => {
    mocks.useServiceFileHistory.mockReturnValue({
      status: "ready",
      files: [file],
      nextCursor: "next-page",
      isFetching: false,
    });

    renderTab();

    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Add file history" })
    ).toHaveAttribute("href", "/projects/project-1/tasks/task-1");
    expect(
      screen.getByRole("link", { name: "Implementation session" })
    ).toHaveAttribute(
      "href",
      "/projects/project-1/resolve-agent-session-by-id/session-1"
    );
    expect(screen.getByText(/2 touches/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Show task history for src/index.ts" })
    );
    expect(screen.getByText("Task history panel")).toBeInTheDocument();
    expect(mocks.historyPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        serviceId: "service-1",
        normalizedPath: "src/index.ts",
      })
    );
  });

  it("sends path and cursor changes back through the service collection", () => {
    mocks.useServiceFileHistory.mockReturnValue({
      status: "ready",
      files: [file],
      nextCursor: "next-page",
      isFetching: false,
    });
    renderTab();

    fireEvent.change(screen.getByTestId("service-files-path-filter"), {
      target: { value: "components" },
    });
    expect(mocks.useServiceFileHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ pathFilter: "components" })
    );

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(mocks.useServiceFileHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "next-page" })
    );
  });

  it("does not reuse a pagination cursor when the Service changes", () => {
    mocks.useServiceFileHistory.mockReturnValue({
      status: "ready",
      files: [file],
      nextCursor: "next-page",
      isFetching: false,
    });
    const { rerender } = renderTab();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(mocks.useServiceFileHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({
        serviceId: "service-1",
        cursor: "next-page",
      })
    );

    rerender(
      <MemoryRouter>
        <ServiceFilesTab
          organizationId="org-1"
          projectId="project-1"
          serviceId="service-2"
          active
        />
      </MemoryRouter>
    );

    expect(mocks.useServiceFileHistory).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ cursor: expect.any(String) })
    );
    expect(mocks.useServiceFileHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ serviceId: "service-2" })
    );
  });
});
