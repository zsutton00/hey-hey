/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> =
  | T
  | {
      [P in keyof T]?: P extends " $fragmentName" | "__typename" ? T[P] : never;
    };
import type { TypedDocumentNode as DocumentNode } from "@graphql-typed-document-node/core";
export type EdgeType =
  | "Conditional"
  | "Consumes"
  | "Contradicts"
  | "DependsOn"
  | "DerivesFrom"
  | "Evolves"
  | "FulfilledBy"
  | "Guarantees"
  | "Implements"
  | "Loop"
  | "ProposedTogether"
  | "RelatedTo"
  | "Standard"
  | "Supersedes"
  | "Tracks";

export type EntityType =
  | "AgentSession"
  | "Artifact"
  | "Conversation"
  | "DesignDoc"
  | "ImplementationHint"
  | "Initiative"
  | "Message"
  | "Project"
  | "Proposal"
  | "Report"
  | "Service"
  | "Task"
  | "ValidationSession";

export type RelatedEntityFilter = {
  edgeTypes: Array<EdgeType>;
  entityId: string | number;
  entityType: EntityType;
};

export type SortDirection = "asc" | "desc";

export type WorkItemSort = {
  direction?: SortDirection;
  field: WorkItemSortField;
};

export type WorkItemSortField =
  "createdAt" | "priority" | "status" | "title" | "updatedAt";

