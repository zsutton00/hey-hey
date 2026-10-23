import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import {
  type ContextRelatedEntityDto,
  type EntityContextDtoProposalsInner,
  EdgeSource,
  EntityType,
  ProposalAction,
  RelationshipValue,
  type WorkItemTypeDefinitionDto,
  type WorkItemTypeSummaryDto,
} from "@hey-hey/ui-common/api";
import {
  EntityIcon,
  EntityNodeStatusChip,
  formatRelationshipLabel,
  isRelationshipValue,
  isWorkflowFlowRelationship,
} from "@hey-hey/ui-common/components";
import { WebPathService } from "@hey-hey/ui-common/services";
import { TERMS } from "@hey-hey/ui-common/i18n";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import {
  Box,
  Chip,
  LinearProgress,
  ListItemButton,
  Tooltip,
  Typography,
} from "@mui/material";
import { formatDistanceToNow } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import React, { useMemo } from "react";
import { Link } from "react-router-dom";

export interface ConversationAbout {
  entityType: string;
  entityId: string;
  name: string;
}

const ENTITY_TYPE_LABEL: Record<string, string> = {
  ARTIFACT: "Artifact",
  INITIATIVE: "Initiative",
  PROJECT: "Project",
  TASK: TERMS.Task,
  MESSAGE: "Message",
  CONVERSATION: "Conversation",
  DESIGN_DOC: "Design Doc",
  AGENT_SESSION: "Agent Session",
  CODING_PROMPT: "Coding Prompt",
  VALIDATION_SESSION: "Validation Session",
  SERVICE: "Service",
  PLAN: "Plan",
  REPORT: "Report",
  PROPOSAL: "Proposal",
  PLAN_STAGE: "Plan Stage",
  PLAN_STEP: "Plan Step",
  IMPLEMENTATION_HINT: "Implementation Hint",
  USER: "User",
};

const labelForEntityType = (type: string): string =>
  ENTITY_TYPE_LABEL[type] ?? type;

export const findAboutFromProposal = (
  proposal: EntityContextDtoProposalsInner | null,
): ConversationAbout | null => {
  if (!proposal) return null;
  const origin = proposal.influences?.find((i) => i.reasonType === "origin");
  if (!origin) return null;
  const title = origin.entityTitle?.trim();
  return {
    entityType: origin.entityType,
    entityId: origin.entityId,
    name: title || labelForEntityType(origin.entityType),
  };
};

// Backend task ec4c894f will emit this string on
// ContextRelatedEntityDto.relationship for entities co-authored with the
// seed by the same proposal. The literal mirrors the kebab-case used
// throughout RelationshipValue (depends-on, derives-from, …); codegen
// will add it as a member once the backend ships.
const PROPOSED_TOGETHER_RELATIONSHIP = "proposed-together";
export const DEPENDS_ON_RELATIONSHIP = RelationshipValue.DependsOn;

export interface MergedEntityRow {
  entityId: string;
  entityType: string;
  displayName: string;
  status?: string;
  /**
   * Work-item type key for `TASK` entities (e.g. `STANDARD`, `BUG`, or a
   * project's custom type). Absent for non-task entities and for older or
   * unmigrated task entries, which bucket under `STANDARD`.
   */
  taskType?: string;
  relationships: string[];
  relationLabels: string[];
  isProposedTogether: boolean;
  /**
   * Effective provenance: `agent` if any contributing edge is `agent` or
   * absent (per OpenAPI: absent → agent); `system` only when every
   * contributing edge is explicitly `system` or `system-derived`. `user`
   * provenance is treated the same as `agent` for the visual affordance.
   */
  isAgentAuthored: boolean;
}

export interface UserInfluenceRow {
  userId: string;
  displayName: string;
  updatedAt: string | null;
}

export const formatTimeAgo = (
  isoDate: string | null | undefined,
): string | null => {
  if (!isoDate) return null;
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatDistanceToNow(parsed, { addSuffix: true });
};

