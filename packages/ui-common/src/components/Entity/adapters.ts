import { formatDistanceToNow } from "date-fns";
import React from "react";
import {
  AgentEdgeType,
  AgentSessionType,
  type AgentEdgeResponseDto,
  type AgentSessionDto,
  type ConversationResponseDto,
  type DesignDocResponseDto,
  type ImplementationHintDto,
  type InitiativeResponseDto,
  type ServiceDto,
  type WorkItemTypeDefinitionDto,
  type WorkItemTypeEffectiveSource,
  type WorkItemReferenceDto,
} from "../../api";
import type { PlanWorkItem } from "../../data/plans/canonicalPlan";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import { getPathService, type PathService } from "../../services";
import { formatStatus } from "../../utils/statusUtils";
import { getWorkItemSectionContent } from "../../utils/workItemSections";
import { getWorkItemCounts, type CountGroup } from "../WorkItem/utils";
import type { EntityDependency, EntityListItemProps } from "./EntityListItem";
import type { MetadataDisclosureRow } from "../shared/MetadataDisclosure";
import type {
  EntityIconKey,
  WorkItemIconIdentity,
} from "../../utils/entityIcons";

/**
 * Options that can be passed to adapters for customization
 */
export interface AdapterOptions {
  /**
   * Organization ID for path generation
   */
  organizationId?: string;

  /**
   * Project ID for path generation
   */
  projectId?: string;

  /**
   * Initiative ID for path generation (for tasks)
   */
  initiativeId?: string;

  /**
   * Whether to show tags in the entity list item
   */
  showTags?: boolean;

  /**
   * Whether to show the entity's canonical or registry-defined kind label.
   */
  showEntityKind?: boolean;

  /**
   * Presentation contract for the shared EntityListItem output. Reference
   * rows intentionally expose only identity while richer entity lists retain
   * the adapter's full metadata.
   */
  presentation?: "default" | "reference";

  /**
   * Title shown for an untitled entity, e.g. the name of the entity a
   * conversation is about.
   */
  fallbackTitle?: string;

  /**
   * Resolved registry definition for a task-like work item. Passing this
   * option, or requesting the entity kind, enters registry-aware rendering.
   */
  workItemTypeDefinition?: WorkItemTypeDefinitionDto;
  workItemTypeEffectiveSource?: WorkItemTypeEffectiveSource;

  /**
   * User lookup map for resolving user IDs to names
   */
  users?: Record<string, { name: string; email?: string }>;

  /**
   * Related entities for building context descriptions
   */
  relatedEntities?: {
    initiatives?: Record<string, { name: string }>;
    tasks?: Record<string, { name: string }>;
    designDocs?: Record<string, { name: string }>;
    conversations?: Record<string, { title?: string }>;
  };

  /**
   * Custom metadata items to add
   */
  customMetadata?: MetadataItem[];

  /**
   * Custom click handler (overrides default navigation)
   */
  onClick?: React.MouseEventHandler<HTMLElement>;

  /**
   * Custom delete handler
   */
  onDelete?: () => void;

  /**
   * Optional path service override for link generation.
   */
  pathService?: PathService;
}

/**
 * Metadata item for displaying additional information
 */
export interface MetadataItem {
  key: string;
  value: string;
  icon?: React.ReactNode;
  tooltip?: string;
}

/**
 * Generic adapter interface for transforming entities to EntityListItem props
 */
export interface EntityListItemAdapter<T> {
  toEntityListItemProps: (
    item: T,
    options?: AdapterOptions,
  ) => EntityListItemProps;
}

const resolvePathService = (options: AdapterOptions): PathService =>
  options.pathService ?? getPathService();

const canonicalKindLabel = (
  options: AdapterOptions,
  label: string,
): string | undefined => (options.showEntityKind ? label : undefined);

const canonicalKindIcon = (
  options: AdapterOptions,
  iconType: EntityIconKey,
): EntityIconKey | undefined => (options.showEntityKind ? iconType : undefined);

const applyPresentation = (
  props: EntityListItemProps,
  options: AdapterOptions,
): EntityListItemProps =>
  options.presentation === "reference"
    ? {
        title: props.title,
        entityKindLabel: props.entityKindLabel,
        entityKindIcon: props.entityKindIcon,
        workItemIcon: props.workItemIcon,
        displayMode: "list",
      }
    : props;

