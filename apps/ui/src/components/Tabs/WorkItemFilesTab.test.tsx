import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemFilesTab, isFilesTabSupported } from "./WorkItemFilesTab";
import type {
  WorkItemFileHistoryState,
} from "@hey-hey/ui-common/data";

const { useWorkItemFileHistoryMock, fileTouchHistoryPanelMock } = vi.hoisted(
  () => ({
    useWorkItemFileHistoryMock: vi.fn<() => WorkItemFileHistoryState>(),
    fileTouchHistoryPanelMock: vi.fn(),
  })
);

vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItemFileHistory: useWorkItemFileHistoryMock,
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  FileTouchHistoryPanel: (props: unknown) => {
    fileTouchHistoryPanelMock(props);
    return <div data-testid="file-touch-history-panel" />;
  },
}));

vi.mock(
  "@hey-hey/ui-common/components/SmarterTextAreaCard/fileReferences/FileReferenceLink",
  () => ({
    FileReferenceLink: ({
      value,
    }: {
      value: { serviceName: string; normalizedPath: string };
    }) => (
      <a href="#" data-testid="file-reference-link">
        {value.serviceName}/{value.normalizedPath}
      </a>
    ),
  })
);

const taskHistory = {
  kind: "task" as const,
  files: [
    {
      serviceId: "service-1",
      serviceName: "UI",
      normalizedPath: "src/index.ts",
    },
  ],
};

describe("isFilesTabSupported", () => {
  it.each(["FEATURE", "STANDARD", "BUG"])(
    "supports resolved %s definitions",
    (typeKey) => {
      expect(isFilesTabSupported({ status: "resolved", typeKey })).toBe(true);
    }
  );

  it.each(["CONTRACT", "CUSTOM", undefined])(
    "fails closed for %s definitions",
    (typeKey) => {
      expect(isFilesTabSupported({ status: "resolved", typeKey })).toBe(false);
    }
  );

  it("fails closed while the definition is unresolved", () => {
    expect(isFilesTabSupported({ status: "unavailable", typeKey: "FEATURE" })).toBe(
      false
    );
  });
});

describe("WorkItemFilesTab", () => {
  beforeEach(() => {
    useWorkItemFileHistoryMock.mockReset();
    fileTouchHistoryPanelMock.mockReset();
  });

  it("renders task files and opens history independently of the file link", () => {
    useWorkItemFileHistoryMock.mockReturnValue({
      status: "ready",
      history: taskHistory,
      isFetching: false,
    });

    render(
      <WorkItemFilesTab
        organizationId="org-1"
        projectId="project-1"
        entityId="task-1"
        typeKey="STANDARD"
      />
    );

    expect(screen.getByText("UI/src/index.ts")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Show task history for src/index.ts" })
    );
    expect(fileTouchHistoryPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        open: true,
        serviceId: "service-1",
        normalizedPath: "src/index.ts",
      })
    );
  });

  it("renders Feature files grouped by their persisted direct owner", () => {
    useWorkItemFileHistoryMock.mockReturnValue({
      status: "ready",
      history: {
        kind: "feature",
        sections: [
          {
            featureId: "feature-1",
            featureName: "Work Item Page",
            featurePath: "Features / Work Item Page",
            files: taskHistory.files,
          },
          {
            featureId: "feature-2",
            featureName: "Child feature",
            featurePath: "Features / Work Item Page / Child feature",
            files: [],
          },
        ],
      },
      isFetching: false,
    });

    render(
      <WorkItemFilesTab
        organizationId="org-1"
        projectId="project-1"
        entityId="feature-1"
        typeKey="FEATURE"
      />
    );

    expect(screen.getByText("Work Item Page")).toBeInTheDocument();
    expect(screen.getByText("Child feature")).toBeInTheDocument();
    expect(screen.getByText("No historical files in this section.")).toBeInTheDocument();
    expect(useWorkItemFileHistoryMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      scope: { kind: "feature", featureId: "feature-1" },
      active: true,
    });
  });

  it("renders loading, empty, and error states", () => {
    useWorkItemFileHistoryMock.mockReturnValue({
      status: "loading",
      history: null,
      isFetching: true,
    });
    const { rerender } = render(
      <WorkItemFilesTab
        organizationId="org-1"
        projectId="project-1"
        entityId="task-1"
        typeKey="BUG"
      />
    );
    expect(screen.getByLabelText("Loading files")).toBeInTheDocument();

    useWorkItemFileHistoryMock.mockReturnValue({
      status: "empty",
      history: { kind: "task", files: [] },
      isFetching: false,
    });
    rerender(
      <WorkItemFilesTab
        organizationId="org-1"
        projectId="project-1"
        entityId="task-1"
        typeKey="BUG"
      />
    );
    expect(screen.getByText("No historical files found for this work item.")).toBeInTheDocument();

    useWorkItemFileHistoryMock.mockReturnValue({
      status: "error",
      history: null,
      isFetching: false,
      error: new Error("file history unavailable"),
    });
    rerender(
      <WorkItemFilesTab
        organizationId="org-1"
        projectId="project-1"
        entityId="task-1"
        typeKey="BUG"
      />
    );
    expect(screen.getByText(/file history unavailable/)).toBeInTheDocument();
  });
});