const fallbackFormatRelationLabel = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const formatRelationLabel = (value: string): string =>
  value === PROPOSED_TOGETHER_RELATIONSHIP
    ? "Created together"
    : isRelationshipValue(value)
      ? formatRelationshipLabel(value)
      : fallbackFormatRelationLabel(value);

const SYSTEM_EDGE_SOURCES = new Set<string>([
  EdgeSource.System,
  "system-derived",
]);

const isSystemSource = (source: EdgeSource | undefined): boolean =>
  source !== undefined && SYSTEM_EDGE_SOURCES.has(source);

const buildEntityHref = (
  projectId: string,
  entityType: string,
  entityId: string,
): string | undefined => {
  switch (entityType) {
    case "TASK":
      return WebPathService.task({ projectId, taskId: entityId });
    case "DESIGN_DOC":
      return WebPathService.designDoc({
        projectId,
        designDocId: entityId,
      });
    case "AGENT_SESSION":
      return WebPathService.agentSession({
        projectId,
        agentSessionId: entityId,
      });
    case "PLAN":
      return WebPathService.plan({ projectId, planId: entityId });
    case "SERVICE":
      return WebPathService.service({ projectId, serviceId: entityId });
    default:
      return undefined;
  }
};

const rowSx = {
  borderRadius: 1,
  py: 0.75,
  px: 1,
  alignItems: "flex-start",
  minWidth: 0,
} as const;

const resolveEntityRowIconType = (
  row: MergedEntityRow,
  workItemTypeDefinitions: ReadonlyMap<string, WorkItemTypeDefinitionDto>,
): string | undefined => {
  if (row.entityType !== EntityType.Task) {
    return row.entityType;
  }

  const typeKey = row.taskType ?? WORK_ITEM_TYPE_KEYS.Standard;
  const definition = workItemTypeDefinitions.get(typeKey);
  if (definition?.key !== typeKey) {
    return undefined;
  }

  return typeKey === WORK_ITEM_TYPE_KEYS.Standard
    ? EntityType.Task
    : definition.key;
};

export const renderEntityRow = (
  row: MergedEntityRow,
  projectId: string,
  testIdPrefix: string,
  workItemTypeDefinitions: ReadonlyMap<string, WorkItemTypeDefinitionDto>,
  workItemTypes: readonly WorkItemTypeSummaryDto[],
): React.ReactNode => {
  const href = buildEntityHref(projectId, row.entityType, row.entityId);
  const iconType = resolveEntityRowIconType(row, workItemTypeDefinitions);
  const typeKey = row.taskType ?? WORK_ITEM_TYPE_KEYS.Standard;
  const workItemIcon =
    row.entityType === EntityType.Task
      ? {
          typeKey,
          definition: workItemTypeDefinitions.get(typeKey),
          effectiveSource: workItemTypes.find(
            (type) => type.definition.key === typeKey,
          )?.effectiveSource,
        }
      : undefined;

  const inner = (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        flex: 1,
        gap: 0.5,
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          minWidth: 0,
        }}
      >
        {iconType && (
          <EntityIcon
            entityType={iconType}
            workItemIcon={workItemIcon}
            size={20}
          />
        )}
        <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
          {row.displayName}
        </Typography>
      </Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 0.5,
          pl: 3.5,
          minWidth: 0,
        }}
      >
        {row.relationships.map((relationship, index) => (
          <Chip
            key={relationship}
            label={row.relationLabels[index]}
            size="small"
            variant="outlined"
            color={
              relationship === DEPENDS_ON_RELATIONSHIP ? "warning" : "default"
            }
            sx={{
              height: 18,
              fontSize: "0.65rem",
              "& .MuiChip-label": { px: 0.75 },
            }}
          />
        ))}
        {row.isAgentAuthored && (
          <Tooltip title="Connection authored by an agent or user">
            <AutoAwesomeIcon
              data-testid={`${testIdPrefix}-${row.entityId}-agent-source`}
              sx={{
                fontSize: 12,
                color: "text.secondary",
                ml: 0.25,
              }}
            />
          </Tooltip>
        )}
        <EntityNodeStatusChip status={row.status} />
      </Box>
    </Box>
  );

  const testId = `${testIdPrefix}-${row.entityId}`;

  return href ? (
    <ListItemButton
      key={`${row.entityType}:${row.entityId}`}
      component={Link}
      to={href}
      sx={rowSx}
      data-testid={testId}
    >
      {inner}
    </ListItemButton>
  ) : (
    <Box
      key={`${row.entityType}:${row.entityId}`}
      sx={{ ...rowSx, display: "flex" }}
      data-testid={testId}
    >
      {inner}
    </Box>
  );
};

