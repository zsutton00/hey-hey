import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReportAudience, ReportType, type ReportDto } from "../../../api";
import { ReportViewer } from "../../Reports/ReportViewer";
import { StandardReportContent } from "../../Reports/viewer";
import type { EvidencePipelineReportPayload } from "../../Reports/viewer/evidencePipelineTypes";

vi.mock("../../../data/hooks/usePlatformAdminAccess", () => ({
  usePlatformAdminAccess: () => ({ isPlatformAdmin: false, isResolved: true }),
}));

const reportFixture: ReportDto = {
  id: "report-42",
  organizationId: "org-1",
  audience: ReportAudience.WorkflowOnly,
  reportType: ReportType.Snapshot,
  title: "Snapshot Report",
  payload: {},
  version: 1,
  schemaVersion: 3,
  sourceExecutionId: "exec-9",
  createdAt: "2026-03-02T09:00:00.000Z",
  expiresAt: "2026-03-20T09:00:00.000Z",
  entities: [],
};

const evidencePipelinePayload = {
  plannerInput: {
    messageCount: 4,
    optionKeys: ["scope", "services"],
    maxRounds: 2,
    scaffoldedQaAnswerFocus: true,
  },
  searchSteps: [
    {
      query: "implementation hints auth service",
      why: "Find prior implementation guidance",
      queryPerspective: "service",
      tool: "semantic_search",
    },
    {
      query: {
        entityType: "TASK",
        terms: ["token refresh", "session expiry"],
      },
      why: "Cross-check task-level evidence",
      queryPerspective: "task",
      tool: "unified_search",
    },
  ],
  searchResults: [
    {
      query: "implementation hints auth service",
      why: "Find prior implementation guidance",
      queryPerspective: "service",
      fromCache: true,
      evidenceItems: [
        {
          entityId: "service-1",
          entityType: "SERVICE",
          source: "semantic_search",
          score: 0.92,
        },
        {
          entityId: "design-doc-1",
          entityType: "DESIGN_DOC",
          source: "semantic_search",
          score: 0.83,
        },
      ],
    },
    {
      query: {
        entityType: "TASK",
        terms: ["token refresh", "session expiry"],
      },
      why: "Cross-check task-level evidence",
      queryPerspective: "task",
      fromCache: false,
      evidenceItems: [
        {
          entityId: "task-99",
          entityType: "TASK",
          source: "unified_search",
          score: 0.78,
        },
      ],
    },
  ],
  selectedEvidenceKeys: ["service-1", "design-doc-1"],
  excludedEvidenceKeys: ["task-11"],
  hydratedEvidenceKeys: ["design-doc-1"],
  implementationHints: [
    {
      entityId: "hint-1",
      entityType: "SERVICE",
      source: "semantic_search",
      score: 0.88,
      hintType: "implementation_hint",
    },
  ],
  finalEvidence: [
    {
      entityId: "service-1",
      entityType: "SERVICE",
      source: "semantic_search",
      score: 0.92,
    },
    {
      entityId: "design-doc-1",
      entityType: "DESIGN_DOC",
      source: "semantic_search",
      score: 0.83,
    },
  ],
  execution: {
    startedAt: "2026-03-02T09:00:00.000Z",
    completedAt: "2026-03-02T09:00:03.000Z",
    durationMs: 3000,
    totalSearchSteps: 2,
    cachedStepCount: 1,
    uncachedStepCount: 1,
    errorCount: 0,
  },
} satisfies EvidencePipelineReportPayload;

const evidencePipelineReportFixture: ReportDto = {
  id: "report-evidence",
  organizationId: "org-1",
  audience: ReportAudience.WorkflowOnly,
  reportType: ReportType.EvidencePipeline,
  title: "Evidence Pipeline Report",
  payload: evidencePipelinePayload,
  version: 1,
  schemaVersion: 1,
  sourceExecutionId: "exec-evidence",
  createdAt: "2026-03-02T09:00:00.000Z",
  expiresAt: "2026-03-20T09:00:00.000Z",
  entities: [],
};

