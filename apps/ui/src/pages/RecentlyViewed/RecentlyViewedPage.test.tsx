import type { AttentionEventResponse } from "@hey-hey/ui-common/api";
import { useAttentionEvents, useProject } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecentlyViewedPage } from "./RecentlyViewedPage";

vi.mock("nuqs", () => {
  const parser = {
    withDefault: (defaultValue: unknown) => ({ defaultValue }),
  };
  return {
    parseAsStringEnum: () => parser,
    useQueryState: (
      _key: string,
      config: { defaultValue?: unknown } = {},
    ) => React.useState(config.defaultValue),
  };
});

vi.mock("@hey-hey/ui-common/data", () => ({
  useAttentionEvents: vi.fn(),
  useProject: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  EntityIcon: ({ entityType }: { entityType: string }) => (
    <span data-entity-type={entityType}>icon</span>
  ),
}));

vi.mock("@hey-hey/ui-common/i18n", () => ({
  compose: (value: string) => value,
}));

vi.mock("../../components/Layout", () => ({
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DetailPageHeader: ({ title }: { title: string }) => <div>{title}</div>,
  PageBreadcrumbs: () => null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValueOrOptions?: unknown, options?: unknown) => {
      if (typeof defaultValueOrOptions === "string") {
        const opts = options as Record<string, unknown> | undefined;
        if (opts) {
          return Object.entries(opts).reduce<string>(
            (acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)),
            defaultValueOrOptions,
          );
        }
        return defaultValueOrOptions;
      }
      return _key;
    },
  }),
}));

const useAttentionEventsMock = vi.mocked(useAttentionEvents);
const useProjectMock = vi.mocked(useProject);
const useUserIdentityMock = vi.mocked(useUserIdentity);

const buildEvent = (
  overrides: Partial<AttentionEventResponse>,
): AttentionEventResponse => ({
  id: `event-${Math.random()}`,
  durationMs: 60000,
  entity: null,
  entityId: "entity-1",
  entityName: "Entity",
  entityType: "task",
  focusEnd: "2026-03-01T00:00:00.000Z",
  focusStart: "2026-03-01T00:00:00.000Z",
  ...overrides,
});

const makeMixedEvents = (count: number): AttentionEventResponse[] => {
  const types = ["task", "design_doc", "plan", "conversation"] as const;
  const events: AttentionEventResponse[] = [];
  for (let index = 0; index < count; index += 1) {
    const type = types[index % types.length];
    const name = `${type}-${String(index).padStart(3, "0")}`;
    events.push(
      buildEvent({
        id: `event-${index}`,
        entityId: `entity-${index}`,
        entityName: name,
        entityType: type,
        entity:
          type === "design_doc"
            ? { title: name, projectId: "project-1" }
            : type === "plan"
              ? { title: name, originatingProjectId: "project-1" }
              : type === "conversation"
                ? { title: name, projectId: "project-1" }
                : { name },
        focusEnd: new Date(2026, 2, 1, 0, 0, index).toISOString(),
        focusStart: new Date(2026, 2, 1, 0, 0, index).toISOString(),
      }),
    );
  }
  return events;
};

const renderPage = (initialPath = "/projects/project-1/recently-viewed") =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          element={<RecentlyViewedPage />}
          path="/projects/:projectId/recently-viewed"
        />
      </Routes>
    </MemoryRouter>,
  );

