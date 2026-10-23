import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectContext } from "../../../contexts";
import type { ReportDto } from "../../../api";
import { ReportMentionInlineRenderer } from "../ReportMentionInlineRenderer";
import type { EntityMention } from "../../SmarterTextAreaCard/types";

const hookMocks = vi.hoisted(() => ({
  useReport: vi.fn(),
}));

vi.mock("../../../data/hooks/useReport", () => ({
  useReport: hookMocks.useReport,
}));

vi.mock("../../Reports/ReportViewer", () => ({
  ReportViewer: ({
    report,
    renderHeader,
    titleLink,
  }: {
    report: ReportDto;
    renderHeader?: boolean;
    titleLink?: { entityId: string; projectId: string; title: string };
  }) => (
    <div data-testid="mock-report-viewer">
      {report.title}:{String(renderHeader)}
      {titleLink ? (
        <a
          data-testid="mock-report-viewer-title-link"
          href={`/projects/${titleLink.projectId}/reports/${titleLink.entityId}`}
        >
          {titleLink.title}
        </a>
      ) : null}
    </div>
  ),
}));

vi.mock("../../SmarterTextAreaCard/EntityHoverCard", () => ({
  EntityHoverCard: () => null,
}));

const report = {
  id: "report-1",
  organizationId: "org-1",
  reportType: "SNAPSHOT",
  audience: "WORKFLOW_ONLY",
  title: "Snapshot report",
  payload: {},
  version: 1,
  schemaVersion: 1,
  createdAt: "2026-07-17T00:00:00.000Z",
  expiresAt: "2026-08-17T00:00:00.000Z",
  entities: [],
} as ReportDto;

const mention: EntityMention = {
  entityType: "report",
  entityId: "report-1",
  entityName: "SNAPSHOT",
};

const interactiveMention: EntityMention = {
  ...mention,
  entityName: "FEATURE_SYNC_DECISION",
};

const interactiveReport = {
  ...report,
  reportType: "FEATURE_SYNC_DECISION",
  title: "Feature Sync Decision",
  schemaVersion: 2,
  payload: {
    reportType: "FEATURE_SYNC_DECISION",
    summary: "Review the grouped decisions.",
    decisionGroups: [],
  },
} as ReportDto;

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter>
    <ThemeProvider theme={createTheme()}>
      <DndContext>
        <ProjectContext.Provider
          value={{
            organizationId: "org-1",
            projectId: "project-1",
            navigate: vi.fn(),
          }}
        >
          {children}
        </ProjectContext.Provider>
      </DndContext>
    </ThemeProvider>
  </MemoryRouter>
);

describe("ReportMentionInlineRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a resolved report inline without the mention badge", () => {
    hookMocks.useReport.mockReturnValue({
      data: report,
      isLoading: false,
      isFetching: false,
      error: null,
    });

    render(<ReportMentionInlineRenderer mention={mention} />, { wrapper });

    expect(screen.queryByTestId("mention-badge")).not.toBeInTheDocument();
    expect(screen.getByTestId("mock-report-viewer")).toHaveTextContent(
      "Snapshot report:false"
    );
    const titleLink = screen.getByTestId("mock-report-viewer-title-link");
    expect(titleLink).toHaveTextContent("Snapshot report");
    expect(titleLink).toHaveAttribute(
      "href",
      "/projects/project-1/reports/report-1"
    );
    expect(hookMocks.useReport).toHaveBeenCalledWith("org-1", "report-1", {
      enabled: true,
    });
  });

  it("keeps response-capable report mentions as badges so the attachment owns the interactive viewer", () => {
    hookMocks.useReport.mockReturnValue({
      data: interactiveReport,
      isLoading: false,
      isFetching: false,
      error: null,
    });

    render(<ReportMentionInlineRenderer mention={interactiveMention} />, {
      wrapper,
    });

    expect(screen.getByTestId("mention-badge")).toHaveTextContent(
      "FEATURE_SYNC_DECISION"
    );
    expect(screen.queryByTestId("mock-report-viewer")).not.toBeInTheDocument();
  });

  it.each([
    { data: null, error: new Error("not found") },
    { data: null, error: null },
  ])(
    "falls back to the generic badge when the report is unavailable",
    (query) => {
      hookMocks.useReport.mockReturnValue({
        data: query.data,
        isLoading: false,
        isFetching: false,
        error: query.error,
      });

      render(<ReportMentionInlineRenderer mention={mention} />, { wrapper });

      expect(screen.getByTestId("mention-badge")).toHaveTextContent("SNAPSHOT");
      expect(
        screen.queryByTestId("mock-report-viewer")
      ).not.toBeInTheDocument();
    }
  );
});