const taskIconIdentity = (
  options: AdapterOptions,
  typeKey: string,
): Pick<EntityListItemProps, "entityKindIcon" | "workItemIcon"> =>
  options.showEntityKind
    ? {
        entityKindIcon: "task",
        workItemIcon: {
          typeKey,
          definition: options.workItemTypeDefinition,
          effectiveSource: options.workItemTypeEffectiveSource,
        } satisfies WorkItemIconIdentity,
      }
    : {};

const hasWorkItemTypeDefinitionOption = (options: AdapterOptions): boolean =>
  Object.prototype.hasOwnProperty.call(options, "workItemTypeDefinition");

const resolveTaskStatus = (
  task: WorkItemResponseDto,
  options: AdapterOptions,
): string | undefined => {
  const isRegistryAware =
    options.showEntityKind === true || hasWorkItemTypeDefinitionOption(options);

  if (!isRegistryAware) {
    return task.status;
  }

  return options.workItemTypeDefinition?.allowedStatuses.length
    ? task.status
    : undefined;
};

/**
 * Format a date string to localized short date format
 */
const formatDate = (dateString?: string | null): string => {
  if (!dateString) return "";

  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) {
    return dateString;
  }

  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

/**
 * Format session date for coding sessions with full timestamp
 */
const formatSessionDate = (value?: string): string => {
  if (!value) return "No date";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const trimDisplayValue = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const shortenId = (id: string): string =>
  id.length > 8 ? `${id.slice(0, 8)}…` : id;

const DEPENDENCY_SORT_ORDER: AgentEdgeType[] = [
  AgentEdgeType.DependsOn,
  AgentEdgeType.Supersedes,
  AgentEdgeType.Contradicts,
  AgentEdgeType.DerivesFrom,
  AgentEdgeType.Evolves,
  AgentEdgeType.Tracks,
  AgentEdgeType.RelatedTo,
];

const dependencySortIndex = (edgeType: AgentEdgeType): number => {
  const index = DEPENDENCY_SORT_ORDER.indexOf(edgeType);
  return index === -1 ? DEPENDENCY_SORT_ORDER.length : index;
};

const getConnectedNodeName = (
  edge: AgentEdgeResponseDto,
  isOutgoing: boolean,
): string | undefined => {
  const name = isOutgoing ? edge.targetNodeName : edge.sourceNodeName;
  return name && name.trim().length > 0 ? name : undefined;
};

const getConnectedNodeType = (
  edge: AgentEdgeResponseDto,
  isOutgoing: boolean,
): string | undefined =>
  isOutgoing
    ? (edge.targetNodeType ?? edge.targetEntityType)
    : edge.sourceEntityType;

const buildTaskDependencies = (
  task: WorkItemResponseDto,
  options: AdapterOptions,
  pathService: PathService,
): EntityDependency[] | undefined => {
  if (!task.edges || task.edges.length === 0) {
    return undefined;
  }
  if (!options.projectId) {
    return undefined;
  }

  const projectId = options.projectId;
  const taskLookup = options.relatedEntities?.tasks;

  const dependencies: EntityDependency[] = [];

  for (const edge of task.edges as AgentEdgeResponseDto[]) {
    const isOutgoing = edge.sourceNodeId === task.id;
    const isIncoming = edge.targetNodeId === task.id;
    if (!isOutgoing && !isIncoming) {
      continue;
    }

    const connectedId = isOutgoing ? edge.targetNodeId : edge.sourceNodeId;
    const lookupEntry = taskLookup?.[connectedId];

    const targetTitle =
      getConnectedNodeName(edge, isOutgoing) ??
      lookupEntry?.name ??
      shortenId(connectedId);
    const entityType = getConnectedNodeType(edge, isOutgoing);
    const href = pathService.task({
      projectId,
      initiativeId: options.initiativeId,
      taskId: connectedId,
    });

    dependencies.push({
      edgeType: edge.type,
      direction: isOutgoing ? "outgoing" : "incoming",
      ...(entityType !== undefined ? { entityType } : {}),
      targetTitle,
      href,
    });
  }

  if (dependencies.length === 0) {
    return undefined;
  }

  dependencies.sort((a, b) => {
    const orderDelta =
      dependencySortIndex(a.edgeType) - dependencySortIndex(b.edgeType);
    if (orderDelta !== 0) return orderDelta;
    return a.targetTitle.localeCompare(b.targetTitle);
  });

  return dependencies;
};

/**
 * Task adapter - transforms WorkItemResponseDto to EntityListItem props
 *
 * @example
 * ```typescript
 * const taskProps = taskAdapter.toEntityListItemProps(task, {
 *   organizationId,
 *   projectId,
 *   initiativeId,
 *   users: { [task.assigneeId]: { name: 'John Doe' } }
 * });
 * ```
 */
export const taskAdapter: EntityListItemAdapter<WorkItemResponseDto> = {
  toEntityListItemProps: (task, options = {}) => {
    const pathService = resolvePathService(options);
    const metadata: MetadataItem[] = [];

    // Add assignee if available
    if (task.assigneeId && options.users?.[task.assigneeId]) {
      metadata.push({
        key: "assignee",
        value: options.users[task.assigneeId].name,
      });
    }

    // Add due date if available
    if (task.dueDate) {
      metadata.push({
        key: "dueDate",
        value: formatDate(task.dueDate),
      });
    }

    // Add custom metadata
    if (options.customMetadata) {
      metadata.push(...options.customMetadata);
    }

    // Build counts structure
    const countGroups: CountGroup[] = [];

    // Task counts
    const childCounts = getWorkItemCounts(task);
    if (childCounts) {
      countGroups.push(...childCounts);
    }

    // Design doc count
    if (task.designDocCount) {
      countGroups.push([
        {
          label: "design doc",
          count: task.designDocCount,
        },
      ]);
    }

    // Coding session count
    if (task.agentSessionCount) {
      countGroups.push([
        {
          label: "agent session",
          count: task.agentSessionCount,
        },
      ]);
    }

    // Tracked work count (GOAL-only). Prefer the compact summary that
    // collection reads request; fall back to embedded snapshots.
    const trackedCount =
      task.type === "GOAL"
        ? (task.trackedWorkSummary?.totalCount ?? task.trackedEntities?.length)
        : undefined;
    if (trackedCount !== undefined && trackedCount > 0) {
      countGroups.push([
        {
          label: "tracked",
          count: trackedCount,
        },
      ]);
    }

    // Generate href if we have the required IDs
    let href: string | undefined;
    if (options.projectId) {
      href =
        task.type === "GOAL"
          ? pathService.goal({
              projectId: options.projectId,
              taskId: task.id,
            })
          : pathService.task({
              projectId: options.projectId,
              initiativeId: options.initiativeId,
              taskId: task.id,
            });
    }

    const dependencies = buildTaskDependencies(task, options, pathService);

    return {
      title: task.name,
      description: getWorkItemSectionContent(task.sections, "description"),
      status: resolveTaskStatus(task, options),
      entityKindLabel: options.showEntityKind
        ? options.workItemTypeDefinition?.key === task.type
          ? options.workItemTypeDefinition.name
          : undefined
        : undefined,
      ...taskIconIdentity(options, task.type),
      tags: options.showTags ? undefined : undefined, // Tasks don't have tags in schema
      metadata:
        metadata.length > 0
          ? metadata.map((item) => ({
              label: item.key,
              value: item.value,
            }))
          : undefined,
      counts: countGroups.length > 0 ? countGroups : undefined,
      href,
      onClick: options.onClick,
      onDelete: options.onDelete,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      dependencies,
    };
  },
};

export const workItemReferenceAdapter: EntityListItemAdapter<WorkItemReferenceDto> =
  {
    toEntityListItemProps: (reference, options = {}) => {
      const pathService = resolvePathService(options);
      const href =
        options.projectId && !options.onClick
          ? reference.type === "GOAL"
            ? pathService.goal({
                projectId: options.projectId,
                taskId: reference.id,
              })
            : pathService.task({
                projectId: options.projectId,
                taskId: reference.id,
              })
          : undefined;

      return applyPresentation(
        {
          title: reference.name,
          entityKindLabel: options.showEntityKind
            ? options.workItemTypeDefinition?.key === reference.type
              ? options.workItemTypeDefinition.name
              : undefined
            : undefined,
          ...taskIconIdentity(options, reference.type),
          href,
          onClick: options.onClick,
          displayMode: "minimal",
        },
        options,
      );
    },
  };

/**
 * Initiative adapter - transforms InitiativeResponseDto to EntityListItem props
 *
 * @example
 * ```typescript
 * const initiativeProps = initiativeAdapter.toEntityListItemProps(initiative, {
 *   organizationId,
 *   projectId,
 *   users: { [initiative.assigneeId]: { name: 'Jane Doe' } }
 * });
 * ```
 */
export const initiativeAdapter: EntityListItemAdapter<InitiativeResponseDto> = {
  toEntityListItemProps: (initiative, options = {}) => {
    const pathService = resolvePathService(options);
    const metadata: MetadataItem[] = [];

    // Add assignee if available
    if (initiative.assigneeId && options.users?.[initiative.assigneeId]) {
      metadata.push({
        key: "assignee",
        value: options.users[initiative.assigneeId].name,
      });
    }

    // Add due date if available
    if (initiative.dueDate) {
      metadata.push({
        key: "dueDate",
        value: formatDate(initiative.dueDate),
      });
    }

    // Add custom metadata
    if (options.customMetadata) {
      metadata.push(...options.customMetadata);
    }

    // Build counts structure
    const countGroups: CountGroup[] = [];

    // Task counts
    const childCounts = getWorkItemCounts(initiative);
    if (childCounts) {
      countGroups.push(...childCounts);
    }

    // Generate href if we have project ID
    let href: string | undefined;
    if (options.projectId) {
      href = pathService.initiativeDetail({
        projectId: options.projectId,
        initiativeId: initiative.id,
      });
    }

    return {
      title: initiative.name,
      description: getWorkItemSectionContent(
        initiative.sections,
        "description",
      ),
      status: initiative.status,
      entityKindLabel: canonicalKindLabel(options, "Initiative"),
      entityKindIcon: canonicalKindIcon(options, "initiative"),
      tags: initiative.tags,
      counts: countGroups.length > 0 ? countGroups : undefined,
      href,
      onClick: options.onClick,
      onDelete: options.onDelete,
    };
  },
};

/**
 * Agent session adapter - transforms AgentSessionDto to EntityListItem props
 *
 * @example
 * ```typescript
 * const sessionProps = agentSessionAdapter.toEntityListItemProps(session, {
 *   organizationId,
 *   projectId,
 *   users: { [session.userId]: { name: 'Bob Smith' } },
 *   relatedEntities: {
 *     initiatives: { [session.initiativeId]: { name: 'My Initiative' } }
 *   }
 * });
 * ```
 */
export const agentSessionAdapter: EntityListItemAdapter<AgentSessionDto> = {
  toEntityListItemProps: (session, options = {}) => {
    const pathService = resolvePathService(options);
    const tags: string[] = [];
    const metadata: MetadataDisclosureRow[] = [];

    // Add user tag from embedded user or lookup
    const embeddedUserName = trimDisplayValue(session.user?.name);
    const fallbackUserName =
      session.userId && options.users?.[session.userId]
        ? trimDisplayValue(options.users[session.userId].name)
        : undefined;
    const userName = embeddedUserName ?? fallbackUserName;
    if (userName) {
      tags.push(userName);
      metadata.push({ label: "User", value: userName });
    }

    // Add service name
    const serviceName = trimDisplayValue(session.service?.name);
    if (serviceName) {
      tags.push(serviceName);
      metadata.push({ label: "Service", value: serviceName });
    }

    // Add provider
    if (session.provider) {
      const provider = session.provider === "claude" ? "Claude" : "Codex";
      tags.push(provider);
      metadata.push({ label: "Provider", value: provider });
    }

    const worktreeBranch =
      session.type === AgentSessionType.Coding &&
      session.config?.type === "CODING_SESSION"
        ? session.config.worktree?.trim()
        : undefined;
    if (worktreeBranch) {
      tags.push(worktreeBranch);
      metadata.push({ label: "Worktree", value: worktreeBranch });
    }

    // Generate href if we have project ID
    let href: string | undefined;
    if (options.projectId) {
      href = pathService.agentSession({
        projectId: options.projectId,
        agentSessionId: session.id,
      });
    }

    return {
      title: session.title || "Untitled agent session",
      description: formatSessionDate(session.sessionDate),
      status: formatStatus(session.status),
      entityKindLabel: canonicalKindLabel(options, "Agent session"),
      entityKindIcon: canonicalKindIcon(options, "agent_session"),
      agentSessionType: session.type,
      conversationId: session.conversationId ?? undefined,
      tags: tags.length > 0 ? tags : undefined,
      metadata: metadata.length > 0 ? metadata : undefined,
      href,
      onClick: options.onClick,
      onDelete: options.onDelete,
    };
  },
};

/**
 * Design doc adapter - transforms DesignDocResponseDto to EntityListItem props
 *
 * @example
 * ```typescript
 * const docProps = designDocAdapter.toEntityListItemProps(doc, {
 *   organizationId,
 *   projectId
 * });
 * ```
 */
export const designDocAdapter: EntityListItemAdapter<DesignDocResponseDto> = {
  toEntityListItemProps: (doc, options = {}) => {
    const pathService = resolvePathService(options);
    // Add template as tag
    const allTags = [...(doc.tags || []), `Template: ${doc.template}`];

    // Generate href if we have project ID
    let href: string | undefined;
    if (options.projectId) {
      href = pathService.designDoc({
        projectId: options.projectId,
        designDocId: doc.id,
      });
    }

    return applyPresentation(
      {
        title: doc.name,
        description: doc.summary || undefined,
        status: doc.status,
        entityKindLabel: canonicalKindLabel(options, "Design doc"),
        entityKindIcon: canonicalKindIcon(options, "design_doc"),
        tags: allTags,
        href,
        onClick: options.onClick,
        onDelete: options.onDelete,
      },
      options,
    );
  },
};

/**
 * Service adapter - transforms Service to EntityListItem props
 *
 * @example
 * ```typescript
 * const serviceProps = serviceAdapter.toEntityListItemProps(service, {
 *   organizationId
 * });
 * ```
 */
export const serviceAdapter: EntityListItemAdapter<ServiceDto> = {
  toEntityListItemProps: (service, options = {}) => {
    const pathService = resolvePathService(options);
    // Build additional tags from service metadata
    const additionalTags: string[] = [];

    // Add service type as tag if available
    if (service.serviceType) {
      additionalTags.push(service.serviceType);
    }

    // Add language as tag if available
    if (service.language) {
      additionalTags.push(service.language);
    }

    // Combine service tags with additional tags
    const allTags = [...(service.tags || []), ...additionalTags];

    // Generate href - services might be at organization or project level
    const href = options.projectId
      ? pathService.service({
          projectId: options.projectId,
          serviceId: service.id,
        })
      : options.organizationId
        ? pathService.organizationService({
            organizationId: options.organizationId,
            serviceId: service.id,
          })
        : undefined;

    return applyPresentation(
      {
        title: service.name,
        description: service.description || undefined,
        status: service.status,
        entityKindLabel: canonicalKindLabel(options, "Service"),
        entityKindIcon: canonicalKindIcon(options, "service"),
        tags: allTags.length > 0 ? allTags : undefined,
        href,
        onClick: options.onClick,
        onDelete: options.onDelete,
      },
      options,
    );
  },
};

/**
 * Format a date to relative time string
 */
const formatRelativeTime = (dateString: string): string => {
  try {
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
  } catch {
    return dateString;
  }
};

/**
 * Conversation adapter - transforms ConversationResponseDto to EntityListItem props
 *
 * @example
 * ```typescript
 * const conversationProps = conversationAdapter.toEntityListItemProps(conversation, {
 *   projectId
 * });
 * ```
 */
export const conversationAdapter: EntityListItemAdapter<ConversationResponseDto> =
  {
    toEntityListItemProps: (conversation, options = {}) => {
      const pathService = resolvePathService(options);
      const description = conversation.title;

      // Format created timestamp for status
      const status = formatRelativeTime(conversation.createdAt);

      // Add conversation status as tag
      const tags = [conversation.status];

      // Generate href if we have project ID
      let href: string | undefined;
      if (options.projectId) {
        href = pathService.conversation({
          projectId: options.projectId,
          conversationId: conversation.id,
        });
      }

      return {
        title:
          conversation.title ||
          options.fallbackTitle ||
          "Untitled Conversation",
        description,
        status,
        entityKindLabel: canonicalKindLabel(options, "Conversation"),
        entityKindIcon: canonicalKindIcon(options, "conversation"),
        conversationId: conversation.id,
        tags,
        href,
        onClick: options.onClick,
        onDelete: options.onDelete,
      };
    },
  };

/**
 * Implementation hint adapter - transforms ImplementationHintDto to EntityListItem props
 *
 * @example
 * ```typescript
 * const hintProps = implementationHintAdapter.toEntityListItemProps(hint);
 * ```
 */
export const implementationHintAdapter: EntityListItemAdapter<ImplementationHintDto> =
  {
    toEntityListItemProps: (hint, options = {}) => {
      const hintContent = (
        hint.latestVersion?.hint ??
        hint.hint ??
        hint.description
      ).trim();
      const title =
        hint.featureName.trim().length > 0
          ? hint.featureName
          : hintContent.length > 0
            ? hintContent.split("\n")[0].trim().slice(0, 72)
            : "Untitled hint";
      const countGroups: CountGroup[] = [];
      const usageCounts: CountGroup = [];
      const sessionCount = 1;
      const versionCount = hint.versions?.length ?? 0;
      const fileReferenceCount = hint.fileReferences?.length ?? 0;

      if (sessionCount > 0) {
        usageCounts.push({ label: "agent session", count: sessionCount });
      }

      if (usageCounts.length > 0) {
        countGroups.push(usageCounts);
      }

      const metadataCounts: CountGroup = [];
      if (versionCount > 0) {
        metadataCounts.push({ label: "version", count: versionCount });
      }
      if (fileReferenceCount > 0) {
        metadataCounts.push({
          label: "file reference",
          count: fileReferenceCount,
        });
      }
      if (metadataCounts.length > 0) {
        countGroups.push(metadataCounts);
      }

      return {
        title,
        description: hintContent || undefined,
        status: formatStatus(hint.sourceType),
        entityKindLabel: canonicalKindLabel(options, "Implementation hint"),
        entityKindIcon: canonicalKindIcon(options, "design_doc"),
        tags: undefined,
        counts: countGroups.length > 0 ? countGroups : undefined,
        href: undefined,
        onClick: options.onClick,
        onDelete: options.onDelete,
      };
    },
  };

/**
 * Plan adapter - transforms a canonical PLAN Work Item to EntityListItem props
 *
 * @example
 * ```typescript
 * const planProps = planAdapter.toEntityListItemProps(plan, {
 *   organizationId,
 *   projectId
 * });
 * ```
 */
export const planAdapter: EntityListItemAdapter<PlanWorkItem> = {
  toEntityListItemProps: (plan, options = {}) => {
    const pathService = resolvePathService(options);
    const countGroups: CountGroup[] = [];
    const stageCount = plan.childCounts?.total;
    if (stageCount && stageCount > 0) {
      countGroups.push([
        {
          label: "stage",
          count: stageCount,
        },
      ]);
    }
    let href: string | undefined;
    if (options.projectId) {
      href = pathService.plan({
        projectId: options.projectId,
        planId: plan.id,
      });
    }

    const description = plan.sections?.find(
      (section) => section.key === "description",
    )?.materializedMarkdown;
    const outcome = plan.sections?.find(
      (section) => section.key === "outcome",
    )?.materializedMarkdown;

    return applyPresentation(
      {
        title: plan.name,
        description: description || outcome,
        status: formatStatus(plan.status),
        entityKindLabel: canonicalKindLabel(options, "Plan"),
        entityKindIcon: canonicalKindIcon(options, "plan"),
        counts: countGroups.length > 0 ? countGroups : undefined,
        href,
        onClick: options.onClick,
        onDelete: options.onDelete,
      },
      options,
    );
  },
};
