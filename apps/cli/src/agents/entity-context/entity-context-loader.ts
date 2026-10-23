import { z } from 'zod';
import {
  AgentSessionsApi,
  ConversationsApi,
  DesignDocTemplate,
  DesignDocsApi,
  EntityContextApi,
  EntityType as CanonicalEntityType,
  ProjectStatus,
  ProjectsApi,
  TaskSource,
  TasksApi,
  type AgentSessionDto,
  type DesignDocResponseDto,
  type FullEntityContextDto,
  type ProjectResponseDto,
  type MessageResponseDto,
  type SystemMessageData,
  type TaskResponseDto,
  type UserMessageData,
  WorkStatus,
} from '../../shared/api/generated/api';
import { Configuration } from '../../shared/api/generated/configuration';
import type { RunEntityReference } from '../../shared/agent-bridge-contract/contract';
import { RunEntityReferenceEntityTypeEnum as RunEntityType } from '../../shared/agent-bridge-contract/generated/api';
import type { ServerLogger } from '../../server/logger';
import type { SubmissionToolAuth } from '../submission-tools/submission-tool-auth';
import type { EntityContextApiClient } from '../submission-tools/search-messages-proxy';
import { projectAgentSessionTranscript } from './conversation-transcript';
import type { CurrentEntityDto, LoadedEntityPromptContext } from './types';

const agentSessionIdentitySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  conversationId: z.string().min(1).nullable(),
});

const messageDataSchema = z.custom<SystemMessageData | UserMessageData>(
  (value) => typeof value === 'object' && value !== null,
);

const conversationShapeSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  workflowAboutId: z.string().min(1).optional(),
  workflowAboutType: z.string().min(1).optional(),
});

const transcriptMessagesSchema = z.array(
  z.object({
    id: z.string().min(1),
    type: z.enum(['SYSTEM', 'USER']),
    conversationId: z.string().min(1),
    createdAt: z.string().min(1),
    data: messageDataSchema,
  }),
);

const authoritativeResponseEnvelopeSchema = z.object({
  success: z.boolean(),
});

const projectEntityFieldsSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    organizationId: z.string().min(1),
    status: z.nativeEnum(ProjectStatus),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .passthrough();

const projectEntitySchema = z.custom<ProjectResponseDto>(
  (value) => projectEntityFieldsSchema.safeParse(value).success,
);

const designDocEntityFieldsSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    template: z.nativeEnum(DesignDocTemplate),
    status: z.string().min(1),
    organizationId: z.string().min(1),
    tags: z.array(z.string()),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .passthrough();

const designDocEntitySchema = z.custom<DesignDocResponseDto>(
  (value) => designDocEntityFieldsSchema.safeParse(value).success,
);

const workItemEntityFieldsSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    organizationId: z.string().min(1),
    projectId: z.string().min(1),
    status: z.nativeEnum(WorkStatus),
    source: z.nativeEnum(TaskSource),
  })
  .passthrough();

export const workItemEntitySchema = z.custom<TaskResponseDto>(
  (value) => workItemEntityFieldsSchema.safeParse(value).success,
);

const canonicalContextFieldsSchema = z
  .object({
    entityId: z.string().min(1),
    entityType: z.nativeEnum(CanonicalEntityType),
    displayName: z.string().min(1),
    createdAt: z.string().min(1),
  })
  .passthrough();

export const canonicalContextSchema = z.custom<FullEntityContextDto>(
  (value) => canonicalContextFieldsSchema.safeParse(value).success,
);

export interface EntityContextLoaderOptions {
  auth: SubmissionToolAuth;
  apiBaseUrl: string;
  logger: ServerLogger;
  createClient?: (accessToken: string) => EntityContextApiClient;
}

export interface EntityContextLoaderInput {
  runEntity: RunEntityReference;
  organizationId: string;
  projectId: string;
}

const isAgentSessionEntity = (
  entityType: RunEntityReference['entityType'],
): entityType is typeof RunEntityType.AgentSession => entityType === RunEntityType.AgentSession;

const isWorkItemEntity = (
  entityType: RunEntityReference['entityType'],
): entityType is typeof RunEntityType.Task => entityType === RunEntityType.Task;