describe("RecentlyViewedPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useUserIdentityMock.mockReturnValue({
      currentOrgId: "org-1",
      userId: "user-1",
    });

    useProjectMock.mockReturnValue({
      data: { id: "project-1", name: "Project One" },
    } as ReturnType<typeof useProject>);

    useAttentionEventsMock.mockReturnValue({
      error: null,
      events: [],
      isFetched: true,
      isFetching: false,
      isLoading: false,
      isReady: true,
      isStale: false,
      markStale: vi.fn(),
      pagination: { limit: 50, offset: 0, total: 0 },
      refetch: vi.fn(),
    } as ReturnType<typeof useAttentionEvents>);
  });

  it("requests up to 50 events and caps rendered rows at 50", () => {
    const events = makeMixedEvents(75);
    useAttentionEventsMock.mockReturnValue({
      error: null,
      events,
      isFetched: true,
      isFetching: false,
      isLoading: false,
      isReady: true,
      isStale: false,
      markStale: vi.fn(),
      pagination: { limit: 50, offset: 0, total: events.length },
      refetch: vi.fn(),
    } as ReturnType<typeof useAttentionEvents>);

    renderPage();

    expect(useAttentionEventsMock).toHaveBeenCalledWith("org-1", {
      enabled: true,
      includeEntity: true,
      limit: 50,
      sort: "mostRecent",
    });

    const list = screen.getByTestId("recently-viewed-list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(50);
  });

  it("defaults to Most recent and reorders when the user picks a different sort", () => {
    const events = [
      buildEvent({
        id: "evt-zebra",
        entityId: "zebra",
        entityName: "Zebra Doc",
        entityType: "design_doc",
        entity: { title: "Zebra Doc", projectId: "project-1" },
        focusEnd: "2026-03-01T00:00:01.000Z",
      }),
      buildEvent({
        id: "evt-apple",
        entityId: "apple",
        entityName: "Apple Task",
        entityType: "task",
        entity: { name: "Apple Task" },
        focusEnd: "2026-03-01T00:00:03.000Z",
      }),
      buildEvent({
        id: "evt-mango",
        entityId: "mango",
        entityName: "Mango Plan",
        entityType: "plan",
        entity: { title: "Mango Plan", originatingProjectId: "project-1" },
        focusEnd: "2026-03-01T00:00:02.000Z",
      }),
    ];
    useAttentionEventsMock.mockReturnValue({
      error: null,
      events,
      isFetched: true,
      isFetching: false,
      isLoading: false,
      isReady: true,
      isStale: false,
      markStale: vi.fn(),
      pagination: { limit: 50, offset: 0, total: events.length },
      refetch: vi.fn(),
    } as ReturnType<typeof useAttentionEvents>);

    renderPage();

    const select = screen.getByTestId("recently-viewed-sort-select");
    expect(within(select).getByText("Most recent")).toBeInTheDocument();

    const collectOrder = () =>
      within(screen.getByTestId("recently-viewed-list"))
        .getAllByRole("listitem")
        .map((node) => node.getAttribute("data-testid"));

    expect(collectOrder()).toEqual([
      "recently-viewed-row-evt-apple",
      "recently-viewed-row-evt-mango",
      "recently-viewed-row-evt-zebra",
    ]);

    const pickSort = (value: string) => {
      fireEvent.mouseDown(within(select).getByRole("combobox"));
      fireEvent.click(
        screen.getByTestId(`recently-viewed-sort-option-${value}`),
      );
    };

    pickSort("oldest");
    expect(collectOrder()).toEqual([
      "recently-viewed-row-evt-zebra",
      "recently-viewed-row-evt-mango",
      "recently-viewed-row-evt-apple",
    ]);

    pickSort("alphabetical");
    expect(collectOrder()).toEqual([
      "recently-viewed-row-evt-apple",
      "recently-viewed-row-evt-mango",
      "recently-viewed-row-evt-zebra",
    ]);

    pickSort("entityType");
    expect(collectOrder()).toEqual([
      "recently-viewed-row-evt-zebra",
      "recently-viewed-row-evt-mango",
      "recently-viewed-row-evt-apple",
    ]);
  });

  it("renders the empty state when no project events match", () => {
    renderPage();
    expect(screen.getByTestId("recently-viewed-empty")).toBeInTheDocument();
  });

  it("renders the loading state while fetching", () => {
    useAttentionEventsMock.mockReturnValue({
      error: null,
      events: [],
      isFetched: false,
      isFetching: true,
      isLoading: true,
      isReady: false,
      isStale: false,
      markStale: vi.fn(),
      pagination: { limit: 50, offset: 0, total: 0 },
      refetch: vi.fn(),
    } as ReturnType<typeof useAttentionEvents>);

    renderPage();
    expect(screen.getByTestId("recently-viewed-loading")).toBeInTheDocument();
  });
});