export type ConversationFieldsFragment = {
  id: string;
  organizationId: string;
  projectId: string;
  title: string | null;
  status: string;
  workflowName: string;
  workflowId: string | null;
  workflowAboutType: string | null;
  workflowAboutId: string | null;
  initiatedBy: string;
  triggerEvent: string | null;
  createdBy: string | null;
  lastModifiedBy: string | null;
  restricted: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ConversationWithDecisionsFieldsFragment = {
  suggestionDecisions: Array<unknown> | null;
  goalPmRoutingDecisions: Array<unknown> | null;
  id: string;
  organizationId: string;
  projectId: string;
  title: string | null;
  status: string;
  workflowName: string;
  workflowId: string | null;
  workflowAboutType: string | null;
  workflowAboutId: string | null;
  initiatedBy: string;
  triggerEvent: string | null;
  createdBy: string | null;
  lastModifiedBy: string | null;
  restricted: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type MessageFieldsFragment = {
  id: string;
  conversationId: string;
  projectId: string;
  type: string;
  status: string;
  userId: string | null;
  parentMessageId: string | null;
  createdAt: string | null;
  executionStatus: string | null;
  executionQueueConfirmed: boolean | null;
  executionAdmissionDisposition: string | null;
  executionCancellationRequested: boolean | null;
  executionOperationId: string | null;
  awaitingResponse: boolean | null;
  handler: string | null;
  user: unknown;
  data: unknown;
};

export type GetConversationQueryVariables = Exact<{
  id: string | number;
}>;

export type GetConversationQuery = {
  conversation: {
    id: string;
    organizationId: string;
    projectId: string;
    title: string | null;
    status: string;
    workflowName: string;
    workflowId: string | null;
    workflowAboutType: string | null;
    workflowAboutId: string | null;
    initiatedBy: string;
    triggerEvent: string | null;
    createdBy: string | null;
    lastModifiedBy: string | null;
    restricted: boolean;
    version: number;
    createdAt: string;
    updatedAt: string;
  };
};

export type GetConversationWithDecisionsQueryVariables = Exact<{
  id: string | number;
}>;

export type GetConversationWithDecisionsQuery = {
  conversation: {
    suggestionDecisions: Array<unknown> | null;
    goalPmRoutingDecisions: Array<unknown> | null;
    id: string;
    organizationId: string;
    projectId: string;
    title: string | null;
    status: string;
    workflowName: string;
    workflowId: string | null;
    workflowAboutType: string | null;
    workflowAboutId: string | null;
    initiatedBy: string;
    triggerEvent: string | null;
    createdBy: string | null;
    lastModifiedBy: string | null;
    restricted: boolean;
    version: number;
    createdAt: string;
    updatedAt: string;
  };
};

export type GetConversationsQueryVariables = Exact<{
  statuses?: Array<string> | string | null | undefined;
  workflowNames?: Array<string> | string | null | undefined;
  workflowAboutId?: string | null | undefined;
  workflowAboutType?: string | null | undefined;
  search?: string | null | undefined;
  page?: number | null | undefined;
  limit?: number | null | undefined;
}>;

export type GetConversationsQuery = {
  page: {
    nodes: Array<{
      id: string;
      organizationId: string;
      projectId: string;
      title: string | null;
      status: string;
      workflowName: string;
      workflowId: string | null;
      workflowAboutType: string | null;
      workflowAboutId: string | null;
      initiatedBy: string;
      triggerEvent: string | null;
      createdBy: string | null;
      lastModifiedBy: string | null;
      restricted: boolean;
      version: number;
      createdAt: string;
      updatedAt: string;
    }>;
  };
};

export type GetConversationsWithDecisionsQueryVariables = Exact<{
  statuses?: Array<string> | string | null | undefined;
  workflowNames?: Array<string> | string | null | undefined;
  workflowAboutId?: string | null | undefined;
  workflowAboutType?: string | null | undefined;
  search?: string | null | undefined;
  page?: number | null | undefined;
  limit?: number | null | undefined;
}>;

export type GetConversationsWithDecisionsQuery = {
  page: {
    nodes: Array<{
      suggestionDecisions: Array<unknown> | null;
      goalPmRoutingDecisions: Array<unknown> | null;
      id: string;
      organizationId: string;
      projectId: string;
      title: string | null;
      status: string;
      workflowName: string;
      workflowId: string | null;
      workflowAboutType: string | null;
      workflowAboutId: string | null;
      initiatedBy: string;
      triggerEvent: string | null;
      createdBy: string | null;
      lastModifiedBy: string | null;
      restricted: boolean;
      version: number;
      createdAt: string;
      updatedAt: string;
    }>;
  };
};

export type GetActiveConversationsQueryVariables = Exact<{
  workflowNames?: Array<string> | string | null | undefined;
  workflowAboutId?: string | null | undefined;
  workflowAboutType?: string | null | undefined;
  search?: string | null | undefined;
  page?: number | null | undefined;
  limit?: number | null | undefined;
}>;

export type GetActiveConversationsQuery = {
  page: {
    nodes: Array<{
      id: string;
      organizationId: string;
      projectId: string;
      title: string | null;
      status: string;
      workflowName: string;
      workflowId: string | null;
      workflowAboutType: string | null;
      workflowAboutId: string | null;
      initiatedBy: string;
      triggerEvent: string | null;
      createdBy: string | null;
      lastModifiedBy: string | null;
      restricted: boolean;
      version: number;
      createdAt: string;
      updatedAt: string;
    }>;
  };
};

export type GetActiveConversationsWithDecisionsQueryVariables = Exact<{
  workflowNames?: Array<string> | string | null | undefined;
  workflowAboutId?: string | null | undefined;
  workflowAboutType?: string | null | undefined;
  search?: string | null | undefined;
  page?: number | null | undefined;
  limit?: number | null | undefined;
}>;

export type GetActiveConversationsWithDecisionsQuery = {
  page: {
    nodes: Array<{
      suggestionDecisions: Array<unknown> | null;
      goalPmRoutingDecisions: Array<unknown> | null;
      id: string;
      organizationId: string;
      projectId: string;
      title: string | null;
      status: string;
      workflowName: string;
      workflowId: string | null;
      workflowAboutType: string | null;
      workflowAboutId: string | null;
      initiatedBy: string;
      triggerEvent: string | null;
      createdBy: string | null;
      lastModifiedBy: string | null;
      restricted: boolean;
      version: number;
      createdAt: string;
      updatedAt: string;
    }>;
  };
};

export type GetWorkflowConversationsQueryVariables = Exact<{
  workflowName: string;
  workflowAboutId: string;
  statuses?: Array<string> | string | null | undefined;
  sortBy?: string | null | undefined;
  sortOrder?: string | null | undefined;
  page?: number | null | undefined;
  limit?: number | null | undefined;
}>;

export type GetWorkflowConversationsQuery = {
  page: {
    nodes: Array<{
      id: string;
      organizationId: string;
      projectId: string;
      title: string | null;
      status: string;
      workflowName: string;
      workflowId: string | null;
      workflowAboutType: string | null;
      workflowAboutId: string | null;
      initiatedBy: string;
      triggerEvent: string | null;
      createdBy: string | null;
      lastModifiedBy: string | null;
      restricted: boolean;
      version: number;
      createdAt: string;
      updatedAt: string;
    }>;
  };
};

export type GetConversationMessagesQueryVariables = Exact<{
  id: string | number;
  after?: string | number | null | undefined;
}>;

export type GetConversationMessagesQuery = {
  conversation: {
    id: string;
    messages: {
      endCursor: string | null;
      nodes: Array<{
        proposals: Array<unknown> | null;
        reports: Array<unknown> | null;
        id: string;
        conversationId: string;
        projectId: string;
        type: string;
        status: string;
        userId: string | null;
        parentMessageId: string | null;
        createdAt: string | null;
        executionStatus: string | null;
        executionQueueConfirmed: boolean | null;
        executionAdmissionDisposition: string | null;
        executionCancellationRequested: boolean | null;
        executionOperationId: string | null;
        awaitingResponse: boolean | null;
        handler: string | null;
        user: unknown;
        data: unknown;
      }>;
    };
  };
};

export type GetConversationMessageHistoryQueryVariables = Exact<{
  id: string | number;
  last: number;
  before?: string | number | null | undefined;
}>;

export type GetConversationMessageHistoryQuery = {
  conversation: {
    id: string;
    messages: {
      endCursor: string | null;
      startCursor: string | null;
      hasOlder: boolean | null;
      nodes: Array<{
        proposals: Array<unknown> | null;
        reports: Array<unknown> | null;
        id: string;
        conversationId: string;
        projectId: string;
        type: string;
        status: string;
        userId: string | null;
        parentMessageId: string | null;
        createdAt: string | null;
        executionStatus: string | null;
        executionQueueConfirmed: boolean | null;
        executionAdmissionDisposition: string | null;
        executionCancellationRequested: boolean | null;
        executionOperationId: string | null;
        awaitingResponse: boolean | null;
        handler: string | null;
        user: unknown;
        data: unknown;
      }>;
    };
  };
};

export type GetMessageQueryVariables = Exact<{
  id: string | number;
}>;

export type GetMessageQuery = {
  message: {
    proposals: Array<unknown> | null;
    reports: Array<unknown> | null;
    id: string;
    conversationId: string;
    projectId: string;
    type: string;
    status: string;
    userId: string | null;
    parentMessageId: string | null;
    createdAt: string | null;
    executionStatus: string | null;
    executionQueueConfirmed: boolean | null;
    executionAdmissionDisposition: string | null;
    executionCancellationRequested: boolean | null;
    executionOperationId: string | null;
    awaitingResponse: boolean | null;
    handler: string | null;
    user: unknown;
    data: unknown;
    parentMessage: {
      id: string;
      conversationId: string;
      projectId: string;
      type: string;
      status: string;
      userId: string | null;
      parentMessageId: string | null;
      createdAt: string | null;
      executionStatus: string | null;
      executionQueueConfirmed: boolean | null;
      executionAdmissionDisposition: string | null;
      executionCancellationRequested: boolean | null;
      executionOperationId: string | null;
      awaitingResponse: boolean | null;
      handler: string | null;
      user: unknown;
      data: unknown;
    } | null;
    responses: Array<{
      id: string;
      conversationId: string;
      projectId: string;
      type: string;
      status: string;
      userId: string | null;
      parentMessageId: string | null;
      createdAt: string | null;
      executionStatus: string | null;
      executionQueueConfirmed: boolean | null;
      executionAdmissionDisposition: string | null;
      executionCancellationRequested: boolean | null;
      executionOperationId: string | null;
      awaitingResponse: boolean | null;
      handler: string | null;
      user: unknown;
      data: unknown;
    }> | null;
  };
};

export type GetLatestMessageQueryVariables = Exact<{
  conversationId: string | number;
}>;

export type GetLatestMessageQuery = {
  latestMessage: {
    proposals: Array<unknown> | null;
    reports: Array<unknown> | null;
    id: string;
    conversationId: string;
    projectId: string;
    type: string;
    status: string;
    userId: string | null;
    parentMessageId: string | null;
    createdAt: string | null;
    executionStatus: string | null;
    executionQueueConfirmed: boolean | null;
    executionAdmissionDisposition: string | null;
    executionCancellationRequested: boolean | null;
    executionOperationId: string | null;
    awaitingResponse: boolean | null;
    handler: string | null;
    user: unknown;
    data: unknown;
  } | null;
};

export type ReadConversationThreadQueryVariables = Exact<{
  id: string | number;
}>;

export type ReadConversationThreadQuery = {
  conversation: {
    id: string;
    messages: {
      endCursor: string | null;
      startCursor: string | null;
      hasOlder: boolean | null;
      nodes: Array<{ id: string; status: string; createdAt: string | null }>;
    };
  };
};

export type MessageProposalLinksFragment = {
  type: string;
  data: unknown;
  proposals: Array<unknown> | null;
};

export type ProjectScopeQueryVariables = Exact<{ [key: string]: never }>;

export type ProjectScopeQuery = {
  projectScope: { organizationId: string; projectId: string };
};

export type WorkItemFieldsFragment = {
  id: string;
  name: string;
  type: string;
  status: string;
  organizationId: string;
  projectId: string;
  initiativeId: string | null;
  parentTaskId: string | null;
  source: string;
  priority: string | null;
  tag: string | null;
  assigneeId: string | null;
  reporterId: string | null;
  dueDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  archivedAt: string | null;
  hasProposalSupport: boolean | null;
  config: unknown;
  childCounts: {
    total: number | null;
    done: number | null;
    inProgress: number | null;
    backlog: number | null;
  } | null;
};

export type WorkItemSectionFieldsFragment = {
  id: string;
  key: string;
  order: number;
  materializedMarkdown: string;
  materializedProposalId: string;
  crdtSnapshotSeq: number | null;
};

export type WorkItemEdgeFieldsFragment = {
  id: string;
  type: EdgeType;
  targetNodeType: string | null;
  category: string | null;
  direction: string | null;
  predicate: string | null;
  actionLabel: string | null;
  transitionRole: string | null;
  reasoning: string;
  origin: string | null;
  createdBySessionId: string | null;
  lastModifiedBySessionId: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  source: { entityId: string; entityType: string | null; name: string | null };
  target: { entityId: string; entityType: string | null; name: string | null };
};

export type WorkItemServiceRelationFieldsFragment = {
  id: string;
  serviceId: string;
  taskId: string;
  relationType: string | null;
  createdAt: string;
};

export type WorkItemTrackedEntityFieldsFragment = {
  entityId: string;
  entityType: string | null;
  name: string | null;
  status: string | null;
  dueDate: string | null;
};

export type WorkItemTrackedSummaryFieldsFragment = {
  totalCount: number;
  completedCount: number;
  cancelledCount: number;
  pastDueCount: number;
  openUndatedCount: number;
};

export type WorkItemPartsFragment = {
  designDocCount?: number | null;
  codingSessionCount?: number | null;
  agentSessionCount?: number | null;
  id: string;
  name: string;
  type: string;
  status: string;
  organizationId: string;
  projectId: string;
  initiativeId: string | null;
  parentTaskId: string | null;
  source: string;
  priority: string | null;
  tag: string | null;
  assigneeId: string | null;
  reporterId: string | null;
  dueDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  archivedAt: string | null;
  hasProposalSupport: boolean | null;
  config: unknown;
  sections?: Array<{
    id: string;
    key: string;
    order: number;
    materializedMarkdown: string;
    materializedProposalId: string;
    crdtSnapshotSeq: number | null;
  }> | null;
  edges?: Array<{
    id: string;
    type: EdgeType;
    targetNodeType: string | null;
    category: string | null;
    direction: string | null;
    predicate: string | null;
    actionLabel: string | null;
    transitionRole: string | null;
    reasoning: string;
    origin: string | null;
    createdBySessionId: string | null;
    lastModifiedBySessionId: string | null;
    metadata: unknown;
    createdAt: string;
    updatedAt: string;
    source: {
      entityId: string;
      entityType: string | null;
      name: string | null;
    };
    target: {
      entityId: string;
      entityType: string | null;
      name: string | null;
    };
  }> | null;
  serviceRelations?: Array<{
    id: string;
    serviceId: string;
    taskId: string;
    relationType: string | null;
    createdAt: string;
  }> | null;
  trackedEntities?: Array<{
    entityId: string;
    entityType: string | null;
    name: string | null;
    status: string | null;
    dueDate: string | null;
  }> | null;
  trackedWorkSummary?: {
    totalCount: number;
    completedCount: number;
    cancelledCount: number;
    pastDueCount: number;
    openUndatedCount: number;
  } | null;
  childCounts: {
    total: number | null;
    done: number | null;
    inProgress: number | null;
    backlog: number | null;
  } | null;
};

export type GetWorkItemsQueryVariables = Exact<{
  initiativeId?: string | number | null | undefined;
  parentTaskId?: string | number | null | undefined;
  parentTaskIds?: Array<string | number> | string | number | null | undefined;
  ids?: Array<string | number> | string | number | null | undefined;
  type?: string | null | undefined;
  statuses?: Array<string> | string | null | undefined;
  includeDescendants?: boolean | null | undefined;
  relatedTo?: RelatedEntityFilter | null | undefined;
  sort?: WorkItemSort | null | undefined;
  page?: number | null | undefined;
  limit?: number | null | undefined;
  withSections: boolean;
  sectionKeys?: Array<string> | string | null | undefined;
  withEdges: boolean;
  edgeTypes?: Array<EdgeType> | EdgeType | null | undefined;
  withServiceRelations: boolean;
  withTrackedEntities: boolean;
  withTrackedWorkSummary: boolean;
  withDesignDocCounts: boolean;
  withAgentSessionCounts: boolean;
}>;

export type GetWorkItemsQuery = {
  workItems: Array<{
    designDocCount?: number | null;
    codingSessionCount?: number | null;
    agentSessionCount?: number | null;
    id: string;
    name: string;
    type: string;
    status: string;
    organizationId: string;
    projectId: string;
    initiativeId: string | null;
    parentTaskId: string | null;
    source: string;
    priority: string | null;
    tag: string | null;
    assigneeId: string | null;
    reporterId: string | null;
    dueDate: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    archivedAt: string | null;
    hasProposalSupport: boolean | null;
    config: unknown;
    sections?: Array<{
      id: string;
      key: string;
      order: number;
      materializedMarkdown: string;
      materializedProposalId: string;
      crdtSnapshotSeq: number | null;
    }> | null;
    edges?: Array<{
      id: string;
      type: EdgeType;
      targetNodeType: string | null;
      category: string | null;
      direction: string | null;
      predicate: string | null;
      actionLabel: string | null;
      transitionRole: string | null;
      reasoning: string;
      origin: string | null;
      createdBySessionId: string | null;
      lastModifiedBySessionId: string | null;
      metadata: unknown;
      createdAt: string;
      updatedAt: string;
      source: {
        entityId: string;
        entityType: string | null;
        name: string | null;
      };
      target: {
        entityId: string;
        entityType: string | null;
        name: string | null;
      };
    }> | null;
    serviceRelations?: Array<{
      id: string;
      serviceId: string;
      taskId: string;
      relationType: string | null;
      createdAt: string;
    }> | null;
    trackedEntities?: Array<{
      entityId: string;
      entityType: string | null;
      name: string | null;
      status: string | null;
      dueDate: string | null;
    }> | null;
    trackedWorkSummary?: {
      totalCount: number;
      completedCount: number;
      cancelledCount: number;
      pastDueCount: number;
      openUndatedCount: number;
    } | null;
    childCounts: {
      total: number | null;
      done: number | null;
      inProgress: number | null;
      backlog: number | null;
    } | null;
  }>;
};

export type GetWorkItemQueryVariables = Exact<{
  id: string | number;
  withSections: boolean;
  sectionKeys?: Array<string> | string | null | undefined;
  withEdges: boolean;
  edgeTypes?: Array<EdgeType> | EdgeType | null | undefined;
  withServiceRelations: boolean;
  withTrackedEntities: boolean;
  withTrackedWorkSummary: boolean;
  withDesignDocCounts: boolean;
  withAgentSessionCounts: boolean;
}>;

export type GetWorkItemQuery = {
  workItem: {
    designDocCount?: number | null;
    codingSessionCount?: number | null;
    agentSessionCount?: number | null;
    id: string;
    name: string;
    type: string;
    status: string;
    organizationId: string;
    projectId: string;
    initiativeId: string | null;
    parentTaskId: string | null;
    source: string;
    priority: string | null;
    tag: string | null;
    assigneeId: string | null;
    reporterId: string | null;
    dueDate: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    archivedAt: string | null;
    hasProposalSupport: boolean | null;
    config: unknown;
    sections?: Array<{
      id: string;
      key: string;
      order: number;
      materializedMarkdown: string;
      materializedProposalId: string;
      crdtSnapshotSeq: number | null;
    }> | null;
    edges?: Array<{
      id: string;
      type: EdgeType;
      targetNodeType: string | null;
      category: string | null;
      direction: string | null;
      predicate: string | null;
      actionLabel: string | null;
      transitionRole: string | null;
      reasoning: string;
      origin: string | null;
      createdBySessionId: string | null;
      lastModifiedBySessionId: string | null;
      metadata: unknown;
      createdAt: string;
      updatedAt: string;
      source: {
        entityId: string;
        entityType: string | null;
        name: string | null;
      };
      target: {
        entityId: string;
        entityType: string | null;
        name: string | null;
      };
    }> | null;
    serviceRelations?: Array<{
      id: string;
      serviceId: string;
      taskId: string;
      relationType: string | null;
      createdAt: string;
    }> | null;
    trackedEntities?: Array<{
      entityId: string;
      entityType: string | null;
      name: string | null;
      status: string | null;
      dueDate: string | null;
    }> | null;
    trackedWorkSummary?: {
      totalCount: number;
      completedCount: number;
      cancelledCount: number;
      pastDueCount: number;
      openUndatedCount: number;
    } | null;
    childCounts: {
      total: number | null;
      done: number | null;
      inProgress: number | null;
      backlog: number | null;
    } | null;
  };
};

export type GetWorkItemHierarchyQueryVariables = Exact<{
  id: string | number;
  includeDesignDocCounts?: boolean | null | undefined;
  includeAgentSessionCounts?: boolean | null | undefined;
  withSections: boolean;
  sectionKeys?: Array<string> | string | null | undefined;
  withEdges: boolean;
  edgeTypes?: Array<EdgeType> | EdgeType | null | undefined;
  withServiceRelations: boolean;
  withTrackedEntities: boolean;
  withTrackedWorkSummary: boolean;
  withDesignDocCounts: boolean;
  withAgentSessionCounts: boolean;
}>;

export type GetWorkItemHierarchyQuery = {
  workItemHierarchy: {
    task: {
      designDocCount?: number | null;
      codingSessionCount?: number | null;
      agentSessionCount?: number | null;
      id: string;
      name: string;
      type: string;
      status: string;
      organizationId: string;
      projectId: string;
      initiativeId: string | null;
      parentTaskId: string | null;
      source: string;
      priority: string | null;
      tag: string | null;
      assigneeId: string | null;
      reporterId: string | null;
      dueDate: string | null;
      createdAt: string | null;
      updatedAt: string | null;
      archivedAt: string | null;
      hasProposalSupport: boolean | null;
      config: unknown;
      sections?: Array<{
        id: string;
        key: string;
        order: number;
        materializedMarkdown: string;
        materializedProposalId: string;
        crdtSnapshotSeq: number | null;
      }> | null;
      edges?: Array<{
        id: string;
        type: EdgeType;
        targetNodeType: string | null;
        category: string | null;
        direction: string | null;
        predicate: string | null;
        actionLabel: string | null;
        transitionRole: string | null;
        reasoning: string;
        origin: string | null;
        createdBySessionId: string | null;
        lastModifiedBySessionId: string | null;
        metadata: unknown;
        createdAt: string;
        updatedAt: string;
        source: {
          entityId: string;
          entityType: string | null;
          name: string | null;
        };
        target: {
          entityId: string;
          entityType: string | null;
          name: string | null;
        };
      }> | null;
      serviceRelations?: Array<{
        id: string;
        serviceId: string;
        taskId: string;
        relationType: string | null;
        createdAt: string;
      }> | null;
      trackedEntities?: Array<{
        entityId: string;
        entityType: string | null;
        name: string | null;
        status: string | null;
        dueDate: string | null;
      }> | null;
      trackedWorkSummary?: {
        totalCount: number;
        completedCount: number;
        cancelledCount: number;
        pastDueCount: number;
        openUndatedCount: number;
      } | null;
      childCounts: {
        total: number | null;
        done: number | null;
        inProgress: number | null;
        backlog: number | null;
      } | null;
    };
    parent: {
      designDocCount?: number | null;
      codingSessionCount?: number | null;
      agentSessionCount?: number | null;
      id: string;
      name: string;
      type: string;
      status: string;
      organizationId: string;
      projectId: string;
      initiativeId: string | null;
      parentTaskId: string | null;
      source: string;
      priority: string | null;
      tag: string | null;
      assigneeId: string | null;
      reporterId: string | null;
      dueDate: string | null;
      createdAt: string | null;
      updatedAt: string | null;
      archivedAt: string | null;
      hasProposalSupport: boolean | null;
      config: unknown;
      sections?: Array<{
        id: string;
        key: string;
        order: number;
        materializedMarkdown: string;
        materializedProposalId: string;
        crdtSnapshotSeq: number | null;
      }> | null;
      edges?: Array<{
        id: string;
        type: EdgeType;
        targetNodeType: string | null;
        category: string | null;
        direction: string | null;
        predicate: string | null;
        actionLabel: string | null;
        transitionRole: string | null;
        reasoning: string;
        origin: string | null;
        createdBySessionId: string | null;
        lastModifiedBySessionId: string | null;
        metadata: unknown;
        createdAt: string;
        updatedAt: string;
        source: {
          entityId: string;
          entityType: string | null;
          name: string | null;
        };
        target: {
          entityId: string;
          entityType: string | null;
          name: string | null;
        };
      }> | null;
      serviceRelations?: Array<{
        id: string;
        serviceId: string;
        taskId: string;
        relationType: string | null;
        createdAt: string;
      }> | null;
      trackedEntities?: Array<{
        entityId: string;
        entityType: string | null;
        name: string | null;
        status: string | null;
        dueDate: string | null;
      }> | null;
      trackedWorkSummary?: {
        totalCount: number;
        completedCount: number;
        cancelledCount: number;
        pastDueCount: number;
        openUndatedCount: number;
      } | null;
      childCounts: {
        total: number | null;
        done: number | null;
        inProgress: number | null;
        backlog: number | null;
      } | null;
    } | null;
    children: Array<{
      designDocCount?: number | null;
      codingSessionCount?: number | null;
      agentSessionCount?: number | null;
      id: string;
      name: string;
      type: string;
      status: string;
      organizationId: string;
      projectId: string;
      initiativeId: string | null;
      parentTaskId: string | null;
      source: string;
      priority: string | null;
      tag: string | null;
      assigneeId: string | null;
      reporterId: string | null;
      dueDate: string | null;
      createdAt: string | null;
      updatedAt: string | null;
      archivedAt: string | null;
      hasProposalSupport: boolean | null;
      config: unknown;
      sections?: Array<{
        id: string;
        key: string;
        order: number;
        materializedMarkdown: string;
        materializedProposalId: string;
        crdtSnapshotSeq: number | null;
      }> | null;
      edges?: Array<{
        id: string;
        type: EdgeType;
        targetNodeType: string | null;
        category: string | null;
        direction: string | null;
        predicate: string | null;
        actionLabel: string | null;
        transitionRole: string | null;
        reasoning: string;
        origin: string | null;
        createdBySessionId: string | null;
        lastModifiedBySessionId: string | null;
        metadata: unknown;
        createdAt: string;
        updatedAt: string;
        source: {
          entityId: string;
          entityType: string | null;
          name: string | null;
        };
        target: {
          entityId: string;
          entityType: string | null;
          name: string | null;
        };
      }> | null;
      serviceRelations?: Array<{
        id: string;
        serviceId: string;
        taskId: string;
        relationType: string | null;
        createdAt: string;
      }> | null;
      trackedEntities?: Array<{
        entityId: string;
        entityType: string | null;
        name: string | null;
        status: string | null;
        dueDate: string | null;
      }> | null;
      trackedWorkSummary?: {
        totalCount: number;
        completedCount: number;
        cancelledCount: number;
        pastDueCount: number;
        openUndatedCount: number;
      } | null;
      childCounts: {
        total: number | null;
        done: number | null;
        inProgress: number | null;
        backlog: number | null;
      } | null;
    }>;
  };
};

export type WorkItemGraphMemberFragment = {
  id: string;
  name: string;
  type: string;
  status: string;
  organizationId: string;
  projectId: string;
  initiativeId: string | null;
  parentTaskId: string | null;
  source: string;
  priority: string | null;
  tag: string | null;
  assigneeId: string | null;
  reporterId: string | null;
  dueDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  archivedAt: string | null;
  hasProposalSupport: boolean | null;
  config: unknown;
  sections: Array<{
    id: string;
    key: string;
    order: number;
    materializedMarkdown: string;
    materializedProposalId: string;
    crdtSnapshotSeq: number | null;
  }> | null;
  childCounts: {
    total: number | null;
    done: number | null;
    inProgress: number | null;
    backlog: number | null;
  } | null;
};

export type GetWorkItemGraphQueryVariables = Exact<{
  id: string | number;
  incidentRelationshipTypes?: Array<string> | string | null | undefined;
}>;

export type GetWorkItemGraphQuery = {
  workItem: {
    id: string;
    graph: {
      layout: unknown;
      participation: unknown;
      root: {
        id: string;
        name: string;
        type: string;
        status: string;
        organizationId: string;
        projectId: string;
        initiativeId: string | null;
        parentTaskId: string | null;
        source: string;
        priority: string | null;
        tag: string | null;
        assigneeId: string | null;
        reporterId: string | null;
        dueDate: string | null;
        createdAt: string | null;
        updatedAt: string | null;
        archivedAt: string | null;
        hasProposalSupport: boolean | null;
        config: unknown;
        sections: Array<{
          id: string;
          key: string;
          order: number;
          materializedMarkdown: string;
          materializedProposalId: string;
          crdtSnapshotSeq: number | null;
        }> | null;
        childCounts: {
          total: number | null;
          done: number | null;
          inProgress: number | null;
          backlog: number | null;
        } | null;
      };
      children: Array<{
        id: string;
        name: string;
        type: string;
        status: string;
        organizationId: string;
        projectId: string;
        initiativeId: string | null;
        parentTaskId: string | null;
        source: string;
        priority: string | null;
        tag: string | null;
        assigneeId: string | null;
        reporterId: string | null;
        dueDate: string | null;
        createdAt: string | null;
        updatedAt: string | null;
        archivedAt: string | null;
        hasProposalSupport: boolean | null;
        config: unknown;
        sections: Array<{
          id: string;
          key: string;
          order: number;
          materializedMarkdown: string;
          materializedProposalId: string;
          crdtSnapshotSeq: number | null;
        }> | null;
        childCounts: {
          total: number | null;
          done: number | null;
          inProgress: number | null;
          backlog: number | null;
        } | null;
      }>;
      relationships: Array<{
        id: string;
        type: EdgeType;
        targetNodeType: string | null;
        category: string | null;
        direction: string | null;
        predicate: string | null;
        actionLabel: string | null;
        transitionRole: string | null;
        reasoning: string;
        origin: string | null;
        createdBySessionId: string | null;
        lastModifiedBySessionId: string | null;
        metadata: unknown;
        createdAt: string;
        updatedAt: string;
        source: {
          entityId: string;
          entityType: string | null;
          name: string | null;
        };
        target: {
          entityId: string;
          entityType: string | null;
          name: string | null;
        };
      }>;
      derivedReferences: Array<{
        entityId: string;
        entityType: string | null;
        name: string | null;
        expansionKey: string;
        projectionKind: string;
        workItemTypeKey: string | null;
        viaEntityIds: Array<string>;
      }>;
    };
  };
};

export type WorkItemReferenceFieldsFragment = {
  id: string;
  name: string;
  type: string;
  parentTaskId: string | null;
};

export type GetAllWorkItemReferencesQueryVariables = Exact<{
  type: string;
}>;

export type GetAllWorkItemReferencesQuery = {
  references: Array<{
    id: string;
    name: string;
    type: string;
    parentTaskId: string | null;
  }>;
};

export type GetWorkItemReferencePageQueryVariables = Exact<{
  type: string;
  page: number;
  limit: number;
  filter?: string | null | undefined;
  statuses?: Array<string> | string | null | undefined;
  sortBy?: string | null | undefined;
  sortOrder?: string | null | undefined;
}>;

export type GetWorkItemReferencePageQuery = {
  workItemReferences: {
    items: Array<{
      id: string;
      name: string;
      type: string;
      parentTaskId: string | null;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrevious: boolean;
    };
  };
};

export const ConversationFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "ConversationFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Conversation" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "organizationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "title" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "workflowName" } },
          { kind: "Field", name: { kind: "Name", value: "workflowId" } },
          { kind: "Field", name: { kind: "Name", value: "workflowAboutType" } },
          { kind: "Field", name: { kind: "Name", value: "workflowAboutId" } },
          { kind: "Field", name: { kind: "Name", value: "initiatedBy" } },
          { kind: "Field", name: { kind: "Name", value: "triggerEvent" } },
          { kind: "Field", name: { kind: "Name", value: "createdBy" } },
          { kind: "Field", name: { kind: "Name", value: "lastModifiedBy" } },
          { kind: "Field", name: { kind: "Name", value: "restricted" } },
          { kind: "Field", name: { kind: "Name", value: "version" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<ConversationFieldsFragment, unknown>;
export const ConversationWithDecisionsFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "ConversationWithDecisionsFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Conversation" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "FragmentSpread",
            name: { kind: "Name", value: "ConversationFields" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "suggestionDecisions" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "goalPmRoutingDecisions" },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "ConversationFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Conversation" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "organizationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "title" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "workflowName" } },
          { kind: "Field", name: { kind: "Name", value: "workflowId" } },
          { kind: "Field", name: { kind: "Name", value: "workflowAboutType" } },
          { kind: "Field", name: { kind: "Name", value: "workflowAboutId" } },
          { kind: "Field", name: { kind: "Name", value: "initiatedBy" } },
          { kind: "Field", name: { kind: "Name", value: "triggerEvent" } },
          { kind: "Field", name: { kind: "Name", value: "createdBy" } },
          { kind: "Field", name: { kind: "Name", value: "lastModifiedBy" } },
          { kind: "Field", name: { kind: "Name", value: "restricted" } },
          { kind: "Field", name: { kind: "Name", value: "version" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<ConversationWithDecisionsFieldsFragment, unknown>;
export const MessageFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "MessageFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Message" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "conversationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "userId" } },
          { kind: "Field", name: { kind: "Name", value: "parentMessageId" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "executionStatus" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionQueueConfirmed" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionAdmissionDisposition" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionCancellationRequested" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionOperationId" },
          },
          { kind: "Field", name: { kind: "Name", value: "awaitingResponse" } },
          { kind: "Field", name: { kind: "Name", value: "handler" } },
          { kind: "Field", name: { kind: "Name", value: "user" } },
          { kind: "Field", name: { kind: "Name", value: "data" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MessageFieldsFragment, unknown>;
export const MessageProposalLinksFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "MessageProposalLinks" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Message" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "type" } },
          { kind: "Field", name: { kind: "Name", value: "data" } },
          { kind: "Field", name: { kind: "Name", value: "proposals" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MessageProposalLinksFragment, unknown>;
export const WorkItemFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItem" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "name" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "organizationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "initiativeId" } },
          { kind: "Field", name: { kind: "Name", value: "parentTaskId" } },
          { kind: "Field", name: { kind: "Name", value: "source" } },
          { kind: "Field", name: { kind: "Name", value: "priority" } },
          { kind: "Field", name: { kind: "Name", value: "tag" } },
          { kind: "Field", name: { kind: "Name", value: "assigneeId" } },
          { kind: "Field", name: { kind: "Name", value: "reporterId" } },
          { kind: "Field", name: { kind: "Name", value: "dueDate" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
          { kind: "Field", name: { kind: "Name", value: "archivedAt" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "hasProposalSupport" },
          },
          { kind: "Field", name: { kind: "Name", value: "config" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "childCounts" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "total" } },
                { kind: "Field", name: { kind: "Name", value: "done" } },
                { kind: "Field", name: { kind: "Name", value: "inProgress" } },
                { kind: "Field", name: { kind: "Name", value: "backlog" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<WorkItemFieldsFragment, unknown>;
export const WorkItemSectionFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemSectionFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItemSection" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "key" } },
          { kind: "Field", name: { kind: "Name", value: "order" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "materializedMarkdown" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "materializedProposalId" },
          },
          { kind: "Field", name: { kind: "Name", value: "crdtSnapshotSeq" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<WorkItemSectionFieldsFragment, unknown>;
export const WorkItemEdgeFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemEdgeFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItemEdge" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "source" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "entityId" } },
                { kind: "Field", name: { kind: "Name", value: "entityType" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "target" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "entityId" } },
                { kind: "Field", name: { kind: "Name", value: "entityType" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
              ],
            },
          },
          { kind: "Field", name: { kind: "Name", value: "targetNodeType" } },
          { kind: "Field", name: { kind: "Name", value: "category" } },
          { kind: "Field", name: { kind: "Name", value: "direction" } },
          { kind: "Field", name: { kind: "Name", value: "predicate" } },
          { kind: "Field", name: { kind: "Name", value: "actionLabel" } },
          { kind: "Field", name: { kind: "Name", value: "transitionRole" } },
          { kind: "Field", name: { kind: "Name", value: "reasoning" } },
          { kind: "Field", name: { kind: "Name", value: "origin" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "createdBySessionId" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "lastModifiedBySessionId" },
          },
          { kind: "Field", name: { kind: "Name", value: "metadata" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<WorkItemEdgeFieldsFragment, unknown>;
export const WorkItemServiceRelationFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemServiceRelationFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "ServiceRelation" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "serviceId" } },
          { kind: "Field", name: { kind: "Name", value: "taskId" } },
          { kind: "Field", name: { kind: "Name", value: "relationType" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<WorkItemServiceRelationFieldsFragment, unknown>;
export const WorkItemTrackedEntityFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemTrackedEntityFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "TrackedEntity" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "entityId" } },
          { kind: "Field", name: { kind: "Name", value: "entityType" } },
          { kind: "Field", name: { kind: "Name", value: "name" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "dueDate" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<WorkItemTrackedEntityFieldsFragment, unknown>;
export const WorkItemTrackedSummaryFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemTrackedSummaryFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "TrackedWorkSummary" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "totalCount" } },
          { kind: "Field", name: { kind: "Name", value: "completedCount" } },
          { kind: "Field", name: { kind: "Name", value: "cancelledCount" } },
          { kind: "Field", name: { kind: "Name", value: "pastDueCount" } },
          { kind: "Field", name: { kind: "Name", value: "openUndatedCount" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<WorkItemTrackedSummaryFieldsFragment, unknown>;
export const WorkItemPartsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemParts" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItem" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "FragmentSpread",
            name: { kind: "Name", value: "WorkItemFields" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "sections" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "keys" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "sectionKeys" },
                },
              },
            ],
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withSections" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemSectionFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "edges" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "types" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "edgeTypes" },
                },
              },
            ],
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withEdges" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemEdgeFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "serviceRelations" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withServiceRelations" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: {
                    kind: "Name",
                    value: "WorkItemServiceRelationFields",
                  },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "trackedEntities" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withTrackedEntities" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemTrackedEntityFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "trackedWorkSummary" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withTrackedWorkSummary" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemTrackedSummaryFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "designDocCount" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withDesignDocCounts" },
                    },
                  },
                ],
              },
            ],
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "codingSessionCount" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withAgentSessionCounts" },
                    },
                  },
                ],
              },
            ],
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "agentSessionCount" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withAgentSessionCounts" },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItem" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "name" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "organizationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "initiativeId" } },
          { kind: "Field", name: { kind: "Name", value: "parentTaskId" } },
          { kind: "Field", name: { kind: "Name", value: "source" } },
          { kind: "Field", name: { kind: "Name", value: "priority" } },
          { kind: "Field", name: { kind: "Name", value: "tag" } },
          { kind: "Field", name: { kind: "Name", value: "assigneeId" } },
          { kind: "Field", name: { kind: "Name", value: "reporterId" } },
          { kind: "Field", name: { kind: "Name", value: "dueDate" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
          { kind: "Field", name: { kind: "Name", value: "archivedAt" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "hasProposalSupport" },
          },
          { kind: "Field", name: { kind: "Name", value: "config" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "childCounts" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "total" } },
                { kind: "Field", name: { kind: "Name", value: "done" } },
                { kind: "Field", name: { kind: "Name", value: "inProgress" } },
                { kind: "Field", name: { kind: "Name", value: "backlog" } },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemSectionFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItemSection" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "key" } },
          { kind: "Field", name: { kind: "Name", value: "order" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "materializedMarkdown" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "materializedProposalId" },
          },
          { kind: "Field", name: { kind: "Name", value: "crdtSnapshotSeq" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemEdgeFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItemEdge" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "source" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "entityId" } },
                { kind: "Field", name: { kind: "Name", value: "entityType" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "target" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "entityId" } },
                { kind: "Field", name: { kind: "Name", value: "entityType" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
              ],
            },
          },
          { kind: "Field", name: { kind: "Name", value: "targetNodeType" } },
          { kind: "Field", name: { kind: "Name", value: "category" } },
          { kind: "Field", name: { kind: "Name", value: "direction" } },
          { kind: "Field", name: { kind: "Name", value: "predicate" } },
          { kind: "Field", name: { kind: "Name", value: "actionLabel" } },
          { kind: "Field", name: { kind: "Name", value: "transitionRole" } },
          { kind: "Field", name: { kind: "Name", value: "reasoning" } },
          { kind: "Field", name: { kind: "Name", value: "origin" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "createdBySessionId" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "lastModifiedBySessionId" },
          },
          { kind: "Field", name: { kind: "Name", value: "metadata" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemServiceRelationFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "ServiceRelation" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "serviceId" } },
          { kind: "Field", name: { kind: "Name", value: "taskId" } },
          { kind: "Field", name: { kind: "Name", value: "relationType" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemTrackedEntityFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "TrackedEntity" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "entityId" } },
          { kind: "Field", name: { kind: "Name", value: "entityType" } },
          { kind: "Field", name: { kind: "Name", value: "name" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "dueDate" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemTrackedSummaryFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "TrackedWorkSummary" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "totalCount" } },
          { kind: "Field", name: { kind: "Name", value: "completedCount" } },
          { kind: "Field", name: { kind: "Name", value: "cancelledCount" } },
          { kind: "Field", name: { kind: "Name", value: "pastDueCount" } },
          { kind: "Field", name: { kind: "Name", value: "openUndatedCount" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<WorkItemPartsFragment, unknown>;
export const WorkItemGraphMemberFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemGraphMember" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItem" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "FragmentSpread",
            name: { kind: "Name", value: "WorkItemFields" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "sections" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemSectionFields" },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItem" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "name" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "organizationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "initiativeId" } },
          { kind: "Field", name: { kind: "Name", value: "parentTaskId" } },
          { kind: "Field", name: { kind: "Name", value: "source" } },
          { kind: "Field", name: { kind: "Name", value: "priority" } },
          { kind: "Field", name: { kind: "Name", value: "tag" } },
          { kind: "Field", name: { kind: "Name", value: "assigneeId" } },
          { kind: "Field", name: { kind: "Name", value: "reporterId" } },
          { kind: "Field", name: { kind: "Name", value: "dueDate" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
          { kind: "Field", name: { kind: "Name", value: "archivedAt" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "hasProposalSupport" },
          },
          { kind: "Field", name: { kind: "Name", value: "config" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "childCounts" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "total" } },
                { kind: "Field", name: { kind: "Name", value: "done" } },
                { kind: "Field", name: { kind: "Name", value: "inProgress" } },
                { kind: "Field", name: { kind: "Name", value: "backlog" } },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemSectionFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItemSection" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "key" } },
          { kind: "Field", name: { kind: "Name", value: "order" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "materializedMarkdown" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "materializedProposalId" },
          },
          { kind: "Field", name: { kind: "Name", value: "crdtSnapshotSeq" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<WorkItemGraphMemberFragment, unknown>;
export const WorkItemReferenceFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemReferenceFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItemReference" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "name" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          { kind: "Field", name: { kind: "Name", value: "parentTaskId" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<WorkItemReferenceFieldsFragment, unknown>;
export const GetConversationDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetConversation" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "conversation" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "ConversationFields" },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "ConversationFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Conversation" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "organizationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "title" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "workflowName" } },
          { kind: "Field", name: { kind: "Name", value: "workflowId" } },
          { kind: "Field", name: { kind: "Name", value: "workflowAboutType" } },
          { kind: "Field", name: { kind: "Name", value: "workflowAboutId" } },
          { kind: "Field", name: { kind: "Name", value: "initiatedBy" } },
          { kind: "Field", name: { kind: "Name", value: "triggerEvent" } },
          { kind: "Field", name: { kind: "Name", value: "createdBy" } },
          { kind: "Field", name: { kind: "Name", value: "lastModifiedBy" } },
          { kind: "Field", name: { kind: "Name", value: "restricted" } },
          { kind: "Field", name: { kind: "Name", value: "version" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  GetConversationQuery,
  GetConversationQueryVariables
>;
export const GetConversationWithDecisionsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetConversationWithDecisions" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "conversation" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: {
                    kind: "Name",
                    value: "ConversationWithDecisionsFields",
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "ConversationFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Conversation" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "organizationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "title" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "workflowName" } },
          { kind: "Field", name: { kind: "Name", value: "workflowId" } },
          { kind: "Field", name: { kind: "Name", value: "workflowAboutType" } },
          { kind: "Field", name: { kind: "Name", value: "workflowAboutId" } },
          { kind: "Field", name: { kind: "Name", value: "initiatedBy" } },
          { kind: "Field", name: { kind: "Name", value: "triggerEvent" } },
          { kind: "Field", name: { kind: "Name", value: "createdBy" } },
          { kind: "Field", name: { kind: "Name", value: "lastModifiedBy" } },
          { kind: "Field", name: { kind: "Name", value: "restricted" } },
          { kind: "Field", name: { kind: "Name", value: "version" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "ConversationWithDecisionsFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Conversation" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "FragmentSpread",
            name: { kind: "Name", value: "ConversationFields" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "suggestionDecisions" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "goalPmRoutingDecisions" },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  GetConversationWithDecisionsQuery,
  GetConversationWithDecisionsQueryVariables
>;
export const GetConversationsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetConversations" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "statuses" },
          },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: {
                kind: "NamedType",
                name: { kind: "Name", value: "String" },
              },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "workflowNames" },
          },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: {
                kind: "NamedType",
                name: { kind: "Name", value: "String" },
              },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "workflowAboutId" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "workflowAboutType" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "search" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "page" } },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "limit" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            alias: { kind: "Name", value: "page" },
            name: { kind: "Name", value: "conversations" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "statuses" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "statuses" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "workflowNames" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "workflowNames" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "workflowAboutId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "workflowAboutId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "workflowAboutType" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "workflowAboutType" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "search" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "search" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "page" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "page" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "limit" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "nodes" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "ConversationFields" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "ConversationFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Conversation" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "organizationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "title" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "workflowName" } },
          { kind: "Field", name: { kind: "Name", value: "workflowId" } },
          { kind: "Field", name: { kind: "Name", value: "workflowAboutType" } },
          { kind: "Field", name: { kind: "Name", value: "workflowAboutId" } },
          { kind: "Field", name: { kind: "Name", value: "initiatedBy" } },
          { kind: "Field", name: { kind: "Name", value: "triggerEvent" } },
          { kind: "Field", name: { kind: "Name", value: "createdBy" } },
          { kind: "Field", name: { kind: "Name", value: "lastModifiedBy" } },
          { kind: "Field", name: { kind: "Name", value: "restricted" } },
          { kind: "Field", name: { kind: "Name", value: "version" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  GetConversationsQuery,
  GetConversationsQueryVariables
>;
export const GetConversationsWithDecisionsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetConversationsWithDecisions" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "statuses" },
          },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: {
                kind: "NamedType",
                name: { kind: "Name", value: "String" },
              },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "workflowNames" },
          },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: {
                kind: "NamedType",
                name: { kind: "Name", value: "String" },
              },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "workflowAboutId" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "workflowAboutType" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "search" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "page" } },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "limit" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            alias: { kind: "Name", value: "page" },
            name: { kind: "Name", value: "conversations" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "statuses" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "statuses" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "workflowNames" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "workflowNames" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "workflowAboutId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "workflowAboutId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "workflowAboutType" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "workflowAboutType" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "search" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "search" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "page" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "page" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "limit" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "nodes" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: {
                          kind: "Name",
                          value: "ConversationWithDecisionsFields",
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "ConversationFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Conversation" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "organizationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "title" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "workflowName" } },
          { kind: "Field", name: { kind: "Name", value: "workflowId" } },
          { kind: "Field", name: { kind: "Name", value: "workflowAboutType" } },
          { kind: "Field", name: { kind: "Name", value: "workflowAboutId" } },
          { kind: "Field", name: { kind: "Name", value: "initiatedBy" } },
          { kind: "Field", name: { kind: "Name", value: "triggerEvent" } },
          { kind: "Field", name: { kind: "Name", value: "createdBy" } },
          { kind: "Field", name: { kind: "Name", value: "lastModifiedBy" } },
          { kind: "Field", name: { kind: "Name", value: "restricted" } },
          { kind: "Field", name: { kind: "Name", value: "version" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "ConversationWithDecisionsFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Conversation" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "FragmentSpread",
            name: { kind: "Name", value: "ConversationFields" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "suggestionDecisions" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "goalPmRoutingDecisions" },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  GetConversationsWithDecisionsQuery,
  GetConversationsWithDecisionsQueryVariables
>;
export const GetActiveConversationsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetActiveConversations" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "workflowNames" },
          },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: {
                kind: "NamedType",
                name: { kind: "Name", value: "String" },
              },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "workflowAboutId" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "workflowAboutType" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "search" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "page" } },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "limit" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            alias: { kind: "Name", value: "page" },
            name: { kind: "Name", value: "activeConversations" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "workflowNames" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "workflowNames" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "workflowAboutId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "workflowAboutId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "workflowAboutType" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "workflowAboutType" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "search" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "search" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "page" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "page" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "limit" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "nodes" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "ConversationFields" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "ConversationFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Conversation" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "organizationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "title" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "workflowName" } },
          { kind: "Field", name: { kind: "Name", value: "workflowId" } },
          { kind: "Field", name: { kind: "Name", value: "workflowAboutType" } },
          { kind: "Field", name: { kind: "Name", value: "workflowAboutId" } },
          { kind: "Field", name: { kind: "Name", value: "initiatedBy" } },
          { kind: "Field", name: { kind: "Name", value: "triggerEvent" } },
          { kind: "Field", name: { kind: "Name", value: "createdBy" } },
          { kind: "Field", name: { kind: "Name", value: "lastModifiedBy" } },
          { kind: "Field", name: { kind: "Name", value: "restricted" } },
          { kind: "Field", name: { kind: "Name", value: "version" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  GetActiveConversationsQuery,
  GetActiveConversationsQueryVariables
>;
export const GetActiveConversationsWithDecisionsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetActiveConversationsWithDecisions" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "workflowNames" },
          },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: {
                kind: "NamedType",
                name: { kind: "Name", value: "String" },
              },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "workflowAboutId" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "workflowAboutType" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "search" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "page" } },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "limit" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            alias: { kind: "Name", value: "page" },
            name: { kind: "Name", value: "activeConversations" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "workflowNames" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "workflowNames" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "workflowAboutId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "workflowAboutId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "workflowAboutType" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "workflowAboutType" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "search" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "search" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "page" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "page" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "limit" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "nodes" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: {
                          kind: "Name",
                          value: "ConversationWithDecisionsFields",
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "ConversationFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Conversation" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "organizationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "title" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "workflowName" } },
          { kind: "Field", name: { kind: "Name", value: "workflowId" } },
          { kind: "Field", name: { kind: "Name", value: "workflowAboutType" } },
          { kind: "Field", name: { kind: "Name", value: "workflowAboutId" } },
          { kind: "Field", name: { kind: "Name", value: "initiatedBy" } },
          { kind: "Field", name: { kind: "Name", value: "triggerEvent" } },
          { kind: "Field", name: { kind: "Name", value: "createdBy" } },
          { kind: "Field", name: { kind: "Name", value: "lastModifiedBy" } },
          { kind: "Field", name: { kind: "Name", value: "restricted" } },
          { kind: "Field", name: { kind: "Name", value: "version" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "ConversationWithDecisionsFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Conversation" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "FragmentSpread",
            name: { kind: "Name", value: "ConversationFields" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "suggestionDecisions" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "goalPmRoutingDecisions" },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  GetActiveConversationsWithDecisionsQuery,
  GetActiveConversationsWithDecisionsQueryVariables
>;
export const GetWorkflowConversationsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetWorkflowConversations" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "workflowName" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "String" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "workflowAboutId" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "String" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "statuses" },
          },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: {
                kind: "NamedType",
                name: { kind: "Name", value: "String" },
              },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "sortBy" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "sortOrder" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "page" } },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "limit" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            alias: { kind: "Name", value: "page" },
            name: { kind: "Name", value: "workflowConversations" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "workflowName" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "workflowName" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "workflowAboutId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "workflowAboutId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "statuses" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "statuses" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "sortBy" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "sortBy" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "sortOrder" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "sortOrder" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "page" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "page" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "limit" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "nodes" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "ConversationFields" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "ConversationFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Conversation" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "organizationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "title" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "workflowName" } },
          { kind: "Field", name: { kind: "Name", value: "workflowId" } },
          { kind: "Field", name: { kind: "Name", value: "workflowAboutType" } },
          { kind: "Field", name: { kind: "Name", value: "workflowAboutId" } },
          { kind: "Field", name: { kind: "Name", value: "initiatedBy" } },
          { kind: "Field", name: { kind: "Name", value: "triggerEvent" } },
          { kind: "Field", name: { kind: "Name", value: "createdBy" } },
          { kind: "Field", name: { kind: "Name", value: "lastModifiedBy" } },
          { kind: "Field", name: { kind: "Name", value: "restricted" } },
          { kind: "Field", name: { kind: "Name", value: "version" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  GetWorkflowConversationsQuery,
  GetWorkflowConversationsQueryVariables
>;
export const GetConversationMessagesDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetConversationMessages" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "after" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "conversation" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "messages" },
                  arguments: [
                    {
                      kind: "Argument",
                      name: { kind: "Name", value: "after" },
                      value: {
                        kind: "Variable",
                        name: { kind: "Name", value: "after" },
                      },
                    },
                  ],
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "endCursor" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "nodes" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "FragmentSpread",
                              name: { kind: "Name", value: "MessageFields" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "proposals" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "reports" },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "MessageFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Message" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "conversationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "userId" } },
          { kind: "Field", name: { kind: "Name", value: "parentMessageId" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "executionStatus" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionQueueConfirmed" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionAdmissionDisposition" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionCancellationRequested" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionOperationId" },
          },
          { kind: "Field", name: { kind: "Name", value: "awaitingResponse" } },
          { kind: "Field", name: { kind: "Name", value: "handler" } },
          { kind: "Field", name: { kind: "Name", value: "user" } },
          { kind: "Field", name: { kind: "Name", value: "data" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  GetConversationMessagesQuery,
  GetConversationMessagesQueryVariables
>;
export const GetConversationMessageHistoryDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetConversationMessageHistory" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "last" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "before" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "conversation" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "messages" },
                  arguments: [
                    {
                      kind: "Argument",
                      name: { kind: "Name", value: "last" },
                      value: {
                        kind: "Variable",
                        name: { kind: "Name", value: "last" },
                      },
                    },
                    {
                      kind: "Argument",
                      name: { kind: "Name", value: "before" },
                      value: {
                        kind: "Variable",
                        name: { kind: "Name", value: "before" },
                      },
                    },
                  ],
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "endCursor" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "startCursor" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "hasOlder" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "nodes" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "FragmentSpread",
                              name: { kind: "Name", value: "MessageFields" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "proposals" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "reports" },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "MessageFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Message" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "conversationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "userId" } },
          { kind: "Field", name: { kind: "Name", value: "parentMessageId" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "executionStatus" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionQueueConfirmed" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionAdmissionDisposition" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionCancellationRequested" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionOperationId" },
          },
          { kind: "Field", name: { kind: "Name", value: "awaitingResponse" } },
          { kind: "Field", name: { kind: "Name", value: "handler" } },
          { kind: "Field", name: { kind: "Name", value: "user" } },
          { kind: "Field", name: { kind: "Name", value: "data" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  GetConversationMessageHistoryQuery,
  GetConversationMessageHistoryQueryVariables
>;
export const GetMessageDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetMessage" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "message" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "MessageFields" },
                },
                { kind: "Field", name: { kind: "Name", value: "proposals" } },
                { kind: "Field", name: { kind: "Name", value: "reports" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "parentMessage" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "MessageFields" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "responses" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "MessageFields" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "MessageFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Message" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "conversationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "userId" } },
          { kind: "Field", name: { kind: "Name", value: "parentMessageId" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "executionStatus" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionQueueConfirmed" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionAdmissionDisposition" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionCancellationRequested" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionOperationId" },
          },
          { kind: "Field", name: { kind: "Name", value: "awaitingResponse" } },
          { kind: "Field", name: { kind: "Name", value: "handler" } },
          { kind: "Field", name: { kind: "Name", value: "user" } },
          { kind: "Field", name: { kind: "Name", value: "data" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<GetMessageQuery, GetMessageQueryVariables>;
export const GetLatestMessageDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetLatestMessage" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "conversationId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "latestMessage" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "conversationId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "conversationId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "MessageFields" },
                },
                { kind: "Field", name: { kind: "Name", value: "proposals" } },
                { kind: "Field", name: { kind: "Name", value: "reports" } },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "MessageFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Message" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "conversationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "userId" } },
          { kind: "Field", name: { kind: "Name", value: "parentMessageId" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "executionStatus" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionQueueConfirmed" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionAdmissionDisposition" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionCancellationRequested" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "executionOperationId" },
          },
          { kind: "Field", name: { kind: "Name", value: "awaitingResponse" } },
          { kind: "Field", name: { kind: "Name", value: "handler" } },
          { kind: "Field", name: { kind: "Name", value: "user" } },
          { kind: "Field", name: { kind: "Name", value: "data" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  GetLatestMessageQuery,
  GetLatestMessageQueryVariables
>;
export const ReadConversationThreadDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "ReadConversationThread" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "conversation" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "messages" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "endCursor" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "startCursor" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "hasOlder" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "nodes" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "id" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "status" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "createdAt" },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  ReadConversationThreadQuery,
  ReadConversationThreadQueryVariables
>;
export const ProjectScopeDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "ProjectScope" },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "projectScope" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "organizationId" },
                },
                { kind: "Field", name: { kind: "Name", value: "projectId" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<ProjectScopeQuery, ProjectScopeQueryVariables>;
export const GetWorkItemsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetWorkItems" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "initiativeId" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "parentTaskId" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "parentTaskIds" },
          },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "ids" } },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "type" } },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "statuses" },
          },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: {
                kind: "NamedType",
                name: { kind: "Name", value: "String" },
              },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "includeDescendants" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Boolean" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "relatedTo" },
          },
          type: {
            kind: "NamedType",
            name: { kind: "Name", value: "RelatedEntityFilter" },
          },
        },
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "sort" } },
          type: {
            kind: "NamedType",
            name: { kind: "Name", value: "WorkItemSort" },
          },
        },
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "page" } },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "limit" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withSections" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "sectionKeys" },
          },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: {
                kind: "NamedType",
                name: { kind: "Name", value: "String" },
              },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withEdges" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "edgeTypes" },
          },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: {
                kind: "NamedType",
                name: { kind: "Name", value: "EdgeType" },
              },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withServiceRelations" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withTrackedEntities" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withTrackedWorkSummary" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withDesignDocCounts" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withAgentSessionCounts" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "workItems" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "initiativeId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "initiativeId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "parentTaskId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "parentTaskId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "parentTaskIds" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "parentTaskIds" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "ids" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "ids" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "type" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "type" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "statuses" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "statuses" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "includeDescendants" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "includeDescendants" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "relatedTo" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "relatedTo" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "sort" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "sort" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "page" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "page" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "limit" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemParts" },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItem" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "name" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "organizationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "initiativeId" } },
          { kind: "Field", name: { kind: "Name", value: "parentTaskId" } },
          { kind: "Field", name: { kind: "Name", value: "source" } },
          { kind: "Field", name: { kind: "Name", value: "priority" } },
          { kind: "Field", name: { kind: "Name", value: "tag" } },
          { kind: "Field", name: { kind: "Name", value: "assigneeId" } },
          { kind: "Field", name: { kind: "Name", value: "reporterId" } },
          { kind: "Field", name: { kind: "Name", value: "dueDate" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
          { kind: "Field", name: { kind: "Name", value: "archivedAt" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "hasProposalSupport" },
          },
          { kind: "Field", name: { kind: "Name", value: "config" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "childCounts" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "total" } },
                { kind: "Field", name: { kind: "Name", value: "done" } },
                { kind: "Field", name: { kind: "Name", value: "inProgress" } },
                { kind: "Field", name: { kind: "Name", value: "backlog" } },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemSectionFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItemSection" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "key" } },
          { kind: "Field", name: { kind: "Name", value: "order" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "materializedMarkdown" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "materializedProposalId" },
          },
          { kind: "Field", name: { kind: "Name", value: "crdtSnapshotSeq" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemEdgeFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItemEdge" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "source" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "entityId" } },
                { kind: "Field", name: { kind: "Name", value: "entityType" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "target" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "entityId" } },
                { kind: "Field", name: { kind: "Name", value: "entityType" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
              ],
            },
          },
          { kind: "Field", name: { kind: "Name", value: "targetNodeType" } },
          { kind: "Field", name: { kind: "Name", value: "category" } },
          { kind: "Field", name: { kind: "Name", value: "direction" } },
          { kind: "Field", name: { kind: "Name", value: "predicate" } },
          { kind: "Field", name: { kind: "Name", value: "actionLabel" } },
          { kind: "Field", name: { kind: "Name", value: "transitionRole" } },
          { kind: "Field", name: { kind: "Name", value: "reasoning" } },
          { kind: "Field", name: { kind: "Name", value: "origin" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "createdBySessionId" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "lastModifiedBySessionId" },
          },
          { kind: "Field", name: { kind: "Name", value: "metadata" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemServiceRelationFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "ServiceRelation" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "serviceId" } },
          { kind: "Field", name: { kind: "Name", value: "taskId" } },
          { kind: "Field", name: { kind: "Name", value: "relationType" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemTrackedEntityFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "TrackedEntity" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "entityId" } },
          { kind: "Field", name: { kind: "Name", value: "entityType" } },
          { kind: "Field", name: { kind: "Name", value: "name" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "dueDate" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemTrackedSummaryFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "TrackedWorkSummary" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "totalCount" } },
          { kind: "Field", name: { kind: "Name", value: "completedCount" } },
          { kind: "Field", name: { kind: "Name", value: "cancelledCount" } },
          { kind: "Field", name: { kind: "Name", value: "pastDueCount" } },
          { kind: "Field", name: { kind: "Name", value: "openUndatedCount" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemParts" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItem" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "FragmentSpread",
            name: { kind: "Name", value: "WorkItemFields" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "sections" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "keys" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "sectionKeys" },
                },
              },
            ],
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withSections" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemSectionFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "edges" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "types" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "edgeTypes" },
                },
              },
            ],
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withEdges" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemEdgeFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "serviceRelations" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withServiceRelations" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: {
                    kind: "Name",
                    value: "WorkItemServiceRelationFields",
                  },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "trackedEntities" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withTrackedEntities" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemTrackedEntityFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "trackedWorkSummary" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withTrackedWorkSummary" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemTrackedSummaryFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "designDocCount" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withDesignDocCounts" },
                    },
                  },
                ],
              },
            ],
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "codingSessionCount" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withAgentSessionCounts" },
                    },
                  },
                ],
              },
            ],
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "agentSessionCount" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withAgentSessionCounts" },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<GetWorkItemsQuery, GetWorkItemsQueryVariables>;
export const GetWorkItemDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetWorkItem" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withSections" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "sectionKeys" },
          },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: {
                kind: "NamedType",
                name: { kind: "Name", value: "String" },
              },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withEdges" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "edgeTypes" },
          },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: {
                kind: "NamedType",
                name: { kind: "Name", value: "EdgeType" },
              },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withServiceRelations" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withTrackedEntities" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withTrackedWorkSummary" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withDesignDocCounts" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withAgentSessionCounts" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "workItem" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemParts" },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItem" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "name" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "organizationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "initiativeId" } },
          { kind: "Field", name: { kind: "Name", value: "parentTaskId" } },
          { kind: "Field", name: { kind: "Name", value: "source" } },
          { kind: "Field", name: { kind: "Name", value: "priority" } },
          { kind: "Field", name: { kind: "Name", value: "tag" } },
          { kind: "Field", name: { kind: "Name", value: "assigneeId" } },
          { kind: "Field", name: { kind: "Name", value: "reporterId" } },
          { kind: "Field", name: { kind: "Name", value: "dueDate" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
          { kind: "Field", name: { kind: "Name", value: "archivedAt" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "hasProposalSupport" },
          },
          { kind: "Field", name: { kind: "Name", value: "config" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "childCounts" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "total" } },
                { kind: "Field", name: { kind: "Name", value: "done" } },
                { kind: "Field", name: { kind: "Name", value: "inProgress" } },
                { kind: "Field", name: { kind: "Name", value: "backlog" } },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemSectionFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItemSection" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "key" } },
          { kind: "Field", name: { kind: "Name", value: "order" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "materializedMarkdown" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "materializedProposalId" },
          },
          { kind: "Field", name: { kind: "Name", value: "crdtSnapshotSeq" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemEdgeFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItemEdge" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "source" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "entityId" } },
                { kind: "Field", name: { kind: "Name", value: "entityType" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "target" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "entityId" } },
                { kind: "Field", name: { kind: "Name", value: "entityType" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
              ],
            },
          },
          { kind: "Field", name: { kind: "Name", value: "targetNodeType" } },
          { kind: "Field", name: { kind: "Name", value: "category" } },
          { kind: "Field", name: { kind: "Name", value: "direction" } },
          { kind: "Field", name: { kind: "Name", value: "predicate" } },
          { kind: "Field", name: { kind: "Name", value: "actionLabel" } },
          { kind: "Field", name: { kind: "Name", value: "transitionRole" } },
          { kind: "Field", name: { kind: "Name", value: "reasoning" } },
          { kind: "Field", name: { kind: "Name", value: "origin" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "createdBySessionId" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "lastModifiedBySessionId" },
          },
          { kind: "Field", name: { kind: "Name", value: "metadata" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemServiceRelationFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "ServiceRelation" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "serviceId" } },
          { kind: "Field", name: { kind: "Name", value: "taskId" } },
          { kind: "Field", name: { kind: "Name", value: "relationType" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemTrackedEntityFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "TrackedEntity" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "entityId" } },
          { kind: "Field", name: { kind: "Name", value: "entityType" } },
          { kind: "Field", name: { kind: "Name", value: "name" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "dueDate" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemTrackedSummaryFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "TrackedWorkSummary" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "totalCount" } },
          { kind: "Field", name: { kind: "Name", value: "completedCount" } },
          { kind: "Field", name: { kind: "Name", value: "cancelledCount" } },
          { kind: "Field", name: { kind: "Name", value: "pastDueCount" } },
          { kind: "Field", name: { kind: "Name", value: "openUndatedCount" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemParts" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItem" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "FragmentSpread",
            name: { kind: "Name", value: "WorkItemFields" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "sections" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "keys" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "sectionKeys" },
                },
              },
            ],
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withSections" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemSectionFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "edges" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "types" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "edgeTypes" },
                },
              },
            ],
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withEdges" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemEdgeFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "serviceRelations" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withServiceRelations" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: {
                    kind: "Name",
                    value: "WorkItemServiceRelationFields",
                  },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "trackedEntities" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withTrackedEntities" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemTrackedEntityFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "trackedWorkSummary" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withTrackedWorkSummary" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemTrackedSummaryFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "designDocCount" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withDesignDocCounts" },
                    },
                  },
                ],
              },
            ],
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "codingSessionCount" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withAgentSessionCounts" },
                    },
                  },
                ],
              },
            ],
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "agentSessionCount" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withAgentSessionCounts" },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<GetWorkItemQuery, GetWorkItemQueryVariables>;
export const GetWorkItemHierarchyDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetWorkItemHierarchy" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "includeDesignDocCounts" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Boolean" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "includeAgentSessionCounts" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Boolean" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withSections" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "sectionKeys" },
          },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: {
                kind: "NamedType",
                name: { kind: "Name", value: "String" },
              },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withEdges" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "edgeTypes" },
          },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: {
                kind: "NamedType",
                name: { kind: "Name", value: "EdgeType" },
              },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withServiceRelations" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withTrackedEntities" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withTrackedWorkSummary" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withDesignDocCounts" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "withAgentSessionCounts" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Boolean" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "workItemHierarchy" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "includeDesignDocCounts" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "includeDesignDocCounts" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "includeAgentSessionCounts" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "includeAgentSessionCounts" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "task" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "WorkItemParts" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "parent" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "WorkItemParts" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "children" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "WorkItemParts" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItem" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "name" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "organizationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "initiativeId" } },
          { kind: "Field", name: { kind: "Name", value: "parentTaskId" } },
          { kind: "Field", name: { kind: "Name", value: "source" } },
          { kind: "Field", name: { kind: "Name", value: "priority" } },
          { kind: "Field", name: { kind: "Name", value: "tag" } },
          { kind: "Field", name: { kind: "Name", value: "assigneeId" } },
          { kind: "Field", name: { kind: "Name", value: "reporterId" } },
          { kind: "Field", name: { kind: "Name", value: "dueDate" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
          { kind: "Field", name: { kind: "Name", value: "archivedAt" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "hasProposalSupport" },
          },
          { kind: "Field", name: { kind: "Name", value: "config" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "childCounts" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "total" } },
                { kind: "Field", name: { kind: "Name", value: "done" } },
                { kind: "Field", name: { kind: "Name", value: "inProgress" } },
                { kind: "Field", name: { kind: "Name", value: "backlog" } },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemSectionFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItemSection" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "key" } },
          { kind: "Field", name: { kind: "Name", value: "order" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "materializedMarkdown" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "materializedProposalId" },
          },
          { kind: "Field", name: { kind: "Name", value: "crdtSnapshotSeq" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemEdgeFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItemEdge" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "source" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "entityId" } },
                { kind: "Field", name: { kind: "Name", value: "entityType" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "target" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "entityId" } },
                { kind: "Field", name: { kind: "Name", value: "entityType" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
              ],
            },
          },
          { kind: "Field", name: { kind: "Name", value: "targetNodeType" } },
          { kind: "Field", name: { kind: "Name", value: "category" } },
          { kind: "Field", name: { kind: "Name", value: "direction" } },
          { kind: "Field", name: { kind: "Name", value: "predicate" } },
          { kind: "Field", name: { kind: "Name", value: "actionLabel" } },
          { kind: "Field", name: { kind: "Name", value: "transitionRole" } },
          { kind: "Field", name: { kind: "Name", value: "reasoning" } },
          { kind: "Field", name: { kind: "Name", value: "origin" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "createdBySessionId" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "lastModifiedBySessionId" },
          },
          { kind: "Field", name: { kind: "Name", value: "metadata" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemServiceRelationFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "ServiceRelation" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "serviceId" } },
          { kind: "Field", name: { kind: "Name", value: "taskId" } },
          { kind: "Field", name: { kind: "Name", value: "relationType" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemTrackedEntityFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "TrackedEntity" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "entityId" } },
          { kind: "Field", name: { kind: "Name", value: "entityType" } },
          { kind: "Field", name: { kind: "Name", value: "name" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "dueDate" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemTrackedSummaryFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "TrackedWorkSummary" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "totalCount" } },
          { kind: "Field", name: { kind: "Name", value: "completedCount" } },
          { kind: "Field", name: { kind: "Name", value: "cancelledCount" } },
          { kind: "Field", name: { kind: "Name", value: "pastDueCount" } },
          { kind: "Field", name: { kind: "Name", value: "openUndatedCount" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemParts" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItem" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "FragmentSpread",
            name: { kind: "Name", value: "WorkItemFields" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "sections" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "keys" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "sectionKeys" },
                },
              },
            ],
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withSections" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemSectionFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "edges" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "types" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "edgeTypes" },
                },
              },
            ],
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withEdges" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemEdgeFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "serviceRelations" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withServiceRelations" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: {
                    kind: "Name",
                    value: "WorkItemServiceRelationFields",
                  },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "trackedEntities" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withTrackedEntities" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemTrackedEntityFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "trackedWorkSummary" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withTrackedWorkSummary" },
                    },
                  },
                ],
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemTrackedSummaryFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "designDocCount" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withDesignDocCounts" },
                    },
                  },
                ],
              },
            ],
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "codingSessionCount" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withAgentSessionCounts" },
                    },
                  },
                ],
              },
            ],
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "agentSessionCount" },
            directives: [
              {
                kind: "Directive",
                name: { kind: "Name", value: "include" },
                arguments: [
                  {
                    kind: "Argument",
                    name: { kind: "Name", value: "if" },
                    value: {
                      kind: "Variable",
                      name: { kind: "Name", value: "withAgentSessionCounts" },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  GetWorkItemHierarchyQuery,
  GetWorkItemHierarchyQueryVariables
>;
export const GetWorkItemGraphDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetWorkItemGraph" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "ID" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "incidentRelationshipTypes" },
          },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: {
                kind: "NamedType",
                name: { kind: "Name", value: "String" },
              },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "workItem" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "graph" },
                  arguments: [
                    {
                      kind: "Argument",
                      name: {
                        kind: "Name",
                        value: "incidentRelationshipTypes",
                      },
                      value: {
                        kind: "Variable",
                        name: {
                          kind: "Name",
                          value: "incidentRelationshipTypes",
                        },
                      },
                    },
                  ],
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "root" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "FragmentSpread",
                              name: {
                                kind: "Name",
                                value: "WorkItemGraphMember",
                              },
                            },
                          ],
                        },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "children" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "FragmentSpread",
                              name: {
                                kind: "Name",
                                value: "WorkItemGraphMember",
                              },
                            },
                          ],
                        },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "relationships" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "FragmentSpread",
                              name: {
                                kind: "Name",
                                value: "WorkItemEdgeFields",
                              },
                            },
                          ],
                        },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "layout" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "derivedReferences" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "entityId" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "entityType" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "name" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "expansionKey" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "projectionKind" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "workItemTypeKey" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "viaEntityIds" },
                            },
                          ],
                        },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "participation" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItem" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "name" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "organizationId" } },
          { kind: "Field", name: { kind: "Name", value: "projectId" } },
          { kind: "Field", name: { kind: "Name", value: "initiativeId" } },
          { kind: "Field", name: { kind: "Name", value: "parentTaskId" } },
          { kind: "Field", name: { kind: "Name", value: "source" } },
          { kind: "Field", name: { kind: "Name", value: "priority" } },
          { kind: "Field", name: { kind: "Name", value: "tag" } },
          { kind: "Field", name: { kind: "Name", value: "assigneeId" } },
          { kind: "Field", name: { kind: "Name", value: "reporterId" } },
          { kind: "Field", name: { kind: "Name", value: "dueDate" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
          { kind: "Field", name: { kind: "Name", value: "archivedAt" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "hasProposalSupport" },
          },
          { kind: "Field", name: { kind: "Name", value: "config" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "childCounts" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "total" } },
                { kind: "Field", name: { kind: "Name", value: "done" } },
                { kind: "Field", name: { kind: "Name", value: "inProgress" } },
                { kind: "Field", name: { kind: "Name", value: "backlog" } },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemSectionFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItemSection" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "key" } },
          { kind: "Field", name: { kind: "Name", value: "order" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "materializedMarkdown" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "materializedProposalId" },
          },
          { kind: "Field", name: { kind: "Name", value: "crdtSnapshotSeq" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemGraphMember" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItem" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "FragmentSpread",
            name: { kind: "Name", value: "WorkItemFields" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "sections" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemSectionFields" },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemEdgeFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItemEdge" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "source" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "entityId" } },
                { kind: "Field", name: { kind: "Name", value: "entityType" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "target" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "entityId" } },
                { kind: "Field", name: { kind: "Name", value: "entityType" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
              ],
            },
          },
          { kind: "Field", name: { kind: "Name", value: "targetNodeType" } },
          { kind: "Field", name: { kind: "Name", value: "category" } },
          { kind: "Field", name: { kind: "Name", value: "direction" } },
          { kind: "Field", name: { kind: "Name", value: "predicate" } },
          { kind: "Field", name: { kind: "Name", value: "actionLabel" } },
          { kind: "Field", name: { kind: "Name", value: "transitionRole" } },
          { kind: "Field", name: { kind: "Name", value: "reasoning" } },
          { kind: "Field", name: { kind: "Name", value: "origin" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "createdBySessionId" },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "lastModifiedBySessionId" },
          },
          { kind: "Field", name: { kind: "Name", value: "metadata" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          { kind: "Field", name: { kind: "Name", value: "updatedAt" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  GetWorkItemGraphQuery,
  GetWorkItemGraphQueryVariables
>;
export const GetAllWorkItemReferencesDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetAllWorkItemReferences" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "type" } },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "String" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            alias: { kind: "Name", value: "references" },
            name: { kind: "Name", value: "allWorkItemReferences" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "type" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "type" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "WorkItemReferenceFields" },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemReferenceFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItemReference" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "name" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          { kind: "Field", name: { kind: "Name", value: "parentTaskId" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  GetAllWorkItemReferencesQuery,
  GetAllWorkItemReferencesQueryVariables
>;
export const GetWorkItemReferencePageDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetWorkItemReferencePage" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "type" } },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "String" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "page" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "limit" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "filter" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "statuses" },
          },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: {
                kind: "NamedType",
                name: { kind: "Name", value: "String" },
              },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "sortBy" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "sortOrder" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "workItemReferences" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "type" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "type" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "page" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "page" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "limit" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "limit" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "filter" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "filter" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "statuses" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "statuses" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "sortBy" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "sortBy" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "sortOrder" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "sortOrder" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "items" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: {
                          kind: "Name",
                          value: "WorkItemReferenceFields",
                        },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "pagination" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "page" } },
                      { kind: "Field", name: { kind: "Name", value: "limit" } },
                      { kind: "Field", name: { kind: "Name", value: "total" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "totalPages" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "hasNext" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "hasPrevious" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "WorkItemReferenceFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "WorkItemReference" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "name" } },
          { kind: "Field", name: { kind: "Name", value: "type" } },
          { kind: "Field", name: { kind: "Name", value: "parentTaskId" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  GetWorkItemReferencePageQuery,
  GetWorkItemReferencePageQueryVariables
>;
