import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  CliReadEnvelopeBody,
  CliReadWorkspaceSkillsListRequest,
  HostActionTarget,
  CliReadErrorCode,
  CliReadErrorResponseDto,
  CliReadProjectSessionCostsListRequest,
  CliReadProviderUsage,
  CliReadProviderUsageGetSuccessResponseDto,
  CliReadRequestDto,
  CliReadRuntimeModelCatalogGetSuccessResponseDto,
  CliReadRunToolCallsLatestTurnSuccessResponseDto,
  CliReadRunToolCallsLatestTurnRequest,
  CliReadRunChangedFilesCountRequest,
  CliReadRunChangedFileDetailRequest,
  CliReadRunChangedFilesInventoryRequest,
  CliReadRunContextUsageGetRequest,
  CliReadResponseDto,
  AgentSkillCatalogScope,
  AgentSkillProvider,
  WebSocketCliReadRequestEvent,
  HostActionTargetKind,
  HostAffectingActionType,
} from '../../generated';
import {
  AgentSessionId,
  MachineId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../types';
import { TriggerEnvelopeSigner } from './trigger-envelope-signer.service';
import { WebsocketGateway } from './websocket.gateway';
import { ExecutableFrameAuthorizationService } from './executable-frame-authorization.service';
import type { AdmittedCliReadAuthorization } from './cli-read-operation-registry';

const errorCodes = [
  'RUN_NOT_FOUND',
  'RUN_ID_MISMATCH',
  'INVALID_RUN_CONTEXT',
  'INVALID_PROJECT_CONTEXT',
  'INVALID_REQUEST',
  'INVALID_CURSOR',
  'SERVICE_NOT_FOUND',
  'REPOSITORY_NOT_FOUND',
  'INVALID_REPOSITORY_PATH',
  'INVALID_FILE_MEMBERSHIP',
  'RESULT_TOO_LARGE',
  'READ_FAILED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_FAILURE',
  'CATALOG_BUSY',
  'INVALID_WORKSPACE',
  'MACHINE_NOT_BOUND',
  'NO_RECIPIENT',
  'TIMEOUT',
  'CORRELATION_MISMATCH',
  'MALFORMED_ACK',
] as const;

const errorSchema = z
  .object({
    requestId: z.string().uuid(),
    status: z.literal('error'),
    error: z.object({ code: z.enum(errorCodes), message: z.string() }).strict(),
  })
  .strict();

const runChangedFilesCountSuccessSchema = z
  .object({
    requestId: z.string().uuid(),
    operation: z.literal('run.changed_files.count'),
    status: z.literal('success'),
    result: z
      .object({
        runId: z.string().uuid(),
        changedFilesCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

const changedFileIdentitySchema = z
  .object({
    serviceId: z.string().uuid(),
    repoPath: z.string().max(4_096),
    filePath: z.string().max(4_096),
  })
  .strict();

const changedFileInventoryEntrySchema = changedFileIdentitySchema.extend({
  status: z.enum(['create', 'modify', 'delete']),
});

const runChangedFilesInventorySuccessSchema = z
  .object({
    requestId: z.string().uuid(),
    operation: z.literal('run.changed_files.inventory'),
    status: z.literal('success'),
    result: z
      .object({
        runId: z.string().uuid(),
        entries: z.array(changedFileInventoryEntrySchema).max(100),
      })
      .strict(),
  })
  .strict();

const runChangedFileDetailSuccessSchema = z
  .object({
    requestId: z.string().uuid(),
    operation: z.literal('run.changed_files.detail'),
    status: z.literal('success'),
    result: z
      .object({
        runId: z.string().uuid(),
        file: changedFileInventoryEntrySchema
          .extend({
            diff: z.string().max(1_048_576),
            preContent: z.string().max(1_048_576).nullable(),
            postContent: z.string().max(1_048_576).nullable(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

const projectSessionCostSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('available'),
      amountUsd: z.number().nonnegative(),
      currency: z.literal('USD'),
      source: z.literal('ccusage'),
    })
    .strict(),
  z
    .object({
      state: z.literal('unavailable'),
      reason: z.enum([
        'unsupported_provider',
        'provider_session_id_missing',
        'cost_source_unavailable',
        'session_not_found',
        'malformed_cost_data',
        'adapter_error',
      ]),
      message: z.string().min(1).optional(),
    })
    .strict(),
]);

const contextToolDetailSchema = z
  .object({
    name: z.string(),
    tokens: z.number().int().nonnegative(),
    isLoaded: z.boolean().optional(),
  })
  .strict();

const contextDataSchema = z
  .object({
    categories: z.array(
      z
        .object({
          name: z.string(),
          tokens: z.number().int().nonnegative(),
          color: z.string(),
          isDeferred: z.boolean().optional(),
        })
        .strict(),
    ),
    totalTokens: z.number().int().nonnegative(),
    maxTokens: z.number().int().nonnegative(),
    rawMaxTokens: z.number().int().nonnegative(),
    percentage: z.number().nonnegative(),
    gridRows: z.array(
      z.array(
        z
          .object({
            color: z.string(),
            isFilled: z.boolean(),
            categoryName: z.string(),
            tokens: z.number().int().nonnegative(),
            percentage: z.number().nonnegative(),
            squareFullness: z.number().nonnegative(),
          })
          .strict(),
      ),
    ),
    model: z.string(),
    memoryFiles: z.array(
      z
        .object({
          path: z.string(),
          type: z.string(),
          tokens: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    mcpTools: z.array(
      z
        .object({
          name: z.string(),
          serverName: z.string(),
          tokens: z.number().int().nonnegative(),
          isLoaded: z.boolean().optional(),
        })
        .strict(),
    ),
    deferredBuiltinTools: z.array(contextToolDetailSchema).optional(),
    systemTools: z.array(contextToolDetailSchema).optional(),
    systemPromptSections: z
      .array(
        z
          .object({ name: z.string(), tokens: z.number().int().nonnegative() })
          .strict(),
      )
      .optional(),
    agents: z.array(
      z
        .object({
          agentType: z.string(),
          source: z.string(),
          tokens: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    slashCommands: z
      .object({
        totalCommands: z.number().int().nonnegative(),
        includedCommands: z.number().int().nonnegative(),
        tokens: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    skills: z
      .object({
        totalSkills: z.number().int().nonnegative(),
        includedSkills: z.number().int().nonnegative(),
        tokens: z.number().int().nonnegative(),
        skillFrontmatter: z.array(
          z
            .object({
              name: z.string(),
              source: z.string(),
              tokens: z.number().int().nonnegative(),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
    autoCompactThreshold: z.number().int().nonnegative().optional(),
    isAutoCompactEnabled: z.boolean(),
    messageBreakdown: z
      .object({
        toolCallTokens: z.number().int().nonnegative(),
        toolResultTokens: z.number().int().nonnegative(),
        attachmentTokens: z.number().int().nonnegative(),
        assistantMessageTokens: z.number().int().nonnegative(),
        userMessageTokens: z.number().int().nonnegative(),
        toolCallsByType: z.array(
          z
            .object({
              name: z.string(),
              callTokens: z.number().int().nonnegative(),
              resultTokens: z.number().int().nonnegative(),
            })
            .strict(),
        ),
        attachmentsByType: z.array(
          z
            .object({
              name: z.string(),
              tokens: z.number().int().nonnegative(),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
    apiUsage: z
      .object({
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
        cache_creation_input_tokens: z.number().int().nonnegative(),
        cache_read_input_tokens: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict();

const runContextUsageGetSuccessSchema = z
  .object({
    requestId: z.string().uuid(),
    operation: z.literal('run.context_usage.get'),
    status: z.literal('success'),
    result: z
      .object({
        runId: z.string().uuid(),
        providerSessionId: z.string().min(1),
        contextData: contextDataSchema,
        cost: projectSessionCostSchema,
      })
      .strict(),
  })
  .strict();

const agentSkillInterfaceMetadataSchema = z
  .object({
    brandColor: z.string().nullable().optional(),
    defaultPrompt: z.string().nullable().optional(),
    displayName: z.string().nullable().optional(),
    iconLarge: z.string().nullable().optional(),
    iconSmall: z.string().nullable().optional(),
    shortDescription: z.string().nullable().optional(),
  })
  .strict();

const agentSkillToolDependencySchema = z
  .object({
    type: z.string(),
    value: z.string(),
    command: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    transport: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
  })
  .strict();

const agentSkillCatalogEntrySchema = z
  .object({
    provider: z.nativeEnum(AgentSkillProvider),
    name: z.string().min(1).max(200),
    catalogScope: z.nativeEnum(AgentSkillCatalogScope),
    description: z.string(),
    shortDescription: z.string().nullable().optional(),
    enabled: z.boolean(),
    interface: agentSkillInterfaceMetadataSchema.optional(),
    dependencies: z
      .object({ tools: z.array(agentSkillToolDependencySchema) })
      .strict()
      .optional(),
  })
  .strict();

const agentSkillDiscoveryErrorSchema = z
  .object({
    provider: z.nativeEnum(AgentSkillProvider),
    message: z.string(),
  })
  .strict();

const runSkillsListSuccessSchema = z
  .object({
    requestId: z.string().uuid(),
    operation: z.literal('run.skills.list'),
    status: z.literal('success'),
    result: z
      .object({
        runId: z.string().uuid(),
        provider: z.nativeEnum(AgentSkillProvider),
        skills: z.array(agentSkillCatalogEntrySchema),
        errors: z.array(agentSkillDiscoveryErrorSchema),
      })
      .strict(),
  })
  .strict();

const projectSessionCostsListSuccessSchema = z
  .object({
    requestId: z.string().uuid(),
    operation: z.literal('project.session_costs.list'),
    status: z.literal('success'),
    result: z
      .object({
        items: z.array(
          z
            .object({
              agentSessionId: z.string().uuid(),
              conversationId: z.string().uuid(),
              context: z
                .object({
                  entityType: z.string().nullable(),
                  entityId: z.string().nullable(),
                  entityTitle: z.string().nullable(),
                  promptType: z.string().nullable(),
                })
                .strict(),
              providerSessions: z.array(
                z
                  .object({
                    providerId: z.enum(['claude', 'codex', 'opencode']),
                    providerSessionId: z.string().min(1),
                    providerConversationId: z.string().nullable(),
                    providerSessionAgentId: z.string().nullable(),
                    observedAt: z.string().datetime(),
                    cost: projectSessionCostSchema,
                  })
                  .strict(),
              ),
              knownCostUsd: z.number().nonnegative().nullable(),
              completeness: z.enum(['complete', 'partial', 'unavailable']),
              latestActivityAt: z.string().datetime(),
              costReadAt: z.string().datetime(),
            })
            .strict(),
        ),
        nextCursor: z.string().nullable(),
        sourceAvailability: z.enum(['available', 'partial', 'unavailable']),
        costReadAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict();

const providerUsageLimitWindowSchema = z
  .object({
    usedPercent: z.number().nullable(),
    resetsAt: z.string().datetime().nullable(),
  })
  .strict();

const providerUsageGetSuccessSchema = z
  .object({
    requestId: z.string().uuid(),
    operation: z.literal(
      CliReadProviderUsageGetSuccessResponseDto.OperationEnum.ProviderUsageGet,
    ),
    status: z.literal('success'),
    result: z
      .object({
        providers: z.array(
          z
            .object({
              provider: z.nativeEnum(CliReadProviderUsage.ProviderEnum),
              status: z.nativeEnum(CliReadProviderUsage.StatusEnum),
              observedAt: z.string().datetime().nullable(),
              fiveHour: providerUsageLimitWindowSchema.nullable(),
              weekly: providerUsageLimitWindowSchema.nullable(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict() satisfies z.ZodType<CliReadProviderUsageGetSuccessResponseDto>;

const providerUsageGetErrorSchema = errorSchema.extend({
  operation: z.literal(
    CliReadProviderUsageGetSuccessResponseDto.OperationEnum.ProviderUsageGet,
  ),
});

const runtimeModelCatalogGetSuccessSchema = z
  .object({
    requestId: z.string().uuid(),
    operation: z.literal('runtime.model_catalog.get'),
    status: z.literal('success'),
    result: z
      .object({
        providers: z.array(
          z
            .object({
              provider: z.enum(['claude', 'codex', 'opencode']),
              models: z.array(
                z
                  .object({
                    id: z.string().min(1),
                    label: z.string().min(1),
                    efforts: z.array(
                      z.enum([
                        'none',
                        'minimal',
                        'low',
                        'medium',
                        'high',
                        'xhigh',
                        'max',
                        'ultra',
                        'default',
                      ]),
                    ),
                    serviceTiers: z.array(z.enum(['priority'])).optional(),
                    opencodeModelRef: z
                      .object({
                        providerID: z.string().min(1),
                        modelID: z.string().min(1),
                      })
                      .strict()
                      .optional(),
                  })
                  .strict(),
              ),
              notice: z.string().min(1).optional(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict() satisfies z.ZodType<CliReadRuntimeModelCatalogGetSuccessResponseDto>;

const runtimeModelCatalogGetErrorSchema = errorSchema.extend({
  operation: z.literal('runtime.model_catalog.get'),
});

const toolCallTextSchema = z
  .object({ text: z.string(), truncated: z.boolean() })
  .strict();

const toolCallSchema = z
  .object({
    entryId: z.string().min(1),
    toolUseId: z.string().min(1),
    toolName: z.string().nullable(),
    summary: z.string(),
    status: z.enum(['running', 'completed', 'failed']),
    exitCode: z.number().int().nullable(),
    lane: z
      .object({
        subagentTurnId: z.string().nullable(),
        providerThreadId: z.string().nullable(),
        parentToolUseId: z.string().nullable(),
      })
      .strict(),
    createdAt: z.string(),
    updatedAt: z.string(),
    detail: z
      .object({
        input: toolCallTextSchema.nullable(),
        output: toolCallTextSchema.nullable(),
        result: toolCallTextSchema.nullable(),
      })
      .strict(),
  })
  .strict();

const runToolCallsLatestTurnSuccessSchema = z
  .object({
    requestId: z.string().uuid(),
    operation: z.literal('run.tool_calls.latest_turn'),
    status: z.literal('success'),
    result: z.discriminatedUnion('state', [
      z
        .object({
          state: z.literal('available'),
          runId: z.string().uuid(),
          turnId: z.string().nullable(),
          toolCalls: z.array(toolCallSchema),
          omittedEarlierCount: z.number().int().min(0),
          evictedCount: z.number().int().min(0),
        })
        .strict(),
      z
        .object({ state: z.literal('disabled'), runId: z.string().uuid() })
        .strict(),
    ]),
  })
  .strict() satisfies z.ZodType<CliReadRunToolCallsLatestTurnSuccessResponseDto>;

const runToolCallsLatestTurnErrorSchema = errorSchema.extend({
  operation: z.literal('run.tool_calls.latest_turn'),
});

const runChangedFilesCountErrorSchema = errorSchema.extend({
  operation: z.literal('run.changed_files.count'),
});

const runChangedFilesInventoryErrorSchema = errorSchema.extend({
  operation: z.literal('run.changed_files.inventory'),
});

const runChangedFileDetailErrorSchema = errorSchema.extend({
  operation: z.literal('run.changed_files.detail'),
});

const projectSessionCostsListErrorSchema = errorSchema.extend({
  operation: z.literal('project.session_costs.list'),
});

const runContextUsageGetErrorSchema = errorSchema.extend({
  operation: z.literal('run.context_usage.get'),
});

const runSkillsListErrorSchema = errorSchema.extend({
  operation: z.literal('run.skills.list'),
});

const workspaceSkillsListSuccessSchema = runSkillsListSuccessSchema.extend({
  operation: z.literal('workspace.skills.list'),
  result: runSkillsListSuccessSchema.shape.result.omit({ runId: true }),
});
const workspaceSkillsListErrorSchema = errorSchema.extend({
  operation: z.literal('workspace.skills.list'),
});
const responseSchema = z.union([
  workspaceSkillsListSuccessSchema,
  workspaceSkillsListErrorSchema,
  runChangedFilesCountSuccessSchema,
  runChangedFilesCountErrorSchema,
  runChangedFilesInventorySuccessSchema,
  runChangedFilesInventoryErrorSchema,
  runChangedFileDetailSuccessSchema,
  runChangedFileDetailErrorSchema,
  projectSessionCostsListSuccessSchema,
  projectSessionCostsListErrorSchema,
  providerUsageGetSuccessSchema,
  providerUsageGetErrorSchema,
  runtimeModelCatalogGetSuccessSchema,
  runtimeModelCatalogGetErrorSchema,
  runToolCallsLatestTurnSuccessSchema,
  runToolCallsLatestTurnErrorSchema,
  runContextUsageGetSuccessSchema,
  runContextUsageGetErrorSchema,
  runSkillsListSuccessSchema,
  runSkillsListErrorSchema,
]);

const DEFAULT_CLI_READ_TIMEOUT_MS = 5_000;

const CLI_READ_TIMEOUT_MS_BY_OPERATION: Partial<
  Record<CliReadEnvelopeBody['operation'], number>
> = {
  [CliReadProjectSessionCostsListRequest.OperationEnum.ProjectSessionCostsList]:
    30_000,
  [CliReadRunContextUsageGetRequest.OperationEnum.RunContextUsageGet]: 30_000,
};

@Injectable()
export class CliReadEmitter {
  private readonly logger = new Logger(CliReadEmitter.name);

  constructor(
    private readonly signer: TriggerEnvelopeSigner,
    private readonly gateway: WebsocketGateway,
    private readonly executableFrameAuthorization: ExecutableFrameAuthorizationService,
  ) {}

  async read(params: {
    request: CliReadRequestDto;
    machineId: MachineId;
    userId: UserId;
    organizationId: OrganizationId;
    projectId: ProjectId;
    conversationId: string;
    agentSessionId: string;
    admission: AdmittedCliReadAuthorization;
    timeoutMs?: number;
  }): Promise<CliReadResponseDto> {
    const requestId = randomUUID();
    const { authorization: _authorization, ...readRequest } = params.request;
    const body = {
      requestId,
      agentSessionId: params.agentSessionId,
      ...readRequest,
    } satisfies CliReadEnvelopeBody;
    return this.readBody({
      ...params,
      body,
      target: {
        kind: HostActionTargetKind.AgentSession,
        id: params.agentSessionId,
        revision: null,
      },
    });
  }

  async readWorkspace(params: {
    request: CliReadWorkspaceSkillsListRequest;
    organizationId: OrganizationId;
    projectId: ProjectId;
    machineId: MachineId;
    userId: UserId;
    authorizationRequestId: string;
    admission: AdmittedCliReadAuthorization;
  }): Promise<CliReadResponseDto> {
    const body: CliReadEnvelopeBody = {
      requestId: randomUUID(),
      operation: 'workspace.skills.list',
      provider: params.request.provider,
      catalogContext: params.request.catalogContext,
      organizationId: params.organizationId,
      projectId: params.projectId,
      machineId: params.machineId,
      authorizationRequestId: params.authorizationRequestId,
    };
    return this.readBody({
      ...params,
      body,
      agentSessionId: null,
      timeoutMs: 30_000,
      target: {
        kind: HostActionTargetKind.CliRead,
        id: params.machineId,
        revision: null,
      },
    });
  }

  async readRuntimeModelCatalog(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    machineId: MachineId;
    userId: UserId;
    authorizationRequestId: string;
    admission: AdmittedCliReadAuthorization;
  }): Promise<CliReadResponseDto> {
    const body: CliReadEnvelopeBody = {
      requestId: randomUUID(),
      operation: 'runtime.model_catalog.get',
      organizationId: params.organizationId,
      projectId: params.projectId,
      machineId: params.machineId,
      authorizationRequestId: params.authorizationRequestId,
    };
    return this.readBody({
      ...params,
      body,
      agentSessionId: null,
      target: {
        kind: HostActionTargetKind.CliRead,
        id: params.machineId,
        revision: null,
      },
    });
  }

  private async readBody(params: {
    body: CliReadEnvelopeBody;
    machineId: MachineId;
    userId: UserId;
    organizationId: OrganizationId;
    projectId: ProjectId;
    conversationId?: string;
    agentSessionId: string | null;
    admission: AdmittedCliReadAuthorization;
    timeoutMs?: number;
    target: HostActionTarget;
  }): Promise<CliReadResponseDto> {
    const { body } = params;
    const requestId = body.requestId;
    this.logger.log('[cli-read] preparing signed request', {
      requestId,
      operation: body.operation,
      machineId: params.machineId,
      conversationId: params.conversationId,
    });

    const authorization =
      await this.executableFrameAuthorization.resolveSelectedAuthorization({
        machineId: params.machineId,
        userId: params.userId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        actionType: HostAffectingActionType.CliRead,
        actionPayloadHash: params.admission.actionPayloadHash,
        target: params.target,
        agentSessionId: params.agentSessionId as AgentSessionId | null,
        conversationId: params.conversationId,
        taskMonitorId: null,
        authorizationId: params.admission.authorizationId,
        envelopeAuthorization: params.admission.envelopeAuthorization,
      });
    if (!authorization) {
      return this.error(
        body,
        CliReadErrorCode.NoRecipient,
        'The controller authorization does not permit this read.',
      );
    }

    const event: WebSocketCliReadRequestEvent = {
      type: WebSocketCliReadRequestEvent.TypeEnum.CliReadRequest,
      timestamp: new Date().toISOString(),
      organizationId: params.organizationId,
      projectId: params.projectId,
      ...(params.conversationId
        ? { conversationId: params.conversationId }
        : {}),
      userId: params.userId,
      envelope: this.signer.signCliReadAuthorized(
        body,
        params.machineId,
        params.userId,
        authorization,
      ),
    };
    const timeoutMs =
      params.timeoutMs ??
      CLI_READ_TIMEOUT_MS_BY_OPERATION[body.operation] ??
      DEFAULT_CLI_READ_TIMEOUT_MS;
    const ack = await this.gateway.emitCliReadWithAck(event, timeoutMs);
    if (ack.kind === 'no_recipient') {
      return this.error(
        body,
        CliReadErrorCode.NoRecipient,
        'The bound CLI is not connected.',
      );
    }
    if (ack.kind === 'timeout') {
      return this.error(
        body,
        CliReadErrorCode.Timeout,
        'The bound CLI did not complete the read before the timeout.',
      );
    }

    const acknowledgement = this.unwrapSingleAcknowledgement(ack.value);
    const parsed = responseSchema.safeParse(acknowledgement);
    if (!parsed.success) {
      this.logger.warn('[cli-read] malformed acknowledgement', {
        requestId,
        issues: parsed.error.issues,
      });
      return this.error(
        body,
        CliReadErrorCode.MalformedAck,
        'The CLI returned a malformed acknowledgement.',
      );
    }
    if (
      parsed.data.requestId !== requestId ||
      parsed.data.operation !== body.operation ||
      (body.operation === 'workspace.skills.list' &&
        parsed.data.operation === 'workspace.skills.list' &&
        parsed.data.status === 'success' &&
        parsed.data.result.provider !== body.provider) ||
      (body.operation === 'run.skills.list' &&
        parsed.data.operation === 'run.skills.list' &&
        parsed.data.status === 'success' &&
        parsed.data.result.runId !== body.runId) ||
      ((body.operation ===
        CliReadRunChangedFilesCountRequest.OperationEnum.RunChangedFilesCount ||
        body.operation ===
          CliReadRunChangedFilesInventoryRequest.OperationEnum
            .RunChangedFilesInventory ||
        body.operation ===
          CliReadRunChangedFileDetailRequest.OperationEnum
            .RunChangedFilesDetail ||
        body.operation ===
          CliReadRunContextUsageGetRequest.OperationEnum.RunContextUsageGet ||
        body.operation ===
          CliReadRunToolCallsLatestTurnRequest.OperationEnum
            .RunToolCallsLatestTurn) &&
        parsed.data.status === 'success' &&
        (parsed.data.operation ===
          CliReadRunChangedFilesCountRequest.OperationEnum
            .RunChangedFilesCount ||
          parsed.data.operation ===
            CliReadRunChangedFilesInventoryRequest.OperationEnum
              .RunChangedFilesInventory ||
          parsed.data.operation ===
            CliReadRunChangedFileDetailRequest.OperationEnum
              .RunChangedFilesDetail ||
          parsed.data.operation ===
            CliReadRunContextUsageGetRequest.OperationEnum.RunContextUsageGet ||
          parsed.data.operation ===
            CliReadRunToolCallsLatestTurnRequest.OperationEnum
              .RunToolCallsLatestTurn) &&
        parsed.data.result.runId !== body.runId) ||
      (body.operation ===
        CliReadRunContextUsageGetRequest.OperationEnum.RunContextUsageGet &&
        body.providerSessionId !== undefined &&
        parsed.data.status === 'success' &&
        parsed.data.operation ===
          CliReadRunContextUsageGetRequest.OperationEnum.RunContextUsageGet &&
        parsed.data.result.providerSessionId !== body.providerSessionId)
    ) {
      this.logger.warn('[cli-read] acknowledgement correlation mismatch', {
        requestId,
        operation: body.operation,
        responseRequestId: parsed.data.requestId,
      });
      return this.error(
        body,
        CliReadErrorCode.CorrelationMismatch,
        'The CLI acknowledgement did not match the request.',
      );
    }

    return parsed.data satisfies CliReadResponseDto;
  }

  error(
    request:
      | CliReadRequestDto
      | CliReadWorkspaceSkillsListRequest
      | CliReadEnvelopeBody,
    code: CliReadErrorCode,
    message: string,
  ): CliReadErrorResponseDto {
    const requestId = 'requestId' in request ? request.requestId : randomUUID();
    return {
      requestId,
      operation: request.operation,
      status: 'error',
      error: { code, message },
    };
  }
  private unwrapSingleAcknowledgement(value: unknown): unknown {
    return Array.isArray(value)
      ? value.length === 1
        ? value[0]
        : undefined
      : value;
  }
}
