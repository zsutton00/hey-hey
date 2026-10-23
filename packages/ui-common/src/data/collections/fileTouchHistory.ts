import type {
  FileTouchServiceHistoryDto,
  FileTouchServiceHistoryEntryDto,
  FileTouchTaskHistoryDto,
  FileTouchTaskHistoryEntryDto,
  FileTouchTaskHistoryEvidenceDto,
  FileTouchReferenceCandidateDto,
  ReportsApiListReportFileTouchesByWorkRequest,
} from "../../api";
import { z } from "zod";
import {
  FileTouchServiceHistorySortBy,
  FileTouchServiceHistorySortOrder,
  ListReportFileTouchesByWorkEntityTypeEnum,
} from "../../api";
import { reportsClient } from "../../clients/serviceClients";
import { queryOptions } from "@tanstack/react-query";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

export type SupportedFilesTabType = "FEATURE" | "STANDARD" | "BUG";

export interface FileHistoryFile {
  serviceId: string;
  serviceName: string;
  normalizedPath: string;
}

export interface FeatureFileSection {
  featureId: string;
  featureName: string;
  featurePath: string;
  files: readonly FileHistoryFile[];
}

export type WorkItemFileHistory =
  | { kind: "task"; files: readonly FileHistoryFile[] }
  | { kind: "feature"; sections: readonly FeatureFileSection[] };

export interface FileTaskHistoryKey {
  organizationId: string;
  projectId: string;
  serviceId: string;
  normalizedPath: string;
}

export type FileTaskHistoryEvidence = FileTouchTaskHistoryEvidenceDto;

export type FileTaskHistoryEntry = Omit<
  FileTouchTaskHistoryEntryDto,
  "evidence"
> & {
  evidence: readonly FileTaskHistoryEvidence[];
};

export type ServiceFileHistoryEntry = FileTouchServiceHistoryEntryDto;

export interface ServiceFileHistoryPage {
  files: readonly ServiceFileHistoryEntry[];
  nextCursor: string | null;
}

export interface ServiceFileHistoryKey {
  organizationId: string;
  projectId: string;
  serviceId: string;
  pathFilter: string;
  sortBy: FileTouchServiceHistorySortBy;
  sortOrder: FileTouchServiceHistorySortOrder;
  cursor?: string;
}

const normalizeRepoPath = (path: string): string =>
  path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^\.\/+/, "")
    .replace(/\/{2,}/g, "/");

export type WorkItemFileHistoryScope =
  | { kind: "task"; taskId: string }
  | { kind: "feature"; featureId: string };

export const fileHistoryKeys = {
  root: () => ["fileHistory"] as const,
  workItem: (
    organizationId: string,
    projectId: string,
    scope: WorkItemFileHistoryScope
  ) => [
    "fileHistory", organizationId, projectId, "workItem", scope.kind,
    scope.kind === "task" ? scope.taskId : scope.featureId,
  ] as const,
  file: (key: FileTaskHistoryKey) =>
    ["fileHistory", key.organizationId, key.projectId, "file", key.serviceId, normalizeRepoPath(key.normalizedPath)] as const,
  service: (key: ServiceFileHistoryKey) =>
    ["fileHistory", key.organizationId, key.projectId, "service", key.serviceId, key.pathFilter.trim(), key.sortBy, key.sortOrder, key.cursor ?? ""] as const,
};

export const buildWorkItemFileHistoryRequest = ({
  organizationId,
  projectId,
  scope,
}: {
  organizationId: string;
  projectId: string;
  scope: WorkItemFileHistoryScope;
}): ReportsApiListReportFileTouchesByWorkRequest =>
  scope.kind === "task"
    ? {
        organizationId,
        projectId,
        entityType: ListReportFileTouchesByWorkEntityTypeEnum.Task,
        entityId: scope.taskId,
      }
    : {
        organizationId,
        projectId,
        featureId: scope.featureId,
      };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isString = (value: unknown): value is string => typeof value === "string";

const isFileHistoryFile = (value: unknown): value is FileHistoryFile =>
  isRecord(value) &&
  isString(value.serviceId) &&
  isString(value.serviceName) &&
  isString(value.normalizedPath);

const toFileHistoryFile = (file: FileHistoryFile): FileHistoryFile => ({
  serviceId: file.serviceId,
  serviceName: file.serviceName,
  normalizedPath: normalizeRepoPath(file.normalizedPath),
});

const parseFiles = (value: unknown): FileHistoryFile[] => {
  if (!Array.isArray(value) || !value.every(isFileHistoryFile)) {
    throw new Error(
      "File history response does not match the generated file contract."
    );
  }
  return value.map(toFileHistoryFile);
};

const parseFeatureSections = (value: unknown): FeatureFileSection[] => {
  if (!Array.isArray(value)) {
    throw new Error(
      "File history response is missing generated feature sections."
    );
  }

  return value.map((section) => {
    if (!isRecord(section) || !isString(section.featureId)) {
      throw new Error(
        "File history response contains an invalid feature section."
      );
    }
    return {
      featureId: section.featureId,
      featureName: isString(section.featureName)
        ? section.featureName
        : section.featureId,
      featurePath: isString(section.featurePath) ? section.featurePath : "",
      files: parseFiles(section.files),
    };
  });
};

