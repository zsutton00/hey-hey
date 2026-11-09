import type {
  ReportUsageTrendBucket,
  ReportUsageTrends,
} from "../../../../api";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../../../../i18n/locales/en";
import { useProjectReportUsageTrends } from "../../../../data/hooks/useProjectReportUsageTrends";
import { UsageTrendsView } from "../UsageTrendsView";
import {
  defaultUsageTrendsFilters,
  type UsageTrendsFilterState,
} from "../usageTrendsState";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) => {
      const template =
        (en as Record<string, string>)[key] ??
        (values.defaultValue as string | undefined) ??
        key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(values[name]),
      );
    },
  }),
}));

vi.mock("@mui/x-charts/BarChart", () => ({
  BarChart: ({
    series,
  }: {
    series: { label: string; data: (number | null)[] }[];
  }) => (
    <div data-testid="chart">
      {series.map((s) => (
        <span key={s.label}>
          {s.label}:{s.data.map((value) => value ?? "none").join(",")}
        </span>
      ))}
    </div>
  ),
}));

vi.mock("../../../../data/hooks/useProjectReportUsageTrends", () => ({
  useProjectReportUsageTrends: vi.fn(),
}));

const useTrendsMock = vi.mocked(useProjectReportUsageTrends);

const totals = {
  inputTokens: 5000,
  freshInputTokens: 1000,
  cacheReadInputTokens: 3500,
  cacheCreationInputTokens: 500,
  outputTokens: 800,
  toolCalls: 40,
};

const bucket = (
  start: string,
  overrides: Partial<ReportUsageTrendBucket> = {},
): ReportUsageTrendBucket => ({
  start,
  executionCount: 2,
  completeCount: 2,
  partialCount: 0,
  unavailableCount: 0,
  averages: { inputTokens: 1200, outputTokens: 300, toolCalls: 7 },
  totals,
  ...overrides,
});

const trends = (
  granularity: ReportUsageTrends["granularity"],
  overrides: Partial<ReportUsageTrends> = {},
): ReportUsageTrends => ({
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-11-01T00:00:00.000Z",
  granularity,
  executionCount: 6,
  completeCount: 4,
  partialCount: 1,
  unavailableCount: 1,
  averages: { inputTokens: 1200, outputTokens: 300, toolCalls: 7 },
  totals,
  buckets: [bucket("2026-10-26T00:00:00.000Z")],
  options: {
    reportKinds: ["IMPLEMENTATION", "REVIEW"],
    providers: ["claude"],
    models: ["opus"],
    efforts: ["high", "unknown"],
  },
  ...overrides,
});

const Harness = () => {
  const [filters, setFilters] = useState<UsageTrendsFilterState>(
    defaultUsageTrendsFilters(new Date("2026-10-31T12:00:00Z")),
  );

  return (
    <UsageTrendsView
      organizationId="org-1"
      projectId="project-1"
      filters={filters}
      onFiltersChange={setFilters}
    />
  );
};

const returning = (value: ReportUsageTrends | null, extra = {}) =>
  useTrendsMock.mockReturnValue({
    trends: value,
    isLoading: false,
    error: null,
    ...extra,
  });

