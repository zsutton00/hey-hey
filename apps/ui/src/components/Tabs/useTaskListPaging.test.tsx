import { act, render, renderHook } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTaskListPageCount,
  parseTaskListSortKey,
  TaskListPagination,
  useTaskListPaging,
} from "./useTaskListPaging";

const mocks = vi.hoisted(() => ({
  pagination: vi.fn(),
  queryState: {} as Record<string, unknown>,
  queryStateKeys: [] as string[],
  setters: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("nuqs", () => ({
  parseAsInteger: { withDefault: (value: number) => value },
  parseAsString: { withDefault: (value: string) => value },
  parseAsStringLiteral: () => ({ withDefault: (value: string) => value }),
  useQueryState: (key: string) => {
    mocks.queryStateKeys.push(key);
    const defaultValue = key.endsWith("Page")
      ? 1
      : key.endsWith("Sort")
        ? "createdAt:desc"
        : "";
    const setter = mocks.setters[key] ?? vi.fn();
    mocks.setters[key] = setter;
    return [mocks.queryState[key] ?? defaultValue, setter] as const;
  },
}));

vi.mock("@mui/material", () => ({
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pagination: (props: unknown) => {
    mocks.pagination(props);
    return <div data-testid="task-list-pagination" />;
  },
}));

describe("task-list paging", () => {
  beforeEach(() => {
    mocks.pagination.mockReset();
    mocks.queryState = {};
    mocks.queryStateKeys = [];
    mocks.setters = {};
  });

  it("maps every supported UI sort key to provider request values", () => {
    expect(parseTaskListSortKey("createdAt:desc")).toEqual({
      sortBy: "createdAt",
      sortDir: "desc",
    });
    expect(parseTaskListSortKey("updatedAt:desc")).toEqual({
      sortBy: "updatedAt",
      sortDir: "desc",
    });
    expect(parseTaskListSortKey("title:asc")).toEqual({
      sortBy: "title",
      sortDir: "asc",
    });
  });

  it("uses exact totals when supplied and the page-size heuristic otherwise", () => {
    expect(
      getTaskListPageCount({ page: 2, limit: 50, itemCount: 50 }),
    ).toBe(3);
    expect(
      getTaskListPageCount({ page: 2, limit: 50, itemCount: 49 }),
    ).toBe(2);
    expect(
      getTaskListPageCount({
        page: 2,
        limit: 50,
        itemCount: 50,
        totalCount: 101,
      }),
    ).toBe(3);
  });

  it("uses the tasks prefix by default and resets paging for sort and status changes", () => {
    mocks.queryState.tasksPage = 4;
    const { result } = renderHook(() => useTaskListPaging({}));

    expect(mocks.queryStateKeys).toEqual([
      "tasksPage",
      "tasksSort",
      "tasksSearch",
      "tasksStatus",
    ]);

    act(() => result.current.setSortKey("title:desc"));
    expect(mocks.setters.tasksSort).toHaveBeenCalledWith("title:desc");
    expect(mocks.setters.tasksPage).toHaveBeenCalledWith(1);

    mocks.setters.tasksPage.mockClear();
    act(() => result.current.setStatus("ACTIVE"));
    expect(mocks.setters.tasksStatus).toHaveBeenCalledWith("ACTIVE");
    expect(mocks.setters.tasksPage).toHaveBeenCalledWith(1);
  });

  it("isolates URL state behind a custom prefix", () => {
    renderHook(() => useTaskListPaging({ keyPrefix: "bugs" }));

    expect(mocks.queryStateKeys).toEqual([
      "bugsPage",
      "bugsSort",
      "bugsSearch",
      "bugsStatus",
    ]);
  });

  it("renders the footer only when pagination is visible", () => {
    const onChange = vi.fn();
    const { rerender, queryByTestId } = render(
      <TaskListPagination
        count={1}
        page={1}
        onChange={onChange}
        visible={false}
      />,
    );

    expect(queryByTestId("task-list-pagination")).not.toBeInTheDocument();

    rerender(
      <TaskListPagination
        count={2}
        page={1}
        onChange={onChange}
        visible
      />,
    );

    expect(queryByTestId("task-list-pagination")).toBeInTheDocument();
    expect(mocks.pagination).toHaveBeenCalledWith(
      expect.objectContaining({ count: 2, page: 1, onChange, color: "primary" }),
    );
  });
});
