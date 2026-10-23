import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReportType, type ReportDto } from "../../../api";
import { ReportSummaryCard } from "../ReportSummaryCard";

const reportFixture: ReportDto = {
  id: "report-42",
  organizationId: "org-1",
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

describe("ReportSummaryCard", () => {
  it("renders the report container with report id", () => {
    render(<ReportSummaryCard report={reportFixture} />);

    expect(
      screen.getByTestId("activity-report-summary-report-42")
    ).toBeInTheDocument();
  });

  it("renders the report title", () => {
    render(<ReportSummaryCard report={reportFixture} />);

    expect(
      screen.getByTestId("activity-report-summary-title-report-42")
    ).toHaveTextContent("Snapshot Report");
  });

  it("renders the report type and schema version chips", () => {
    render(<ReportSummaryCard report={reportFixture} />);

    const container = screen.getByTestId("activity-report-summary-report-42");
    expect(container).toHaveTextContent("SNAPSHOT");
    expect(container).toHaveTextContent("v3");
  });

  it("renders a created-at timestamp", () => {
    render(<ReportSummaryCard report={reportFixture} />);

    expect(
      screen.getByTestId("activity-report-summary-created-at-report-42")
    ).toHaveTextContent(/Created/);
  });
});
