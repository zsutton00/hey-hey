import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface BarChartMockProps {
  dataset: readonly { label: string; value: number }[];
  series: readonly { barLabel?: string; barLabelPlacement?: string }[];
  xAxis: readonly { dataKey?: string; scaleType?: string }[];
  slotProps?: {
    bar?: (ownerState: { dataIndex: number }) => {
      "aria-label"?: string;
      "data-metric"?: string;
      "data-testid"?: string;
      onKeyDown?: (event: React.KeyboardEvent<SVGRectElement>) => void;
      role?: "button";
      tabIndex?: number;
    };
  };
  onItemClick: (event: React.MouseEvent, item: { dataIndex: number }) => void;
}

const barChartProps = vi.hoisted(() => [] as BarChartMockProps[]);
vi.mock("@mui/x-charts/BarChart", async () => {
  const ReactModule = await import("react");
  return {
    BarChart: (props: BarChartMockProps) => {
      barChartProps.push(props);
      return ReactModule.createElement(
        "div",
        { "data-testid": "mui-bar-chart" },
        props.dataset.map(({ label, value }, dataIndex) =>
          ReactModule.createElement(
            "button",
            {
              key: label,
              type: "button",
              onClick: (event: React.MouseEvent) =>
                props.onItemClick(event, { dataIndex }),
            },
            `${label}: ${String(value)}`
          )
        )
      );
    },
  };
});
const canHoverState = vi.hoisted(() => ({ value: true }));
vi.mock("../../../hooks/useCanHover", () => ({
  useCanHover: () => canHoverState.value,
}));
import type {
  ActivityMetricContinuationDto,
  ProjectMetricDto,
  ProjectMetricsResponseDto,
} from "../../../api";
import { ProjectMetricIdentity } from "../../../api";
import { WebPathService } from "../../../services";
import {
  areAllProjectMetricsZero,
  groupProjectMetrics,
} from "../organizationHomeMetrics";
import { OrganizationHomeEvidence } from "../OrganizationHomeEvidence";

const WINDOW_START = "2026-09-03T12:00:00.000Z";
const WINDOW_END = "2026-09-04T12:00:00.000Z";
const ORGANIZATION_ID = "organization-1";

const allIdentities: ProjectMetricIdentity[] = [
  ProjectMetricIdentity.TaskCreated,
  ProjectMetricIdentity.TaskCompleted,
  ProjectMetricIdentity.TaskVerifying,
  ProjectMetricIdentity.BugCreated,
  ProjectMetricIdentity.BugCompleted,
  ProjectMetricIdentity.BugVerifying,
  ProjectMetricIdentity.PlanCreated,
  ProjectMetricIdentity.PlanCompleted,
  ProjectMetricIdentity.PlanVerifying,
  ProjectMetricIdentity.AgentSessionCreated,
  ProjectMetricIdentity.ProjectInfoCreated,
  ProjectMetricIdentity.ProjectInfoUpdated,
];

const makeMetric = (
  metric: ProjectMetricIdentity,
  value = 0
): ProjectMetricDto => {
  const activityContinuation: ActivityMetricContinuationDto = {
    metric,
    projectIds: ["project-1"],
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    actorScope: { mode: "ORGANIZATION" },
  };
  return { metric, value, activityContinuation };
};

const makeData = (value = 0): ProjectMetricsResponseDto => ({
  metrics: allIdentities.map((identity, index) =>
    makeMetric(identity, value === 0 ? 0 : value + index)
  ),
  actorScope: { mode: "ORGANIZATION" },
  effectiveProjectIds: ["project-1"],
  windowStart: WINDOW_START,
  windowEnd: WINDOW_END,
});

const renderEvidence = (
  overrides: Partial<ComponentProps<typeof OrganizationHomeEvidence>> = {}
) => {
  const refetch = vi.fn().mockResolvedValue(null);
  const props: ComponentProps<typeof OrganizationHomeEvidence> = {
    data: makeData(1),
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch,
    organizationId: ORGANIZATION_ID,
    onMetricActivate: vi.fn(),
    ...overrides,
  };

  return { ...render(<OrganizationHomeEvidence {...props} />), refetch };
};

