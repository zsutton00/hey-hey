import { useFeatureLookup } from "../../data/hooks/useFeatureHierarchy";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Alert,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState, type FC } from "react";
import {
  ProposalAction,
  ProposalEdgeTargetType,
  ProposalStatus,
  WorkItemChangeSetMaterializationState,
  type WorkItemGraphAggregateResponseDto,
  type ProjectedWorkItemRelationship,
  type ProposalEdgeDeclaration,
  type ProposalResponseDto,
  type WorkItemChangeSetValidationRequest,
  type WorkItemChangeSetIdentity,
  type WorkItemChangeSetRelationshipIdentity,
  type WorkItemTypeDefinitionDto,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { useWorkItemGraph } from "../../data/hooks/useWorkItemGraph";
import { getResponseStatus } from "../../data/query/queryPolicy";
import type { ApprovalProgress } from "../../permissions";
import type {
  WorkItemGraphExternalEntity,
  WorkflowGraphCreatedElements,
  WorkflowGraphDirectEntityLink,
  WorkflowGraphDiffElements,
  WorkflowGraphPresentationState,
  WorkflowGraphSurfaceData,
  WorkItemGraphProjectionData,
} from "../shared/WorkflowMentionInlineRenderer";
import { WorkflowGraphSurface } from "../shared/WorkflowMentionInlineRenderer";
import type { WorkItemGraphDraftProjection } from "../shared/workItemGraphDraft";
import { ProposalEdges } from "./ProposalEdges";
import { ProposalStateIndicator } from "./ProposalStateIndicator";
import type { ProposalItemStatus } from "./types";
import { WorkItemGraphMaterializationProgress } from "./WorkItemGraphMaterializationProgress";
import { useWorkItemGraphProposalReview } from "./useWorkItemGraphProposalReview";
import type { ProposalRenderOverrides } from "./proposalRenderOverrides";
import { ProposalTitle } from "./ProposalTitle";
import { getProposalDisplayTitle } from "./getProposalDisplayTitle";
import { staticProposalTypePresentation } from "./proposalHeaderType";
import type { DiffViewMode } from "../SuggestedContent";
import { WorkItemGraphChangeSummary } from "./WorkItemGraphChangeSummary";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import { getCreatedGraphRootType, isPlaceholderEntityId } from "./types";
import { useWorkItem } from "../../data/hooks/useWorkItem";

interface WorkItemGraphProposal extends ProposalResponseDto {
  updates: WorkItemChangeSetValidationRequest;
}

const publishedWorkItemGraphData = (
  aggregate: WorkItemGraphAggregateResponseDto | null,
): WorkflowGraphSurfaceData | null => {
  if (!aggregate) return null;

  return {
    workflow: aggregate.root,
    steps: aggregate.children,
    edges: aggregate.relationships,
    participation: aggregate.participation,
    layout: aggregate.layout,
  };
};

function isTerminalGraphReadError(error: Error | null): boolean {
  if (!error) return false;
  const status = getResponseStatus(error);
  // Missing publication, transport failures, and retryable responses do not
  // establish that the approved graph has failed.
  return (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 404 &&
    status !== 408 &&
    status !== 429
  );
}

const PUBLISHED_GRAPH_POLL_BASE_MS = 1000;
const PUBLISHED_GRAPH_POLL_MAX_MS = 30_000;

const PublishedWorkItemGraph: FC<{
  proposal: WorkItemGraphProposal;
  organizationId: string;
  projectId: string;
  typeDefinitions: readonly WorkItemTypeDefinitionDto[];
  registryLoading: boolean;
  registryError: Error | null;
}> = ({
  proposal,
  organizationId,
  projectId,
  typeDefinitions,
  registryLoading,
  registryError,
}) => {
  // A failed application leaves the placeholder target; never read it.
  const hasTarget = !isPlaceholderEntityId(proposal.targetEntityId);
  const graphQuery = useWorkItemGraph(
    organizationId,
    projectId,
    proposal.targetEntityId,
    { enabled: hasTarget, refetchOnMount: true },
  );
  const graphData = publishedWorkItemGraphData(graphQuery.data);
  const materializationState = proposal.materialization?.state;
  const awaitingPublication =
    materializationState !== undefined &&
    materializationState !== WorkItemChangeSetMaterializationState.Published;
  const terminalReadFailure = isTerminalGraphReadError(graphQuery.error);
  const [pollAttempts, setPollAttempts] = useState(0);
  const awaitingAggregate = hasTarget && !graphData && !terminalReadFailure;

  useEffect(() => {
    setPollAttempts(0);
  }, [materializationState, proposal.targetEntityId]);

  useEffect(() => {
    if (
      !hasTarget ||
      terminalReadFailure ||
      graphQuery.isFetching ||
      !graphQuery.isFetched ||
      (!awaitingPublication && !awaitingAggregate)
    )
      return;
    const delay = Math.min(
      PUBLISHED_GRAPH_POLL_BASE_MS * 2 ** pollAttempts,
      PUBLISHED_GRAPH_POLL_MAX_MS,
    );
    const timer = setTimeout(() => {
      setPollAttempts((attempts) => attempts + 1);
      void graphQuery.refetch().catch(() => undefined);
    }, delay);
    return () => clearTimeout(timer);
  }, [
    hasTarget,
    terminalReadFailure,
    pollAttempts,
    awaitingPublication,
    awaitingAggregate,
    graphQuery.isFetching,
    graphQuery.isFetched,
    graphQuery.refetch,
  ]);

  if (!hasTarget && !awaitingPublication) {
    return (
      <Alert severity="error" data-testid="published-work-item-graph-error">
        The approved graph has no published target.
      </Alert>
    );
  }
  const graphAuthorized = Boolean(
    graphQuery.data &&
    typeDefinitions.find(({ key }) => key === graphQuery.data?.root.type)
      ?.capabilities?.graph?.rendererKey === "work-item-graph",
  );

  if (
    (awaitingPublication && !terminalReadFailure) ||
    awaitingAggregate ||
    !graphQuery.isFetched ||
    graphQuery.isFetching ||
    registryLoading
  ) {
    return (
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        data-testid="published-work-item-graph-loading"
      >
        <CircularProgress size={18} />
        <Typography variant="body2">Loading published graph…</Typography>
      </Stack>
    );
  }

  if (terminalReadFailure || !graphData) {
    return (
      <Alert severity="error" data-testid="published-work-item-graph-error">
        The published graph could not be loaded.
      </Alert>
    );
  }

  if (registryError || !graphAuthorized) {
    return (
      <Alert severity="warning" data-testid="work-item-graph-unavailable">
        {registryError
          ? "The work-item type registry is unavailable."
          : "Graph rendering is unavailable for this work-item type."}
      </Alert>
    );
  }

  return <WorkflowGraphSurface graphData={graphData} allowFullscreen />;
};

const ProjectedWorkItemGraph: FC<{
  organizationId: string;
  projectId: string;
  rootId?: string;
  projection: WorkItemGraphDraftProjection;
  createdElements: WorkflowGraphCreatedElements;
  diffElements: WorkflowGraphDiffElements;
  presentationState: WorkflowGraphPresentationState;
  directEntityLinks: readonly WorkflowGraphDirectEntityLink[];
}> = ({
  organizationId,
  projectId,
  rootId,
  projection,
  createdElements,
  diffElements,
  presentationState,
  directEntityLinks,
}) => {
  const baselineGraphQuery = useWorkItemGraph(
    organizationId,
    projectId,
    rootId,
    { enabled: Boolean(rootId) },
  );

  return (
    <WorkflowGraphSurface
      mode="view"
      organizationId={organizationId}
      projectId={projectId}
      projection={projection}
      participation={baselineGraphQuery.data?.participation ?? null}
      createdElements={createdElements}
      diffElements={diffElements}
      presentationState={presentationState}
      directEntityLinks={directEntityLinks}
      allowFullscreen
    />
  );
};

const getCreatedGraphElements = (
  updates: WorkItemChangeSetValidationRequest,
): WorkflowGraphCreatedElements => ({
  children: updates.operations.flatMap((operation) =>
    operation.op === "workItem.create" ? [operation.ref] : [],
  ),
  relationships: updates.operations.flatMap((operation) =>
    operation.op === "relationship.create" ? [operation.ref] : [],
  ),
});

const getGraphDiffElements = (
  updates: WorkItemChangeSetValidationRequest,
): WorkflowGraphDiffElements => {
  const addedChildren = new Map<string, WorkItemChangeSetIdentity>();
  const changedChildren = new Map<string, WorkItemChangeSetIdentity>();
  const deletedChildren = new Map<string, WorkItemChangeSetIdentity>();
  const addedRelationships = new Map<
    string,
    WorkItemChangeSetRelationshipIdentity
  >();
  const changedRelationships = new Map<
    string,
    WorkItemChangeSetRelationshipIdentity
  >();
  const deletedRelationships = new Map<
    string,
    WorkItemChangeSetRelationshipIdentity
  >();

  updates.operations.forEach((operation) => {
    switch (operation.op) {
      case "workItem.create":
        addedChildren.set(graphIdentityKey(operation.ref), operation.ref);
        break;
      case "workItem.update":
      case "section.replace":
      case "section.clear":
        changedChildren.set(graphIdentityKey(operation.ref), operation.ref);
        break;
      case "workItem.delete":
        deletedChildren.set(graphIdentityKey(operation.ref), operation.ref);
        break;
      case "relationship.create":
        addedRelationships.set(
          relationshipIdentityKey(operation.ref),
          operation.ref,
        );
        break;
      case "relationship.update":
        changedRelationships.set(
          relationshipIdentityKey(operation.ref),
          operation.ref,
        );
        break;
      case "relationship.delete":
        deletedRelationships.set(
          relationshipIdentityKey(operation.ref),
          operation.ref,
        );
        break;
      case "layout.replace":
      case "layout.clear":
        break;
    }
  });

  addedChildren.forEach((_identity, key) => changedChildren.delete(key));
  deletedChildren.forEach((_identity, key) => changedChildren.delete(key));
  addedRelationships.forEach((_identity, key) =>
    changedRelationships.delete(key),
  );
  deletedRelationships.forEach((_identity, key) =>
    changedRelationships.delete(key),
  );

  return {
    added: {
      children: [...addedChildren.values()],
      relationships: [...addedRelationships.values()],
    },
    changed: {
      children: [...changedChildren.values()],
      relationships: [...changedRelationships.values()],
    },
    deleted: {
      children: [...deletedChildren.values()],
      relationships: [...deletedRelationships.values()],
    },
  };
};

const graphIdentityKey = (identity: WorkItemChangeSetIdentity): string =>
  identity.refType === "existing"
    ? `existing:${identity.id}`
    : `temporary:${identity.tempId}`;

export const getProposalElementEntityLinks = ({
  proposal,
  projection,
  siblingProposals,
}: {
  proposal: WorkItemGraphProposal;
  projection: Pick<WorkItemGraphProjectionData, "children"> | undefined;
  siblingProposals: Map<string, ProposalResponseDto> | undefined;
}): WorkflowGraphDirectEntityLink[] => {
  if (!projection) return [];

  const rootKey = graphIdentityKey(proposal.updates.root);
  const elementIds = new Set(
    projection.children.map((child) => graphIdentityKey(child.identity)),
  );

  return (proposal.edges ?? []).flatMap((edge) => {
    if (!edge.sourceRef) return [];
    const sourceKey = graphIdentityKey(edge.sourceRef);
    if (sourceKey === rootKey || !elementIds.has(sourceKey)) return [];

    const sourceNodeId =
      edge.sourceRef.refType === "existing"
        ? edge.sourceRef.id
        : `temporary:${edge.sourceRef.tempId}`;
    let targetEntityId = edge.targetEntityId;
    let targetEntityType: WorkflowGraphDirectEntityLink["targetEntityType"] =
      edge.targetEntityType;
    let targetTitle = edge.targetEntityTitle?.trim() ?? "";

    if (edge.targetEntityType === ProposalEdgeTargetType.Proposal) {
      const targetProposal = siblingProposals?.get(edge.targetEntityId);
      if (!targetTitle && targetProposal) {
        targetTitle = getProposalDisplayTitle(targetProposal);
      }
      if (targetProposal?.status === ProposalStatus.Approved) {
        if (!isPlaceholderEntityId(targetProposal.targetEntityId)) {
          targetEntityId = targetProposal.targetEntityId;
          targetEntityType = targetProposal.targetEntityType;
        }
      }
    }

    return targetTitle
      ? [
          {
            sourceNodeId,
            targetEntityId,
            targetEntityType,
            targetTitle,
            relationshipType: edge.edgeType,
          },
        ]
      : [];
  });
};

/**
 * Labels the source of a deferred outer edge: an omitted sourceRef or the
 * root identity is the Diagram itself; any other identity is an element,
 * named from the projected change set, falling back to the authored
 * operations once the proposal is published and no projection exists.
 */
export const createGraphEdgeSourceLabelResolver = ({
  root,
  operations,
  identityLabels,
  rootLabel,
}: {
  root: WorkItemChangeSetIdentity;
  operations: WorkItemChangeSetValidationRequest["operations"];
  identityLabels?: Readonly<Record<string, string>>;
  rootLabel: string;
}): ((edge: ProposalEdgeDeclaration) => string) => {
  const operationNames = new Map<string, string>();
  operations.forEach((operation) => {
    if (
      (operation.op === "workItem.create" ||
        operation.op === "workItem.update") &&
      operation.name
    ) {
      operationNames.set(graphIdentityKey(operation.ref), operation.name);
    }
  });
  const rootKey = graphIdentityKey(root);

  return (edge) => {
    if (!edge.sourceRef) return rootLabel;
    const key = graphIdentityKey(edge.sourceRef);
    if (key === rootKey) return rootLabel;
    return (
      identityLabels?.[key] ?? operationNames.get(key) ?? "Diagram element"
    );
  };
};

const relationshipIdentityKey = (
  identity: WorkItemChangeSetRelationshipIdentity,
): string =>
  identity.refType === "existing"
    ? `existing:${identity.id}`
    : `temporary:${identity.tempId}`;

const metadataString = (
  relationship: ProjectedWorkItemRelationship,
  keys: readonly string[],
): string | null => {
  const metadata = relationship.metadata;
  if (typeof metadata !== "object" || metadata === null) return null;

  for (const key of keys) {
    const value = (metadata as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
};

const hasResolvedTargetMetadata = (
  relationship: ProjectedWorkItemRelationship,
): boolean =>
  Boolean(
    metadataString(relationship, ["targetNodeName", "targetName"]) &&
    metadataString(relationship, [
      "targetNodeType",
      "targetWorkItemTypeKey",
      "targetType",
    ]),
  );

const getUnresolvedExternalTargets = (
  projection: WorkItemGraphDraftProjection | undefined,
): WorkItemChangeSetIdentity[] => {
  if (!projection) return [];

  const projectedNodeKeys = new Set(
    [projection.projectedRoot, ...projection.children].map((node) =>
      graphIdentityKey(node.identity),
    ),
  );
  const targetsByKey = new Map<string, WorkItemChangeSetIdentity>();

  projection.incidentRelationships.forEach((relationship) => {
    if (
      relationship.deleted ||
      relationship.target.refType !== "existing" ||
      projectedNodeKeys.has(graphIdentityKey(relationship.target)) ||
      hasResolvedTargetMetadata(relationship)
    ) {
      return;
    }

    const key = graphIdentityKey(relationship.target);
    targetsByKey.set(key, relationship.target);
  });

  return [...targetsByKey.values()];
};

interface ExternalGraphEntityResolution {
  entities: WorkItemGraphExternalEntity[];
  isLoading: boolean;
  error: Error | null;
}

const useExternalGraphEntityResolution = ({
  organizationId,
  projectId,
  projection,
}: {
  organizationId: string;
  projectId: string;
  projection: WorkItemGraphDraftProjection | undefined;
}): ExternalGraphEntityResolution => {
  const targets = useMemo(
    () => getUnresolvedExternalTargets(projection),
    [projection],
  );
  const lookup = useFeatureLookup(
    organizationId,
    targets.length ? projectId : "",
  );
  const targetKey = useMemo(
    () => targets.map(graphIdentityKey).join("|"),
    [targets],
  );
  const [entities, setEntities] = useState<WorkItemGraphExternalEntity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (targets.length > 0 && lookup.isLoading) return;

    if (targets.length === 0) {
      setEntities([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setEntities([]);
    setIsLoading(true);
    setError(null);

    Promise.allSettled(
      targets.map(async (identity): Promise<WorkItemGraphExternalEntity> => {
        if (identity.refType !== "existing") {
          throw new Error(
            "External graph entities must use persisted identities.",
          );
        }

        const cached = lookup.get(identity.id);
        if (cached) return { identity, name: cached.name, type: "FEATURE" };
        const response = await unifiedApiClient.getTask({
          organizationId,
          projectId,
          taskId: identity.id,
        });
        const task = response.data.data;
        if (!task) {
          throw new Error("The external graph entity could not be loaded.");
        }

        return {
          identity,
          name: task.name,
          type: task.type,
        };
      }),
    ).then((results) => {
      if (cancelled) return;

      const resolved = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failed = results.some((result) => result.status === "rejected");
      setEntities(resolved);
      setError(
        failed
          ? new Error(
              "Some external graph relationship details could not be loaded.",
            )
          : null,
      );
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [organizationId, projectId, targetKey, targets, lookup]);

  return {
    entities,
    isLoading: isLoading || (targets.length > 0 && lookup.isLoading),
    error,
  };
};

export interface WorkItemGraphProposalRendererProps {
  proposal: WorkItemGraphProposal;
  status: ProposalItemStatus;
  onApply: () => void;
  onReject?: (reason: string) => Promise<void>;
  organizationId: string;
  projectId: string;
  disabled?: boolean;
  siblingProposals?: Map<string, ProposalResponseDto>;
  approvalProgress?: ApprovalProgress;
  overrides?: ProposalRenderOverrides;
  diffDefaultViewMode?: DiffViewMode;
}

const ReviewSummaryWithBaseline: FC<{
  organizationId: string;
  projectId: string;
  rootId?: string;
  operations: WorkItemChangeSetValidationRequest["operations"];
  projection: WorkItemGraphDraftProjection;
  externalEntities: readonly WorkItemGraphExternalEntity[];
  diffDefaultViewMode?: DiffViewMode;
}> = ({
  organizationId,
  projectId,
  rootId,
  operations,
  projection,
  externalEntities,
  diffDefaultViewMode,
}) => {
  const priorGraphQuery = useWorkItemGraph(organizationId, projectId, rootId, {
    enabled: Boolean(rootId),
    refetchOnMount: true,
  });
  const resolvedEntityNames = useMemo(() => {
    const names: Record<string, string> = {};
    priorGraphQuery.data?.derivedReferences.forEach((reference) => {
      names[`${reference.entityType}:${reference.entityId}`] =
        reference.displayName;
    });
    externalEntities.forEach((entity) => {
      if (entity.identity.refType === "existing") {
        names[`TASK:${entity.identity.id}`] = entity.name;
      }
    });
    Object.entries(projection.identityLabels).forEach(([identity, name]) => {
      if (identity.startsWith("existing:")) {
        const entityId = identity.slice("existing:".length);
        names[`TASK:${entityId}`] = name;
        names[`SERVICE:${entityId}`] = name;
      }
    });
    return names;
  }, [externalEntities, priorGraphQuery.data, projection.identityLabels]);

  return (
    <WorkItemGraphChangeSummary
      operations={operations}
      projection={projection}
      priorAggregate={priorGraphQuery.data}
      resolvedEntityNames={resolvedEntityNames}
      diffDefaultViewMode={diffDefaultViewMode}
    />
  );
};

export const WorkItemGraphProposalRenderer: FC<
  WorkItemGraphProposalRendererProps
> = ({
  proposal,
  status,
  onApply,
  onReject,
  organizationId,
  projectId,
  disabled,
  siblingProposals,
  approvalProgress,
  overrides,
  diffDefaultViewMode,
}) => {
  const published = status.state === "applied";
  const registry = useWorkItemTypes(organizationId, { projectId });
  const existingRootId =
    proposal.updates.root.refType === "existing"
      ? proposal.updates.root.id
      : undefined;
  const existingRoot = useWorkItem(
    organizationId,
    "task",
    existingRootId ?? proposal.targetEntityId,
    {
      projectId,
      enabled: !published && Boolean(existingRootId),
    },
  );
  const { reviewState, retryValidation } = useWorkItemGraphProposalReview({
    organizationId,
    projectId,
    proposalId: proposal.id,
    updates: proposal.updates,
    enabled: !published,
  });
  const projection =
    !published && reviewState.kind === "ready"
      ? reviewState.projection
      : undefined;
  const directEntityLinks = useMemo(
    () =>
      getProposalElementEntityLinks({
        proposal,
        projection,
        siblingProposals,
      }),
    [proposal, projection, siblingProposals],
  );
  const rootTypeKey =
    getCreatedGraphRootType(proposal.updates) ??
    projection?.projectedRoot.type ??
    existingRoot.workItem?.type;
  const rootTypeDefinition = useMemo<WorkItemTypeDefinitionDto | undefined>(
    () =>
      rootTypeKey
        ? registry.workItemTypes.find(
            ({ definition }) => definition.key === rootTypeKey,
          )?.definition
        : undefined,
    [registry.workItemTypes, rootTypeKey],
  );
  const resolveEdgeSourceLabel = useMemo(
    () =>
      createGraphEdgeSourceLabelResolver({
        root: proposal.updates.root,
        operations: proposal.updates.operations,
        identityLabels: projection?.identityLabels,
        rootLabel: rootTypeDefinition?.name ?? "Diagram",
      }),
    [
      projection?.identityLabels,
      proposal.updates.operations,
      proposal.updates.root,
      rootTypeDefinition?.name,
    ],
  );
  const graphAuthorized =
    rootTypeDefinition?.capabilities?.graph?.rendererKey === "work-item-graph";
  const authorityAvailable = graphAuthorized && !registry.error;
  const authorityLoading =
    !published &&
    (registry.isLoading ||
      (!registry.error &&
        !rootTypeKey &&
        (reviewState.kind === "validating" || existingRoot.isLoading)));
  const authorityUnavailable =
    !published &&
    !authorityLoading &&
    (Boolean(registry.error) || !graphAuthorized);
  const {
    entities: externalEntities,
    isLoading: externalEntitiesLoading,
    error: externalEntitiesError,
  } = useExternalGraphEntityResolution({
    organizationId,
    projectId,
    projection,
  });
  const resolvedProjection = useMemo<WorkItemGraphDraftProjection | undefined>(
    () =>
      projection
        ? {
            ...projection,
            externalEntities,
          }
        : undefined,
    [externalEntities, projection],
  );
  const createdElements = getCreatedGraphElements(proposal.updates);
  const diffElements = getGraphDiffElements(proposal.updates);
  const presentationState: WorkflowGraphPresentationState =
    proposal.action === ProposalAction.Create &&
    rootTypeKey?.toUpperCase() === "DIAGRAM"
      ? "authored"
      : "added";
  const materializationActive =
    proposal.materialization?.state ===
    WorkItemChangeSetMaterializationState.Applying;
  const confirmationDisabled =
    disabled ||
    !authorityAvailable ||
    reviewState.kind !== "ready" ||
    externalEntitiesLoading ||
    materializationActive ||
    status.state === "applying";

  const content = (
    <Stack spacing={2}>
      {!overrides?.hideHeader && (
        <ProposalTitle
          proposal={proposal}
          resolvedTargetName={
            projection?.projectedRoot.name?.trim() ||
            existingRoot.workItem?.name?.trim() ||
            getProposalDisplayTitle(proposal)
          }
          typePresentation={staticProposalTypePresentation("Graph Change Set")}
          hideTypeChip={overrides?.hideTypeChip}
          titleSx={
            overrides?.titleFontSize
              ? { fontSize: overrides.titleFontSize }
              : undefined
          }
        />
      )}
      {published ? (
        <PublishedWorkItemGraph
          proposal={proposal}
          organizationId={organizationId}
          projectId={projectId}
          typeDefinitions={registry.workItemTypes.map(
            ({ definition }) => definition,
          )}
          registryLoading={registry.isLoading}
          registryError={registry.error}
        />
      ) : null}
      {!published && authorityLoading ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={18} />
          <Typography variant="body2">
            Loading graph rendering authority…
          </Typography>
        </Stack>
      ) : null}
      {!published && authorityUnavailable ? (
        <Alert severity="warning" data-testid="work-item-graph-unavailable">
          {registry.error
            ? "The work-item type registry is unavailable."
            : "Graph rendering is unavailable for this work-item type."}
        </Alert>
      ) : null}
      {!published &&
      !authorityLoading &&
      !authorityUnavailable &&
      reviewState.kind === "validating" ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={18} />
          <Typography variant="body2">Validating projected graph…</Typography>
        </Stack>
      ) : null}
      {!published && authorityAvailable && reviewState.kind === "failed" ? (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              size="small"
              startIcon={<RefreshIcon />}
              onClick={retryValidation}
            >
              Retry validation
            </Button>
          }
        >
          {reviewState.message}
        </Alert>
      ) : null}
      {!published &&
      authorityAvailable &&
      reviewState.kind === "ready" &&
      resolvedProjection ? (
        <Stack spacing={1}>
          {externalEntitiesError ? (
            <Alert
              severity="warning"
              data-testid="workflow-graph-metadata-warning"
            >
              {externalEntitiesError.message}
            </Alert>
          ) : null}
          {reviewState.projection.warnings.length > 0 ? (
            <Alert
              severity="warning"
              data-testid="work-item-graph-validation-warnings"
            >
              <Stack spacing={0.75}>
                {reviewState.projection.warnings.map((warning, index) => (
                  <Stack
                    key={`${warning.layer}-${warning.code}-${warning.field}-${index}`}
                  >
                    <Typography variant="body2">{warning.reason}</Typography>
                    {warning.suggestion ? (
                      <Typography variant="caption">
                        {warning.suggestion}
                      </Typography>
                    ) : null}
                  </Stack>
                ))}
              </Stack>
            </Alert>
          ) : null}
          <ProjectedWorkItemGraph
            organizationId={organizationId}
            projectId={projectId}
            rootId={
              proposal.updates.root.refType === "existing"
                ? proposal.updates.root.id
                : undefined
            }
            projection={resolvedProjection}
            createdElements={createdElements}
            diffElements={diffElements}
            presentationState={presentationState}
            directEntityLinks={directEntityLinks}
          />
          <ReviewSummaryWithBaseline
            organizationId={organizationId}
            projectId={projectId}
            rootId={
              proposal.updates.root.refType === "existing"
                ? proposal.updates.root.id
                : undefined
            }
            operations={proposal.updates.operations}
            projection={reviewState.projection}
            externalEntities={externalEntities}
            diffDefaultViewMode={diffDefaultViewMode}
          />
        </Stack>
      ) : null}
      {!published && authorityAvailable && reviewState.kind === "invalid" ? (
        <Alert severity="error" data-testid="work-item-graph-validation-issues">
          <Stack spacing={0.75}>
            <Typography variant="subtitle2">
              This graph cannot be confirmed.
            </Typography>
            {reviewState.issues.map((issue, index) => (
              <Stack
                key={`${issue.layer}-${issue.code}-${issue.field}-${index}`}
              >
                <Typography variant="body2">
                  {issue.layer} · {issue.field} · {issue.code}: {issue.reason}
                </Typography>
                {issue.suggestion ? (
                  <Typography variant="caption">{issue.suggestion}</Typography>
                ) : null}
              </Stack>
            ))}
          </Stack>
        </Alert>
      ) : null}
      {proposal.materialization ? (
        <WorkItemGraphMaterializationProgress
          progress={proposal.materialization}
          operations={proposal.updates.operations}
          relationships={
            reviewState.kind === "ready"
              ? reviewState.projection.incidentRelationships
              : []
          }
        />
      ) : null}
      {siblingProposals ? (
        <ProposalEdges
          edges={proposal.edges}
          siblingProposals={siblingProposals}
          organizationId={proposal.organizationId}
          projectId={proposal.projectId}
          ownerApplied={status.state === "applied"}
          resolveSourceLabel={resolveEdgeSourceLabel}
        />
      ) : null}
      {!overrides?.hideStateIndicator && (
        <ProposalStateIndicator
          status={status}
          action={proposal.action}
          onApply={onApply}
          onReject={onReject}
          disabled={confirmationDisabled}
          approvalProgress={approvalProgress}
          applyLabel="Confirm graph changes"
        />
      )}
    </Stack>
  );

  return overrides?.hideCard ? (
    content
  ) : (
    <Paper
      variant="outlined"
      sx={{ p: 2 }}
      data-testid="work-item-graph-proposal-review"
    >
      {content}
    </Paper>
  );
};