describe("ReportViewer", () => {
  it("renders report frame with title, type and version", () => {
    render(<ReportViewer report={reportFixture} />);

    expect(screen.getByTestId("report-viewer-report-42")).toBeInTheDocument();
    expect(
      screen.getByTestId("report-viewer-report-42-title"),
    ).toHaveTextContent("Snapshot Report");
    expect(
      screen.getByTestId("report-viewer-report-42-type"),
    ).toHaveTextContent("SNAPSHOT");
    expect(
      screen.getByTestId("report-viewer-report-42-version"),
    ).toHaveTextContent("v3");
  });

  it("renders the standard fallback content for report types without a dedicated renderer", () => {
    const unknownReport: ReportDto = {
      ...reportFixture,
      id: "report-unknown",
      reportType: "MYSTERY_TYPE" as ReportType,
      payload: {},
    };

    render(
      <StandardReportContent
        report={unknownReport}
        reportTestId="report-viewer-report-unknown"
      />,
    );

    expect(
      screen.getByTestId("report-viewer-report-unknown-empty"),
    ).toHaveTextContent("No renderer available for report type MYSTERY_TYPE.");
  });

  it("supports custom testIdPrefix", () => {
    render(
      <ReportViewer report={reportFixture} testIdPrefix="custom-prefix" />,
    );

    expect(screen.getByTestId("custom-prefix-report-42")).toBeInTheDocument();
  });

  it("renders evidence pipeline planner input and search steps", () => {
    render(<ReportViewer report={evidencePipelineReportFixture} />);

    expect(
      screen.getByTestId("report-viewer-evidence-pipeline"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("report-viewer-report-evidence-type"),
    ).toHaveTextContent("EVIDENCE_PIPELINE");
    expect(
      screen.getByTestId("report-viewer-evidence-pipeline-planner-list"),
    ).toHaveTextContent("Conversation messages");
    expect(
      screen.getByTestId("report-viewer-evidence-pipeline-planner-list"),
    ).toHaveTextContent("Planner option keys");
    expect(
      screen.getByTestId("report-viewer-evidence-pipeline-search-steps-list"),
    ).toHaveTextContent("implementation hints auth service");
    expect(
      screen.getByTestId("report-viewer-evidence-pipeline-search-steps-list"),
    ).toHaveTextContent('"entityType":"TASK"');
  });

  it("renders grouped per-step evidence results with entity references", () => {
    render(<ReportViewer report={evidencePipelineReportFixture} />);

    const searchResults = screen.getAllByTestId(
      "report-viewer-evidence-pipeline-search-result",
    );
    expect(searchResults).toHaveLength(2);

    const firstResult = searchResults[0];
    expect(firstResult).toHaveTextContent("Cached");
    expect(firstResult).toHaveTextContent("Service");
    expect(firstResult).toHaveTextContent("Design Doc");
    expect(firstResult).toHaveTextContent("Entity ID: service-1");
    expect(firstResult).toHaveTextContent("Entity ID: design-doc-1");
  });

  it("renders hydration selections, implementation hints, and final evidence separately", () => {
    render(<ReportViewer report={evidencePipelineReportFixture} />);

    expect(
      screen.getByTestId("report-viewer-evidence-pipeline-selected-keys-list"),
    ).toHaveTextContent("service-1");
    expect(
      screen.getByTestId("report-viewer-evidence-pipeline-excluded-keys-list"),
    ).toHaveTextContent("task-11");
    expect(
      screen.getByTestId("report-viewer-evidence-pipeline-hydrated-keys-list"),
    ).toHaveTextContent("design-doc-1");

    const implementationHintsSection = screen.getByTestId(
      "report-viewer-evidence-pipeline-implementation-hints",
    );
    expect(implementationHintsSection).toHaveTextContent(
      "Implementation Hints",
    );
    expect(implementationHintsSection).toHaveTextContent(
      "Hint type: implementation_hint",
    );
    expect(implementationHintsSection).toHaveTextContent("Entity ID: hint-1");

    const finalEvidenceSection = screen.getByTestId(
      "report-viewer-evidence-pipeline-final-evidence",
    );
    expect(finalEvidenceSection).toHaveTextContent("Final Evidence Payload");
    expect(finalEvidenceSection).toHaveTextContent("Entity ID: service-1");
    expect(finalEvidenceSection).toHaveTextContent("Entity ID: design-doc-1");
    expect(finalEvidenceSection).not.toHaveTextContent(
      "Hint type: implementation_hint",
    );
  });

  it("renders an empty-state message when an evidence pipeline payload is malformed", () => {
    const malformedReport: ReportDto = {
      ...evidencePipelineReportFixture,
      id: "report-evidence-malformed",
      payload: {},
    };

    render(<ReportViewer report={malformedReport} />);

    expect(
      screen.getByTestId("report-viewer-evidence-pipeline-empty"),
    ).toHaveTextContent("Evidence pipeline payload is unavailable.");
  });
});
