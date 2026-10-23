import {
  workItemFileHistoryQueryOptions,
  fileTaskHistoryQueryOptions,
  serviceFileHistoryQueryOptions,
  type FileTaskHistoryEntry,
  type FileTaskHistoryKey,
  type ServiceFileHistoryEntry,
  type WorkItemFileHistory,
  type WorkItemFileHistoryScope,
} from "../collections/fileTouchHistory";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export type {
  FileTaskHistoryEntry,
  FileTaskHistoryKey,
} from "../collections/fileTouchHistory";
export type {
  FeatureFileSection,
  FileHistoryFile,
  SupportedFilesTabType,
  WorkItemFileHistory,
  WorkItemFileHistoryScope,
  ServiceFileHistoryEntry,
  ServiceFileHistoryKey,
  ServiceFileHistoryPage,
} from "../collections/fileTouchHistory";
export {
  FileTouchServiceHistorySortBy,
  FileTouchServiceHistorySortOrder,
} from "../collections/fileTouchHistory";

export interface WorkItemFileHistoryInput {
  organizationId?: string;
  projectId?: string;
  scope?: WorkItemFileHistoryScope;
  active: boolean;
}

export interface FileTaskHistoryInput extends FileTaskHistoryKey {
  active: boolean;
}

export interface ServiceFileHistoryInput {
  organizationId?: string;
  projectId?: string;
  serviceId?: string;
  pathFilter: string;
  sortBy: import("../collections/fileTouchHistory").FileTouchServiceHistorySortBy;
  sortOrder: import("../collections/fileTouchHistory").FileTouchServiceHistorySortOrder;
  cursor?: string;
  active: boolean;
}

export type WorkItemFileHistoryState =
  | { status: "disabled"; history: null; isFetching: false }
  | { status: "loading"; history: null; isFetching: true }
  | {
      status: "updating";
      history: WorkItemFileHistory;
      isFetching: true;
    }
  | {
      status: "ready";
      history: WorkItemFileHistory;
      isFetching: false;
    }
  | {
      status: "empty";
      history: WorkItemFileHistory;
      isFetching: false;
    }
  | {
      status: "error";
      history: null;
      isFetching: false;
      error: Error;
    };

export type FileTaskHistoryState =
  | { status: "disabled"; entries: readonly []; isFetching: false }
  | { status: "loading"; entries: readonly []; isFetching: true }
  | {
      status: "updating";
      entries: readonly FileTaskHistoryEntry[];
      isFetching: true;
    }
  | {
      status: "ready";
      entries: readonly FileTaskHistoryEntry[];
      isFetching: false;
    }
  | { status: "empty"; entries: readonly []; isFetching: false }
  | {
      status: "error";
      entries: readonly [];
      isFetching: false;
      error: Error;
    };

export type ServiceFileHistoryState =
  | {
      status: "disabled";
      files: readonly [];
      nextCursor: null;
      isFetching: false;
    }
  | {
      status: "loading";
      files: readonly [];
      nextCursor: null;
      isFetching: true;
    }
  | {
      status: "updating";
      files: readonly ServiceFileHistoryEntry[];
      nextCursor: string | null;
      isFetching: true;
    }
  | {
      status: "ready";
      files: readonly ServiceFileHistoryEntry[];
      nextCursor: string | null;
      isFetching: false;
    }
  | { status: "empty"; files: readonly []; nextCursor: null; isFetching: false }
  | {
      status: "error";
      files: readonly [];
      nextCursor: null;
      isFetching: false;
      error: Error;
    };

export const useWorkItemFileHistory = ({
  organizationId,
  projectId,
  scope,
  active,
}: WorkItemFileHistoryInput): WorkItemFileHistoryState => {
  const enabled = Boolean(active && organizationId && projectId && scope);
  const { result, state: query } = useDataLayerQuery(
    workItemFileHistoryQueryOptions(
      organizationId ?? "",
      projectId ?? "",
      scope ?? { kind: "task", taskId: "" }
    ),
    { enabled }
  );

  if (!enabled) {
    return { status: "disabled", history: null, isFetching: false };
  }
  if (query.error) {
    return {
      status: "error",
      history: null,
      isFetching: false,
      error: query.error,
    };
  }

  const history = result.data ?? null;
  if (query.isFetching && history) {
    return { status: "updating", history, isFetching: true };
  }
  if (query.isLoading || !query.isFetched || !history) {
    return { status: "loading", history: null, isFetching: true };
  }

  const isEmpty =
    history.kind === "task"
      ? history.files.length === 0
      : history.sections.every((section) => section.files.length === 0);
  return isEmpty
    ? { status: "empty", history, isFetching: false }
    : { status: "ready", history, isFetching: false };
};

export const useFileTaskHistory = ({
  organizationId,
  projectId,
  serviceId,
  normalizedPath,
  active,
}: FileTaskHistoryInput): FileTaskHistoryState => {
  const hasCompleteIdentity = Boolean(
    active && organizationId && projectId && serviceId && normalizedPath
  );
  const enabled = hasCompleteIdentity;
  const { result, state: query } = useDataLayerQuery(
    fileTaskHistoryQueryOptions({ organizationId, projectId, serviceId, normalizedPath }),
    { enabled }
  );

  if (!enabled) {
    return { status: "disabled", entries: [], isFetching: false };
  }
  if (query.error) {
    return {
      status: "error",
      entries: [],
      isFetching: false,
      error: query.error,
    };
  }

  const entries = result.data ?? [];
  if (query.isFetching && entries.length > 0) {
    return { status: "updating", entries, isFetching: true };
  }
  if (query.isLoading || !query.isFetched) {
    return { status: "loading", entries: [], isFetching: true };
  }
  return entries.length === 0
    ? { status: "empty", entries: [], isFetching: false }
    : { status: "ready", entries, isFetching: false };
};

export const useServiceFileHistory = ({
  organizationId,
  projectId,
  serviceId,
  pathFilter,
  sortBy,
  sortOrder,
  cursor,
  active,
}: ServiceFileHistoryInput): ServiceFileHistoryState => {
  const enabled = Boolean(active && organizationId && projectId && serviceId);
  const { result, state: query } = useDataLayerQuery(
    serviceFileHistoryQueryOptions({
      organizationId: organizationId ?? "",
      projectId: projectId ?? "",
      serviceId: serviceId ?? "",
      pathFilter,
      sortBy,
      sortOrder,
      cursor,
    }),
    { enabled }
  );

  if (!enabled) {
    return {
      status: "disabled",
      files: [],
      nextCursor: null,
      isFetching: false,
    };
  }
  if (query.error) {
    return {
      status: "error",
      files: [],
      nextCursor: null,
      isFetching: false,
      error: query.error,
    };
  }
  const page = result.data ?? null;
  if (query.isFetching && page) {
    return {
      status: "updating",
      files: page.files,
      nextCursor: page.nextCursor,
      isFetching: true,
    };
  }
  if (query.isLoading || !query.isFetched || !page) {
    return { status: "loading", files: [], nextCursor: null, isFetching: true };
  }
  return page.files.length === 0
    ? { status: "empty", files: [], nextCursor: null, isFetching: false }
    : {
        status: "ready",
        files: page.files,
        nextCursor: page.nextCursor,
        isFetching: false,
      };
};

export const useFileTouchHistory = useWorkItemFileHistory;
