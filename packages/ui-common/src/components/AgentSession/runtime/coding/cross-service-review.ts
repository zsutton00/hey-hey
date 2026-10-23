import {
  AgentSessionStatus,
  type AgentSessionDto,
  type TaskResponseDto,
} from "../../../../api";
import type { RepoBinding } from "../types";

const normalizeId = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toUniqueIds = (ids: ReadonlyArray<string>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    result.push(id);
  }

  return result;
};

export interface CrossServiceReviewReadiness {
  linkedServiceIds: string[];
  completedServiceIds: string[];
  incompleteServiceIds: string[];
  repositoryPaths: string[];
  missingRepositoryServiceIds: string[];
  isTaskMultiService: boolean;
  allServicesCompleted: boolean;
  hasRepositoryCoverage: boolean;
  canStartCrossServiceReview: boolean;
}

export interface EvaluateCrossServiceReviewReadinessInput {
  linkedServiceIds: ReadonlyArray<string>;
  agentSessions: ReadonlyArray<
    Pick<AgentSessionDto, "launchServiceId" | "status">
  >;
  repoBindings: ReadonlyArray<RepoBinding>;
}

export const extractLinkedServiceIdsFromTask = (
  task: Pick<TaskResponseDto, "serviceRelations"> | null | undefined
): string[] => {
  if (!task?.serviceRelations?.length) {
    return [];
  }

  const linkedServiceIds = task.serviceRelations
    .map((relation) => normalizeId(relation.serviceId))
    .filter((serviceId): serviceId is string => serviceId !== null);

  return toUniqueIds(linkedServiceIds);
};

const buildCompletedServiceSet = (
  agentSessions: ReadonlyArray<
    Pick<AgentSessionDto, "launchServiceId" | "status">
  >
): Set<string> => {
  const completedServiceIds = agentSessions
    .filter((session) => session.status === AgentSessionStatus.Completed)
    .map((session) => normalizeId(session.launchServiceId))
    .filter((serviceId): serviceId is string => serviceId !== null);

  return new Set(completedServiceIds);
};

const buildRepositoryPathByServiceId = (
  repoBindings: ReadonlyArray<RepoBinding>
): Map<string, string> => {
  const byServiceId = new Map<string, string>();

  for (const binding of repoBindings) {
    const serviceId = normalizeId(binding.serviceId);
    const repositoryPath = normalizeId(binding.repositoryPath);
    if (!serviceId || !repositoryPath) {
      continue;
    }

    byServiceId.set(serviceId, repositoryPath);
  }

  return byServiceId;
};

export const evaluateCrossServiceReviewReadiness = ({
  linkedServiceIds: linkedServiceIdsRaw,
  agentSessions,
  repoBindings,
}: EvaluateCrossServiceReviewReadinessInput): CrossServiceReviewReadiness => {
  const linkedServiceIds = toUniqueIds(
    linkedServiceIdsRaw
      .map((serviceId) => normalizeId(serviceId))
      .filter((serviceId): serviceId is string => serviceId !== null)
  );

  const completedServiceSet = buildCompletedServiceSet(agentSessions);
  const completedServiceIds = linkedServiceIds.filter((serviceId) =>
    completedServiceSet.has(serviceId)
  );
  const incompleteServiceIds = linkedServiceIds.filter(
    (serviceId) => !completedServiceSet.has(serviceId)
  );

  const repositoryPathByServiceId =
    buildRepositoryPathByServiceId(repoBindings);
  const missingRepositoryServiceIds = linkedServiceIds.filter(
    (serviceId) => !repositoryPathByServiceId.has(serviceId)
  );
  const repositoryPaths = toUniqueIds(
    linkedServiceIds
      .map((serviceId) => repositoryPathByServiceId.get(serviceId))
      .filter((repositoryPath): repositoryPath is string =>
        Boolean(repositoryPath)
      )
  );

  const isTaskMultiService = linkedServiceIds.length > 1;
  const allServicesCompleted =
    linkedServiceIds.length > 0 && incompleteServiceIds.length === 0;
  const hasRepositoryCoverage =
    linkedServiceIds.length > 0 && missingRepositoryServiceIds.length === 0;

  return {
    linkedServiceIds,
    completedServiceIds,
    incompleteServiceIds,
    repositoryPaths,
    missingRepositoryServiceIds,
    isTaskMultiService,
    allServicesCompleted,
    hasRepositoryCoverage,
    canStartCrossServiceReview:
      isTaskMultiService && allServicesCompleted && hasRepositoryCoverage,
  };
};