export const renderUserRow = (
  user: UserInfluenceRow,
  projectId: string,
  testIdPrefix: string,
): React.ReactNode => {
  const href = WebPathService.user({ projectId, userId: user.userId });
  const timeAgo = formatTimeAgo(user.updatedAt);
  const updatedLabel = timeAgo ? `Updated ${timeAgo}` : null;

  return (
    <ListItemButton
      key={`USER:${user.userId}`}
      component={Link}
      to={href}
      sx={rowSx}
      data-testid={`${testIdPrefix}-user-${user.userId}`}
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          flex: 1,
          gap: 0.5,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            minWidth: 0,
          }}
        >
          <EntityIcon entityType="user" size={20} />
          <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
            {user.displayName}
          </Typography>
        </Box>
        {updatedLabel && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              pl: 3.5,
              minWidth: 0,
            }}
          >
            <Typography variant="caption" color="text.secondary" noWrap>
              {updatedLabel}
            </Typography>
          </Box>
        )}
      </Box>
    </ListItemButton>
  );
};

export const renderProposalRow = (
  proposal: EntityContextDtoProposalsInner,
  conversationPath: string,
  testId: string,
  caption: string,
  about: ConversationAbout | null,
): React.ReactNode => {
  return (
    <ListItemButton
      key={proposal.id}
      component={Link}
      to={conversationPath}
      sx={rowSx}
      data-testid={testId}
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          flex: 1,
          gap: 0.5,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            minWidth: 0,
          }}
        >
          <EntityIcon entityType="CONVERSATION" size={20} />
          <Typography
            variant="body2"
            noWrap
            sx={{ flex: 1, minWidth: 0 }}
            data-testid={`${testId}-label`}
          >
            {about ? (
              <>
                Conversation about{" "}
                <Box
                  component="span"
                  sx={{ fontWeight: 600 }}
                  data-testid={`${testId}-about`}
                >
                  {about.name}
                </Box>
              </>
            ) : (
              "Conversation"
            )}
          </Typography>
        </Box>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            pl: 3.5,
            minWidth: 0,
          }}
        >
          <Typography variant="caption" color="text.secondary" noWrap>
            {caption}
          </Typography>
        </Box>
      </Box>
    </ListItemButton>
  );
};

export const SectionHeader: React.FC<{ title: string; testId?: string }> = ({
  title,
  testId,
}) => (
  <Typography
    variant="caption"
    color="text.secondary"
    sx={{
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      fontWeight: 600,
      mt: 0.5,
    }}
    data-testid={testId}
  >
    {title}
  </Typography>
);

export interface MergedRelatedRows {
  proposedTogetherRows: MergedEntityRow[];
  designDocRows: MergedEntityRow[];
  taskBuckets: Map<string, MergedEntityRow[]>;
  otherRows: MergedEntityRow[];
  userInfluenceRows: UserInfluenceRow[];
}

/**
 * Merges edge-driven related entities and proposal influences into one row
 * per entity. History and Related both read this so a row's labels and
 * provenance stay identical wherever it renders.
 */