export const parseWorkItemFileHistoryResponse = (
  payload: unknown,
  scope: WorkItemFileHistoryScope
): WorkItemFileHistory => {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new Error(
      "File history lookup response is missing the generated payload."
    );
  }

  const data = payload.data;
  if (scope.kind === "feature" && "sections" in data) {
    return { kind: "feature", sections: parseFeatureSections(data.sections) };
  }

  if (scope.kind === "task" && "files" in data) {
    return { kind: "task", files: parseFiles(data.files) };
  }

  if ("candidates" in data) {
    const files = parseFiles(data.candidates);
    return scope.kind === "task"
      ? { kind: "task", files }
      : {
          kind: "feature",
          sections: [
            {
              featureId: scope.featureId,
              featureName: scope.featureId,
              featurePath: "",
              files,
            },
          ],
        };
  }

  throw new Error(
    "File history lookup response does not match the generated contract."
  );
};

const fileTaskHistoryEvidenceSchema: z.ZodType<FileTouchTaskHistoryEvidenceDto> =
  z.object({
    reportId: z.string(),
    agentSessionId: z.string(),
    agentSessionTitle: z.string(),
    createdAt: z.string(),
  });

const fileTaskHistoryEntrySchema: z.ZodType<FileTouchTaskHistoryEntryDto> =
  z.object({
    taskId: z.string(),
    taskName: z.string(),
    taskType: z.string(),
    directFeatureId: z.string().nullable(),
    directFeatureName: z.string().nullable(),
    touchCount: z.number().finite(),
    firstTouchedAt: z.string(),
    lastTouchedAt: z.string(),
    evidence: z.array(fileTaskHistoryEvidenceSchema),
  });

const fileTaskHistorySchema: z.ZodType<FileTouchTaskHistoryDto> = z.object({
  tasks: z.array(fileTaskHistoryEntrySchema),
});

const fileTaskHistoryResponseSchema = z.object({
  data: fileTaskHistorySchema,
});

const serviceFileHistoryEntrySchema: z.ZodType<FileTouchServiceHistoryEntryDto> =
  z.object({
    serviceId: z.string(),
    serviceName: z.string(),
    normalizedPath: z.string(),
    touchCount: z.number().finite(),
    firstTouchedAt: z.string(),
    lastTouchedAt: z.string(),
    latestTaskId: z.string(),
    latestTaskName: z.string(),
    latestTaskType: z.string(),
    latestAgentSessionId: z.string(),
    latestAgentSessionTitle: z.string(),
    latestReportId: z.string(),
  });

const serviceFileHistorySchema: z.ZodType<FileTouchServiceHistoryDto> =
  z.object({
    files: z.array(serviceFileHistoryEntrySchema),
    nextCursor: z.string().nullable(),
  });

const serviceFileHistoryResponseSchema = z.object({
  data: serviceFileHistorySchema,
});

export const parseServiceFileHistoryResponse = (
  payload: unknown
): ServiceFileHistoryPage => {
  const result = serviceFileHistoryResponseSchema.safeParse(payload);
  if (!result.success) {
    throw new Error(
      "Service file history response does not match the generated contract."
    );
  }
  return {
    files: result.data.data.files.map((file) => ({
      ...file,
      normalizedPath: normalizeRepoPath(file.normalizedPath),
    })),
    nextCursor: result.data.data.nextCursor,
  };
};

export const parseFileTaskHistoryResponse = (
  payload: unknown
): FileTaskHistoryEntry[] => {
  const result = fileTaskHistoryResponseSchema.safeParse(payload);
  if (!result.success) {
    throw new Error(
      "File task history lookup response does not match the generated contract."
    );
  }

  return result.data.data.tasks.map((entry) => ({
    ...entry,
    evidence: [...entry.evidence],
  }));
};

export function workItemFileHistoryQueryOptions(
  organizationId: string,
  projectId: string,
  scope: WorkItemFileHistoryScope
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: fileHistoryKeys.workItem(organizationId, projectId, scope),
    queryFn: async ({ signal }) => {
      const response = await reportsClient.listReportFileTouchesByWork(
        buildWorkItemFileHistoryRequest({ organizationId, projectId, scope }),
        { ...captureRequestOptions(), signal }
      );
      return parseWorkItemFileHistoryResponse(response.data, scope);
    },
  });
}

export function fileTaskHistoryQueryOptions(key: FileTaskHistoryKey) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: fileHistoryKeys.file(key),
    queryFn: async ({ signal }) => {
      const response = await reportsClient.listReportFileHistoryByFile(
        {
          organizationId: key.organizationId,
          projectId: key.projectId,
          serviceId: key.serviceId,
          path: normalizeRepoPath(key.normalizedPath),
        },
        { ...captureRequestOptions(), signal }
      );
      return parseFileTaskHistoryResponse(response.data);
    },
  });
}

export function serviceFileHistoryQueryOptions(key: ServiceFileHistoryKey) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: fileHistoryKeys.service(key),
    queryFn: async ({ signal }) => {
      const pathFilter = key.pathFilter.trim();
      const response = await reportsClient.listReportFileHistoryByService(
        {
          organizationId: key.organizationId,
          projectId: key.projectId,
          serviceId: key.serviceId,
          ...(pathFilter ? { pathFilter } : {}),
          sortBy: key.sortBy,
          sortOrder: key.sortOrder,
          ...(key.cursor ? { cursor: key.cursor } : {}),
          limit: 50,
        },
        { ...captureRequestOptions(), signal }
      );
      return parseServiceFileHistoryResponse(response.data);
    },
  });
}

export type { FileTouchReferenceCandidateDto };
export { FileTouchServiceHistorySortBy, FileTouchServiceHistorySortOrder };