const isSupportedFocalEntity = (entityType: RunEntityReference['entityType']): boolean =>
  entityType === RunEntityType.Project ||
  entityType === RunEntityType.DesignDoc ||
  isWorkItemEntity(entityType);

const canonicalEntityTypeFor = (
  entityType: RunEntityReference['entityType'],
):
  | typeof CanonicalEntityType.Project
  | typeof CanonicalEntityType.DesignDoc
  | typeof CanonicalEntityType.AgentSession
  | typeof CanonicalEntityType.Task => {
  if (entityType === RunEntityType.Project) return CanonicalEntityType.Project;
  if (entityType === RunEntityType.DesignDoc) return CanonicalEntityType.DesignDoc;
  if (entityType === RunEntityType.AgentSession) return CanonicalEntityType.AgentSession;
  return CanonicalEntityType.Task;
};

export class EntityContextLoader {
  private readonly auth: SubmissionToolAuth;
  private readonly logger: ServerLogger;
  private readonly createClient: (accessToken: string) => EntityContextApiClient;

  public constructor(options: EntityContextLoaderOptions) {
    this.auth = options.auth;
    this.logger = options.logger;
    this.createClient =
      options.createClient ??
      ((accessToken: string): EntityContextApiClient => {
        const configuration = new Configuration({
          accessToken,
          basePath: options.apiBaseUrl,
        });
        const conversationsClient = new ConversationsApi(configuration);
        const agentSessionsClient = new AgentSessionsApi(configuration);
        const designDocsClient = new DesignDocsApi(configuration);
        const entityContextClient = new EntityContextApi(configuration);
        const projectsClient = new ProjectsApi(configuration);
        const tasksClient = new TasksApi(configuration);
        return {
          getConversation: (request) => conversationsClient.getConversation(request),
          getMessages: (request) => conversationsClient.getMessages(request),
          findOneProject: (request) => projectsClient.findOneProject(request),
          getAgentSession: (request) => agentSessionsClient.getAgentSession(request),
          organizationsOrganizationIdDesignDocsDesignDocIdGet: (request) =>
            designDocsClient.getDesignDoc(request),
          getEntityContext: (request) => entityContextClient.getEntityContext(request),
          organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet: (request) =>
            tasksClient.organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet(request),
        };
      });
  }