export const useMergedRelatedRows = (
  proposals: EntityContextDtoProposalsInner[],
  relatedEntities: ContextRelatedEntityDto[],
): MergedRelatedRows => {
  const influenceEntityIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (const proposal of proposals ?? []) {
      for (const influence of proposal.influences ?? []) {
        if (influence.entityType === EntityType.User) continue;
        ids.add(influence.entityId);
      }
    }
    return ids;
  }, [proposals]);

  return useMemo<MergedRelatedRows>(() => {
    interface Accumulator {
      entityType: string;
      displayName: string;
      status?: string;
      taskType?: string;
      rawEdges: string[];
      rawEdgeSet: Set<string>;
      order: number;
      /** True once any contributing edge is non-system (agent/user/absent). */
      hasNonSystemEdge: boolean;
    }

    const accumulators = new Map<string, Accumulator>();
    let nextOrder = 0;

    const addEdge = (entityId: string, rawRelationship: string): void => {
      const acc = accumulators.get(entityId);
      if (!acc) return;
      if (acc.rawEdgeSet.has(rawRelationship)) return;
      acc.rawEdgeSet.add(rawRelationship);
      acc.rawEdges.push(rawRelationship);
    };

    const noteEdgeSource = (
      entityId: string,
      source: EdgeSource | undefined,
    ): void => {
      const acc = accumulators.get(entityId);
      if (!acc) return;
      if (!isSystemSource(source)) acc.hasNonSystemEdge = true;
    };

    for (const entity of relatedEntities) {
      if (isWorkflowFlowRelationship(entity.relationship)) {
        continue;
      }
      if (
        entity.relationship === RelationshipValue.SiblingViaParent &&
        !influenceEntityIds.has(entity.entityId)
      ) {
        continue;
      }
      const existing = accumulators.get(entity.entityId);
      if (!existing) {
        accumulators.set(entity.entityId, {
          entityType: entity.entityType,
          displayName: entity.displayName,
          status: entity.status,
          taskType: entity.taskType ?? undefined,
          rawEdges: [],
          rawEdgeSet: new Set(),
          order: nextOrder++,
          hasNonSystemEdge: false,
        });
      } else {
        if (!existing.status && entity.status) {
          existing.status = entity.status;
        }
        if (!existing.taskType && entity.taskType) {
          existing.taskType = entity.taskType;
        }
      }
      addEdge(entity.entityId, entity.relationship);
      noteEdgeSource(entity.entityId, entity.source);
    }

    const users = new Map<string, UserInfluenceRow>();
    for (const proposal of proposals ?? []) {
      const proposalCreatedAt = proposal.createdAt ?? null;
      for (const influence of proposal.influences ?? []) {
        if (influence.entityType === EntityType.User) {
          const existing = users.get(influence.entityId);
          if (!existing) {
            users.set(influence.entityId, {
              userId: influence.entityId,
              displayName: influence.entityTitle ?? influence.entityId,
              updatedAt: proposalCreatedAt,
            });
          } else if (
            proposalCreatedAt &&
            (!existing.updatedAt || proposalCreatedAt > existing.updatedAt)
          ) {
            existing.updatedAt = proposalCreatedAt;
          }
          continue;
        }
        if (!accumulators.has(influence.entityId)) {
          accumulators.set(influence.entityId, {
            entityType: influence.entityType,
            displayName: influence.entityTitle ?? influence.entityId,
            rawEdges: [],
            rawEdgeSet: new Set(),
            order: nextOrder++,
            hasNonSystemEdge: false,
          });
        }
        addEdge(influence.entityId, influence.reasonType);
        // Influences are agent/user authored, never system.
        noteEdgeSource(influence.entityId, undefined);
      }
    }

    const sortedAccumulators = Array.from(accumulators.entries()).sort(
      ([, a], [, b]) => a.order - b.order,
    );

    const proposedTogether: MergedEntityRow[] = [];
    const designDocs: MergedEntityRow[] = [];
    const tasks = new Map<string, MergedEntityRow[]>();
    const others: MergedEntityRow[] = [];

    for (const [entityId, acc] of sortedAccumulators) {
      const isProposedTogether = acc.rawEdgeSet.has(
        PROPOSED_TOGETHER_RELATIONSHIP,
      );
      const labels = acc.rawEdges.map(formatRelationLabel);
      const orderedRelationships = isProposedTogether
        ? [
            PROPOSED_TOGETHER_RELATIONSHIP,
            ...acc.rawEdges.filter(
              (relationship) => relationship !== PROPOSED_TOGETHER_RELATIONSHIP,
            ),
          ]
        : acc.rawEdges;
      const orderedLabels = isProposedTogether
        ? orderedRelationships.map(formatRelationLabel)
        : labels;

      const row: MergedEntityRow = {
        entityId,
        entityType: acc.entityType,
        displayName: acc.displayName,
        status: acc.status,
        taskType: acc.taskType,
        relationships: orderedRelationships,
        relationLabels: orderedLabels,
        isProposedTogether,
        isAgentAuthored: acc.hasNonSystemEdge,
      };

      if (isProposedTogether) {
        proposedTogether.push(row);
      } else if (row.entityType === EntityType.DesignDoc) {
        designDocs.push(row);
      } else if (row.entityType === EntityType.Task) {
        // Bucket each task under its work-item type, falling back to
        // STANDARD so older or unmigrated entries still render.
        const typeKey = row.taskType ?? WORK_ITEM_TYPE_KEYS.Standard;
        const bucket = tasks.get(typeKey);
        if (bucket) {
          bucket.push(row);
        } else {
          tasks.set(typeKey, [row]);
        }
      } else {
        others.push(row);
      }
    }

    return {
      proposedTogetherRows: proposedTogether,
      designDocRows: designDocs,
      taskBuckets: tasks,
      otherRows: others,
      userInfluenceRows: Array.from(users.values()),
    };
  }, [relatedEntities, proposals, influenceEntityIds]);
};

