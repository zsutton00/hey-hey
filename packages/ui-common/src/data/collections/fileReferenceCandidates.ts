import { captureRequestOptions } from "../core/requestInitiator";
import { queryOptions } from "@tanstack/react-query";
import type {
  FileTouchReferenceCandidateDto,
  ReportsApiListReportFileTouchesByWorkRequest,
} from "../../api";
import { ListReportFileTouchesByWorkEntityTypeEnum } from "../../api";
import { reportsClient } from "../../clients/serviceClients";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
export type FileReferenceScope =
  | { kind: "task"; taskId: string }
  | { kind: "feature"; featureId: string };
export const fileReferenceKeys = {
  root: () => ["fileReferenceCandidates"] as const,
  scope: (
    organizationId: string,
    projectId: string,
    scope: FileReferenceScope
  ) =>
    [
      ...fileReferenceKeys.root(),
      organizationId,
      projectId,
      scope.kind,
      scope.kind === "task" ? scope.taskId : scope.featureId,
    ] as const,
};
export const buildFileReferenceCandidatesRequest = ({
  organizationId,
  projectId,
  scope,
}: {
  organizationId: string;
  projectId: string;
  scope: FileReferenceScope;
}): ReportsApiListReportFileTouchesByWorkRequest => {
  switch (scope.kind) {
    case "task":
      return {
        organizationId,
        projectId,
        entityType: ListReportFileTouchesByWorkEntityTypeEnum.Task,
        entityId: scope.taskId,
      };
    case "feature":
      return {
        organizationId,
        projectId,
        featureId: scope.featureId,
      };
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isFileReferenceCandidate = (
  value: unknown
): value is FileTouchReferenceCandidateDto =>
  isRecord(value) &&
  typeof value.serviceId === "string" &&
  typeof value.serviceName === "string" &&
  typeof value.normalizedPath === "string";

export const parseFileReferenceCandidatesResponse = (
  payload: unknown
): FileTouchReferenceCandidateDto[] => {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new Error(
      "Touched-file lookup response is missing the generated candidate payload."
    );
  }

  const candidates = payload.data.candidates;
  if (
    !Array.isArray(candidates) ||
    !candidates.every(isFileReferenceCandidate)
  ) {
    throw new Error(
      "Touched-file lookup response does not match the generated candidate contract."
    );
  }

  return candidates;
};

export const fileReferenceCandidatesQueryOptions = (
  organizationId: string,
  projectId: string,
  scope: FileReferenceScope
) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: fileReferenceKeys.scope(organizationId, projectId, scope),
    queryFn: async ({ signal }) => {
      const response = await reportsClient.listReportFileTouchesByWork(
        buildFileReferenceCandidatesRequest({
          organizationId,
          projectId,
          scope,
        }),
        { ...captureRequestOptions(), signal }
      );
      return parseFileReferenceCandidatesResponse(response.data);
    },
  });