  public async load(input: EntityContextLoaderInput): Promise<LoadedEntityPromptContext> {
    this.logger.debug('entity_context.load.started', {
      entityType: input.runEntity.entityType,
      entityId: input.runEntity.entityId,
      organizationId: input.organizationId,
      projectId: input.projectId,
    });

    if (!isAgentSessionEntity(input.runEntity.entityType)) {
      if (!isSupportedFocalEntity(input.runEntity.entityType)) {
        this.logger.error('entity_context.load.unsupported_focal_entity', {
          entityType: input.runEntity.entityType,
          entityId: input.runEntity.entityId,
        });
        throw new Error(
          `Entity context does not support focal entity type "${input.runEntity.entityType}".`,
        );
      }

      this.logger.debug('entity_context.load.generic_entity', {
        entityType: input.runEntity.entityType,
        entityId: input.runEntity.entityId,
      });
      return this.loadAuthoritativeEntityContext(input);
    }

    if (!input.organizationId.trim() || !input.projectId.trim()) {
      this.logger.error('entity_context.load.scope_missing', {
        hasOrganizationId: Boolean(input.organizationId.trim()),
        hasProjectId: Boolean(input.projectId.trim()),
        entityId: input.runEntity.entityId,
      });
      throw new Error('Agent Session context requires organizationId and projectId.');
    }

    let accessToken: string;
    try {
      accessToken = await this.auth.getAccessToken();
    } catch (error) {
      this.logger.error('entity_context.load.auth_failed', {
        entityId: input.runEntity.entityId,
        error,
      });
      throw new Error('Agent Session context could not authenticate its platform read.');
    }

    const client = this.createClient(accessToken);
    let sessionResponse: Awaited<ReturnType<EntityContextApiClient['getAgentSession']>>;
    try {
      sessionResponse = await client.getAgentSession({
        organizationId: input.organizationId,
        projectId: input.projectId,
        agentSessionId: input.runEntity.entityId,
      });
    } catch (error) {
      this.logger.error('entity_context.load.agent_session_read_failed', {
        entityId: input.runEntity.entityId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        error,
      });
      throw new Error('Agent Session context could not read the source Agent Session.');
    }

    const agentSession = sessionResponse.data?.data;
    if (!agentSession || !agentSessionIdentitySchema.safeParse(agentSession).success) {
      this.logger.error('entity_context.load.agent_session_malformed', {
        entityId: input.runEntity.entityId,
        hasData: Boolean(agentSession),
      });
      throw new Error('Agent Session context received a malformed Agent Session.');
    }

    this.assertAgentSessionIdentity(agentSession, input);
    const context = await this.readCanonicalContext(
      client,
      input,
      CanonicalEntityType.AgentSession,
    );
    this.assertCanonicalContextIdentity(context, input, CanonicalEntityType.AgentSession);
    const conversationId = agentSession.conversationId;
    if (!conversationId) {
      this.logger.error('entity_context.load.conversation_missing', {
        entityId: agentSession.id,
      });
      throw new Error('Agent Session context requires an attached source conversation.');
    }

    let conversationResponse: Awaited<ReturnType<EntityContextApiClient['getConversation']>>;
    try {
      conversationResponse = await client.getConversation({
        organizationId: input.organizationId,
        projectId: input.projectId,
        conversationId,
      });
    } catch (error) {
      this.logger.error('entity_context.load.conversation_read_failed', {
        entityId: agentSession.id,
        conversationId,
        error,
      });
      throw new Error('Agent Session context could not read the source conversation.');
    }

    const conversation = conversationResponse.data?.data;
    if (!conversation || !conversationShapeSchema.safeParse(conversation).success) {
      this.logger.error('entity_context.load.conversation_malformed', {
        entityId: agentSession.id,
        conversationId,
        hasData: Boolean(conversation),
      });
      throw new Error('Agent Session context received a malformed source conversation.');
    }

    this.assertAttachedConversationIdentity(conversation, input, conversationId);
    this.logger.debug('entity_context.load.conversation_attached', {
      entityId: agentSession.id,
      conversationId,
      workflowAboutId: conversation.workflowAboutId ?? null,
      workflowAboutType: conversation.workflowAboutType ?? null,
    });
    const messages = await this.readTranscriptMessages(client, input, conversationId);
    const transcript = projectAgentSessionTranscript(messages);

    this.logger.info('entity_context.load.succeeded', {
      entityId: agentSession.id,
      conversationId,
      transcriptEntryCount: transcript.length,
    });

    return {
      kind: 'agent_session',
      focalEntity: input.runEntity,
      entity: agentSession,
      context,
      agentSession,
      conversationId,
      transcript,
    };
  }

  private async readTranscriptMessages(
    client: EntityContextApiClient,
    input: EntityContextLoaderInput,
    conversationId: string,
  ): Promise<MessageResponseDto[]> {
    this.logger.debug('entity_context.load.messages_read', { conversationId });
    let messageResponse: Awaited<ReturnType<EntityContextApiClient['getMessages']>>;
    try {
      messageResponse = await client.getMessages({
        organizationId: input.organizationId,
        projectId: input.projectId,
        conversationId,
        includeProposals: false,
        includeReports: false,
      });
    } catch (error) {
      this.logger.error('entity_context.load.messages_read_failed', { conversationId, error });
      throw new Error('Agent Session context could not read the source Messages.');
    }
    const data = messageResponse.data.data;
    const messages = Array.isArray(data) ? data : data?.messages;
    if (
      !messages ||
      !transcriptMessagesSchema.safeParse(messages).success ||
      messages.some((message) => message.conversationId !== conversationId)
    ) {
      this.logger.error('entity_context.load.messages_malformed', { conversationId });
      throw new Error('Agent Session context received malformed or mismatched source Messages.');
    }
    return messages;
  }

