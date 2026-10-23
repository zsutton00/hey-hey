import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient, Project } from '@prisma/client';
import {
  ApiKeyId,
  ArtifactId,
  ConversationId,
  DesignDocId,
  InitiativeId,
  MessageId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
  WorkflowId,
  SubfacetId,
  EntitySummaryId,
  EntitySubfacetId,
  AgentSessionId,
} from '../types';
import {
  ArtifactData,
  SystemMessageData,
  UserMessageData,
} from 'src/generated';

export const idBrandingExtension = Prisma.defineExtension({
  name: 'idBranding',
  result: {
    project: {
      id: {
        needs: { id: true },
        compute(record) {
          return record.id as ProjectId;
        },
      },
      organizationId: {
        needs: { organizationId: true },
        compute(record) {
          return record.organizationId as OrganizationId;
        },
      },
      createdBy: {
        needs: { createdBy: true },
        compute(record) {
          return record.createdBy as UserId | null;
        },
      },
    },
    user: {
      id: {
        needs: { id: true },
        compute(record) {
          return record.id as UserId;
        },
      },
    },
    organization: {
      id: {
        needs: { id: true },
        compute(record) {
          return record.id as OrganizationId;
        },
      },
    },
    conversation: {
      id: {
        needs: { id: true },
        compute(record) {
          return record.id as ConversationId;
        },
      },
      projectId: {
        needs: { projectId: true },
        compute(record) {
          return record.projectId as ProjectId;
        },
      },
      workflowId: {
        needs: { workflowId: true },
        compute(record) {
          return record.workflowId as WorkflowId;
        },
      },
    },
    message: {
      id: {
        needs: { id: true },
        compute(record) {
          return record.id as MessageId;
        },
      },
      conversationId: {
        needs: { conversationId: true },
        compute(record) {
          return record.conversationId as ConversationId;
        },
      },
      projectId: {
        needs: { projectId: true },
        compute(record) {
          return record.projectId as ProjectId;
        },
      },
      data: {
        needs: { data: true },
        compute(record) {
          return record.data as unknown as SystemMessageData | UserMessageData;
        },
      },
      parentMessageId: {
        needs: { parentMessageId: true },
        compute(record) {
          return record.parentMessageId as MessageId | null;
        },
      },
    },
    initiative: {
      id: {
        needs: { id: true },
        compute(record) {
          return record.id as InitiativeId;
        },
      },
      organizationId: {
        needs: { organizationId: true },
        compute(record) {
          return record.organizationId as OrganizationId;
        },
      },
      assigneeId: {
        needs: { assigneeId: true },
        compute(record) {
          return record.assigneeId as UserId | null;
        },
      },
    },
    flowExecution: {
      organizationId: {
        needs: { organizationId: true },
        compute(record) {
          return record.organizationId as OrganizationId;
        },
      },
      projectId: {
        needs: { projectId: true },
        compute(record) {
          return record.projectId as ProjectId;
        },
      },
      metadata: {
        needs: { metadata: true },
        compute(record) {
          return record.metadata as Record<string, unknown>;
        },
      },
    },
    artifact: {
      id: {
        needs: { id: true },
        compute(record) {
          return record.id as ArtifactId;
        },
      },
      projectId: {
        needs: { projectId: true },
        compute(record) {
          return record.projectId as ProjectId;
        },
      },
      organizationId: {
        needs: { organizationId: true },
        compute(record) {
          return record.organizationId as OrganizationId;
        },
      },
      parentId: {
        needs: { parentId: true },
        compute(record) {
          return record.parentId as ArtifactId | null;
        },
      },
      rootId: {
        needs: { rootId: true },
        compute(record) {
          return record.rootId as ArtifactId | null;
        },
      },
      data: {
        needs: { data: true },
        compute(record) {
          return record.data as unknown as ArtifactData;
        },
      },
    },
    organizationMember: {
      userId: {
        needs: { userId: true },
        compute(record) {
          return record.userId as UserId;
        },
      },
      organizationId: {
        needs: { organizationId: true },
        compute(record) {
          return record.organizationId as OrganizationId;
        },
      },
    },
    designDoc: {
      id: {
        needs: { id: true },
        compute(record) {
          return record.id as DesignDocId;
        },
      },
      organizationId: {
        needs: { organizationId: true },
        compute(record) {
          return record.organizationId as OrganizationId;
        },
      },
      projectId: {
        needs: { projectId: true },
        compute(record) {
          return (record.projectId ?? null) as ProjectId | null;
        },
      },
    },
    apiKey: {
      id: {
        needs: { id: true },
        compute(record) {
          return record.id as ApiKeyId;
        },
      },
      organizationId: {
        needs: { organizationId: true },
        compute(record) {
          return record.organizationId as OrganizationId;
        },
      },
      createdBy: {
        needs: { createdBy: true },
        compute(record) {
          return record.createdBy as UserId;
        },
      },
    },
    subfacet: {
      id: {
        needs: { id: true },
        compute(record) {
          return record.id as SubfacetId;
        },
      },
      organizationId: {
        needs: { organizationId: true },
        compute(record) {
          return record.organizationId as OrganizationId;
        },
      },
      projectId: {
        needs: { projectId: true },
        compute(record) {
          return record.projectId as ProjectId;
        },
      },
    },
    entitySummary: {
      id: {
        needs: { id: true },
        compute(record) {
          return record.id as EntitySummaryId;
        },
      },
      organizationId: {
        needs: { organizationId: true },
        compute(record) {
          return record.organizationId as OrganizationId;
        },
      },
      projectId: {
        needs: { projectId: true },
        compute(record) {
          return record.projectId as ProjectId;
        },
      },
    },
    entitySubfacet: {
      id: {
        needs: { id: true },
        compute(record) {
          return record.id as EntitySubfacetId;
        },
      },
      organizationId: {
        needs: { organizationId: true },
        compute(record) {
          return record.organizationId as OrganizationId;
        },
      },
      projectId: {
        needs: { projectId: true },
        compute(record) {
          return record.projectId as ProjectId;
        },
      },
    },
    topologyCategorySummary: {
      organizationId: {
        needs: { organizationId: true },
        compute(record) {
          return record.organizationId as OrganizationId;
        },
      },
      projectId: {
        needs: { projectId: true },
        compute(record) {
          return record.projectId as ProjectId;
        },
      },
    },
    agentSession: {
      id: {
        needs: { id: true },
        compute(record) {
          return record.id as AgentSessionId;
        },
      },
      organizationId: {
        needs: { organizationId: true },
        compute(record) {
          return record.organizationId as OrganizationId;
        },
      },
      userId: {
        needs: { userId: true },
        compute(record) {
          return record.userId as UserId;
        },
      },
    },
    task: {
      id: {
        needs: { id: true },
        compute(record) {
          return record.id as TaskId;
        },
      },
      organizationId: {
        needs: { organizationId: true },
        compute(record) {
          return record.organizationId as OrganizationId;
        },
      },
      initiativeId: {
        needs: { initiativeId: true },
        compute(record) {
          return record.initiativeId as InitiativeId;
        },
      },
    },
  },
});

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  public readonly db = this.$extends(idBrandingExtension);
  constructor() {
    super();
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

// Export type for the extended Prisma client
export type ExtendedPrismaClient = PrismaService['db'];

// Type for any transaction client (base or extended)
// Using a permissive type since the extended transaction client has
// structural compatibility but TypeScript's deep type checking is too strict
export type AnyTransactionClient =
  | Prisma.TransactionClient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | any;
