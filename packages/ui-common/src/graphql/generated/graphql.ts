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