  private async loadAuthoritativeEntityContext(
    input: EntityContextLoaderInput,
  ): Promise<LoadedEntityPromptContext> {
    if (!input.runEntity.entityId.trim()) {
      this.logger.error('entity_context.load.focal_entity_id_missing', {
        entityType: input.runEntity.entityType,
      });
      throw new Error('Entity context requires a non-empty persisted focal entity id.');
    }

    if (!input.organizationId.trim() || !input.projectId.trim()) {
      this.logger.error('entity_context.load.scope_missing', {
        hasOrganizationId: Boolean(input.organizationId.trim()),
        hasProjectId: Boolean(input.projectId.trim()),
        entityId: input.runEntity.entityId,
      });
      throw new Error('Entity context requires organizationId and projectId.');
    }

    let accessToken: string;
    try {
      accessToken = await this.auth.getAccessToken();
    } catch (error) {
      this.logger.error('entity_context.load.auth_failed', {
        entityType: input.runEntity.entityType,
        entityId: input.runEntity.entityId,
        error,
      });
      throw new Error('Entity context could not authenticate its platform read.');
    }

    const client = this.createClient(accessToken);
    const entity = await this.readCurrentEntity(client, input);
    this.assertCurrentEntityIdentity(entity, input);

    const canonicalEntityType = canonicalEntityTypeFor(input.runEntity.entityType);
    const context = await this.readCanonicalContext(client, input, canonicalEntityType);
    this.assertCanonicalContextIdentity(context, input, canonicalEntityType);

    this.logger.info('entity_context.load.succeeded', {
      entityType: input.runEntity.entityType,
      entityId: input.runEntity.entityId,
      canonicalEntityType,
    });

    return {
      kind: 'entity',
      focalEntity: input.runEntity,
      entity,
      context,
    };
  }

  private async readCurrentEntity(
    client: EntityContextApiClient,
    input: EntityContextLoaderInput,
  ): Promise<CurrentEntityDto> {
    this.logger.debug('entity_context.load.entity_dispatch', {
      entityType: input.runEntity.entityType,
      entityId: input.runEntity.entityId,
    });

    if (input.runEntity.entityType === RunEntityType.Project) {
      this.logger.debug('entity_context.load.project_read_started', {
        entityId: input.runEntity.entityId,
        organizationId: input.organizationId,
        projectId: input.projectId,
      });
      let response: Awaited<ReturnType<EntityContextApiClient['findOneProject']>>;
      try {
        response = await client.findOneProject({
          organizationId: input.organizationId,
          projectId: input.runEntity.entityId,
        });
      } catch (error) {
        this.logger.error('entity_context.load.project_read_failed', {
          entityId: input.runEntity.entityId,
          organizationId: input.organizationId,
          error,
        });
        throw new Error('Entity context project read failed.');
      }
      const entity = this.parseAuthoritativeResponse(response, projectEntitySchema, 'project');
      this.logger.debug('entity_context.load.project_read_succeeded', {
        entityId: entity.id,
      });
      return entity;
    }

    if (input.runEntity.entityType === RunEntityType.DesignDoc) {
      this.logger.debug('entity_context.load.design_doc_read_started', {
        entityId: input.runEntity.entityId,
        organizationId: input.organizationId,
        projectId: input.projectId,
      });
      let response: Awaited<
        ReturnType<EntityContextApiClient['organizationsOrganizationIdDesignDocsDesignDocIdGet']>
      >;
      try {
        response = await client.organizationsOrganizationIdDesignDocsDesignDocIdGet({
          organizationId: input.organizationId,
          designDocId: input.runEntity.entityId,
        });
      } catch (error) {
        this.logger.error('entity_context.load.design_doc_read_failed', {
          entityId: input.runEntity.entityId,
          organizationId: input.organizationId,
          projectId: input.projectId,
          error,
        });
        throw new Error('Entity context Design Doc read failed.');
      }
      const entity = this.parseAuthoritativeResponse(response, designDocEntitySchema, 'design_doc');
      this.logger.debug('entity_context.load.design_doc_read_succeeded', {
        entityId: entity.id,
      });
      return entity;
    }

    if (isWorkItemEntity(input.runEntity.entityType)) {
      this.logger.debug('entity_context.load.work_item_read_started', {
        entityType: input.runEntity.entityType,
        entityId: input.runEntity.entityId,
        organizationId: input.organizationId,
        projectId: input.projectId,
      });
      let response: Awaited<
        ReturnType<
          EntityContextApiClient['organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet']
        >
      >;
      try {
        response = await client.organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet({
          organizationId: input.organizationId,
          projectId: input.projectId,
          taskId: input.runEntity.entityId,
        });
      } catch (error) {
        this.logger.error('entity_context.load.work_item_read_failed', {
          entityType: input.runEntity.entityType,
          entityId: input.runEntity.entityId,
          organizationId: input.organizationId,
          projectId: input.projectId,
          error,
        });
        throw new Error('Entity context Work Item read failed.');
      }
      const entity = this.parseAuthoritativeResponse(response, workItemEntitySchema, 'work_item');
      this.logger.debug('entity_context.load.work_item_read_succeeded', {
        entityType: entity.type,
        entityId: entity.id,
      });
      return entity;
    }

    this.logger.error('entity_context.load.entity_dispatch_unsupported', {
      entityType: input.runEntity.entityType,
      entityId: input.runEntity.entityId,
    });
    throw new Error(
      `Entity context does not support focal entity type "${input.runEntity.entityType}".`,
    );
  }