export const findOriginProposal = (
  proposals: EntityContextDtoProposalsInner[],
): EntityContextDtoProposalsInner | null => {
  const creates = proposals.filter((p) => p.action === ProposalAction.Create);
  if (creates.length === 0) return null;
  return creates.reduce((earliest, current) => {
    const earliestTime = earliest.createdAt
      ? new Date(earliest.createdAt).getTime()
      : Infinity;
    const currentTime = current.createdAt
      ? new Date(current.createdAt).getTime()
      : Infinity;
    return currentTime < earliestTime ? current : earliest;
  });
};

export const findLastUpdateProposal = (
  proposals: EntityContextDtoProposalsInner[],
): EntityContextDtoProposalsInner | null => {
  const updates = proposals.filter((p) => p.action === ProposalAction.Update);
  if (updates.length === 0) return null;
  return updates.reduce((latest, current) => {
    const latestTime = latest.createdAt
      ? new Date(latest.createdAt).getTime()
      : -Infinity;
    const currentTime = current.createdAt
      ? new Date(current.createdAt).getTime()
      : -Infinity;
    return currentTime > latestTime ? current : latest;
  });
};

interface RailCardBodyProps {
  loading: boolean;
  dataTestId: string;
  loadingLabel: string;
  children: React.ReactNode;
}

/** Loading-to-content transition shared by the History and Related cards. */
export const RailCardBody: React.FC<RailCardBodyProps> = ({
  loading,
  dataTestId,
  loadingLabel,
  children,
}) => (
  <AnimatePresence initial={false} mode="wait">
    {loading ? (
      <motion.div
        key="loading"
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.16, ease: "easeIn" }}
        data-testid={`${dataTestId}-loading-state`}
      >
        <LinearProgress
          aria-label={loadingLabel}
          data-testid={`${dataTestId}-loading-progress`}
        />
      </motion.div>
    ) : (
      <motion.div
        key="content"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
        style={{ minWidth: 0 }}
        data-testid={`${dataTestId}-content-state`}
      >
        {children}
      </motion.div>
    )}
  </AnimatePresence>
);
