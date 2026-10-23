import { Box, Pagination, type PaginationProps } from "@mui/material";
import type { TaskSortBy, TaskSortDir } from "@hey-hey/ui-common/api";
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
} from "nuqs";
import React, { useCallback } from "react";

const TASK_LIST_SORT_KEYS = [
  "createdAt:desc",
  "createdAt:asc",
  "title:asc",
  "title:desc",
  "status:asc",
  "priority:asc",
  "updatedAt:desc",
] as const;

export type TaskListSortKey = (typeof TASK_LIST_SORT_KEYS)[number];

const TASK_LIST_SORTS = {
  "createdAt:desc": { sortBy: "createdAt", sortDir: "desc" },
  "createdAt:asc": { sortBy: "createdAt", sortDir: "asc" },
  "title:asc": { sortBy: "title", sortDir: "asc" },
  "title:desc": { sortBy: "title", sortDir: "desc" },
  "status:asc": { sortBy: "status", sortDir: "asc" },
  "priority:asc": { sortBy: "priority", sortDir: "asc" },
  "updatedAt:desc": { sortBy: "updatedAt", sortDir: "desc" },
} satisfies Record<
  TaskListSortKey,
  { sortBy: TaskSortBy; sortDir: TaskSortDir }
>;

export interface UseTaskListPagingOptions {
  keyPrefix?: string;
  defaultLimit?: number;
}

export interface TaskListPageItems {
  itemCount: number;
  totalCount?: number;
}

export interface TaskListPaginationProps {
  count: number;
  page: number;
  onChange: NonNullable<PaginationProps["onChange"]>;
  visible: boolean;
}

export const parseTaskListSortKey = (
  sortKey: TaskListSortKey,
): { sortBy: TaskSortBy; sortDir: TaskSortDir } => TASK_LIST_SORTS[sortKey];

export const getTaskListPageCount = ({
  page,
  limit,
  itemCount,
  totalCount,
}: {
  page: number;
  limit: number;
  itemCount: number;
  totalCount?: number;
}): number =>
  totalCount === undefined
    ? itemCount === limit
      ? page + 1
      : page
    : Math.ceil(totalCount / limit);

export const useTaskListPaging = ({
  keyPrefix = "tasks",
  defaultLimit = 50,
}: UseTaskListPagingOptions) => {
  const [page, setPageState] = useQueryState(
    `${keyPrefix}Page`,
    parseAsInteger.withDefault(1),
  );
  const [sortKey, setSortKeyState] = useQueryState(
    `${keyPrefix}Sort`,
    parseAsStringLiteral(TASK_LIST_SORT_KEYS).withDefault("createdAt:desc"),
  );
  const [search, setSearch] = useQueryState(
    `${keyPrefix}Search`,
    parseAsString.withDefault(""),
  );
  const [status, setStatusState] = useQueryState(
    `${keyPrefix}Status`,
    parseAsString.withDefault(""),
  );

  const setPage = useCallback(
    (nextPage: number): void => {
      void setPageState(nextPage);
    },
    [setPageState],
  );
  const setSortKey = useCallback(
    (nextSortKey: TaskListSortKey): void => {
      void setSortKeyState(nextSortKey);
      void setPageState(1);
    },
    [setPageState, setSortKeyState],
  );
  const setStatus = useCallback(
    (nextStatus: string): void => {
      void setStatusState(nextStatus);
      void setPageState(1);
    },
    [setPageState, setStatusState],
  );

  const { sortBy, sortDir } = parseTaskListSortKey(sortKey);
  const getPaginationProps = useCallback(
    ({ itemCount, totalCount }: TaskListPageItems): TaskListPaginationProps => {
      const count = getTaskListPageCount({
        page,
        limit: defaultLimit,
        itemCount,
        totalCount,
      });

      return {
        count,
        page,
        onChange: (_event, nextPage) => setPage(nextPage),
        visible: count > 1 || page > 1,
      };
    },
    [defaultLimit, page, setPage],
  );

  return {
    page,
    setPage,
    sortKey,
    setSortKey,
    search,
    setSearch,
    status,
    setStatus,
    sortBy,
    sortDir,
    getPaginationProps,
  };
};

export const TaskListPagination: React.FC<TaskListPaginationProps> = ({
  visible,
  ...paginationProps
}) =>
  visible ? (
    <Box display="flex" justifyContent="center" sx={{ pt: 1 }}>
      <Pagination {...paginationProps} color="primary" />
    </Box>
  ) : null;