  private async readCanonicalContext(
    client: EntityContextApiClient,
    input: EntityContextLoaderInput,
    entityType:
      | typeof CanonicalEntityType.Project
      | typeof CanonicalEntityType.DesignDoc
      | typeof CanonicalEntityType.AgentSession
      | typeof CanonicalEntityType.Task,
  ): Promise<FullEntityContextDto> {
    this.logger.debug('entity_context.load.canonical_context_read_started', {
      entityType,
      entityId: input.runEntity.entityId,
      organizationId: input.organizationId,
      projectId: input.projectId,
    });

    let response: Awaited<ReturnType<EntityContextApiClient['getEntityContext']>>;
    try {
      response = await client.getEntityContext({
        organizationId: input.organizationId,
        projectId: input.projectId,
        entityType,
        entityId: input.runEntity.entityId,
      });
    } catch (error) {
      this.logger.error('entity_context.load.canonical_context_read_failed', {
        entityType,
        entityId: input.runEntity.entityId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        error,
      });
      throw new Error('Entity context canonical Context read failed.');
    }

    const context = this.parseAuthoritativeResponse(
      response,
      canonicalContextSchema,
      'canonical_context',
    );
    this.logger.debug('entity_context.load.canonical_context_read_succeeded', {
      entityType: context.entityType,
      entityId: context.entityId,
    });
    return context;
  }

  private parseAuthoritativeResponse<T>(
    response: { data?: { success?: boolean; data?: T } } | null | undefined,
    schema: z.ZodType<T>,
    operation: string,
  ): T {
    const envelope = authoritativeResponseEnvelopeSchema.safeParse(response?.data);
    if (!envelope.success) {
      this.logger.error('entity_context.load.authoritative_response_malformed', {
        operation,
        issues: envelope.error.issues,
      });
      throw new Error(`Entity context received a malformed ${operation} response.`);
    }
    if (!envelope.data.success) {
      this.logger.error('entity_context.load.authoritative_response_failed', {
        operation,
      });
      throw new Error(`Entity context ${operation} read returned an unsuccessful response.`);
    }

    const parsed = schema.safeParse(response?.data?.data);
    if (!parsed.success) {
      this.logger.error('entity_context.load.authoritative_payload_malformed', {
        operation,
        issues: parsed.error.issues,
      });
      throw new Error(`Entity context received malformed ${operation} data.`);
    }
    return parsed.data;
  }

