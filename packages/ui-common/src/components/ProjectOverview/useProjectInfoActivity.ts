import React from "react";
import {
  ProposalAction,
  TargetEntityType,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
  type ProposalResponseDto,
} from "../../api";
import type { WorkItemIconIdentity } from "../../utils/entityIcons";
import { useProposals } from "../../data/hooks/useProposals";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import { useWorkItems } from "../../data/hooks/useWorkItems";
import {
  readSettled,
  isRecord,
  getProjectInfoProposalIconType,
  activityIdentity,
  useIdentitySnapshot,
} from "./projectInfoActivityState";
const PROJECT_INFO_PROPOSAL_PAGE_SIZE = 8;

export type ProjectInfoActivityProposal = {
  proposal: ProposalResponseDto;
  iconType: string;
  workItemIcon?: WorkItemIconIdentity;
};

type PaginatedProjectInfoProposals = {
  data: ProposalResponseDto[];
  requestedPage: number;
  total: number;
  page: number;
  totalPages: number;
  isLoading: boolean;
  isFetching: boolean;
  isReady: boolean;
  error: Error | null;
  refetch: () => Promise<ProposalResponseDto[] | null>;
  goToPage: (page: number) => void;
};

const usePaginatedProjectInfoProposals = (
  organizationId: string,
  projectId: string,
  action: ProposalAction,
  windowStart: string | undefined,
  windowEnd: string | undefined
): PaginatedProjectInfoProposals => {
  const [selection, setSelection] = React.useState({ scope: "", page: 1 });
  const scope = activityIdentity([
    organizationId,
    projectId,
    action,
    windowStart,
    windowEnd,
  ]);
  const page = selection.scope === scope ? selection.page : 1;
  if (selection.scope !== scope) setSelection({ scope, page: 1 });
  const query = useProposals(organizationId, projectId, {
    action,
    workItemRole: WorkItemTypeRole.ProjectInfo,
    windowStart,
    windowEnd,
    enabled: projectId.length > 0,
    limit: PROJECT_INFO_PROPOSAL_PAGE_SIZE,
    offset: (page - 1) * PROJECT_INFO_PROPOSAL_PAGE_SIZE,
  });

  const totalPages =
    query.pagination?.totalPages ??
    (query.data.length >= PROJECT_INFO_PROPOSAL_PAGE_SIZE ? page + 1 : page);
  const goToPage = React.useCallback(
    (nextPage: number) => {
      if (
        nextPage < 1 ||
        nextPage > totalPages ||
        nextPage === page ||
        query.isFetching
      ) {
        return;
      }
      setSelection({ scope, page: nextPage });
    },
    [page, query.isFetching, totalPages, scope]
  );

  return {
    data: query.data,
    requestedPage: page,
    total: query.pagination?.total ?? query.data.length,
    page: query.pagination?.page ?? page,
    totalPages,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isReady: query.isReady,
    error: query.error,
    refetch: query.refetch,
    goToPage,
  };
};

export const useProjectInfoActivity = (
  organizationId: string,
  projectId: string,
  activeTab: "created" | "updated",
  windowStart?: string,
  windowEnd?: string
) => {
  const registryQuery = useWorkItemTypes(organizationId, { projectId });
  const createdQuery = usePaginatedProjectInfoProposals(
    organizationId,
    projectId,
    ProposalAction.Create,
    windowStart,
    windowEnd
  );
  const updatedQuery = usePaginatedProjectInfoProposals(
    organizationId,
    projectId,
    ProposalAction.Update,
    windowStart,
    windowEnd
  );

  const identity = activityIdentity([
    organizationId,
    projectId,
    activeTab,
    createdQuery.requestedPage,
    updatedQuery.requestedPage,
    WorkItemTypeRole.ProjectInfo,
    PROJECT_INFO_PROPOSAL_PAGE_SIZE,
    windowStart,
    windowEnd,
  ]);
  const proposalsReady = readSettled(createdQuery) && readSettled(updatedQuery);
  const proposalSnapshot = useIdentitySnapshot(
    identity,
    proposalsReady
      ? { created: createdQuery.data, updated: updatedQuery.data }
      : undefined
  );
  const registryByKey = React.useMemo(() => {
    const entries = registryQuery.workItemTypes
      .filter(
        (summary) =>
          summary.projectId === projectId &&
          summary.status === WorkItemTypeLifecycleStatus.Active
      )
      .map((summary) => [summary.definition.key, summary] as const);
    return new Map(entries);
  }, [projectId, registryQuery.workItemTypes]);

  const taskTargetIds = React.useMemo(() => {
    if (!proposalSnapshot) return [];

    return [...proposalSnapshot.created, ...proposalSnapshot.updated]
      .filter((proposal) => {
        if (proposal.targetEntityType !== TargetEntityType.Task) return false;
        const updates = isRecord(proposal.updates) ? proposal.updates : null;
        return (
          typeof updates?.type !== "string" || updates.type.trim().length === 0
        );
      })
      .map((proposal) => proposal.targetEntityId)
      .filter((id) => id.length > 0)
      .filter((id, index, ids) => ids.indexOf(id) === index);
  }, [proposalSnapshot]);

  const targetTasksQuery = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    {
      taskIds: taskTargetIds,
      enabled: taskTargetIds.length > 0,
      websocketsEnabled: false,
    }
  );

  const targetTypes = React.useMemo(
    () =>
      new Map(targetTasksQuery.workItems.map((item) => [item.id, item.type])),
    [targetTasksQuery.workItems]
  );

  const decorateProposals = React.useCallback(
    (proposals: ProposalResponseDto[]): ProjectInfoActivityProposal[] =>
      proposals.map((proposal) => ({
        proposal,
        ...getProjectInfoProposalIconType(proposal, registryByKey, targetTypes),
      })),
    [registryByKey, targetTypes]
  );

  const created = React.useMemo(
    () => decorateProposals(createdQuery.data),
    [decorateProposals, createdQuery.data]
  );
  const updated = React.useMemo(
    () => decorateProposals(updatedQuery.data),
    [decorateProposals, updatedQuery.data]
  );

  const reads = [
    createdQuery,
    updatedQuery,
    registryQuery,
    ...(taskTargetIds.length ? [targetTasksQuery] : []),
  ];
  const activityError = reads.find((read) => read.error)?.error ?? null;
  const settled = reads.every(readSettled);
  const pending = reads.some(
    (read) =>
      read.isLoading || read.isFetching || (!read.isReady && !read.error)
  );
  const snapshot = useIdentitySnapshot(
    identity,
    settled
      ? {
          created,
          updated,
          createdPage: {
            total: createdQuery.total,
            page: createdQuery.page,
            totalPages: createdQuery.totalPages,
          },
          updatedPage: {
            total: updatedQuery.total,
            page: updatedQuery.page,
            totalPages: updatedQuery.totalPages,
          },
        }
      : undefined
  );
  const retryActivity = React.useCallback(() => {
    void Promise.all([
      registryQuery.refetch(),
      createdQuery.refetch(),
      updatedQuery.refetch(),
      ...(taskTargetIds.length > 0 ? [targetTasksQuery.refetch()] : []),
    ]).catch(() => undefined);
  }, [
    createdQuery,
    registryQuery,
    targetTasksQuery,
    taskTargetIds.length,
    updatedQuery,
  ]);

  return {
    identity,
    snapshot,
    activityError,
    pending,
    retryActivity,
    createdQuery,
    updatedQuery,
  };
};