describe("UsageTrendsView", () => {
  beforeEach(() => {
    useTrendsMock.mockReset();
  });

  it("shows averages, totals, coverage, charts and table from the same read", () => {
    returning(trends("week"));
    render(<Harness />);

    expect(screen.getByTestId("usage-trends-avg-tokens")).toHaveTextContent(
      "1,200 input",
    );
    expect(screen.getByTestId("usage-trends-avg-tokens")).toHaveTextContent(
      "300 output",
    );
    expect(screen.getByTestId("usage-trends-avg-tools")).toHaveTextContent("7");
    expect(screen.getByTestId("usage-trends-totals")).toHaveTextContent(
      "cache read 3,500, cache creation 500",
    );
    expect(screen.getByTestId("usage-trends-coverage")).toHaveTextContent(
      "4 of 6",
    );
    expect(screen.getByTestId("usage-trends-coverage")).toHaveTextContent(
      "1 partial · 1 unavailable",
    );
    expect(screen.getByTestId("usage-trends-footnote")).toHaveTextContent(
      "4 executions with complete measurements",
    );
    expect(screen.getByTestId("usage-trends-approximate")).toBeInTheDocument();
    expect(screen.getAllByTestId("chart")[0]).toHaveTextContent("Input:1200");
  });

  it("adapts bucket labels to the selected grouping and requests the new grouping", () => {
    useTrendsMock.mockImplementation((_org, _project, params) => ({
      trends: trends(params.granularity, {
        buckets: [
          bucket(
            params.granularity === "month"
              ? "2026-10-01T00:00:00.000Z"
              : "2026-10-26T00:00:00.000Z",
          ),
        ],
      }),
      isLoading: false,
      error: null,
    }));
    render(<Harness />);

    expect(
      within(screen.getByTestId("usage-trends-table")).getByText("Oct 26"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("usage-trends-granularity-week"));
    expect(screen.getByText("Week of Oct 26")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("usage-trends-granularity-month"));
    expect(screen.getByText("Oct 2026")).toBeInTheDocument();
    expect(useTrendsMock).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      expect.objectContaining({ granularity: "month" }),
    );
  });

  it("explains incomplete measurements while showing counts, with no averages", () => {
    returning(
      trends("day", {
        completeCount: 0,
        partialCount: 3,
        unavailableCount: 0,
        executionCount: 3,
        averages: { inputTokens: null, outputTokens: null, toolCalls: null },
        buckets: [
          bucket("2026-10-26T00:00:00.000Z", {
            completeCount: 0,
            averages: {
              inputTokens: null,
              outputTokens: null,
              toolCalls: null,
            },
          }),
        ],
      }),
    );
    render(<Harness />);

    expect(screen.getByTestId("usage-trends-incomplete")).toBeInTheDocument();
    expect(screen.getByTestId("usage-trends-avg-tools")).toHaveTextContent("—");
    expect(screen.getByTestId("usage-trends-coverage")).toHaveTextContent(
      "0 of 3",
    );
  });

  it("keeps a measured zero average distinct from unavailable", () => {
    returning(
      trends("day", {
        averages: { inputTokens: 10, outputTokens: 5, toolCalls: 0 },
      }),
    );
    render(<Harness />);

    expect(screen.getByTestId("usage-trends-avg-tools")).toHaveTextContent("0");
    expect(screen.getByTestId("usage-trends-avg-tools")).not.toHaveTextContent(
      "—",
    );
  });

  it("shows loading, empty, error and invalid-period states", () => {
    returning(null, { isLoading: true });
    const { unmount } = render(<Harness />);
    expect(screen.getByTestId("usage-trends-loading")).toBeInTheDocument();
    unmount();

    returning(trends("day", { executionCount: 0, buckets: [] }));
    const empty = render(<Harness />);
    expect(screen.getByTestId("usage-trends-empty")).toBeInTheDocument();
    empty.unmount();

    returning(null, { error: new Error("boom") });
    const failed = render(<Harness />);
    expect(screen.getByTestId("usage-trends-error")).toBeInTheDocument();
    failed.unmount();

    returning(null);
    render(<Harness />);
    fireEvent.change(screen.getByTestId("usage-trends-from"), {
      target: { value: "2026-12-31" },
    });
    expect(
      screen.getByTestId("usage-trends-invalid-period"),
    ).toBeInTheDocument();
  });

  it("explains the period instead of crashing when a date is cleared or impossible", () => {
    returning(null);
    render(<Harness />);

    fireEvent.change(screen.getByTestId("usage-trends-to"), {
      target: { value: "" },
    });
    expect(
      screen.getByTestId("usage-trends-invalid-period"),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("usage-trends-to"), {
      target: { value: "2026-10-31" },
    });
    fireEvent.change(screen.getByTestId("usage-trends-from"), {
      target: { value: "2026-02-30" },
    });
    expect(
      screen.getByTestId("usage-trends-invalid-period"),
    ).toBeInTheDocument();
  });

  it("never renders review scaffolding", () => {
    returning(trends("day"));
    render(<Harness />);

    expect(screen.queryByText(/illustrative/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/other data states/i)).not.toBeInTheDocument();
  });
});