  private assertCurrentEntityIdentity(
    entity: CurrentEntityDto,
    input: EntityContextLoaderInput,
  ): void {
    const requestedEntityType = input.runEntity.entityType;
    let identityMatches = false;
    let scopeMatches = false;
    let receivedEntityType: string | null = null;

    if (requestedEntityType === RunEntityType.Project && 'organizationId' in entity) {
      identityMatches = entity.id === input.runEntity.entityId;
      scopeMatches =
        entity.organizationId === input.organizationId && entity.id === input.projectId;
    } else if (
      requestedEntityType === RunEntityType.DesignDoc &&
      'organizationId' in entity &&
      'projectId' in entity
    ) {
      identityMatches = entity.id === input.runEntity.entityId;
      scopeMatches =
        entity.organizationId === input.organizationId && entity.projectId === input.projectId;
    } else if (
      isWorkItemEntity(requestedEntityType) &&
      'projectId' in entity &&
      'type' in entity &&
      typeof entity.type === 'string'
    ) {
      identityMatches = entity.id === input.runEntity.entityId;
      scopeMatches =
        entity.organizationId === input.organizationId && entity.projectId === input.projectId;
      receivedEntityType = entity.type;
    }

    if (!identityMatches || !scopeMatches) {
      this.logger.error('entity_context.load.entity_identity_or_scope_conflict', {
        requested: {
          entityType: requestedEntityType,
          entityId: input.runEntity.entityId,
          organizationId: input.organizationId,
          projectId: input.projectId,
        },
        received: {
          entityId: entity.id,
          organizationId: 'organizationId' in entity ? entity.organizationId : null,
          projectId:
            'projectId' in entity
              ? entity.projectId
              : 'originatingProjectId' in entity
                ? entity.originatingProjectId
                : null,
          entityType: receivedEntityType,
        },
      });
      throw new Error('Entity context current entity identity or scope mismatch.');
    }
  }

  private assertCanonicalContextIdentity(
    context: FullEntityContextDto,
    input: EntityContextLoaderInput,
    expectedEntityType:
      | typeof CanonicalEntityType.Project
      | typeof CanonicalEntityType.DesignDoc
      | typeof CanonicalEntityType.AgentSession
      | typeof CanonicalEntityType.Task,
  ): void {
    if (
      context.entityId !== input.runEntity.entityId ||
      context.entityType !== expectedEntityType
    ) {
      this.logger.error('entity_context.load.canonical_context_identity_conflict', {
        requested: {
          entityType: expectedEntityType,
          focalEntityType: input.runEntity.entityType,
          entityId: input.runEntity.entityId,
          organizationId: input.organizationId,
          projectId: input.projectId,
        },
        received: {
          entityType: context.entityType,
          entityId: context.entityId,
        },
      });
      throw new Error('Entity context canonical Context identity or scope mismatch.');
    }
  }

  private assertAgentSessionIdentity(
    agentSession: AgentSessionDto,
    input: EntityContextLoaderInput,
  ): void {
    if (
      agentSession.id !== input.runEntity.entityId ||
      agentSession.organizationId !== input.organizationId ||
      agentSession.projectId !== input.projectId
    ) {
      this.logger.error('entity_context.load.agent_session_identity_conflict', {
        requested: {
          entityId: input.runEntity.entityId,
          organizationId: input.organizationId,
          projectId: input.projectId,
        },
        received: {
          entityId: agentSession.id,
          organizationId: agentSession.organizationId,
          projectId: agentSession.projectId,
        },
      });
      throw new Error('Agent Session context conflicts with the persisted Run identity.');
    }
  }

  private assertAttachedConversationIdentity(
    conversation: {
      id: string;
      organizationId: string;
      projectId: string;
      workflowAboutId?: string;
      workflowAboutType?: string;
    },
    input: EntityContextLoaderInput,
    conversationId: string,
  ): void {
    if (
      conversation.id !== conversationId ||
      conversation.organizationId !== input.organizationId ||
      conversation.projectId !== input.projectId
    ) {
      this.logger.error('entity_context.load.conversation_identity_conflict', {
        requested: {
          conversationId,
          organizationId: input.organizationId,
          projectId: input.projectId,
        },
        received: {
          conversationId: conversation.id,
          organizationId: conversation.organizationId,
          projectId: conversation.projectId,
          workflowAboutId: conversation.workflowAboutId ?? null,
          workflowAboutType: conversation.workflowAboutType ?? null,
        },
      });
      throw new Error('Agent Session context conflicts with the attached conversation identity.');
    }
  }
}
