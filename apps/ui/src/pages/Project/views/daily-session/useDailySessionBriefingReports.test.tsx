import { act, renderHook } from "@testing-library/react";
import { ReportType, type ReportDto } from "@hey-hey/ui-common/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDailySessionBriefingReports } from "./useDailySessionBriefingReports";

const mocks = vi.hoisted(() => ({
  useReports: vi.fn(),
  useWebsocketSubscriptions: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useReports: mocks.useReports,
  useWebsocketSubscriptions: mocks.useWebsocketSubscriptions,
}));

type ReportQuerySpies = {
  markStale: ReturnType<typeof vi.fn>;
  refetch: ReturnType<typeof vi.fn>;
};

const parentSpies: ReportQuerySpies = {
  markStale: vi.fn(),
  refetch: vi.fn(),
};

const childSpies: ReportQuerySpies = {
  markStale: vi.fn(),
  refetch: vi.fn(),
};

let parentReports: ReportDto[] = [];
let childReports: ReportDto[] = [];
let reportOptions: Array<Record<string, unknown>> = [];

const buildReport = (overrides: Partial<ReportDto>): ReportDto => ({
  id: "report-1",
  organizationId: "org-1",
  projectId: "project-1",
  reportType: ReportType.DailySession,
  audience: "PROJECT_VISIBLE",
  title: "Daily Session",
  payload: {
    reportType: ReportType.DailySession,
    summary: "Daily session parent",
  },
  version: 1,
  schemaVersion: 1,
  sourceExecutionId: "exec-1",
  parentReportId: null,
  createdAt: "2026-07-08T08:00:00.000Z",
  expiresAt: "2026-07-15T08:00:00.000Z",
  entities: [],
  ...overrides,
});

const buildChildReport = (overrides: Partial<ReportDto>): ReportDto =>
  buildReport({
    id: "child-1",
    reportType: ReportType.GoalProgress,
    title: "Goal progress",
    payload: {
      reportType: ReportType.GoalProgress,
      summary: "Summary",
      text: "Analysis",
    },
    parentReportId: "parent-new",
    ...overrides,
  });

const makeQuery = (
  reports: ReportDto[],
  spies: ReportQuerySpies,
): unknown => ({
  reports,
  data: reports,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  markStale: spies.markStale,
  refetch: spies.refetch,
});

const renderBriefingHook = () =>
  renderHook(() =>
    useDailySessionBriefingReports("org-1", "project-1"),
  );

describe("useDailySessionBriefingReports", () => {
  beforeEach(() => {
    parentReports = [];
    childReports = [];
    reportOptions = [];
    parentSpies.markStale.mockReset();
    parentSpies.refetch.mockReset().mockResolvedValue([]);
    childSpies.markStale.mockReset();
    childSpies.refetch.mockReset().mockResolvedValue([]);
    mocks.useWebsocketSubscriptions.mockReset();
    mocks.useReports.mockReset();
    mocks.useReports.mockImplementation((_organizationId, options) => {
      reportOptions.push(options);

      if (options.reportType === ReportType.DailySession) {
        return makeQuery(parentReports, parentSpies);
      }

      return makeQuery(childReports, childSpies);
    });
  });

  it("auto-follows the newest parent while selection is implicit", () => {
    const oldParent = buildReport({
      id: "parent-old",
      createdAt: "2026-07-07T08:00:00.000Z",
    });
    const newParent = buildReport({
      id: "parent-new",
      createdAt: "2026-07-08T08:00:00.000Z",
    });
    parentReports = [oldParent];
    childReports = [buildChildReport({ parentReportId: "parent-old" })];

    const { result, rerender } = renderBriefingHook();

    expect(result.current.selectedParentReportId).toBe("parent-old");

    parentReports = [newParent, oldParent];
    childReports = [buildChildReport({ parentReportId: "parent-new" })];
    rerender();

    expect(result.current.selectedParentReportId).toBe("parent-new");
    expect(
      reportOptions.some(
        (options) => options.parentReportId === "parent-new",
      ),
    ).toBe(true);
  });

  it("preserves an explicit older parent when newer parents arrive", () => {
    const olderParent = buildReport({
      id: "parent-old",
      createdAt: "2026-07-06T08:00:00.000Z",
    });
    const newParent = buildReport({
      id: "parent-new",
      createdAt: "2026-07-07T08:00:00.000Z",
    });
    const newerParent = buildReport({
      id: "parent-newer",
      createdAt: "2026-07-08T08:00:00.000Z",
    });
    parentReports = [newParent, olderParent];

    const { result, rerender } = renderBriefingHook();

    act(() => {
      result.current.selectParentReport("parent-old");
    });

    expect(result.current.selectedParentReportId).toBe("parent-old");

    parentReports = [newerParent, newParent];
    rerender();

    expect(result.current.selectedParentReportId).toBe("parent-old");
    expect(result.current.availableBriefings.map((option) => option.reportId)).toEqual([
      "parent-newer",
      "parent-new",
      "parent-old",
    ]);
  });

  it("refreshes parent and selected child reports for notification and focus hints", () => {
    parentReports = [
      buildReport({
        id: "parent-new",
      }),
    ];

    renderBriefingHook();

    const subscriptionConfig = mocks.useWebsocketSubscriptions.mock.calls[0][0];

    act(() => {
      subscriptionConfig.events.onSystemNotification({
        organizationId: "org-1",
        projectId: "project-1",
        notification: {
          eventType: "session_report_ready",
          payload: {
            reportId: "parent-new",
            reportType: ReportType.DailySession,
          },
        },
      });
    });

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(parentSpies.markStale).toHaveBeenCalledTimes(2);
    expect(parentSpies.refetch).toHaveBeenCalledTimes(2);
    expect(childSpies.markStale).toHaveBeenCalledTimes(2);
    expect(childSpies.refetch).toHaveBeenCalledTimes(2);
  });

  it("subscribes through the project-scoped typed websocket boundary", () => {
    renderBriefingHook();

    expect(mocks.useWebsocketSubscriptions).toHaveBeenCalledWith(
      expect.objectContaining({ projectIds: ["project-1"] }),
      { enabled: true },
    );
  });

  it("does not invalidate Daily Session reports for a non-Daily session report notification", () => {
    parentReports = [
      buildReport({
        id: "parent-new",
      }),
    ];

    renderBriefingHook();

    const subscriptionConfig = mocks.useWebsocketSubscriptions.mock.calls[0][0];

    act(() => {
      subscriptionConfig.events.onSystemNotification({
        organizationId: "org-1",
        projectId: "project-1",
        notification: {
          eventType: "session_report_ready",
          payload: {
            reportId: "coding-report",
            reportType: ReportType.Implement,
          },
        },
      });
    });

    expect(parentSpies.markStale).not.toHaveBeenCalled();
    expect(parentSpies.refetch).not.toHaveBeenCalled();
    expect(childSpies.markStale).not.toHaveBeenCalled();
    expect(childSpies.refetch).not.toHaveBeenCalled();
  });
});