describe("OrganizationHomeEvidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    barChartProps.length = 0;
  });

  it("groups every generated identity without copying metric entries", () => {
    const data = makeData(1);
    const grouped = groupProjectMetrics(data.metrics);

    expect(grouped.throughput.map((group) => group.label)).toEqual([
      "Agent Sessions",
      "Tasks",
      "Plans",
      "Bugs",
    ]);
    expect(grouped.updates[0]?.label).toBe("Project Info");
    expect(grouped.throughput[1]?.metrics[0]?.metric).toBe(data.metrics[0]);
    expect(grouped.updates[0]?.metrics[1]?.metric).toBe(data.metrics[11]);
  });

  it("renders both responsive sections, exact values, accessible labels, and the server window", () => {
    const onMetricActivate = vi.fn();
    const data = makeData(1);
    renderEvidence({ data, onMetricActivate });

    expect(
      screen.getByTestId("organization-home-throughput")
    ).toBeInTheDocument();
    expect(screen.getByTestId("organization-home-updates")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", {
        name: "Organization Activity time range",
      })
    ).toHaveTextContent("Last 24 hours");
    expect(screen.getByText("Organization Activity")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Organization Activity" })
    ).toBeVisible();
    expect(screen.getByText("All accessible projects")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Activity from everyone in the selected organization, limited to projects you can access."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Home activity summary" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Evidence")).not.toBeInTheDocument();
    expect(
      screen.getAllByTestId("organization-home-categorical-chart")
    ).toHaveLength(5);
    expect(screen.getAllByTestId("mui-bar-chart")).toHaveLength(5);
    expect(barChartProps).toHaveLength(5);
    expect(barChartProps[1]?.xAxis[0]).toMatchObject({
      dataKey: "label",
      scaleType: "band",
    });
    expect(barChartProps[1]?.series[0]).toMatchObject({
      barLabel: "value",
      barLabelPlacement: "outside",
    });
    expect(barChartProps[1]?.dataset).toMatchObject([
      { label: "Created", value: 1 },
      { label: "Completed", value: 2 },
      { label: "Verifying", value: 3 },
    ]);
    expect(barChartProps[1]?.slotProps?.bar?.({ dataIndex: 0 })).toMatchObject({
      "aria-label":
        "Tasks, Created, 1, Last 24 hours (Rolling 24 hours: 2026-09-03T12:00:00.000Z – 2026-09-04T12:00:00.000Z)",
      "data-metric": ProjectMetricIdentity.TaskCreated,
      "data-testid": "organization-home-metric-bar",
      role: "button",
      tabIndex: 0,
    });
    expect(
      barChartProps[1]?.slotProps?.bar?.({ dataIndex: 0 })?.onKeyDown
    ).toEqual(expect.any(Function));

    const throughput = screen.getByTestId("organization-home-throughput");
    const updates = screen.getByTestId("organization-home-updates");
    expect(
      throughput.compareDocumentPosition(updates) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("shows an explanation for an explicitly named shared section", async () => {
    const user = userEvent.setup();
    renderEvidence({
      title: "Task Activity",
      infoDescription: "Implementation work and its progress",
      includeProjectInfo: false,
    });

    const control = screen.getByRole("button", { name: "About Task Activity" });
    expect(
      screen.getByRole("heading", { name: "Task Activity" }).parentElement
    ).toContainElement(control);
    expect(
      screen.getByRole("heading", { name: "Task Activity" }).parentElement
    ).not.toContainElement(
      screen.getByRole("combobox", { name: "Task Activity time range" })
    );
    await user.click(control);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Implementation work and its progress"
    );
    expect(
      screen.queryByTestId("organization-home-updates")
    ).not.toBeInTheDocument();
  });

  it("omits the section explanation on devices that cannot hover", () => {
    canHoverState.value = false;
    try {
      renderEvidence({
        title: "Task Activity",
        infoDescription: "Implementation work and its progress",
        includeProjectInfo: false,
      });
      expect(
        screen.queryByTestId("activity-section-info")
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("combobox", { name: "Task Activity time range" })
      ).toBeInTheDocument();
    } finally {
      canHoverState.value = true;
    }
  });

  it("builds the canonical Activity path from the exact provider continuation", async () => {
    const user = userEvent.setup();
    const onMetricActivate = vi.fn();
    const data = makeData(1);
    const continuation = data.metrics.find(
      ({ metric }) => metric === ProjectMetricIdentity.AgentSessionCreated
    )!.activityContinuation;
    renderEvidence({ data, onMetricActivate });

    await user.click(
      screen.getAllByRole("button", { name: "Created: 10" })[0]!
    );

    expect(onMetricActivate).toHaveBeenCalledWith(
      WebPathService.organizationActivity({
        organizationId: ORGANIZATION_ID,
        metricContinuation: continuation,
      })
    );
  });

  it("renders an explicit loading skeleton", () => {
    renderEvidence({
      data: null,
      includeProjectInfo: false,
      isLoading: true,
      isFetched: false,
    });

    expect(
      screen.getByTestId("organization-home-evidence-loading")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("organization-home-throughput")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("organization-home-updates")
    ).not.toBeInTheDocument();
  });

  it("renders retryable errors and stale state explicitly", async () => {
    const user = userEvent.setup();
    const { refetch } = renderEvidence({
      data: null,
      error: new Error("metrics unavailable"),
      isReady: false,
    });

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);

    renderEvidence({ data: makeData(1), isStale: true });
    expect(
      screen.getByTestId("organization-home-evidence-stale")
    ).toBeInTheDocument();
    expect(
      screen.getByText("These rolling metrics are stale.")
    ).toBeInTheDocument();
  });

  it("renders zero-valued graphs without a separate empty-activity notice", () => {
    const data = makeData();
    expect(areAllProjectMetricsZero(data.metrics)).toBe(true);
    renderEvidence({ data });

    expect(
      screen.queryByText("No matching events in this rolling 24-hour window.")
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /: 0$/ })).toHaveLength(12);
    expect(screen.getByRole("combobox")).toHaveTextContent("Last 24 hours");
  });

  it("omits Project Info Updates when the Home surface excludes project info", () => {
    renderEvidence({ includeProjectInfo: false });

    expect(
      screen.getByTestId("organization-home-throughput")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("organization-home-updates")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Project Info Updates")).not.toBeInTheDocument();
    expect(screen.getAllByText("Last 24 hours")).toHaveLength(1);
  });
});
