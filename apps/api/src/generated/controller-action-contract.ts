/**
 * Auto-generated from specs/agent-bridge/openapi.yaml.
 * Do not edit manually; regenerate from the OpenAPI source.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */

import type {
  HostActionPreparation,
  ControllerActionInputs,
} from './model/models';
export type ControllerActionRuntimeSchemaTypes = {
  HostActionPreparation: HostActionPreparation;
  ControllerActionInputs: ControllerActionInputs;
};
export const controllerActionRuntimeSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  definitions: {
    HostActionPreparation: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'requestId',
            'actionCategory',
            'actionType',
            'targetKind',
            'targetId',
          ],
          properties: {
            requestId: {
              type: 'string',
              format: 'uuid',
              description:
                'Retry identity only; it conveys no execution authority.',
            },
            actionCategory: {
              type: 'string',
              enum: [
                'CONVERSATION',
                'PLATFORM_EVENT',
                'AUTHORITY_INCREASING_CONTROL',
                'TASK_MONITOR',
                'CLI_READ',
                'APPLICATION_EFFECT',
                'EXACT_ACTION',
              ],
            },
            actionType: {
              type: 'string',
              enum: [
                'CONVERSATION_TRIGGER',
                'PLATFORM_EVENT_TRIGGER',
                'CONVERSATION_CONTROL_COMPACT_RUN',
                'CONVERSATION_CONTROL_PERMISSION_DECISION',
                'TASK_MONITOR_START',
                'TASK_MONITOR_RESUME',
                'TASK_MONITOR_JUDGMENT_RESOLVED',
                'TASK_MONITOR_CONTINUE',
                'TASK_MONITOR_COMPLETE',
                'CLI_READ',
                'APPLICATION_EFFECT_LAUNCH',
                'EXACT_ACTION_DELIVERY',
              ],
              description:
                'Exhaustive authority-increasing or host-observing vocabulary. Reductions are deliberately excluded and classified separately.',
            },
            targetKind: {
              type: 'string',
              enum: ['CONVERSATION'],
            },
            targetId: {
              type: 'string',
              format: 'uuid',
              description:
                'Selection hint only. The server resolves and authorizes the canonical target instead of copying browser scope into the intent.',
            },
            inputs: {
              $ref: '#/definitions/ControllerActionInputs',
            },
          },
          description:
            'Closed selector for a non-revisioned conversation action. Conversation authorization is bound to target identity and the immutable operation fingerprint instead of a mutable conversation counter.',
        },
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'requestId',
            'actionCategory',
            'actionType',
            'targetKind',
            'targetId',
          ],
          properties: {
            requestId: {
              type: 'string',
              format: 'uuid',
              description:
                'Retry identity only; it conveys no execution authority.',
            },
            actionCategory: {
              $ref: '#/definitions/HostActionPreparation/oneOf/0/properties/actionCategory',
            },
            actionType: {
              $ref: '#/definitions/HostActionPreparation/oneOf/0/properties/actionType',
            },
            targetKind: {
              type: 'string',
              enum: ['AGENT_SESSION'],
            },
            targetId: {
              type: 'string',
              format: 'uuid',
              description:
                'Selection hint only. The server resolves and authorizes the canonical target instead of copying browser scope into the intent.',
            },
            inputs: {
              $ref: '#/definitions/ControllerActionInputs',
            },
          },
          description:
            'Preparation for a non-revisioned Agent Session action. Direct actions bind target identity and complete semantic inputs, independently of delivery framing and mutable conversation counters.',
        },
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'requestId',
            'actionCategory',
            'actionType',
            'targetKind',
            'targetId',
          ],
          properties: {
            requestId: {
              type: 'string',
              format: 'uuid',
              description:
                'Retry identity only; it conveys no execution authority.',
            },
            actionCategory: {
              $ref: '#/definitions/HostActionPreparation/oneOf/0/properties/actionCategory',
            },
            actionType: {
              $ref: '#/definitions/HostActionPreparation/oneOf/0/properties/actionType',
            },
            targetKind: {
              type: 'string',
              enum: ['TASK_MONITOR'],
            },
            targetId: {
              type: 'string',
              format: 'uuid',
              description:
                'Selection hint only. The server resolves and authorizes the canonical target instead of copying browser scope into the intent.',
            },
            inputs: {
              $ref: '#/definitions/ControllerActionInputs',
            },
          },
          description:
            'Preparation for a Task Monitor machine action. Authorization binds the complete typed command and Task Monitor identity; the CLI evaluates the command against its own durable snapshot and internal revision.',
        },
        {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: [
                'requestId',
                'actionCategory',
                'actionType',
                'targetKind',
                'targetId',
                'provider',
                'catalogContext',
              ],
              properties: {
                requestId: {
                  type: 'string',
                  format: 'uuid',
                },
                actionCategory: {
                  type: 'string',
                  enum: ['CLI_READ'],
                },
                actionType: {
                  type: 'string',
                  enum: ['CLI_READ'],
                },
                targetKind: {
                  type: 'string',
                  enum: ['CLI_READ'],
                },
                targetId: {
                  type: 'string',
                  format: 'uuid',
                  description:
                    'Durable selected machine identity, never a request correlation identity.',
                },
                provider: {
                  $ref: '#/definitions/AgentSkillProvider',
                },
                catalogContext: {
                  $ref: '#/definitions/AgentSkillCatalogContext',
                },
              },
              description:
                'Exact machine-addressed workspace Skill catalog read under existing CLI_READ authority.',
            },
            {
              type: 'object',
              additionalProperties: false,
              required: [
                'requestId',
                'actionCategory',
                'actionType',
                'targetKind',
                'targetId',
              ],
              properties: {
                requestId: {
                  type: 'string',
                  format: 'uuid',
                },
                actionCategory: {
                  type: 'string',
                  enum: ['CLI_READ'],
                },
                actionType: {
                  type: 'string',
                  enum: ['CLI_READ'],
                },
                targetKind: {
                  type: 'string',
                  enum: ['CLI_READ'],
                },
                targetId: {
                  type: 'string',
                  format: 'uuid',
                  description:
                    'Durable selected machine identity, never a request correlation identity.',
                },
              },
              description:
                'Exact machine-addressed model catalog read under existing CLI_READ authority.',
            },
          ],
          description:
            'Closed selector for a machine-addressed CLI read under existing CLI_READ authority.',
        },
      ],
      description:
        'Preparation for a server-resolved action. Direct actions carry complete typed execution or disclosure inputs. Account, organization, project, payload hash, authorization ID, nonce, and lifetime remain server-owned.',
      'x-heyhey-target-kind-by-action': {
        CONVERSATION_TRIGGER: 'AGENT_SESSION',
        PLATFORM_EVENT_TRIGGER: 'PLATFORM_EVENT',
        CONVERSATION_CONTROL_COMPACT_RUN: 'AGENT_SESSION',
        CONVERSATION_CONTROL_PERMISSION_DECISION: 'AGENT_SESSION',
        TASK_MONITOR_START: 'TASK_MONITOR',
        TASK_MONITOR_RESUME: 'TASK_MONITOR',
        TASK_MONITOR_JUDGMENT_RESOLVED: 'TASK_MONITOR',
        TASK_MONITOR_CONTINUE: 'TASK_MONITOR',
        TASK_MONITOR_COMPLETE: 'TASK_MONITOR',
        CLI_READ: ['AGENT_SESSION', 'CLI_READ'],
        APPLICATION_EFFECT_LAUNCH: 'APPLICATION_EFFECT',
        EXACT_ACTION_DELIVERY: 'EXACT_ACTION',
      },
    },
    ControllerActionInputs: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'body'],
          properties: {
            kind: {
              type: 'string',
              enum: ['CLI_READ'],
            },
            body: {
              oneOf: [
                {
                  type: 'object',
                  required: [
                    'requestId',
                    'agentSessionId',
                    'operation',
                    'runId',
                  ],
                  properties: {
                    requestId: {
                      type: 'string',
                      format: 'uuid',
                      description:
                        'Correlation identity minted by the platform for this read.',
                    },
                    agentSessionId: {
                      type: 'string',
                      format: 'uuid',
                      description:
                        'Canonical Agent Session authorization target.',
                    },
                    operation: {
                      type: 'string',
                      enum: ['run.changed_files.count'],
                    },
                    runId: {
                      type: 'string',
                      format: 'uuid',
                      description:
                        'Persisted CLI Run identity to prepare and read.',
                    },
                  },
                  additionalProperties: false,
                },
                {
                  $ref: '#/definitions/CliReadRunChangedFilesInventoryEnvelopeBody',
                },
                {
                  $ref: '#/definitions/CliReadRunChangedFileDetailEnvelopeBody',
                },
                {
                  $ref: '#/definitions/CliReadRunContextUsageGetEnvelopeBody',
                },
                {
                  $ref: '#/definitions/CliReadRunSkillsListEnvelopeBody',
                },
                {
                  $ref: '#/definitions/CliReadRunToolCallsLatestTurnEnvelopeBody',
                },
                {
                  $ref: '#/definitions/CliReadWorkspaceSkillsListEnvelopeBody',
                },
                {
                  type: 'object',
                  required: [
                    'requestId',
                    'agentSessionId',
                    'operation',
                    'projectId',
                    'limit',
                  ],
                  properties: {
                    requestId: {
                      type: 'string',
                      format: 'uuid',
                      description:
                        'Correlation identity minted by the platform for this read.',
                    },
                    agentSessionId: {
                      type: 'string',
                      format: 'uuid',
                      description:
                        'Canonical Agent Session authorization target.',
                    },
                    operation: {
                      type: 'string',
                      enum: ['project.session_costs.list'],
                    },
                    projectId: {
                      type: 'string',
                      format: 'uuid',
                    },
                    activityFrom: {
                      type: 'string',
                      format: 'date-time',
                    },
                    activityTo: {
                      type: 'string',
                      format: 'date-time',
                    },
                    minKnownCostUsd: {
                      type: 'number',
                      minimum: 0,
                    },
                    limit: {
                      type: 'integer',
                      format: 'int32',
                      minimum: 1,
                      maximum: 100,
                    },
                    cursor: {
                      type: ['string', 'null'],
                      minLength: 1,
                    },
                  },
                  additionalProperties: false,
                },
                {
                  $ref: '#/definitions/CliReadProviderUsageGetEnvelopeBody',
                },
                {
                  $ref: '#/definitions/CliReadRuntimeModelCatalogGetEnvelopeBody',
                },
              ],
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'body'],
          properties: {
            kind: {
              type: 'string',
              enum: ['CONTROL'],
            },
            body: {
              oneOf: [
                {
                  type: 'object',
                  required: [
                    'kind',
                    'agentSessionId',
                    'conversationId',
                    'runId',
                  ],
                  properties: {
                    kind: {
                      type: 'string',
                      enum: ['compact_run'],
                      description:
                        'Discriminator for the compact-run control. Selects the dispatcher branch that compacts the conversation history of the addressed Run.',
                    },
                    agentSessionId: {
                      type: 'string',
                      format: 'uuid',
                      description:
                        'Canonical Agent Session authorization target.',
                    },
                    conversationId: {
                      $ref: '#/definitions/ConversationControlStopRun/properties/conversationId',
                    },
                    runId: {
                      type: 'string',
                      format: 'uuid',
                      description:
                        "Agentic-session id of the live CLI Run to compact. The dispatcher uses the `conversationId` to locate the active Run binding and verifies the binding's runId matches before invoking the compaction path.",
                      example: '550e8400-e29b-41d4-a716-446655440099',
                    },
                  },
                  additionalProperties: false,
                  description:
                    'Structural control body for compacting a CLI Run owned by the conversation. Carries entity IDs only: no free-form text, prompt fragment, or `payload` escape hatch. The CLI dispatcher resolves the Run via `conversationId` and invokes the compaction path on the addressed Run.',
                },
                {
                  type: 'object',
                  required: [
                    'kind',
                    'agentSessionId',
                    'decision',
                    'requestId',
                    'sessionId',
                    'agentType',
                    'idempotencyToken',
                  ],
                  properties: {
                    kind: {
                      type: 'string',
                      enum: ['permission_decision'],
                      description:
                        "Discriminator for the permission-decision control. Selects the dispatcher branch that delivers the user's permission decision to the live runner awaiting the gate.",
                    },
                    agentSessionId: {
                      type: 'string',
                      format: 'uuid',
                      description:
                        'Canonical Agent Session authorization target.',
                    },
                    decision: {
                      type: 'string',
                      enum: ['approve', 'always_approve', 'deny', 'whitelist'],
                      description:
                        "The user's approval decision for the pending permission request.",
                    },
                    requestId: {
                      type: 'string',
                      minLength: 1,
                      description:
                        'Stable identifier for the permission request this decision responds to. The CLI dispatcher uses this to locate the awaiting runner.',
                    },
                    sessionId: {
                      type: 'string',
                      minLength: 1,
                      description:
                        'Provider session identifier. Together with `agentType`, uniquely identifies the agent session holding the permission gate.',
                    },
                    agentType: {
                      type: 'string',
                      enum: ['claude', 'codex', 'opencode'],
                      description:
                        'Agent provider that issued the permission request.',
                    },
                    reason: {
                      type: ['string', 'null'],
                      description:
                        'User-supplied explanation for the decision, rendered alongside the Approved/Denied message in CLI output.',
                    },
                    idempotencyToken: {
                      type: 'string',
                      minLength: 1,
                      description:
                        'Stable token for deduplicating delivery of this decision. The CLI discards duplicate frames that arrive from re-sends.',
                    },
                  },
                  additionalProperties: false,
                  description:
                    'Structural control body for delivering a user permission decision to a live CLI runner awaiting a permission gate. Carries the decision payload and matching identifiers only: no free-form prompt fragment or `payload` escape hatch. The CLI dispatcher matches the frame to the awaiting runner via `requestId`, `sessionId`, and `agentType`, then unblocks the gate with the received `decision`.',
                },
                {
                  $ref: '#/definitions/ConversationControlQuestionAnswer',
                },
              ],
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'command'],
          properties: {
            kind: {
              type: 'string',
              enum: ['TASK_MONITOR'],
            },
            command: {
              $ref: '#/definitions/SignedMonitorCommandEnvelope/allOf/1/properties/event/properties/command',
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'payload'],
          properties: {
            kind: {
              type: 'string',
              enum: ['START_RUN'],
            },
            payload: {
              $ref: '#/definitions/StartRunPromptPayload',
            },
            admittedServiceScope: {
              type: 'object',
              required: ['serviceIds', 'launchServiceId'],
              additionalProperties: false,
              description:
                'Complete ordered Service scope admitted by the authenticated USER-message operation. The first Service becomes launchServiceId when the Agent Session had no launch anchor; an existing anchor is preserved. The CLI reconciles this durable grant into Run-owned workspace authority before the next Turn. A non-null launchServiceId is a member of serviceIds.',
              properties: {
                serviceIds: {
                  type: 'array',
                  items: {
                    type: 'string',
                    format: 'uuid',
                  },
                },
                launchServiceId: {
                  type: ['string', 'null'],
                  format: 'uuid',
                },
              },
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'payload'],
          properties: {
            kind: {
              type: 'string',
              enum: ['USER_MESSAGE'],
            },
            payload: {
              $ref: '#/definitions/UserMessagePromptPayload',
            },
            admittedServiceScope: {
              $ref: '#/definitions/ControllerActionInputs/oneOf/3/properties/admittedServiceScope',
            },
          },
        },
      ],
      description:
        'Complete typed semantic inputs for a direct action. Approval and local admission use the same definition. Authorization and platform signatures are never inputs. Correlation-only fields are removed by the shared canonicalizer; operation parameters and ordered arrays remain bound.',
    },
    CliReadRunChangedFilesInventoryEnvelopeBody: {
      type: 'object',
      required: ['requestId', 'agentSessionId', 'operation', 'runId'],
      properties: {
        requestId: {
          type: 'string',
          format: 'uuid',
          description:
            'Correlation identity minted by the platform for this read.',
        },
        agentSessionId: {
          type: 'string',
          format: 'uuid',
          description: 'Canonical Agent Session authorization target.',
        },
        operation: {
          type: 'string',
          enum: ['run.changed_files.inventory'],
        },
        runId: {
          type: 'string',
          format: 'uuid',
          description:
            'Persisted CLI Run identity whose content-free changed-file inventory is requested.',
        },
      },
      additionalProperties: false,
    },
    CliReadRunChangedFileDetailEnvelopeBody: {
      type: 'object',
      required: ['requestId', 'agentSessionId', 'operation', 'runId', 'file'],
      properties: {
        requestId: {
          type: 'string',
          format: 'uuid',
          description:
            'Correlation identity minted by the platform for this read.',
        },
        agentSessionId: {
          type: 'string',
          format: 'uuid',
          description: 'Canonical Agent Session authorization target.',
        },
        operation: {
          type: 'string',
          enum: ['run.changed_files.detail'],
        },
        runId: {
          type: 'string',
          format: 'uuid',
          description:
            'Persisted CLI Run identity whose selected changed file is requested.',
        },
        file: {
          $ref: '#/definitions/CliReadChangedFileIdentity',
        },
      },
      additionalProperties: false,
    },
    CliReadChangedFileIdentity: {
      type: 'object',
      required: ['serviceId', 'repoPath', 'filePath'],
      properties: {
        serviceId: {
          type: 'string',
          format: 'uuid',
        },
        repoPath: {
          type: 'string',
          maxLength: 4096,
        },
        filePath: {
          type: 'string',
          maxLength: 4096,
        },
      },
      additionalProperties: false,
    },
    CliReadRunContextUsageGetEnvelopeBody: {
      type: 'object',
      required: ['requestId', 'agentSessionId', 'operation', 'runId'],
      properties: {
        requestId: {
          type: 'string',
          format: 'uuid',
          description:
            'Correlation identity minted by the platform for this read.',
        },
        agentSessionId: {
          type: 'string',
          format: 'uuid',
          description: 'Canonical Agent Session authorization target.',
        },
        operation: {
          type: 'string',
          enum: ['run.context_usage.get'],
        },
        runId: {
          type: 'string',
          format: 'uuid',
        },
        providerSessionId: {
          type: 'string',
          minLength: 1,
        },
      },
      additionalProperties: false,
    },
    CliReadRunSkillsListEnvelopeBody: {
      type: 'object',
      required: ['requestId', 'agentSessionId', 'operation', 'runId'],
      properties: {
        requestId: {
          type: 'string',
          format: 'uuid',
          description:
            'Correlation identity minted by the platform for this read.',
        },
        agentSessionId: {
          type: 'string',
          format: 'uuid',
          description: 'Canonical Agent Session authorization target.',
        },
        operation: {
          type: 'string',
          enum: ['run.skills.list'],
        },
        runId: {
          type: 'string',
          format: 'uuid',
          description:
            'Persisted CLI Run identity whose provider Skill catalog is requested.',
        },
      },
      additionalProperties: false,
    },
    CliReadRunToolCallsLatestTurnEnvelopeBody: {
      type: 'object',
      required: ['requestId', 'agentSessionId', 'operation', 'runId'],
      properties: {
        requestId: {
          type: 'string',
          format: 'uuid',
          description:
            'Correlation identity minted by the platform for this read.',
        },
        agentSessionId: {
          type: 'string',
          format: 'uuid',
          description: 'Canonical Agent Session authorization target.',
        },
        operation: {
          type: 'string',
          enum: ['run.tool_calls.latest_turn'],
        },
        runId: {
          type: 'string',
          format: 'uuid',
          description:
            "Persisted CLI Run identity whose latest Turn's tool calls are requested.",
        },
      },
      additionalProperties: false,
    },
    CliReadWorkspaceSkillsListEnvelopeBody: {
      type: 'object',
      required: [
        'requestId',
        'operation',
        'provider',
        'catalogContext',
        'organizationId',
        'projectId',
        'machineId',
        'authorizationRequestId',
      ],
      properties: {
        requestId: {
          type: 'string',
          format: 'uuid',
          description:
            'Correlation identity minted by the platform for this read.',
        },
        operation: {
          type: 'string',
          enum: ['workspace.skills.list'],
        },
        provider: {
          $ref: '#/definitions/AgentSkillProvider',
        },
        catalogContext: {
          $ref: '#/definitions/AgentSkillCatalogContext',
        },
        organizationId: {
          type: 'string',
          format: 'uuid',
        },
        projectId: {
          type: 'string',
          format: 'uuid',
        },
        machineId: {
          type: 'string',
          format: 'uuid',
        },
        authorizationRequestId: {
          type: 'string',
          format: 'uuid',
        },
      },
      additionalProperties: false,
    },
    AgentSkillProvider: {
      type: 'string',
      enum: ['claude', 'codex', 'opencode'],
    },
    AgentSkillCatalogContext: {
      oneOf: [
        {
          $ref: '#/definitions/AgentSkillNonRepositoryCatalogContext',
        },
        {
          $ref: '#/definitions/AgentSkillServiceCatalogContext',
        },
      ],
    },
    AgentSkillNonRepositoryCatalogContext: {
      type: 'object',
      additionalProperties: false,
      required: ['policy'],
      properties: {
        policy: {
          type: 'string',
          enum: ['non_repository'],
        },
      },
    },
    AgentSkillServiceCatalogContext: {
      type: 'object',
      additionalProperties: false,
      required: ['policy', 'serviceId'],
      properties: {
        policy: {
          type: 'string',
          enum: ['service_workspace'],
        },
        serviceId: {
          type: 'string',
          format: 'uuid',
        },
      },
    },
    CliReadProviderUsageGetEnvelopeBody: {
      type: 'object',
      required: ['requestId', 'agentSessionId', 'operation'],
      properties: {
        requestId: {
          type: 'string',
          format: 'uuid',
          description:
            'Correlation identity minted by the platform for this read.',
        },
        agentSessionId: {
          type: 'string',
          format: 'uuid',
          description: 'Canonical Agent Session authorization target.',
        },
        operation: {
          type: 'string',
          enum: ['provider.usage.get'],
        },
      },
      additionalProperties: false,
    },
    CliReadRuntimeModelCatalogGetEnvelopeBody: {
      type: 'object',
      required: [
        'requestId',
        'operation',
        'organizationId',
        'projectId',
        'machineId',
        'authorizationRequestId',
      ],
      properties: {
        requestId: {
          type: 'string',
          format: 'uuid',
          description:
            'Correlation identity minted by the platform for this read.',
        },
        operation: {
          type: 'string',
          enum: ['runtime.model_catalog.get'],
        },
        organizationId: {
          type: 'string',
          format: 'uuid',
        },
        projectId: {
          type: 'string',
          format: 'uuid',
        },
        machineId: {
          type: 'string',
          format: 'uuid',
        },
        authorizationRequestId: {
          type: 'string',
          format: 'uuid',
        },
      },
      additionalProperties: false,
    },
    ConversationControlStopRun: {
      type: 'object',
      required: ['kind', 'conversationId', 'runId'],
      properties: {
        kind: {
          type: 'string',
          enum: ['stop_run'],
          description:
            'Discriminator for the stop-run control. Selects the dispatcher branch that aborts the active Turn on the addressed Run.',
        },
        conversationId: {
          type: 'string',
          pattern:
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          description: 'Unique identifier for a conversation (branded type)',
          example: '550e8400-e29b-41d4-a716-446655440003',
          'x-typescript-type': 'ConversationId',
          'x-brand': 'ConversationId',
          'x-semantic-type': 'resource-identifier',
        },
        runId: {
          type: 'string',
          format: 'uuid',
          description:
            "Agentic-session id of the CLI Run to stop. The dispatcher uses the `conversationId` to locate the active Run binding and verifies the binding's runId matches before invoking the stop path.",
          example: '550e8400-e29b-41d4-a716-446655440099',
        },
      },
      additionalProperties: false,
      description:
        'Structural control body for stopping a CLI Run owned by the conversation. Carries entity IDs only: no free-form text, prompt fragment, or `payload` escape hatch. The CLI dispatcher resolves the Run via `conversationId` and calls the run-service stop path — idempotent on the absent / already-stopped cases.',
    },
    ConversationControlQuestionAnswer: {
      type: 'object',
      required: [
        'kind',
        'agentSessionId',
        'requestId',
        'sessionId',
        'agentType',
        'answers',
        'idempotencyToken',
      ],
      properties: {
        kind: {
          type: 'string',
          enum: ['question_answer'],
        },
        agentSessionId: {
          type: 'string',
          format: 'uuid',
          description: 'Canonical Agent Session authorization target.',
        },
        requestId: {
          type: 'string',
          minLength: 1,
          description:
            'Identifier of the agent question this answer responds to. The CLI dispatcher uses this to locate the waiting tool call.',
        },
        sessionId: {
          type: 'string',
          minLength: 1,
        },
        agentType: {
          type: 'string',
          enum: ['claude', 'codex', 'opencode'],
        },
        answers: {
          type: 'object',
          additionalProperties: {
            type: 'string',
          },
          description:
            'Answer per question, keyed by question text. Multi-select answers are the chosen labels joined by ", ".',
        },
        idempotencyToken: {
          type: 'string',
          minLength: 1,
          description:
            'Stable token for deduplicating delivery of this answer. The CLI discards duplicate frames that arrive from re-sends.',
        },
      },
      additionalProperties: false,
      description:
        "Structural control body delivering a user's answers to a live CLI runner whose question tool call (Claude `AskUserQuestion`) is waiting.",
    },
    SignedMonitorCommandEnvelope: {
      allOf: [
        {
          $ref: '#/definitions/SignedEnvelopeFields',
        },
        {
          type: 'object',
          required: ['event'],
          properties: {
            event: {
              type: 'object',
              additionalProperties: false,
              required: [
                'version',
                'kind',
                'commandId',
                'createdAt',
                'expiresAt',
                'organizationId',
                'projectId',
                'target',
                'command',
              ],
              properties: {
                version: {
                  type: 'integer',
                  enum: [1],
                },
                kind: {
                  type: 'string',
                  enum: ['task_monitor_command'],
                },
                commandId: {
                  type: 'string',
                  format: 'uuid',
                  description:
                    'Durable command, idempotency, acknowledgement, and log correlation identity.',
                },
                createdAt: {
                  type: 'string',
                  format: 'date-time',
                },
                expiresAt: {
                  type: 'string',
                  format: 'date-time',
                },
                organizationId: {
                  type: 'string',
                  format: 'uuid',
                },
                projectId: {
                  type: 'string',
                  format: 'uuid',
                },
                target: {
                  $ref: '#/definitions/SignedMonitorAuthorityNeutralEnvelope/properties/event/properties/target',
                },
                command: {
                  oneOf: [
                    {
                      $ref: '#/definitions/ControllerAuthorizedSignedMonitorCommandEnvelope/properties/event/properties/command/oneOf/0',
                    },
                    {
                      type: 'object',
                      additionalProperties: false,
                      required: ['cause'],
                      properties: {
                        cause: {
                          type: 'string',
                          enum: ['PAUSE'],
                        },
                      },
                    },
                    {
                      $ref: '#/definitions/ControllerAuthorizedSignedMonitorCommandEnvelope/properties/event/properties/command/oneOf/1',
                    },
                    {
                      $ref: '#/definitions/SignedMonitorAuthorityNeutralEnvelope/properties/event/properties/command/oneOf/0',
                    },
                    {
                      $ref: '#/definitions/SignedMonitorAuthorityNeutralEnvelope/properties/event/properties/command/oneOf/1',
                    },
                    {
                      type: 'object',
                      additionalProperties: false,
                      required: ['cause'],
                      properties: {
                        cause: {
                          type: 'string',
                          enum: ['STOP'],
                        },
                      },
                    },
                    {
                      $ref: '#/definitions/ControllerAuthorizedSignedMonitorCommandEnvelope/properties/event/properties/command/oneOf/2',
                    },
                    {
                      $ref: '#/definitions/ControllerAuthorizedSignedMonitorCommandEnvelope/properties/event/properties/command/oneOf/3',
                    },
                    {
                      $ref: '#/definitions/ControllerAuthorizedSignedMonitorCommandEnvelope/properties/event/properties/command/oneOf/4',
                    },
                    {
                      type: 'object',
                      additionalProperties: false,
                      required: ['cause'],
                      properties: {
                        cause: {
                          type: 'string',
                          enum: ['HALT'],
                        },
                      },
                    },
                  ],
                  description:
                    'Closed union of user-authored Task Monitor lifecycle commands. Automated progression is driven by canonical report and Agent Session lifecycle events.',
                },
              },
              description:
                'Complete signed monitor command. It deliberately contains no Run, conversation, agent-session, handler, or internal declaration identity.',
            },
          },
        },
      ],
      description:
        'Server-signed envelope wrapping the complete explicit monitor command. Every routing and execution field is inside `event` and therefore covered by the signature canonicalization contract in `SignedEnvelopeFields`.',
    },
    SignedEnvelopeFields: {
      type: 'object',
      required: ['machineId', 'userId', 'nonce', 'timestampMs', 'signature'],
      properties: {
        machineId: {
          type: 'string',
          pattern:
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          description: 'Unique identifier for a paired machine (branded type)',
          example: '550e8400-e29b-41d4-a716-446655440030',
          'x-typescript-type': 'MachineId',
          'x-brand': 'MachineId',
          'x-semantic-type': 'resource-identifier',
        },
        userId: {
          type: 'string',
          pattern:
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          description: 'Unique identifier for a user (branded type)',
          example: '550e8400-e29b-41d4-a716-446655440001',
          'x-typescript-type': 'UserId',
          'x-brand': 'UserId',
          'x-semantic-type': 'resource-identifier',
        },
        nonce: {
          type: 'string',
          format: 'uuid',
          description:
            'Random UUID minted by the server per envelope. The CLI rejects an envelope whose nonce it has already seen within the freshness window, defeating replay of a captured envelope.',
          example: '550e8400-e29b-41d4-a716-446655440099',
        },
        timestampMs: {
          type: 'integer',
          format: 'int64',
          description:
            'Unix epoch milliseconds at which the server signed the envelope. The CLI rejects an envelope whose timestamp is outside ±30s of local time, bounding the replay window.',
          example: 1747920000000,
        },
        signature: {
          type: 'string',
          description:
            "Base64-encoded Ed25519 signature produced with the server's private signing key, covering the canonical byte string defined below. The CLI verifies it against the server public signing key delivered at machine pairing.",
          example: 'k7wQ2k1m...base64-ed25519-signature...==',
        },
      },
      description:
        'The shared security core composed (via `allOf`) into legacy and protocol-2 signed envelopes. Carries machine/owner binding (`machineId`, `userId`), replay protection (`nonce`, `timestampMs`), and the server `signature`. Each concrete envelope adds one `event` field carrying its body; protocol-2 executable envelopes additionally add `protocolVersion` and the shared closed authorization union. Its activation arm carries fresh assertion evidence plus the complete immutable descriptor; its reuse arm carries only the active grant reference. The CLI runs the ordered verification pipeline (schema validation → signature → machineId → userId → timestamp → nonce → frame-type/kind allowlist) and silently drops any envelope that fails; an unknown field rejects the whole frame.\n\n## Signature canonicalization contract\n\nThe server signer and the CLI verifier MUST canonicalize identical bytes. The signed message is the UTF-8 encoding of the RFC 8785 (JSON Canonicalization Scheme) serialization of the envelope with the `signature` property removed. For a legacy envelope that object is `{ event, machineId, userId, nonce, timestampMs }`; for a protocol-2 executable envelope it is `{ authorization, event, machineId, nonce, protocolVersion, timestampMs, userId }`. RFC 8785 fixes object key ordering (lexicographic by UTF-16 code unit), number formatting, and string escaping, so the trigger body and the four binding fields serialize to one deterministic byte string on both sides. The server signs those bytes with its Ed25519 private key; the CLI reconstructs the same object from the received envelope (dropping `signature`), canonicalizes it identically, and verifies. The signature therefore covers every concrete-envelope property except `signature`. For protocol 2 this explicitly includes the complete authorization union, protocol version, event body, and all binding fields; tampering with any of them invalidates it. Outer WebSocketEvent routing fields are not signed.',
    },
    SignedMonitorAuthorityNeutralEnvelope: {
      type: 'object',
      additionalProperties: false,
      required: [
        'machineId',
        'userId',
        'nonce',
        'timestampMs',
        'signature',
        'protocolVersion',
        'event',
      ],
      properties: {
        machineId: {
          $ref: '#/definitions/SignedEnvelopeFields/properties/machineId',
        },
        userId: {
          $ref: '#/definitions/SignedEnvelopeFields/properties/userId',
        },
        nonce: {
          type: 'string',
          format: 'uuid',
        },
        timestampMs: {
          type: 'integer',
          format: 'int64',
        },
        signature: {
          type: 'string',
        },
        protocolVersion: {
          type: 'integer',
          enum: [2],
        },
        event: {
          type: 'object',
          additionalProperties: false,
          required: [
            'version',
            'kind',
            'commandId',
            'createdAt',
            'expiresAt',
            'organizationId',
            'projectId',
            'target',
            'command',
          ],
          properties: {
            version: {
              type: 'integer',
              enum: [2],
            },
            kind: {
              type: 'string',
              enum: ['task_monitor_authority_neutral'],
            },
            commandId: {
              type: 'string',
              format: 'uuid',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
            expiresAt: {
              type: 'string',
              format: 'date-time',
            },
            organizationId: {
              type: 'string',
              format: 'uuid',
            },
            projectId: {
              type: 'string',
              format: 'uuid',
            },
            target: {
              type: 'object',
              additionalProperties: false,
              required: ['workItemType', 'workItemId'],
              properties: {
                workItemType: {
                  type: 'string',
                  enum: ['TASK_MONITOR'],
                },
                workItemId: {
                  type: 'string',
                  format: 'uuid',
                },
              },
            },
            command: {
              oneOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['cause', 'guidance'],
                  properties: {
                    cause: {
                      type: 'string',
                      enum: ['GUIDANCE_CHANGED'],
                    },
                    guidance: {
                      type: 'string',
                      minLength: 1,
                      maxLength: 5000,
                    },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: [
                    'cause',
                    'interventionId',
                    'providerActionId',
                    'runId',
                    'agentSessionId',
                    'fingerprint',
                    'resolution',
                    'human',
                  ],
                  properties: {
                    cause: {
                      type: 'string',
                      enum: ['HUMAN_DECISION'],
                    },
                    interventionId: {
                      type: 'string',
                      format: 'uuid',
                    },
                    providerActionId: {
                      type: 'string',
                      minLength: 1,
                    },
                    runId: {
                      type: 'string',
                      format: 'uuid',
                    },
                    agentSessionId: {
                      type: 'string',
                      format: 'uuid',
                    },
                    fingerprint: {
                      type: 'string',
                      minLength: 1,
                    },
                    resolution: {
                      type: 'string',
                      enum: ['APPROVE', 'DENY'],
                    },
                    human: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['userId', 'authenticatedAt'],
                      properties: {
                        userId: {
                          type: 'string',
                          format: 'uuid',
                        },
                        authenticatedAt: {
                          type: 'string',
                          format: 'date-time',
                        },
                      },
                    },
                  },
                },
              ],
              description:
                'Authenticated user input that advances Task Monitor-owned state without directly starting, resuming, or terminating host execution.',
            },
          },
          description:
            'Signed protocol-2 authenticated user input. It carries no controller execution authorization because it does not directly authorize host work.',
        },
      },
      description:
        'Protocol-2 authenticated Task Monitor input signed by the platform. It carries no controller execution authorization because admission cannot directly start, resume, or terminate host work.',
    },
    ControllerAuthorizedSignedMonitorCommandEnvelope: {
      type: 'object',
      additionalProperties: false,
      required: [
        'machineId',
        'userId',
        'nonce',
        'timestampMs',
        'signature',
        'protocolVersion',
        'authorization',
        'event',
      ],
      properties: {
        machineId: {
          $ref: '#/definitions/SignedEnvelopeFields/properties/machineId',
        },
        userId: {
          $ref: '#/definitions/SignedEnvelopeFields/properties/userId',
        },
        nonce: {
          type: 'string',
          format: 'uuid',
        },
        timestampMs: {
          type: 'integer',
          format: 'int64',
        },
        signature: {
          type: 'string',
        },
        protocolVersion: {
          type: 'integer',
          enum: [2],
        },
        authorization: {
          $ref: '#/definitions/ControllerAuthorizedSignedCliReadEnvelope/properties/authorization',
        },
        event: {
          type: 'object',
          additionalProperties: false,
          required: [
            'version',
            'kind',
            'commandId',
            'createdAt',
            'expiresAt',
            'organizationId',
            'projectId',
            'target',
            'command',
          ],
          properties: {
            version: {
              type: 'integer',
              enum: [2],
            },
            kind: {
              type: 'string',
              enum: ['task_monitor_command'],
            },
            commandId: {
              type: 'string',
              format: 'uuid',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
            expiresAt: {
              type: 'string',
              format: 'date-time',
            },
            organizationId: {
              type: 'string',
              format: 'uuid',
            },
            projectId: {
              type: 'string',
              format: 'uuid',
            },
            target: {
              $ref: '#/definitions/SignedMonitorAuthorityNeutralEnvelope/properties/event/properties/target',
            },
            command: {
              oneOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['cause', 'launchConfig'],
                  properties: {
                    cause: {
                      type: 'string',
                      enum: ['START'],
                    },
                    launchConfig: {
                      $ref: '#/definitions/TaskMonitorLaunchConfig',
                    },
                    userMessage: {
                      type: 'string',
                      maxLength: 5000,
                    },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['cause'],
                  properties: {
                    cause: {
                      type: 'string',
                      enum: ['RESUME'],
                    },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['cause', 'judgment'],
                  properties: {
                    cause: {
                      type: 'string',
                      enum: ['JUDGMENT_RESOLVED'],
                    },
                    judgment: {
                      $ref: '#/definitions/TaskMonitorJudgmentResponse',
                    },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['cause'],
                  properties: {
                    cause: {
                      type: 'string',
                      enum: ['CONTINUE'],
                    },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['cause'],
                  properties: {
                    cause: {
                      type: 'string',
                      enum: ['COMPLETE'],
                    },
                  },
                },
              ],
              description:
                'Closed protocol-2 command set that may start, resume, continue, redirect, or complete host work. Its signed executable envelope supplies exactly one fresh controller assertion or matching controller-device grant reference.',
            },
          },
          description:
            'Protocol-2 authority-increasing command. Authorization is a sibling of this event in the platform-signed executable envelope.',
        },
      },
    },
    ControllerAuthorizedSignedCliReadEnvelope: {
      type: 'object',
      additionalProperties: false,
      required: [
        'machineId',
        'userId',
        'nonce',
        'timestampMs',
        'signature',
        'protocolVersion',
        'authorization',
        'event',
      ],
      properties: {
        machineId: {
          $ref: '#/definitions/SignedEnvelopeFields/properties/machineId',
        },
        userId: {
          $ref: '#/definitions/SignedEnvelopeFields/properties/userId',
        },
        nonce: {
          type: 'string',
          format: 'uuid',
        },
        timestampMs: {
          type: 'integer',
          format: 'int64',
        },
        signature: {
          type: 'string',
        },
        protocolVersion: {
          type: 'integer',
          enum: [2],
        },
        authorization: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: [
                'kind',
                'intent',
                'credentialId',
                'clientDataJSON',
                'authenticatorData',
                'signature',
                'userHandle',
                'grantDescriptor',
                'grantId',
              ],
              properties: {
                kind: {
                  type: 'string',
                  enum: ['controller_assertion'],
                },
                intent: {
                  $ref: '#/definitions/CliReadRunSkillsListRequest/properties/authorization/oneOf/0/properties/intent',
                },
                credentialId: {
                  $ref: '#/definitions/CliReadRunSkillsListRequest/properties/authorization/oneOf/0/properties/credentialId',
                },
                clientDataJSON: {
                  type: 'string',
                  minLength: 1,
                  pattern: '^[A-Za-z0-9_-]+$',
                },
                authenticatorData: {
                  type: 'string',
                  minLength: 1,
                  pattern: '^[A-Za-z0-9_-]+$',
                },
                signature: {
                  type: 'string',
                  minLength: 1,
                  pattern: '^[A-Za-z0-9_-]+$',
                },
                userHandle: {
                  type: ['string', 'null'],
                  pattern: '^[A-Za-z0-9_-]+$',
                },
                grantDescriptor: {
                  $ref: '#/definitions/CliReadRunSkillsListRequest/properties/authorization/oneOf/0/properties/grantDescriptor',
                },
                grantId: {
                  type: 'string',
                  format: 'uuid',
                  description:
                    'Authoritative server-issued controller-device-window grant identifier.',
                },
              },
              description:
                'Post-admission activation evidence constructed by the API and carried inside a platform-signed executable envelope. The CLI independently verifies the assertion and immutable descriptor before installing reusable authority.',
            },
            {
              $ref: '#/definitions/CliReadRunSkillsListRequest/properties/authorization/oneOf/1',
            },
          ],
          description:
            'Closed two-arm union. Activation carries fresh assertion evidence plus the complete immutable descriptor; reuse carries only the active grant reference. Exactly one arm is required by every protocol-2 executable envelope.',
        },
        event: {
          $ref: '#/definitions/CliReadEnvelopeBody',
        },
      },
    },
    CliReadRunSkillsListRequest: {
      type: 'object',
      required: ['operation', 'runId', 'authorization'],
      properties: {
        operation: {
          type: 'string',
          enum: ['run.skills.list'],
        },
        runId: {
          type: 'string',
          format: 'uuid',
          description:
            'Persisted CLI Run identity whose provider Skill catalog is requested.',
        },
        authorization: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: [
                'kind',
                'intent',
                'credentialId',
                'clientDataJSON',
                'authenticatorData',
                'signature',
                'userHandle',
                'grantDescriptor',
              ],
              properties: {
                kind: {
                  type: 'string',
                  enum: ['controller_assertion'],
                },
                intent: {
                  type: 'object',
                  additionalProperties: false,
                  required: [
                    'version',
                    'authorizationId',
                    'controllerCredentialId',
                    'controllerInstallationId',
                    'machineId',
                    'userId',
                    'organizationId',
                    'projectId',
                    'cadence',
                    'policyRevision',
                    'effectiveGrantExpiresAtMs',
                    'grantDescriptorHash',
                    'actionCategory',
                    'actionType',
                    'actionPayloadHash',
                    'allowedActionTypes',
                    'allowedActionCategories',
                    'target',
                    'agentSessionId',
                    'taskMonitorId',
                    'nonce',
                    'issuedAtMs',
                    'expiresAtMs',
                  ],
                  properties: {
                    version: {
                      type: 'integer',
                      enum: [2],
                    },
                    authorizationId: {
                      type: 'string',
                      format: 'uuid',
                    },
                    controllerCredentialId: {
                      $ref: '#/definitions/CliReadRunSkillsListRequest/properties/authorization/oneOf/0/properties/credentialId',
                    },
                    controllerInstallationId: {
                      $ref: '#/definitions/CliReadRunSkillsListRequest/properties/authorization/oneOf/0/properties/grantDescriptor/properties/controllerInstallationId',
                      description:
                        'Stable identity for the prompting browser installation.',
                    },
                    machineId: {
                      $ref: '#/definitions/SignedEnvelopeFields/properties/machineId',
                    },
                    userId: {
                      $ref: '#/definitions/SignedEnvelopeFields/properties/userId',
                    },
                    organizationId: {
                      type: 'string',
                      pattern:
                        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
                      description:
                        'Unique identifier for an organization (branded type)',
                      example: '550e8400-e29b-41d4-a716-446655440002',
                      'x-typescript-type': 'OrganizationId',
                      'x-brand': 'OrganizationId',
                      'x-semantic-type': 'resource-identifier',
                    },
                    projectId: {
                      $ref: '#/definitions/WorkTrackerImportRequest/properties/projectId',
                    },
                    cadence: {
                      type: 'string',
                      enum: [
                        'FIVE_MINUTES',
                        'EIGHT_HOURS',
                        'ONE_DAY',
                        'ONE_WEEK',
                        'ONE_MONTH',
                      ],
                      description:
                        'Closed browser-requested reusable controller-device cadence. Each value derives one server-owned controller-device window with an effective expiry fixed by the selected cadence; assertion challenges remain independently single-use and valid for two minutes.',
                    },
                    policyRevision: {
                      type: 'integer',
                      format: 'int32',
                      minimum: 1,
                      description:
                        'Server-owned policy revision used to derive the grant scope.',
                    },
                    effectiveGrantExpiresAtMs: {
                      type: 'integer',
                      format: 'int64',
                      description:
                        'Server-computed controller-device grant expiry. This lifetime is independent from the two-minute, single-use WebAuthn challenge.',
                    },
                    grantDescriptorHash: {
                      type: 'string',
                      pattern: '^[a-f0-9]{64}$',
                      description:
                        'Lowercase SHA-256 of the complete immutable controller-device grant descriptor, including installation, machine, action set, policy, issue time, and effective expiry.',
                    },
                    actionCategory: {
                      $ref: '#/definitions/HostActionPreparation/oneOf/0/properties/actionCategory',
                    },
                    actionType: {
                      $ref: '#/definitions/HostActionPreparation/oneOf/0/properties/actionType',
                    },
                    actionPayloadHash: {
                      type: 'string',
                      pattern: '^[a-f0-9]{64}$',
                      description:
                        'Lowercase SHA-256 of the RFC 8785 canonical action payload, computed by the server from the resolved action and never supplied by the browser.',
                    },
                    allowedActionTypes: {
                      $ref: '#/definitions/CurrentAgentOperations',
                    },
                    allowedActionCategories: {
                      type: 'array',
                      minItems: 1,
                      maxItems: 7,
                      uniqueItems: true,
                      items: {
                        $ref: '#/definitions/HostActionPreparation/oneOf/0/properties/actionCategory',
                      },
                      description:
                        'Server-computed closed host-action class set carried in the canonical intent and repeated in the immutable grant descriptor.',
                    },
                    target: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['kind', 'id', 'revision'],
                      properties: {
                        kind: {
                          type: 'string',
                          enum: [
                            'CLI_READ',
                            'CONVERSATION',
                            'AGENT_SESSION',
                            'TASK_MONITOR',
                            'PLATFORM_EVENT',
                            'APPLICATION_EFFECT',
                            'EXACT_ACTION',
                          ],
                        },
                        id: {
                          type: 'string',
                          format: 'uuid',
                        },
                        revision: {
                          type: ['integer', 'null'],
                          format: 'int64',
                          minimum: 0,
                          description:
                            'Server-resolved revision, or null for targets without one.',
                        },
                      },
                    },
                    agentSessionId: {
                      type: ['string', 'null'],
                      format: 'uuid',
                    },
                    taskMonitorId: {
                      type: ['string', 'null'],
                      format: 'uuid',
                    },
                    nonce: {
                      type: 'string',
                      minLength: 43,
                      maxLength: 43,
                      pattern: '^[A-Za-z0-9_-]{43}$',
                      description:
                        'Base64url encoding of a server-generated 256-bit nonce.',
                    },
                    issuedAtMs: {
                      type: 'integer',
                      format: 'int64',
                    },
                    expiresAtMs: {
                      type: 'integer',
                      format: 'int64',
                      description:
                        'Unix epoch milliseconds exactly two minutes after issuance.',
                    },
                  },
                  description:
                    'Complete RFC 8785-canonical intent. The WebAuthn challenge is base64url SHA-256 over UTF-8 `heyhey-controller-authorization-v1`, one zero byte, and the RFC 8785 serialization of this object. Every field is server-authored or server-resolved and participates in the controller proof.',
                },
                credentialId: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 1024,
                  pattern: '^[A-Za-z0-9_-]+$',
                  description:
                    'Base64url WebAuthn controller credential identifier. This is never the internal MachineControllerCredential relational row ID.',
                },
                clientDataJSON: {
                  type: 'string',
                  minLength: 1,
                  pattern: '^[A-Za-z0-9_-]+$',
                },
                authenticatorData: {
                  type: 'string',
                  minLength: 1,
                  pattern: '^[A-Za-z0-9_-]+$',
                },
                signature: {
                  type: 'string',
                  minLength: 1,
                  pattern: '^[A-Za-z0-9_-]+$',
                },
                userHandle: {
                  type: ['string', 'null'],
                  pattern: '^[A-Za-z0-9_-]+$',
                },
                grantDescriptor: {
                  type: 'object',
                  additionalProperties: false,
                  required: [
                    'scope',
                    'controllerCredentialId',
                    'controllerInstallationId',
                    'machineId',
                    'userId',
                    'organizationId',
                    'cadence',
                    'policyRevision',
                    'allowedActionTypes',
                    'allowedActionCategories',
                    'issuedAtMs',
                    'effectiveExpiresAtMs',
                  ],
                  properties: {
                    scope: {
                      type: 'string',
                      enum: ['controller_device_window'],
                      description:
                        'Closed scope name for a reusable controller-device grant.',
                    },
                    controllerCredentialId: {
                      $ref: '#/definitions/CliReadRunSkillsListRequest/properties/authorization/oneOf/0/properties/credentialId',
                    },
                    controllerInstallationId: {
                      type: 'string',
                      format: 'uuid',
                      description:
                        'Server-owned stable identity for the passkey-prompting browser installation. It remains inside canonical and executable authorization evidence but is never supplied, returned, or persisted by browser JavaScript.',
                    },
                    machineId: {
                      $ref: '#/definitions/SignedEnvelopeFields/properties/machineId',
                    },
                    userId: {
                      $ref: '#/definitions/SignedEnvelopeFields/properties/userId',
                    },
                    organizationId: {
                      $ref: '#/definitions/CliReadRunSkillsListRequest/properties/authorization/oneOf/0/properties/intent/properties/organizationId',
                    },
                    cadence: {
                      $ref: '#/definitions/CliReadRunSkillsListRequest/properties/authorization/oneOf/0/properties/intent/properties/cadence',
                    },
                    policyRevision: {
                      type: 'integer',
                      format: 'int32',
                      minimum: 1,
                    },
                    allowedActionTypes: {
                      $ref: '#/definitions/CurrentAgentOperations',
                    },
                    allowedActionCategories: {
                      type: 'array',
                      minItems: 1,
                      maxItems: 7,
                      uniqueItems: true,
                      items: {
                        $ref: '#/definitions/HostActionPreparation/oneOf/0/properties/actionCategory',
                      },
                    },
                    issuedAtMs: {
                      type: 'integer',
                      format: 'int64',
                    },
                    effectiveExpiresAtMs: {
                      type: 'integer',
                      format: 'int64',
                    },
                  },
                  description:
                    'Immutable descriptor hashed by CanonicalControllerAuthorizationIntent.grantDescriptorHash. Every cadence creates one reusable controller-device window with this effective expiry.',
                },
              },
              description:
                'Fresh browser-submitted controller proof. It carries no server grant identifier. The API verifies and consumes this evidence before deriving or resolving any reusable grant and constructing executable activation evidence.',
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'grantId'],
              properties: {
                kind: {
                  type: 'string',
                  enum: ['bounded_grant'],
                },
                grantId: {
                  type: 'string',
                  format: 'uuid',
                },
              },
              description:
                'Reference-only reuse of an active server-admitted controller-device grant. All scope is resolved from persisted grant state; callers cannot widen it by supplying a target, action, machine, user, or expiry alongside the ID.',
            },
          ],
          description:
            'Closed API-admission union. A browser submits fresh assertion evidence without a grant identifier, or references an already active bounded grant. The API constructs the distinct executable activation arm after admission.',
        },
      },
      additionalProperties: false,
    },
    WorkTrackerImportRequest: {
      type: 'object',
      additionalProperties: false,
      required: [
        'projectId',
        'conversationId',
        'workflowId',
        'workflowNodeId',
        'machineId',
        'source',
        'provider',
        'resolvedFrontierModel',
        'reasoningEffort',
      ],
      properties: {
        promptType: {
          type: 'string',
          enum: ['work_tracker_connect', 'work_tracker_import'],
        },
        projectId: {
          type: 'string',
          pattern:
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          description: 'Unique identifier for a project (branded type)',
          example: '550e8400-e29b-41d4-a716-446655440000',
          'x-typescript-type': 'ProjectId',
          'x-brand': 'ProjectId',
          'x-semantic-type': 'resource-identifier',
        },
        conversationId: {
          $ref: '#/definitions/ConversationControlStopRun/properties/conversationId',
        },
        workflowId: {
          type: 'string',
          description: 'Unique identifier for a workflow (branded type)',
          example: '550e8400-e29b-41d4-a716-446655440004',
          'x-typescript-type': 'WorkflowId',
          'x-brand': 'WorkflowId',
          'x-semantic-type': 'resource-identifier',
        },
        workflowNodeId: {
          type: 'string',
          minLength: 1,
        },
        machineId: {
          $ref: '#/definitions/SignedEnvelopeFields/properties/machineId',
        },
        source: {
          type: 'string',
          enum: ['jira', 'linear'],
        },
        provider: {
          type: 'string',
          enum: ['claude', 'codex'],
        },
        resolvedFrontierModel: {
          type: 'string',
          minLength: 1,
        },
        reasoningEffort: {
          type: 'string',
          enum: [
            'none',
            'minimal',
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
            'ultra',
            'default',
          ],
        },
        fastMode: {
          type: 'boolean',
        },
        connectionConfirmed: {
          type: 'boolean',
          description:
            'Server-recorded explicit user confirmation; never inferred from agent output.',
        },
      },
      description:
        'Accepted runtime and source choices, without credentials or a Service binding.',
    },
    CurrentAgentOperations: {
      type: 'array',
      minItems: 12,
      maxItems: 12,
      uniqueItems: true,
      items: {
        $ref: '#/definitions/CurrentAgentOperation',
      },
      description:
        'Exact generated current-operation bundle carried by controller-device grants. All twelve values are required exactly once.',
    },
    CurrentAgentOperation: {
      type: 'string',
      enum: [
        'CONVERSATION_TRIGGER',
        'PLATFORM_EVENT_TRIGGER',
        'CONVERSATION_CONTROL_COMPACT_RUN',
        'CONVERSATION_CONTROL_PERMISSION_DECISION',
        'TASK_MONITOR_START',
        'TASK_MONITOR_RESUME',
        'TASK_MONITOR_JUDGMENT_RESOLVED',
        'TASK_MONITOR_CONTINUE',
        'TASK_MONITOR_COMPLETE',
        'CLI_READ',
        'APPLICATION_EFFECT_LAUNCH',
        'EXACT_ACTION_DELIVERY',
      ],
      description:
        'Closed bundle of host-affecting operations supported by the current controller-authorization protocol. Adding a HostAffectingActionType does not add it to an existing grant; this bundle must be revised deliberately.',
    },
    CliReadEnvelopeBody: {
      oneOf: [
        {
          $ref: '#/definitions/CliReadRunChangedFilesCountEnvelopeBody',
        },
        {
          $ref: '#/definitions/CliReadRunChangedFilesInventoryEnvelopeBody',
        },
        {
          $ref: '#/definitions/CliReadRunChangedFileDetailEnvelopeBody',
        },
        {
          $ref: '#/definitions/CliReadRunContextUsageGetEnvelopeBody',
        },
        {
          $ref: '#/definitions/CliReadRunSkillsListEnvelopeBody',
        },
        {
          $ref: '#/definitions/CliReadRunToolCallsLatestTurnEnvelopeBody',
        },
        {
          $ref: '#/definitions/CliReadWorkspaceSkillsListEnvelopeBody',
        },
        {
          $ref: '#/definitions/CliReadProjectSessionCostsListEnvelopeBody',
        },
        {
          $ref: '#/definitions/CliReadProviderUsageGetEnvelopeBody',
        },
        {
          $ref: '#/definitions/CliReadRuntimeModelCatalogGetEnvelopeBody',
        },
      ],
    },
    CliReadRunChangedFilesCountEnvelopeBody: {
      type: 'object',
      required: ['requestId', 'agentSessionId', 'operation', 'runId'],
      properties: {
        requestId: {
          type: 'string',
          format: 'uuid',
          description:
            'Correlation identity minted by the platform for this read.',
        },
        agentSessionId: {
          type: 'string',
          format: 'uuid',
          description: 'Canonical Agent Session authorization target.',
        },
        operation: {
          type: 'string',
          enum: ['run.changed_files.count'],
        },
        runId: {
          type: 'string',
          format: 'uuid',
          description: 'Persisted CLI Run identity to prepare and read.',
        },
      },
      additionalProperties: false,
    },
    CliReadProjectSessionCostsListEnvelopeBody: {
      type: 'object',
      required: [
        'requestId',
        'agentSessionId',
        'operation',
        'projectId',
        'limit',
      ],
      properties: {
        requestId: {
          type: 'string',
          format: 'uuid',
          description:
            'Correlation identity minted by the platform for this read.',
        },
        agentSessionId: {
          type: 'string',
          format: 'uuid',
          description: 'Canonical Agent Session authorization target.',
        },
        operation: {
          type: 'string',
          enum: ['project.session_costs.list'],
        },
        projectId: {
          type: 'string',
          format: 'uuid',
        },
        activityFrom: {
          type: 'string',
          format: 'date-time',
        },
        activityTo: {
          type: 'string',
          format: 'date-time',
        },
        minKnownCostUsd: {
          type: 'number',
          minimum: 0,
        },
        limit: {
          type: 'integer',
          format: 'int32',
          minimum: 1,
          maximum: 100,
        },
        cursor: {
          type: ['string', 'null'],
          minLength: 1,
        },
      },
      additionalProperties: false,
    },
    TaskMonitorLaunchConfig: {
      type: 'object',
      additionalProperties: false,
      required: ['taskId', 'method', 'provider', 'model', 'reasoningEffort'],
      properties: {
        taskId: {
          type: 'string',
          format: 'uuid',
        },
        method: {
          $ref: '#/definitions/TaskMonitorLaunchMethod',
        },
        provider: {
          $ref: '#/definitions/TaskMonitorLaunchProvider',
        },
        model: {
          type: 'string',
          minLength: 1,
        },
        reasoningEffort: {
          $ref: '#/definitions/TaskMonitorReasoningEffort',
        },
        fastMode: {
          type: 'boolean',
          description:
            'Immutable catalog-supported Fast mode intent copied from the persisted cursor node; omit for unsupported selections.',
        },
        worktree: {
          $ref: '#/definitions/StartRunWorktree',
          description:
            'Optional monitor-level worktree materialization request included in the immutable launch snapshot.',
        },
      },
    },
    TaskMonitorLaunchMethod: {
      type: 'string',
      enum: ['plan', 'open', 'quick'],
    },
    TaskMonitorLaunchProvider: {
      type: 'string',
      enum: ['claude', 'codex', 'opencode'],
    },
    TaskMonitorReasoningEffort: {
      type: 'string',
      enum: [
        'none',
        'minimal',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
        'ultra',
        'default',
      ],
    },
    StartRunWorktree: {
      type: 'object',
      additionalProperties: false,
      required: ['enabled'],
      properties: {
        enabled: {
          type: 'boolean',
          enum: [true],
        },
        branch: {
          type: 'string',
          minLength: 1,
        },
      },
      description:
        'Worktree materialization request forwarded to the Agent Bridge runtime.\n',
    },
    TaskMonitorJudgmentResponse: {
      type: 'object',
      additionalProperties: false,
      required: ['requestMessageId', 'label', 'conclusion'],
      properties: {
        requestMessageId: {
          $ref: '#/definitions/AgentOperationSnapshot/properties/messageId',
          description:
            'Canonical Message identity of the originating JUDGMENT_REQUESTED Message.\n',
        },
        label: {
          type: 'string',
          minLength: 1,
          maxLength: 240,
          description: 'User-visible label for the judgment.',
        },
        conclusion: {
          type: 'string',
          minLength: 1,
          maxLength: 500,
          description:
            'User-authored judgment text delivered to the Task Monitor.',
        },
      },
    },
    AgentOperationSnapshot: {
      type: 'object',
      additionalProperties: false,
      required: ['operationId', 'kind', 'fingerprint', 'state'],
      properties: {
        operationId: {
          $ref: '#/definitions/AgentOperationId',
        },
        kind: {
          type: 'string',
          enum: [
            'START_RUN',
            'DIRECT_TRIGGER',
            'WORKFLOW_ANSWER',
            'SESSION_MONITOR_DECISION',
          ],
        },
        fingerprint: {
          type: 'string',
          minLength: 64,
          maxLength: 64,
          pattern: '^[a-f0-9]{64}$',
          description:
            'Lowercase SHA-256 of the RFC 8785 canonical semantic request. The authorization envelope and operation metadata are excluded.',
        },
        state: {
          type: 'string',
          enum: [
            'CREATED',
            'RESOLVING_AUTHORIZATION',
            'AWAITING_APPROVAL',
            'SUBMITTING',
            'ROUTING_PENDING',
            'AWAITING_WORKFLOW_RESOLUTION',
            'DISPATCH_PENDING',
            'RECONCILING',
            'SUCCEEDED',
            'CANCELLED',
            'DENIED',
            'FAILED',
          ],
        },
        messageId: {
          type: 'string',
          pattern:
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          description: 'Unique identifier for a message (branded type)',
          example: '550e8400-e29b-41d4-a716-446655440005',
          'x-typescript-type': 'MessageId',
          'x-brand': 'MessageId',
          'x-semantic-type': 'resource-identifier',
        },
        triggerMessageId: {
          $ref: '#/definitions/AgentOperationSnapshot/properties/messageId',
        },
        code: {
          type: 'string',
        },
        message: {
          type: 'string',
        },
      },
      description:
        'Read-only durable projection of one interactive operation. DISPATCH_PENDING means the atomic submission committed and the durable CLI delivery obligation is retryable but not yet acknowledged. Terminal rows never return to a non-terminal state.',
    },
    AgentOperationId: {
      type: 'string',
      format: 'uuid',
      description:
        'Fresh identity for one explicit user gesture. It is distinct from authorization, Message, Run, trigger-message, and delivery identities.',
    },
    StartRunPromptPayload: {
      type: 'object',
      required: ['model', 'provider', 'contextMetadata', 'agentSessionId'],
      description:
        "Payload for the start-run envelope variant (AgentTriggerStartRun, sentinel promptType=`start_run`). Mirrors the fields of the Agent Bridge runtime contract in openapi/specs/agent-bridge/openapi.yaml that the CLI needs to materialize a Run on the host side. The platform start-run producer forwards this payload on the signed envelope so the CLI can materialize the Run without re-deriving any field. Carried inside an `AgentTriggerStartRun` whose discriminator value is the sentinel literal `start_run`.\nTwo arms on the signed trigger envelope, distinguished by a `handlerPromptType` (turn-firing) vs `workflowName` (materialize-only) discriminator — exactly one discriminator is present on any given envelope:\n- **`handlerPromptType` + `payload` (turn-firing arm).** The\n  non-workflow case. The CLI materializes the Run and immediately\n  fires its first turn against `handlerPromptType`, driven by\n  `payload`. This is the only arm that drives turn one from the CLI.\n- **`workflowName` (materialize-only arm).** The workflow-orchestrated\n  case (e.g. plan mode). `handlerPromptType` is absent. A bind-only launch\n  omits `payload`; a kickoff launch carries a `workflow_kickoff` payload\n  with the opening user message and optional canonical focal `entity`.\n  The CLI materializes the Run and binds `conversationId → runId` but\n  fires no turn — the Temporal workflow (already started server-side)\n  drives every turn via its own signed SYSTEM triggers. Skipping\n  `start_run` entirely for a workflow session would leave no\n  `conversationId → runId` binding and the workflow's triggers would be\n  dropped as `no_active_run`; the materialize-only arm is how a launch\n  turn is suppressed without dropping the envelope.\n\nOn the kickoff form, the API authors the workflow arm's USER opening row from `payload.userMessage`, while the same payload supplies the CLI with the optional focal `entity` needed for Run materialization. Bind-only launches author no kickoff row and carry no payload.\nIndependently of the arm discriminator, `triggersAgent` (default `true`) governs whether the turn-firing arm actually fires turn one. Setting it `false` turns a `handlerPromptType` + `payload` envelope materialize-only: the CLI materializes the Run and binds `conversationId → runId` but fires no turn. This is the non-workflow way to seed a standing greeting that waits for the user — the same launch-turn suppression the `workflowName` arm achieves by routing dispatch to a Temporal workflow.\n",
      not: {
        anyOf: [
          {
            required: ['handlerPromptType', 'workflowName'],
          },
          {
            allOf: [
              {
                not: {
                  required: ['handlerPromptType'],
                },
              },
              {
                not: {
                  required: ['workflowName'],
                },
              },
            ],
          },
          {
            allOf: [
              {
                required: ['handlerPromptType'],
              },
              {
                not: {
                  required: ['payload'],
                },
              },
            ],
          },
          {
            allOf: [
              {
                required: ['workflowName', 'payload'],
              },
              {
                properties: {
                  payload: {
                    not: {
                      $ref: '#/definitions/RunCreatePayloadWorkflowKickoff',
                    },
                  },
                },
              },
            ],
          },
        ],
      },
      properties: {
        runId: {
          type: 'string',
          format: 'uuid',
          description:
            'Explicit replacement Run identity; the owning Agent Session is unchanged.',
        },
        attachments: {
          type: 'array',
          description:
            'Optional file references for a handler launch. The CLI uses an empty list when omitted. Content stays on the host.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['attachmentId', 'fileName'],
            description:
              'Reference to a file uploaded to a Run through the CLI loopback attachment endpoint. Carries only the identity returned at upload, never file bytes.\n',
            properties: {
              attachmentId: {
                type: 'string',
                format: 'uuid',
              },
              fileName: {
                type: 'string',
                minLength: 1,
              },
            },
          },
        },
        stagedBrowserTab: {
          anyOf: [
            {
              type: 'null',
            },
            {
              description:
                'Shared Browser tab the user opened before the Run existed. The new Run adopts it as its selected page and its first Turn is told the user opened it and at which URL. Null when none. A reference whose tab no longer exists rejects the start with STAGED_BROWSER_TAB_NOT_FOUND before the first Turn. Turn-firing arm only.\n',
              allOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['stagedTabId'],
                  description:
                    'Reference to a Shared Browser tab opened through the CLI loopback pre-Run open-browser endpoint, owned by no Run until a start-run adopts it. Carries only the identity returned at open.\n',
                  properties: {
                    stagedTabId: {
                      type: 'string',
                      format: 'uuid',
                    },
                  },
                },
              ],
            },
          ],
        },
        triggersAgent: {
          type: 'boolean',
          default: true,
          description:
            "Whether the turn-firing arm fires turn one. Defaults to `true`: a `handlerPromptType` + `payload` envelope materializes the Run and immediately dispatches its first turn, exactly as before. When `false`, the CLI materializes the Run and binds `conversationId → runId` but fires no turn even though `handlerPromptType`/`payload` are present — the third, non-dispatching bootstrap mode, used to seed a standing SYSTEM greeting that simply waits for the user's first message. The non-workflow analogue of the `workflowName` materialize-only arm. Omit (or set `true`) on every existing turn-firing path.\n",
        },
        handlerPromptType: {
          type: 'string',
          minLength: 1,
          description:
            "The actual `LocalPromptType` routing key from the Agent Bridge contract that the CLI should dispatch the run against (e.g. `startup_session`, `feature_sync_analyze`, `implement`). Distinct from the sentinel `promptType: 'start_run'` on the parent trigger envelope. Carried as a plain string because the `LocalPromptType` enum is owned by the transport-neutral Agent Bridge contract; the CLI narrows this string against its own enum at the dispatcher boundary. Present on the turn-firing arm only; absent when `workflowName` is set.\n",
        },
        payload: {
          allOf: [
            {
              $ref: '#/definitions/RunCreatePayload',
            },
          ],
          description:
            'Typed prompt payload discriminated by `handlerPromptType`, refs the shared `RunCreatePayload` union in ./run-payloads.yaml — the same union that the Agent Bridge runtime validates, so the platform start-run envelope and CLI execution share one source of truth instead of an unconstrained re-validated object.\nRequired with `handlerPromptType`, where it drives the first turn. Optional with `workflowName`: omitted for a bind-only workflow launch, or the `workflow_kickoff` variant for a kickoff launch. The API uses `userMessage` to author the opening USER row, and the CLI uses the optional canonical `entity` to materialize a scoped Run. Omitting `entity` from a kickoff payload represents a genuinely unscoped workflow launch.\n',
        },
        workflowName: {
          type: 'string',
          minLength: 1,
          description:
            "Name of the Temporal workflow that orchestrates this session (e.g. `feature-sync`). Present on the materialize-only arm. When set, the CLI materializes the Run and binds the conversation but fires no first turn — the workflow drives every turn via its own SYSTEM triggers. Value-set mirrors the `WorkflowName` enum; carried as a plain string for the same independent-generation reason as `handlerPromptType`.\n`workflowName` is mutually exclusive with `handlerPromptType`. `payload` is absent for bind-only launches or must be the `workflow_kickoff` variant. For kickoff launches, the API authors the USER opening row from `payload.userMessage`; the CLI uses `payload.entity`, when present, as the Run's canonical focal identity.\n",
        },
        model: {
          type: 'string',
          minLength: 1,
          description:
            "Claude model id the CLI should use for the run (e.g. `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`). Forwarded verbatim onto the Agent Bridge runtime's model field.\n",
        },
        reasoningEffort: {
          type: 'string',
          enum: [
            'none',
            'minimal',
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
            'ultra',
            'default',
          ],
          description:
            'Reasoning-effort level for the run. Value-set mirrors the Agent Bridge runtime contract (the source of truth); additions there require extending this enum in lockstep.\n',
        },
        config: {
          anyOf: [
            {
              type: 'null',
            },
            {
              allOf: [
                {
                  $ref: '#/definitions/AgentSessionConfig',
                },
              ],
              description:
                'Typed AgentSession launch config forwarded to the CLI. Project Assistant proactive behavior and plan-combination aggressiveness are read from this persisted config after the Run is materialized; absent config or absent flags resolve at the consuming boundary.\n',
            },
          ],
        },
        provider: {
          type: 'string',
          enum: ['claude', 'codex', 'opencode'],
          description:
            'Agent provider the CLI should dispatch against. Value-set mirrors the Agent Bridge runtime provider contract (the source of truth); additions there require extending this enum in lockstep.\n',
        },
        skillSelection: {
          $ref: '#/definitions/AgentSkillSelection',
          description:
            'Optional pathless Skill identity for the first turn. The provider resolves it locally from the active Run workspace.',
        },
        fastMode: {
          type: 'boolean',
          description:
            'Optional provider-neutral Fast mode preference. `true`, `false`, and omission are distinct; the provider runner decides how omission applies. This field is accepted only when `provider` is `codex` or `claude` and carries no provider-native value.\n',
        },
        contextMetadata: {
          allOf: [
            {
              $ref: '#/definitions/RunContextMetadata',
            },
          ],
          description:
            "Run context metadata, refs the shared `RunContextMetadata` in the Agent Bridge-owned `RunContextMetadata` schema. The CLI adopts `agentSessionId` verbatim as the local run's `agentic_session_id` and stamps it on the `X-Agent-Session-ID` header for every MCP request. Shared so the platform start-run envelope and CLI execution validate against one source of truth instead of an unconstrained re-validated object.\n",
        },
        serviceIds: {
          type: 'array',
          items: {
            type: 'string',
            minLength: 1,
          },
          description:
            'Set of platform service ids the run executes against. Threaded through so the CLI can resolve working directories and scope without extra lookups. Optional: coding runs always carry it, but non-coding sessions (task / feature refiners, entity conversations) operate on entity text rather than a checked-out repo and omit it entirely.\n',
        },
        launchServiceId: {
          type: 'string',
          minLength: 1,
          description:
            'The service the CLI launches the session against. Required when serviceIds is non-empty; must be a member of serviceIds. Threaded through so the CLI can resolve the primary working directory without an extra lookup. Omit the field rather than sending an empty string.\n',
        },
        worktree: {
          $ref: '#/definitions/StartRunWorktree',
          description:
            'Worktree materialization request forwarded to the CLI-side the Agent Bridge worktree field. Present only when the launch wizard enabled worktree creation. `branch` carries the chosen branch name the CLI should materialize for each selected service.\n',
        },
        agentSessionId: {
          type: 'string',
          minLength: 1,
          description:
            "Canonical id of the platform agent session that owns this run. Mirrors `contextMetadata.agentSessionId` at the top level for symmetry with the context metadata's canonical session id.\n",
        },
      },
    },
    RunCreatePayloadWorkflowKickoff: {
      type: 'object',
      required: ['promptType', 'userMessage'],
      additionalProperties: false,
      properties: {
        promptType: {
          type: 'string',
          enum: ['workflow_kickoff'],
        },
        entity: {
          $ref: '#/definitions/RunEntityReference',
          description:
            'Canonical focal entity for an entity-scoped workflow launch. Omit only when the workflow is genuinely unscoped. The entity type and id are the identity source; callers must not introduce workflow-specific identity fields.\n',
        },
        userMessage: {
          type: 'string',
          description:
            "The user's launch kickoff text, which may be empty for a supported blank startup. The API authors a real USER message row from this value before the start-run trigger, ordered ahead of the workflow's first turn, so the user's opening text renders before the response.\n",
        },
      },
      description:
        'Payload variant for the workflow-orchestrated materialization arm of `start-run`. Carries the kickoff text the API needs to author the USER row that opens a workflow session (e.g. plan mode) and, when scoped, the same canonical `entity` reference used by other start-run payload variants. Always paired with `workflowName`; the CLI materializes the Run from this payload but does not fire it as a turn. Omitting `entity` is the explicit genuinely-unscoped form. The wire form mirrors kickoff-bearing turn-firing variants by carrying `userMessage`, keeping kickoff text single-sourced in the request payload across both arms.\n',
    },
    RunEntityReference: {
      type: 'object',
      required: ['entityType', 'entityId'],
      properties: {
        entityType: {
          type: 'string',
          enum: [
            'PROJECT',
            'ARTIFACT',
            'INITIATIVE',
            'TASK',
            'DESIGN_DOC',
            'SERVICE',
            'AGENT_SESSION',
            'VALIDATION_SESSION',
            'MESSAGE',
            'CONVERSATION',
            'REPORT',
            'IMPLEMENTATION_HINT',
            'PROPOSAL',
          ],
          description:
            'Canonical platform entity family that scopes the Run. Every work item uses TASK here; its registry-authoritative subtype is carried separately by the work-item payload when a consumer needs it.',
        },
        entityId: {
          type: 'string',
          format: 'uuid',
          description: 'Canonical platform entity id that scopes the Run.',
        },
      },
    },
    RunCreatePayload: {
      oneOf: [
        {
          $ref: '#/definitions/RunCreatePayloadStartupSession',
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType', 'entity'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['plan_execution'],
                },
                entity: {
                  $ref: '#/definitions/RunEntityReference',
                },
              },
            },
            {
              $ref: '#/definitions/LocalPlanExecutionPromptPayload',
            },
          ],
        },
        {
          $ref: '#/definitions/RunCreatePayloadEntityConversation',
        },
        {
          $ref: '#/definitions/RunCreatePayloadGoalPm',
        },
        {
          $ref: '#/definitions/RunCreatePayloadFreeForm',
        },
        {
          $ref: '#/definitions/RunCreatePayloadDebug',
        },
        {
          $ref: '#/definitions/RunCreatePayloadResearch',
        },
        {
          $ref: '#/definitions/RunCreatePayloadRunEval',
        },
        {
          $ref: '#/definitions/RunCreatePayloadQuick',
        },
        {
          $ref: '#/definitions/RunCreatePayloadProjectMode',
        },
        {
          $ref: '#/definitions/RunCreatePayloadDailySession',
        },
        {
          $ref: '#/definitions/RunCreatePayloadProjectReport',
        },
        {
          $ref: '#/definitions/RunCreatePayloadReleaseNotes',
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType', 'entity'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['task_refiner'],
                },
                entity: {
                  $ref: '#/definitions/RunEntityReference',
                },
              },
            },
            {
              $ref: '#/definitions/LocalTaskRefinerPromptPayload',
            },
          ],
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType', 'entity'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['feature_refiner'],
                },
                entity: {
                  $ref: '#/definitions/RunEntityReference',
                },
              },
            },
            {
              $ref: '#/definitions/LocalFeatureRefinerPromptPayload',
            },
          ],
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType', 'entity'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['design_doc_refiner'],
                },
                entity: {
                  $ref: '#/definitions/RunEntityReference',
                },
              },
            },
            {
              $ref: '#/definitions/LocalDesignDocRefinerPromptPayload',
            },
          ],
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType', 'entity'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['proposal_refiner'],
                },
                entity: {
                  $ref: '#/definitions/RunEntityReference',
                },
              },
            },
            {
              $ref: '#/definitions/LocalProposalRefinerPromptPayload',
            },
          ],
        },
        {
          $ref: '#/definitions/RunCreatePayloadAgentSearch',
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['report_update'],
                },
              },
            },
            {
              $ref: '#/definitions/LocalReportUpdatePromptPayload',
            },
          ],
        },
        {
          $ref: '#/definitions/RunCreatePayloadFeatureTreeConversation',
        },
        {
          $ref: '#/definitions/RunCreatePayloadOpenItemsTriage',
        },
        {
          $ref: '#/definitions/RunCreatePayloadVerifyFeature',
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['work_tracker_connect'],
                },
              },
            },
            {
              $ref: '#/definitions/WorkTrackerImportRequest',
            },
          ],
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['work_tracker_import'],
                },
              },
            },
            {
              $ref: '#/definitions/WorkTrackerImportRequest',
            },
          ],
        },
        {
          $ref: '#/definitions/RunCreatePayloadRepositoryGrounding',
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['repository_feature_enrichment'],
                },
              },
            },
            {
              $ref: '#/definitions/RepositoryFeatureEnrichmentPromptPayload',
            },
          ],
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['repository_first_work'],
                },
              },
            },
            {
              $ref: '#/definitions/RepositoryFirstWorkPromptPayload',
            },
          ],
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType', 'userMessage', 'entity'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['feature_sync_analyze'],
                },
                entity: {
                  $ref: '#/definitions/RunEntityReference',
                },
              },
            },
            {
              $ref: '#/definitions/FeatureSyncAnalyzePromptPayload',
            },
          ],
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType', 'userMessage', 'entity'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['feature_sync_iterate'],
                },
                entity: {
                  $ref: '#/definitions/RunEntityReference',
                },
              },
            },
            {
              $ref: '#/definitions/FeatureSyncIteratePromptPayload',
            },
          ],
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType', 'entity'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['plan_shaping_feature_sync_analyze'],
                },
                entity: {
                  $ref: '#/definitions/RunEntityReference',
                },
              },
            },
            {
              $ref: '#/definitions/PlanShapingFeatureSyncAnalyzePromptPayload',
            },
          ],
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType', 'entity'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['plan_shaping_feature_sync_iterate'],
                },
                entity: {
                  $ref: '#/definitions/RunEntityReference',
                },
              },
            },
            {
              $ref: '#/definitions/PlanShapingFeatureSyncIteratePromptPayload',
            },
          ],
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType', 'entity'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['plan_shaping_proposed_stages'],
                },
                entity: {
                  $ref: '#/definitions/RunEntityReference',
                },
              },
            },
            {
              $ref: '#/definitions/PlanShapingProposedStagesPromptPayload',
            },
          ],
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType', 'entity'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['plan_shaping_refine_stage'],
                },
                entity: {
                  $ref: '#/definitions/RunEntityReference',
                },
              },
            },
            {
              $ref: '#/definitions/PlanShapingRefineStagePromptPayload',
            },
          ],
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType', 'entity'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['plan_shaping_visual_preview'],
                },
                entity: {
                  $ref: '#/definitions/RunEntityReference',
                },
              },
            },
            {
              $ref: '#/definitions/PlanShapingVisualPreviewPromptPayload',
            },
          ],
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType', 'entity'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['plan_shaping_phase_breakdown'],
                },
                entity: {
                  $ref: '#/definitions/RunEntityReference',
                },
              },
            },
            {
              $ref: '#/definitions/PlanShapingPhaseBreakdownPromptPayload',
            },
          ],
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType', 'entity'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['plan_shaping_step_review'],
                },
                entity: {
                  $ref: '#/definitions/RunEntityReference',
                },
              },
            },
            {
              $ref: '#/definitions/PlanShapingStepReviewPromptPayload',
            },
          ],
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType', 'entity'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['plan_shaping_finalize'],
                },
                entity: {
                  $ref: '#/definitions/RunEntityReference',
                },
              },
            },
            {
              $ref: '#/definitions/PlanShapingFinalizePromptPayload',
            },
          ],
        },
        {
          $ref: '#/definitions/RunCreatePayloadValidationWalkthrough',
        },
        {
          $ref: '#/definitions/RunCreatePayloadSetSplitting',
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType', 'entity'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['session_monitor'],
                },
                entity: {
                  $ref: '#/definitions/RunEntityReference',
                },
              },
            },
            {
              $ref: '#/definitions/SessionMonitorPromptPayload',
            },
          ],
        },
        {
          allOf: [
            {
              type: 'object',
              required: ['promptType', 'entity'],
              properties: {
                promptType: {
                  type: 'string',
                  enum: ['task_monitor'],
                },
                entity: {
                  $ref: '#/definitions/RunEntityReference',
                },
              },
            },
            {
              $ref: '#/definitions/TaskMonitorPromptPayload',
            },
          ],
        },
        {
          $ref: '#/definitions/RunCreatePayloadHtmlCssMockupRevision',
        },
        {
          $ref: '#/definitions/RunCreatePayloadWorkflowKickoff',
        },
      ],
      description:
        "Discriminated union of every start-run-eligible payload. Carries the handler's typed payload alongside the `promptType` literal the CLI dispatcher branches on. Variants for the 4 subagent-owned handlers (`commit`, `code_review`, `final_assessment`, `implement`) and the follow-up-only handler (`coding_freeform`) is intentionally absent — they are never entered via start-run, only via in-process subagent dispatch or as user-message follow-ups against an already-running session.\n",
    },
    RunCreatePayloadStartupSession: {
      allOf: [
        {
          type: 'object',
          required: ['promptType', 'entity'],
          properties: {
            promptType: {
              type: 'string',
              enum: ['startup_session'],
            },
            entity: {
              $ref: '#/definitions/RunEntityReference',
            },
          },
        },
        {
          $ref: '#/definitions/LocalStartupSessionPromptPayload',
        },
      ],
    },
    LocalStartupSessionPromptPayload: {
      type: 'object',
      properties: {
        startupInput: {
          deprecated: true,
          description:
            'Deprecated compatibility input. Entity-scoped launches load canonical context from the persisted Run entity; this field is ignored by the CLI and will be removed in a later schema revision.',
          allOf: [
            {
              $ref: '#/definitions/LocalPromptStartupInput',
            },
          ],
        },
        userMessage: {
          type: 'string',
        },
        launchPlanId: {
          type: 'string',
          minLength: 1,
          description:
            "Plan that the coding-plan turn was launched from, when the active task is part of a plan stage. Threaded onto the wire payload from the run's contextMetadata so the coding-plan prompt can branch on plan-membership pre-prompt without re-reading session state. Paired with `launchStepId` — both must be present for the planned-task variant of the prompt to engage; either field absent yields the free-task variant.\n",
        },
        launchStepId: {
          type: 'string',
          minLength: 1,
          description:
            'Plan step that the coding-plan turn was launched from. Paired with `launchPlanId` to identify which step within the plan stage the task is anchored to. Use `launchStageId` (not this field) when calling `get_plan_stage` for the stage catch-up read.\n',
        },
        launchStageId: {
          type: 'string',
          minLength: 1,
          description:
            "Plan stage that contains `launchStepId`. Threaded onto the wire payload from the run's contextMetadata so the agent can call `get_plan_stage(stageId: launchStageId)` directly without an extra lookup. Required by the planned-task variant alongside `launchPlanId` and `launchStepId`; if any of the three is absent the free-task variant runs.\n",
        },
        implementationReadiness: {
          description:
            'The Feature Sync-owned implementation-readiness disposition that was checked before this coding session was admitted. The CLI stores it in shared session context; CLEAR and DISMISSED permanently satisfy this one-time gate for subsequent planning and code-capable work.',
          allOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['state', 'sourceSnapshot', 'finding', 'resolution'],
              properties: {
                state: {
                  type: 'string',
                  enum: ['CLEAR', 'REVIEW_REQUIRED', 'DISMISSED'],
                  description:
                    'One-time implementation-readiness admission result. CLEAR and DISMISSED permanently admit the owning Run; REVIEW_REQUIRED remains pending until the user clarifies through the ordinary composer or confirms dismissal.',
                },
                sourceSnapshot: {
                  type: 'object',
                  additionalProperties: false,
                  required: [
                    'runId',
                    'focalEntityId',
                    'focalEntityType',
                    'sourceRevision',
                    'capturedAt',
                  ],
                  properties: {
                    runId: {
                      type: 'string',
                      minLength: 1,
                    },
                    focalEntityId: {
                      type: 'string',
                      minLength: 1,
                    },
                    focalEntityType: {
                      type: 'string',
                      enum: ['TASK', 'FEATURE', 'DESIGN_DOC', 'PLAN'],
                      description:
                        'Entity context whose implementation readiness was checked.',
                    },
                    sourceRevision: {
                      type: 'string',
                      minLength: 1,
                    },
                    capturedAt: {
                      type: 'string',
                      format: 'date-time',
                    },
                  },
                },
                finding: {
                  anyOf: [
                    {
                      type: 'null',
                    },
                    {
                      allOf: [
                        {
                          type: 'object',
                          additionalProperties: false,
                          required: [
                            'affectedSourceContext',
                            'unresolvedDecision',
                            'consequentialInventionRisk',
                            'boundedEvidence',
                            'answerKind',
                          ],
                          properties: {
                            affectedSourceContext: {
                              type: 'string',
                              minLength: 1,
                              description:
                                'Source-bound context presented in the Issue section.',
                            },
                            unresolvedDecision: {
                              type: 'string',
                              minLength: 1,
                              description:
                                'Unresolved choice included in the How to resolve section.',
                            },
                            consequentialInventionRisk: {
                              type: 'string',
                              minLength: 1,
                              description:
                                'Consequence presented in the What could go wrong section.',
                            },
                            boundedEvidence: {
                              type: 'array',
                              minItems: 1,
                              maxItems: 8,
                              items: {
                                type: 'object',
                                additionalProperties: false,
                                required: ['category', 'statement'],
                                properties: {
                                  category: {
                                    description:
                                      'Machine-readable evidence classification; presentation does not prefix the statement with it.',
                                    type: 'string',
                                    enum: [
                                      'behavior',
                                      'ownership',
                                      'data_lifecycle',
                                      'authority',
                                      'security',
                                      'isolation',
                                      'integration',
                                    ],
                                  },
                                  statement: {
                                    type: 'string',
                                    minLength: 1,
                                  },
                                  sourceRef: {
                                    type: 'string',
                                    minLength: 1,
                                    description:
                                      'Bounded reference to the project evidence supporting the statement.',
                                  },
                                },
                              },
                            },
                            answerKind: {
                              type: 'string',
                              minLength: 1,
                              description:
                                'Requested clarification included with unresolvedDecision in the How to resolve section.',
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
                resolution: {
                  oneOf: [
                    {
                      type: 'object',
                      additionalProperties: false,
                      required: ['kind'],
                      properties: {
                        kind: {
                          type: 'string',
                          enum: ['NONE'],
                        },
                      },
                    },
                    {
                      type: 'object',
                      additionalProperties: false,
                      required: [
                        'kind',
                        'runId',
                        'sourceRevision',
                        'resolvedAt',
                      ],
                      properties: {
                        kind: {
                          type: 'string',
                          enum: ['DISMISSED'],
                        },
                        runId: {
                          type: 'string',
                          minLength: 1,
                        },
                        sourceRevision: {
                          type: 'string',
                          minLength: 1,
                        },
                        resolvedAt: {
                          type: 'string',
                          format: 'date-time',
                        },
                      },
                    },
                  ],
                },
              },
              description:
                'Source-bound readiness result produced by Feature Sync. Fresh analysis may produce CLEAR or REVIEW_REQUIRED; DISMISSED is reserved for the confirmed, user-authored acceptance of a displayed REVIEW_REQUIRED finding.',
            },
          ],
        },
      },
    },
    LocalPromptStartupInput: {
      type: 'object',
      required: ['task', 'adjacentScopeTasks', 'evidenceItems'],
      properties: {
        task: {
          $ref: '#/definitions/LocalPromptTaskInput',
        },
        focalEntity: {
          description:
            "The Run's persisted entity identity, forwarded unchanged to Project Assistant prompt preparation.\n",
          $ref: '#/definitions/RunEntityReference',
        },
        designDoc: {
          $ref: '#/definitions/LocalPromptDesignDocInput',
        },
        plan: {
          $ref: '#/definitions/LocalPromptPlanInput',
        },
        planGuidance: {
          $ref: '#/definitions/TaskMonitorPlanGuidance',
        },
        initiative: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
            },
            title: {
              type: 'string',
            },
            description: {
              type: 'string',
            },
          },
        },
        taskNeighborhood: {
          $ref: '#/definitions/LocalPromptTaskNeighborhoodInput',
        },
        adjacentScopeTasks: {
          type: 'array',
          items: {
            type: 'object',
            required: ['title'],
            properties: {
              id: {
                type: 'string',
              },
              title: {
                type: 'string',
              },
              taskType: {
                $ref: '#/definitions/LocalPromptTaskType',
              },
              description: {
                type: 'string',
              },
              acceptanceCriteria: {
                type: 'string',
              },
            },
          },
        },
        evidenceItems: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'type'],
            properties: {
              id: {
                type: 'string',
              },
              type: {
                type: 'string',
                enum: [
                  'initiative',
                  'task',
                  'design_doc',
                  'plan',
                  'message',
                  'service',
                  'artifact',
                  'project',
                ],
              },
              title: {
                type: 'string',
              },
              content: {
                type: 'string',
              },
              topologySummary: {
                type: 'string',
              },
            },
          },
        },
      },
    },
    LocalPromptTaskInput: {
      type: 'object',
      required: ['taskType', 'description'],
      properties: {
        id: {
          type: 'string',
        },
        title: {
          type: 'string',
        },
        taskType: {
          $ref: '#/definitions/LocalPromptTaskType',
        },
        description: {
          type: 'string',
        },
        acceptanceCriteria: {
          type: 'string',
        },
      },
    },
    LocalPromptTaskType: {
      type: 'string',
      enum: ['STANDARD', 'BUG', 'FEATURE', 'GOAL', 'EVAL'],
    },
    LocalPromptDesignDocInput: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
        },
        title: {
          type: 'string',
        },
        sections: {
          type: 'object',
          additionalProperties: {
            type: 'string',
          },
        },
      },
    },
    LocalPromptPlanInput: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
        },
        title: {
          type: 'string',
        },
        description: {
          type: 'string',
        },
        outcome: {
          type: 'string',
        },
      },
    },
    TaskMonitorPlanGuidance: {
      type: 'object',
      additionalProperties: false,
      required: ['plan', 'stage', 'step'],
      properties: {
        plan: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'outcome'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            title: {
              type: 'string',
              minLength: 1,
            },
            description: {
              type: 'string',
            },
            outcome: {
              type: 'string',
              minLength: 1,
            },
          },
        },
        designDoc: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'sections'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            title: {
              type: 'string',
              minLength: 1,
            },
            sections: {
              type: 'object',
              minProperties: 1,
              additionalProperties: {
                type: 'string',
                minLength: 1,
              },
            },
          },
        },
        stage: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            title: {
              type: 'string',
              minLength: 1,
            },
            description: {
              type: 'string',
            },
          },
        },
        step: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            title: {
              type: 'string',
              minLength: 1,
            },
            description: {
              type: 'string',
            },
          },
        },
      },
    },
    LocalPromptTaskNeighborhoodInput: {
      type: 'object',
      required: ['parentTasks', 'childTasks', 'ancestralDesignDocs'],
      properties: {
        parentTasks: {
          type: 'array',
          items: {
            $ref: '#/definitions/LocalPromptTaskNeighborhoodTaskInput',
          },
        },
        childTasks: {
          type: 'array',
          items: {
            allOf: [
              {
                $ref: '#/definitions/LocalPromptTaskNeighborhoodTaskInput',
              },
              {
                type: 'object',
                required: [
                  'parentTaskIds',
                  'incompleteParentTaskIds',
                  'allParentTasksCompleted',
                ],
                properties: {
                  parentTaskIds: {
                    type: 'array',
                    items: {
                      type: 'string',
                    },
                  },
                  incompleteParentTaskIds: {
                    type: 'array',
                    items: {
                      type: 'string',
                    },
                  },
                  allParentTasksCompleted: {
                    type: 'boolean',
                  },
                },
              },
            ],
          },
        },
        ancestralDesignDocs: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'title', 'summary'],
            properties: {
              id: {
                type: 'string',
              },
              title: {
                type: 'string',
              },
              summary: {
                type: 'string',
              },
              status: {
                type: 'string',
              },
            },
          },
        },
      },
    },
    LocalPromptTaskNeighborhoodTaskInput: {
      type: 'object',
      required: ['id', 'title', 'description'],
      properties: {
        id: {
          type: 'string',
        },
        title: {
          type: 'string',
        },
        taskType: {
          $ref: '#/definitions/LocalPromptTaskType',
        },
        description: {
          type: 'string',
        },
        acceptanceCriteria: {
          type: 'string',
        },
        status: {
          $ref: '#/definitions/LocalPromptWorkStatus',
        },
      },
    },
    LocalPromptWorkStatus: {
      type: 'string',
      enum: [
        'GENERATED',
        'BACKLOG',
        'READY',
        'REFINING',
        'BLOCKED',
        'REFINING_DESCRIPTION',
        'REFINING_DETAILS',
        'REFINING_ACCEPTANCE_CRITERIA',
        'GENERATING_DESCRIPTION',
        'GENERATING_DETAILS',
        'GENERATING_DESCRIPTION_AND_DETAILS',
        'GENERATING_ACCEPTANCE_CRITERIA',
        'GENERATING_ALL',
        'ACTIVE',
        'ON_HOLD',
        'VERIFYING',
        'COMPLETED',
        'CANCELLED',
        'ARCHIVED',
        'SUPERSEDED',
      ],
    },
    LocalPlanExecutionPromptPayload: {
      type: 'object',
      required: ['plan', 'review'],
      properties: {
        plan: {
          $ref: '#/definitions/LocalPlanExecutionPromptPayloadPlan',
        },
        review: {
          $ref: '#/definitions/LocalStartupPlanReviewSummary',
          description:
            "The user's review of the plan: question answers, discrepancy dispositions, and feedback notes.\n",
        },
        feedback: {
          type: ['string', 'null'],
          description:
            'Optional free-text user feedback submitted alongside the approval.',
        },
      },
    },
    LocalPlanExecutionPromptPayloadPlan: {
      type: 'object',
      required: [
        'responseType',
        'sessionTitle',
        'requiredServiceIds',
        'primaryImplementations',
        'executionPlan',
        'discrepancies',
        'clarificationQuestions',
      ],
      properties: {
        responseType: {
          type: 'string',
          enum: ['startup_plan_v1'],
        },
        sessionTitle: {
          type: 'string',
          minLength: 1,
        },
        requiredServiceIds: {
          type: 'array',
          minItems: 1,
          uniqueItems: true,
          items: {
            type: 'string',
            minLength: 1,
          },
          description:
            'Complete deduplicated set of project Service IDs the approved implementation may modify.',
        },
        primaryImplementations: {
          type: 'array',
          minItems: 1,
          items: {
            $ref: '#/definitions/LocalResponseStartupPrimaryImplementation',
          },
        },
        executionPlan: {
          type: 'array',
          items: {
            $ref: '#/definitions/LocalResponseStartupPlanStep',
          },
        },
        discrepancies: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
        },
        clarificationQuestions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
        },
      },
      description:
        'The full approved startup plan as emitted by the planning session (responseType startup_plan_v1). Includes primary implementations, executionPlan steps, discrepancies, and clarificationQuestions.\n',
    },
    LocalResponseStartupPrimaryImplementation: {
      type: 'object',
      required: ['title', 'content', 'rationale'],
      properties: {
        title: {
          type: 'string',
          minLength: 1,
        },
        content: {
          type: 'string',
          minLength: 1,
          description:
            'The proposed centerpiece, such as a DTO, table definition, or prose block.',
        },
        rationale: {
          type: 'string',
          minLength: 1,
        },
        location: {
          type: 'string',
          minLength: 1,
        },
        language: {
          type: 'string',
          minLength: 1,
        },
        connections: {
          type: 'array',
          minItems: 1,
          description:
            'Optional evidence-bearing connections. Omit this property when no applicable connection is established.\n',
          items: {
            $ref: '#/definitions/LocalResponseStartupPrimaryImplementationConnection',
          },
        },
      },
    },
    LocalResponseStartupPrimaryImplementationConnection: {
      type: 'object',
      description:
        'Evidence-backed connection between a primary implementation and a resolved, non-archived workflow step or Contract. This records plan evidence only and does not create graph topology.\n',
      required: [
        'entityType',
        'entityId',
        'entityTitle',
        'relationship',
        'sourceField',
        'sourceExcerpt',
        'rationale',
      ],
      properties: {
        entityType: {
          type: 'string',
          enum: ['workflowStep', 'contract'],
        },
        entityId: {
          type: 'string',
          format: 'uuid',
        },
        entityTitle: {
          type: 'string',
          minLength: 1,
        },
        relationship: {
          type: 'string',
          enum: ['fulfills', 'authors', 'enforces', 'consumes'],
        },
        sourceField: {
          type: 'string',
          minLength: 1,
          description:
            'Field path or graph edge that establishes the connection.',
        },
        sourceExcerpt: {
          type: 'string',
          minLength: 1,
          description: 'Complete source excerpt supporting the connection.',
        },
        rationale: {
          type: 'string',
          minLength: 1,
        },
      },
    },
    LocalResponseStartupPlanStep: {
      type: 'object',
      required: ['stepId', 'title', 'description', 'phase', 'references'],
      properties: {
        stepId: {
          type: 'string',
          minLength: 1,
        },
        title: {
          type: 'string',
          minLength: 1,
        },
        description: {
          type: 'string',
          minLength: 1,
        },
        phase: {
          type: 'integer',
          minimum: 1,
          description:
            '1-based phase this step belongs to. Steps sharing a phase number are grouped together in the execution sequence.\n',
        },
        references: {
          type: 'array',
          items: {
            $ref: '#/definitions/LocalResponseStartupPlanReference',
          },
        },
      },
    },
    LocalResponseStartupPlanReference: {
      type: 'object',
      required: ['sourceType', 'sourceId', 'rationale'],
      properties: {
        sourceType: {
          $ref: '#/definitions/LocalResponseSourceType',
        },
        sourceId: {
          type: 'string',
          minLength: 1,
        },
        rationale: {
          type: 'string',
          minLength: 1,
        },
      },
    },
    LocalResponseSourceType: {
      type: 'string',
      enum: ['evidenceItem', 'task', 'designDoc', 'plan', 'initiative'],
    },
    LocalStartupPlanReviewSummary: {
      type: 'object',
      required: ['responseType', 'questionAnswers', 'discrepancyDispositions'],
      properties: {
        responseType: {
          type: 'string',
          enum: ['startup_plan_review_v1'],
        },
        questionAnswers: {
          type: 'array',
          items: {
            $ref: '#/definitions/LocalStartupPlanQuestionAnswer',
          },
        },
        discrepancyDispositions: {
          type: 'array',
          items: {
            $ref: '#/definitions/LocalStartupPlanDiscrepancyReview',
          },
        },
      },
    },
    LocalStartupPlanQuestionAnswer: {
      type: 'object',
      required: ['question', 'answer'],
      properties: {
        question: {
          type: 'string',
          minLength: 1,
        },
        answer: {
          type: 'string',
          minLength: 1,
        },
      },
    },
    LocalStartupPlanDiscrepancyReview: {
      type: 'object',
      required: ['discrepancyIndex', 'disposition'],
      properties: {
        discrepancyIndex: {
          type: 'integer',
          minimum: 0,
        },
        disposition: {
          $ref: '#/definitions/LocalStartupPlanDiscrepancyDisposition',
        },
        note: {
          type: 'string',
          minLength: 1,
        },
      },
    },
    LocalStartupPlanDiscrepancyDisposition: {
      type: 'string',
      enum: ['acknowledged', 'blocker'],
    },
    RunCreatePayloadEntityConversation: {
      allOf: [
        {
          type: 'object',
          required: ['promptType', 'userMessage'],
          properties: {
            promptType: {
              type: 'string',
              enum: ['entity_conversation'],
            },
          },
        },
        {
          $ref: '#/definitions/LocalEntityConversationPromptPayload',
        },
      ],
    },
    LocalEntityConversationPromptPayload: {
      type: 'object',
      required: ['entity', 'userMessage'],
      properties: {
        entity: {
          $ref: '#/definitions/LocalEntityConversationEntity',
        },
        pageContext: {
          type: 'string',
          description:
            'Human-readable description of the current view context (e.g. "You are viewing the plan \'Q4 Roadmap\' (planId: abc123)")\n',
        },
        influences: {
          type: 'array',
          items: {
            $ref: '#/definitions/LocalEntityConversationInfluence',
          },
          description:
            'Entities that influenced the creation or current state of this entity. Provides decision lineage and design rationale context.\n',
        },
        originatingConversationId: {
          type: 'string',
          description:
            'ID of the conversation that originated this entity, if applicable. Allows the agent to reference prior discussion context.\n',
        },
        userMessage: {
          type: 'string',
          description:
            "Required free-form message from the user to guide the agent's response to this entity conversation turn.\n",
        },
      },
    },
    LocalEntityConversationEntity: {
      allOf: [
        {
          $ref: '#/definitions/RunEntityReference',
        },
        {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Human-readable title of the entity',
            },
            description: {
              type: 'string',
              description: 'Entity description or content',
            },
            acceptanceCriteria: {
              type: 'string',
              description: 'Acceptance criteria (for tasks)',
            },
            content: {
              type: 'string',
              description:
                'Full content body (for design docs, artifacts, etc.)',
            },
            metadata: {
              type: 'object',
              additionalProperties: true,
              description: 'Additional entity-specific metadata',
            },
            taskType: {
              type: 'string',
              description:
                'Registry-authoritative subtype key for TASK entities. Present when the underlying work item needs subtype context, including built-in and project-defined custom work-item types. Preserve the key exactly; it is separate from the canonical TASK entityType and may be used by subtype-aware prompt branches.',
            },
            dueDate: {
              type: 'string',
              format: 'date-time',
              description:
                'Optional target date on GOAL tasks; omit for an undated Goal. Missing dates must not produce a date-based closing prompt. alongside the goal description.',
            },
            trackedEntities: {
              type: 'array',
              items: {
                $ref: '#/definitions/TrackedEntitySnapshot',
              },
              description:
                'Outgoing TRACKS-edge snapshots. Populated when the entity is a GOAL task so the goal-scoping prompt section can list what is already attached and avoid re-attaching it.',
            },
          },
        },
      ],
    },
    TrackedEntitySnapshot: {
      type: 'object',
      description:
        "Inlined snapshot of an entity referenced by a `TRACKS` edge. Carries the\nfields needed to render the goal's tracked items in a list view without a\nsecond hop. `targetEntityId`, `targetEntityType`, and `title` are always\npresent. `status` and `dueDate` are optional and may be null for target\ntypes that do not carry them (for example PLAN). Wider than EntityNameDto,\nwhich only carries an entity name.\n",
      required: ['targetEntityId', 'targetEntityType', 'title'],
      properties: {
        targetEntityId: {
          type: 'string',
          format: 'uuid',
          description: 'ID of the tracked entity.',
        },
        targetEntityType: {
          $ref: '#/definitions/LocalOpenItemsTriageItem/properties/entityType',
        },
        title: {
          type: 'string',
          description: 'Display title for the tracked entity.',
        },
        status: {
          anyOf: [
            {
              type: 'null',
            },
            {
              $ref: '#/definitions/RunContextMetadata/properties/task/properties/status',
              description:
                'Current work status, when the target type carries one.',
            },
          ],
        },
        dueDate: {
          type: ['string', 'null'],
          format: 'date-time',
          description:
            'Target completion date, when the target type carries one.',
        },
      },
    },
    LocalOpenItemsTriageItem: {
      type: 'object',
      additionalProperties: false,
      required: ['entityType', 'entityId', 'title'],
      properties: {
        entityType: {
          type: 'string',
          enum: [
            'ARTIFACT',
            'INITIATIVE',
            'PROJECT',
            'TASK',
            'MESSAGE',
            'CONVERSATION',
            'DESIGN_DOC',
            'AGENT_SESSION',
            'VALIDATION_SESSION',
            'SERVICE',
            'REPORT',
            'PROPOSAL',
            'IMPLEMENTATION_HINT',
            'USER',
          ],
          description:
            "Entity type for canonical entities. `USER` is used in proposal influence rows to attribute a change to the human who authored it (resolved to the user's display name on snapshot); users are not stored in the entity registry.",
        },
        entityId: {
          type: 'string',
          format: 'uuid',
        },
        title: {
          type: 'string',
          minLength: 1,
        },
      },
    },
    RunContextMetadata: {
      type: 'object',
      required: [
        'capturedAt',
        'organizationId',
        'projectId',
        'agentSessionId',
        'userComments',
        'fileReferences',
      ],
      properties: {
        capturedAt: {
          type: 'string',
          format: 'date-time',
        },
        organizationId: {
          type: 'string',
          minLength: 1,
        },
        projectId: {
          type: 'string',
          minLength: 1,
        },
        agentSessionId: {
          type: 'string',
          minLength: 1,
          description:
            "The platform `agentSession.id` (UUID) of the row that owns this run. This is the canonical record id — NOT the legacy `agentSession.agentSessionId` string. The CLI adopts this value verbatim as the local run's `agentic_session_id` and stamps it on the `X-Agent-Session-ID` header for every MCP request, so sourcing the wrong field here will cause reports and edges to attach to a phantom session that the platform cannot resolve.\n",
        },
        launchPlanId: {
          type: 'string',
          minLength: 1,
          description:
            "Plan that this run was launched from (e.g. the plan whose stage step opened this coding session). Set client-side by the launching UI when the session originates from a plan surface, threaded onto the local run's contextMetadata so the analyze step can branch on plan-membership pre-prompt. Carried only on the Agent Bridge wire — the platform API service does not persist this field. Distinct from the platform agent-session's `planId`, which identifies the plan being *generated* by a PLAN_GENERATION session.\n",
        },
        launchStepId: {
          type: 'string',
          minLength: 1,
          description:
            'Plan step that this run was launched from. Paired with `launchPlanId` to identify which step within the plan stage this session is executing. Set client-side by the launching UI and carried only on the Agent Bridge wire; the platform API service does not persist this field.\n',
        },
        launchStageId: {
          type: 'string',
          minLength: 1,
          description:
            'Plan stage that contains `launchStepId`. Set client-side by the launching UI from the same route params that supply `launchPlanId` / `launchStepId`, and threaded onto downstream prompt payloads so the analyze and coding-plan agents can call `get_plan_stage(stageId: launchStageId)` directly. Carried only on the Agent Bridge wire; the platform API service does not persist this field.\n',
        },
        task: {
          type: 'object',
          required: [
            'name',
            'id',
            'type',
            'status',
            'source',
            'organizationId',
            'projectId',
          ],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'The unique identifier for the task.',
            },
            name: {
              type: 'string',
              description: 'The name or title of the task.',
            },
            type: {
              type: 'string',
              description:
                'Work-item type key. Values are registry-backed and may include system keys such as `STANDARD`, `BUG`, `FEATURE`, `GOAL`, `PLAN`, `PLAN_STAGE`, `CONTRACT`, `DIAGRAM`, `DIAGRAM_ELEMENT`, and `TASK_MONITOR`, or project-defined keys created at runtime.\n',
              example: 'STANDARD',
            },
            config: {
              anyOf: [
                {
                  type: 'null',
                },
                {
                  allOf: [
                    {
                      oneOf: [
                        {
                          type: 'object',
                          additionalProperties: false,
                          required: ['kind', 'version'],
                          properties: {
                            kind: {
                              description:
                                'Discriminator for the launch-configuration semantics.',
                              type: 'string',
                              enum: ['INITIAL_WORKTREE'],
                            },
                            version: {
                              type: 'string',
                              enum: ['v1'],
                              description:
                                'Schema-version literal for this launch-configuration kind. A future\nrequired-field change must mint a new version rather than changing v1.\n',
                            },
                            initialWorktreeBranch: {
                              type: ['string', 'null'],
                              minLength: 1,
                              description:
                                'Optional branch default for coding-session setup. Null or omission\nmeans no stored branch choice; creating the work item never creates a\ncheckout or materializes a worktree.\n',
                            },
                          },
                          description:
                            'First version of the generic work-item launch configuration envelope.',
                        },
                      ],
                      description:
                        'Discriminated union of typed, versioned launch configuration envelopes.\nThe kind selects the configuration semantics and version evolves the\nshape within that kind.\n',
                    },
                  ],
                  description:
                    'Typed launch defaults retained with the work item. Null or omission\nmeans no stored launch default; checkout materialization happens only\nwhen a coding session is started.\n',
                },
              ],
            },
            sections: {
              type: 'array',
              items: {
                allOf: [
                  {
                    type: 'object',
                    required: ['key', 'order'],
                    properties: {
                      id: {
                        type: 'string',
                        description: "The section's unique id",
                      },
                      key: {
                        type: 'string',
                        description:
                          'Unique identifier for the section (e.g., description, details).',
                      },
                      order: {
                        type: 'integer',
                        description: 'Ordering index for rendering sections.',
                      },
                    },
                  },
                  {
                    type: 'object',
                    required: [
                      'materializedMarkdown',
                      'materializedProposalId',
                      'id',
                    ],
                    properties: {
                      materializedMarkdown: {
                        type: 'string',
                        description:
                          'Persisted markdown snapshot for the section.',
                      },
                      materializedProposalId: {
                        type: 'string',
                        pattern:
                          '^(?:[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})?$',
                        description:
                          "Proposal whose successfully materialized change produced the section's current composition or resolved presentation context. Empty when the section has no recorded proposal provenance.\n",
                      },
                      crdtSnapshotSeq: {
                        type: ['integer', 'null'],
                        description:
                          'Sequence number associated with the persisted CRDT snapshot.',
                      },
                    },
                  },
                ],
              },
            },
            organizationId: {
              type: 'string',
              format: 'uuid',
              description: 'The ID of the organization this task belongs to.',
            },
            projectId: {
              type: 'string',
              format: 'uuid',
              description: 'The ID of the project this task belongs to.',
            },
            initiativeId: {
              type: ['string', 'null'],
              format: 'uuid',
              description: 'The ID of the initiative this task is part of.',
            },
            status: {
              type: 'string',
              enum: [
                'GENERATED',
                'BACKLOG',
                'READY',
                'REFINING',
                'BLOCKED',
                'REFINING_DESCRIPTION',
                'REFINING_DETAILS',
                'REFINING_ACCEPTANCE_CRITERIA',
                'GENERATING_DESCRIPTION',
                'GENERATING_DETAILS',
                'GENERATING_DESCRIPTION_AND_DETAILS',
                'GENERATING_ACCEPTANCE_CRITERIA',
                'GENERATING_ALL',
                'ACTIVE',
                'ON_HOLD',
                'VERIFYING',
                'COMPLETED',
                'CANCELLED',
                'ARCHIVED',
                'SUPERSEDED',
              ],
              description: 'Unified work status for initiatives and tasks',
            },
            source: {
              type: 'string',
              enum: ['system', 'user', 'agent'],
              description: 'Origin source for task creation.',
              example: 'system',
            },
            priority: {
              type: 'string',
              enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
              description: 'The priority level of an item.',
              example: 'HIGH',
            },
            dueDate: {
              type: ['string', 'null'],
              format: 'date-time',
              description:
                'The target completion date, or null for an undated task.',
            },
            tag: {
              $ref: '#/definitions/RepositoryPlacementRequest/properties/candidates/items/properties/tag',
              description:
                'Feature classification. Set on FEATURE tasks; absent on STANDARD,\nBUG, and GOAL tasks.\n',
            },
            assigneeId: {
              type: ['string', 'null'],
              format: 'uuid',
              description: 'The ID of the user assigned to this task.',
            },
            reporterId: {
              type: 'string',
              format: 'uuid',
              description:
                'The ID of the user who reported or created this task.',
            },
            parentTaskId: {
              type: ['string', 'null'],
              format: 'uuid',
              description: 'The ID of the parent task, if this is a sub-task.',
            },
            childCounts: {
              type: 'object',
              description:
                'Aggregated sub-task counts grouped by status for direct children.',
              properties: {
                total: {
                  type: 'integer',
                  format: 'int32',
                  description: 'Total number of direct child tasks.',
                  example: 3,
                },
                done: {
                  type: 'integer',
                  format: 'int32',
                  description: 'Number of direct child tasks marked as done.',
                  example: 1,
                },
                inProgress: {
                  type: 'integer',
                  format: 'int32',
                  description:
                    'Number of direct child tasks currently in progress.',
                  example: 1,
                },
                backlog: {
                  type: 'integer',
                  format: 'int32',
                  description:
                    'Number of direct child tasks that are still in the backlog.',
                  example: 1,
                },
              },
            },
            designDocCount: {
              type: ['integer', 'null'],
              format: 'int32',
              description:
                'Number of design docs linked to this task. Present when includeDesignDocCounts=true; otherwise null.',
            },
            codingSessionCount: {
              type: ['integer', 'null'],
              format: 'int32',
              description:
                'Number of coding sessions (type=CODING) linked to this task. Present when includeAgentSessionCounts=true; otherwise null.',
            },
            agentSessionCount: {
              type: ['integer', 'null'],
              format: 'int32',
              description:
                'Number of non-coding agent sessions (e.g. DAILY_SESSION, TASK_REFINING) linked to this task. Present when includeAgentSessionCounts=true; otherwise null.',
            },
            serviceRelations: {
              type: 'array',
              description:
                'Service-to-task relation records linked to this task. Present when includeServiceRelations=true.',
              items: {
                type: 'object',
                required: ['id', 'serviceId', 'taskId', 'createdAt'],
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  serviceId: {
                    type: 'string',
                    format: 'uuid',
                  },
                  taskId: {
                    type: 'string',
                    format: 'uuid',
                  },
                  relationType: {
                    type: 'string',
                    description: 'Type of relationship',
                  },
                  createdAt: {
                    type: 'string',
                    format: 'date-time',
                  },
                },
              },
            },
            edges: {
              type: 'array',
              description:
                'Agent-authored graph edges that touch this task (inbound + outbound,\ndeduplicated by edge id). Present when includeEdges=true on the\nrequest; otherwise omitted. When `edgeTypes` is omitted, the response\nuses the default generic edge label set; when `edgeTypes` is provided,\nthe requested AgentEdgeType labels define the returned edge domain.\nEdges can include workflow labels (`STANDARD`, `CONDITIONAL`, `LOOP`,\n`FULFILLED_BY`) and preserve graph relationship metadata such as\ncategory, direction, and predicate.\n',
              items: {
                type: 'object',
                required: [
                  'id',
                  'sourceNodeId',
                  'targetNodeId',
                  'type',
                  'reasoning',
                  'createdAt',
                  'updatedAt',
                ],
                example: {
                  id: '8d2f4b1a-1c3e-4f5a-9b6d-7e8c9a0b1c2d',
                  sourceNodeId: '11111111-1111-1111-1111-111111111111',
                  sourceNodeName: 'Source task',
                  targetNodeId: '22222222-2222-2222-2222-222222222222',
                  targetNodeName: 'Target task',
                  type: 'PROPOSED_TOGETHER',
                  source: 'system',
                  reasoning:
                    'Co-authored siblings: both entities were created by the same approved proposal.\n',
                  createdBySessionId: null,
                  lastModifiedBySessionId: null,
                  createdAt: '2026-06-05T12:00:00Z',
                  updatedAt: '2026-06-05T12:00:00Z',
                },
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  sourceNodeId: {
                    type: 'string',
                    format: 'uuid',
                  },
                  sourceEntityType: {
                    description:
                      'Canonical entity type for the source endpoint, as persisted by the Graph service for validation and reconnect operations.\n',
                    type: 'string',
                    enum: [
                      'ARTIFACT',
                      'INITIATIVE',
                      'PROJECT',
                      'TASK',
                      'MESSAGE',
                      'CONVERSATION',
                      'DESIGN_DOC',
                      'AGENT_SESSION',
                      'VALIDATION_SESSION',
                      'SERVICE',
                      'REPORT',
                      'PROPOSAL',
                      'IMPLEMENTATION_HINT',
                    ],
                  },
                  sourceNodeName: {
                    type: ['string', 'null'],
                    description:
                      'Display name for the source endpoint when the node has a materialized name, title, or label property; omitted for stub endpoints.\n',
                  },
                  targetNodeId: {
                    type: 'string',
                    format: 'uuid',
                  },
                  targetEntityType: {
                    $ref: '#/definitions/RunContextMetadata/properties/task/properties/edges/items/properties/sourceEntityType',
                    description:
                      'Canonical entity type for the target endpoint, as persisted by the Graph service for validation and reconnect operations.\n',
                  },
                  targetNodeName: {
                    type: ['string', 'null'],
                    description:
                      'Display name for the target endpoint when the node has a materialized name, title, or label property; omitted for stub endpoints.\n',
                  },
                  targetNodeType: {
                    type: ['string', 'null'],
                    description:
                      'Work-item subtype materialized on the target endpoint, such as `CONTRACT`; omitted when the endpoint is not a work item or has not been materialized.\n',
                  },
                  type: {
                    type: 'string',
                    enum: [
                      'RELATED_TO',
                      'DEPENDS_ON',
                      'DERIVES_FROM',
                      'SUPERSEDES',
                      'CONTRADICTS',
                      'EVOLVES',
                      'TRACKS',
                      'PROPOSED_TOGETHER',
                      'FULFILLED_BY',
                      'GUARANTEES',
                      'IMPLEMENTS',
                      'CONSUMES',
                      'STANDARD',
                      'CONDITIONAL',
                      'LOOP',
                    ],
                    description:
                      "Relationship type for agent-authored topology edges between two entities. Each value carries a distinct semantic:\n- RELATED_TO: source and target share context but have no directional\n  dependency, derivation, or replacement relationship.\n- DEPENDS_ON: source entity requires the target entity to be in place\n  (functionally or temporally) before it is meaningful or completable.\n- DERIVES_FROM: target entity is the origin or basis from which the\n  source entity was produced; the target remains canonical and the\n  source is a downstream artifact.\n- SUPERSEDES: source entity replaces the target entity; the target is\n  displaced and should no longer be treated as canonical.\n- CONTRADICTS: source entity disagrees with the target entity; both\n  remain visible so the conflict can be resolved by an authoring agent.\n- EVOLVES: source entity refines, extends, or iterates on the target\n  entity, which remains canonical. Distinct from SUPERSEDES (target is\n  displaced) and DERIVES_FROM (target is origin only and the source\n  stands apart).\n- TRACKS: source references the target as a tracked deliverable. The\n  meaning is composed with source and target type — the canonical\n  use is a GOAL-typed task referencing a FEATURE / STANDARD / BUG task\n  or a PLAN it expects to ship. DESIGN_DOC and other GOAL targets are\n  rejected at the attach boundary (track the parent feature or plan\n  instead). Validation lives in the boundary handler, not the edge\n  service.\n- PROPOSED_TOGETHER: source and target were created or modified by the\n  same proposal, making them co-authored siblings. Symmetric (the edge\n  carries no direction beyond the storage tuple) and system-emitted\n  (derived by the Graph service from a proposal-approved event rather\n  than authored by a user or agent). Carries no semantic claim about\n  dependency, derivation, or replacement — only that the two entities\n  share a proposal origin. Always paired with source `system`.\n- FULFILLED_BY: meta edge from a WORKFLOW_STEP work item to the work item\n  where that step's implementation lives. It remains visible in generic\n  meta-edge surfaces and is never categorized as flow.\n- STANDARD: flow edge from one WORKFLOW_STEP to the next ordinary step in\n  the same workflow graph. Carries category `flow` and requires direction.\n- CONDITIONAL: flow edge from a WORKFLOW_STEP to the next branch selected\n  by a predicate. Carries category `flow` and requires both direction and\n  predicate.\n- LOOP: flow edge representing a self-loop or return loop in a workflow\n  graph. Carries category `flow`, does not carry direction, and may carry\n  a predicate when the return is conditional.\n",
                  },
                  category: {
                    allOf: [
                      {
                        type: 'string',
                        enum: ['meta', 'flow'],
                        default: 'meta',
                        description:
                          'Rendering and traversal category for an edge. Existing edge records and callers that omit this field default to `meta`. Flow-category edges (`STANDARD`, `CONDITIONAL`, `LOOP`) are workflow structure and must stay out of generic related-entity, supersede/evolves, task-list, and link-discovery surfaces. Meta-category edges remain the regular topology and fulfillment surface.\n',
                      },
                    ],
                    description:
                      'Edge category used by readers to distinguish generic meta edges from workflow flow structure. Missing values from legacy records are interpreted as `meta`.\n',
                    default: 'meta',
                  },
                  direction: {
                    anyOf: [
                      {
                        type: 'null',
                      },
                      {
                        allOf: [
                          {
                            type: 'string',
                            enum: ['forward', 'backward'],
                            description:
                              'Direction declared on workflow flow edges where the direction matters to rendering or validation. `STANDARD` and `CONDITIONAL` edges require this field. `LOOP` edges do not carry it because the source step is also the return point.\n',
                          },
                        ],
                        description:
                          'Required for `STANDARD` and `CONDITIONAL` flow edges; omitted for `LOOP` and meta edges.\n',
                      },
                    ],
                  },
                  predicate: {
                    anyOf: [
                      {
                        type: 'null',
                      },
                      {
                        allOf: [
                          {
                            type: 'string',
                            minLength: 1,
                            maxLength: 200,
                            pattern:
                              '^(?=.*[A-Za-z0-9_\\.:/=()!<>&|+\\-])[A-Za-z0-9_ .:/=()!<>&|+\\-]+$',
                            description:
                              'Non-blank branch label or predicate carried by a CONDITIONAL workflow edge or an optionally conditional LOOP workflow edge. Values are limited to printable ASCII identifier, comparison, boolean, grouping, path, and arithmetic characters so every service applies the same portable predicate syntax.\n',
                          },
                        ],
                        description:
                          'Predicate expression or branch label required for `CONDITIONAL` flow edges and optional for `LOOP` flow edges. Omitted for `STANDARD` and meta edges.\n',
                      },
                    ],
                  },
                  reasoning: {
                    type: 'string',
                  },
                  source: {
                    description:
                      'Origin of the edge. Defaults to `agent` for edges authored through the agent edge-proposal surface; `system` for edges produced by platform code, including those materialized by the Graph service from a domain event (e.g. PROPOSED_TOGETHER edges derived from proposal approval). Absent on responses from older deployments that predate this field — callers should treat the missing value as `agent`.\n',
                    example: 'agent',
                    type: 'string',
                    enum: ['system', 'agent', 'user'],
                  },
                  createdBySessionId: {
                    type: ['string', 'null'],
                    format: 'uuid',
                  },
                  lastModifiedBySessionId: {
                    type: ['string', 'null'],
                    format: 'uuid',
                  },
                  metadata: {
                    type: ['object', 'null'],
                    additionalProperties: true,
                    description:
                      'Label-specific relationship metadata declared by the edge contract.',
                  },
                  createdAt: {
                    type: 'string',
                    format: 'date-time',
                  },
                  updatedAt: {
                    type: 'string',
                    format: 'date-time',
                  },
                },
              },
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              readOnly: true,
              description: 'The timestamp when the task was created.',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              readOnly: true,
              description: 'The timestamp when the task was last updated.',
            },
            hasProposalSupport: {
              type: 'boolean',
              default: true,
              description:
                'Whether this entity type supports MCP proposal tools (e.g. edit_task). Always true for tasks.',
            },
            archivedAt: {
              type: ['string', 'null'],
              format: 'date-time',
              readOnly: true,
              description:
                'The timestamp when the task was archived (soft delete).',
            },
            trackedEntities: {
              type: 'array',
              description:
                'Outgoing `TRACKS` edges from this task, inlined as snapshots so list\nviews render tracked items without a second hop. Populated only for\nGOAL-typed tasks (other task types omit the field or return an empty\narray). Order is unspecified; callers should not rely on it.\n',
              items: {
                $ref: '#/definitions/TrackedEntitySnapshot',
              },
            },
            trackedWorkSummary: {
              description:
                'Compact tracked-work aggregate for GOAL tasks. Populated only when the\nlist read requests `includeTrackedWorkSummary=true`, independently of\n`includeTrackedEntities`. Absent on non-GOAL tasks.\n',
              type: 'object',
              required: [
                'totalCount',
                'completedCount',
                'cancelledCount',
                'pastDueCount',
                'openUndatedCount',
              ],
              properties: {
                totalCount: {
                  type: 'integer',
                  minimum: 0,
                  description: 'Number of resolved tracked targets.',
                },
                completedCount: {
                  type: 'integer',
                  minimum: 0,
                  description: 'Number of tracked targets in COMPLETED status.',
                },
                cancelledCount: {
                  type: 'integer',
                  minimum: 0,
                  description: 'Number of tracked targets in CANCELLED status.',
                },
                pastDueCount: {
                  type: 'integer',
                  minimum: 0,
                  description:
                    "Number of open tracked targets whose own due date is before the server's current time.",
                },
                openUndatedCount: {
                  type: 'integer',
                  minimum: 0,
                  description:
                    "Number of open tracked targets without their own due date. Callers apply the Goal's dueDate to these when deriving progress.",
                },
              },
            },
          },
          description:
            'A task within an organization. Polymorphic over TaskType; the same shape\nrepresents STANDARD, BUG, FEATURE, GOAL, DIAGRAM, DIAGRAM_ELEMENT, and TASK_MONITOR work\nitems. GOAL tasks are top-level by definition (parentTaskId is always null)\nand may have no target date.\nGOAL tasks additionally carry `trackedEntities` — outgoing TRACKS-edge\nsnapshots for the work the goal is tracking. Non-GOAL tasks omit the\nfield or return an empty array.\nWhen requested, GOAL tasks also carry `trackedWorkSummary`, a compact\ncount aggregate that is independent of the `trackedEntities` projection. FEATURE tasks carry `tag`\n(FeatureTag) classifying the feature; the field is absent on all\nnon-FEATURE work-item types.\n',
        },
        targetSessionId: {
          type: 'string',
          minLength: 1,
          description:
            'The platform `agentSession.id` (UUID) of the session this run is operating *against*, when the route observes another session rather than owning its own conversation alone. Used by the session-monitor route as the find-or-create key so subsequent firings against the same target reuse the same monitor AgentSession. Carried only on the Agent Bridge wire; the platform API service does not persist this field.\n',
        },
        taskMonitorId: {
          type: 'string',
          format: 'uuid',
          description:
            'Canonical TASK_MONITOR work-item identity for a coordinating monitor Run. Used only by the shared monitor identity resolver to find or create one coordinator per monitor; source preparation provenance and entity conversation identifiers never participate in this key.\n',
        },
        userComments: {
          type: 'array',
          items: {
            type: 'string',
          },
        },
        fileReferences: {
          $ref: '#/definitions/RunReferences',
        },
      },
    },
    RepositoryPlacementRequest: {
      type: 'object',
      additionalProperties: false,
      required: [
        'projectId',
        'conversationId',
        'workflowId',
        'workflowNodeId',
        'serviceId',
        'machineId',
        'provider',
        'resolvedFrontierModel',
        'reasoningEffort',
        'candidates',
        'instructions',
      ],
      properties: {
        promptType: {
          type: 'string',
          enum: ['repository_placement'],
        },
        projectId: {
          $ref: '#/definitions/WorkTrackerImportRequest/properties/projectId',
        },
        conversationId: {
          $ref: '#/definitions/ConversationControlStopRun/properties/conversationId',
        },
        workflowId: {
          $ref: '#/definitions/WorkTrackerImportRequest/properties/workflowId',
        },
        workflowNodeId: {
          type: 'string',
          minLength: 1,
        },
        serviceId: {
          $ref: '#/definitions/RepositoryFirstWorkRequest/properties/serviceId',
        },
        machineId: {
          $ref: '#/definitions/SignedEnvelopeFields/properties/machineId',
        },
        provider: {
          type: 'string',
          enum: ['claude', 'codex', 'opencode'],
        },
        resolvedFrontierModel: {
          type: 'string',
          minLength: 1,
        },
        reasoningEffort: {
          type: 'string',
          enum: [
            'none',
            'minimal',
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
            'ultra',
            'default',
          ],
        },
        fastMode: {
          type: 'boolean',
        },
        candidates: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['rootKey', 'name', 'description', 'tag', 'children'],
            properties: {
              rootKey: {
                type: 'string',
                format: 'uuid',
                description:
                  'Stable candidate identity retained throughout placement review.',
              },
              name: {
                type: 'string',
              },
              description: {
                type: 'string',
              },
              tag: {
                type: 'string',
                enum: [
                  'product',
                  'frontend',
                  'backend',
                  'infra',
                  'design',
                  'AI',
                ],
                description:
                  'Coarse-grained classification of what kind of work a FEATURE task\nrepresents. Single source of truth — every Feature-shaped DTO that\nsurfaces the tag references this enum.\n\nValues:\n  * `product` — user-facing product capabilities and outcomes.\n  * `frontend` — client/UI-shaped delivery (web, mobile, surfaces).\n  * `backend` — server/API/data-shaped delivery.\n  * `infra` — platform, deployment, observability, build, runtime.\n  * `design` — design-system, visual, or UX research deliverables.\n  * `AI` — AI/agent-shaped delivery: prompts, agent orchestration, runners.\n\nSet on every FEATURE task at creation time. Other task types\n(STANDARD, BUG, GOAL) do not carry a tag.\n',
                example: 'backend',
              },
              children: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['childKey', 'name', 'description', 'tag'],
                  properties: {
                    childKey: {
                      type: 'string',
                      format: 'uuid',
                      description:
                        'Stable display identity; never valid as a root placement key.',
                    },
                    name: {
                      type: 'string',
                    },
                    description: {
                      type: 'string',
                    },
                    tag: {
                      $ref: '#/definitions/RepositoryPlacementRequest/properties/candidates/items/properties/tag',
                    },
                  },
                },
              },
            },
          },
          description:
            'Immutable two-level proposed hierarchy with stable root and child keys.',
        },
        instructions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['rootKey', 'instruction'],
            properties: {
              rootKey: {
                type: 'string',
                format: 'uuid',
              },
              instruction: {
                type: 'string',
                minLength: 1,
                description:
                  'Concise root-only placement guidance; never authorizes candidate mutation.',
              },
            },
          },
          description:
            'Exactly one concise instruction for each proposed root.',
        },
      },
      description:
        'Existing-project-only request asking the paired CLI to suggest one parent for each immutable proposed root. Existing Feature data is read on demand.',
    },
    RepositoryFirstWorkRequest: {
      type: 'object',
      additionalProperties: false,
      required: [
        'projectId',
        'conversationId',
        'workflowId',
        'workflowNodeId',
        'serviceId',
        'machineId',
        'provider',
        'resolvedFrontierModel',
        'reasoningEffort',
        'analysis',
        'materializedFeatureIds',
        'workRequest',
        'followUpRoundCount',
        'followUpAnswers',
      ],
      properties: {
        promptType: {
          type: 'string',
          enum: ['repository_first_work'],
        },
        projectId: {
          $ref: '#/definitions/WorkTrackerImportRequest/properties/projectId',
        },
        conversationId: {
          $ref: '#/definitions/ConversationControlStopRun/properties/conversationId',
        },
        workflowId: {
          $ref: '#/definitions/WorkTrackerImportRequest/properties/workflowId',
        },
        workflowNodeId: {
          type: 'string',
          minLength: 1,
        },
        serviceId: {
          type: 'string',
          pattern:
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          description: 'Unique identifier for a service (branded type)',
          example: '550e8400-e29b-41d4-a716-446655440015',
          'x-typescript-type': 'ServiceId',
          'x-brand': 'ServiceId',
          'x-semantic-type': 'resource-identifier',
        },
        machineId: {
          $ref: '#/definitions/SignedEnvelopeFields/properties/machineId',
        },
        provider: {
          type: 'string',
          enum: ['claude', 'codex', 'opencode'],
        },
        resolvedFrontierModel: {
          type: 'string',
          minLength: 1,
        },
        reasoningEffort: {
          type: 'string',
          enum: [
            'none',
            'minimal',
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
            'ultra',
            'default',
          ],
        },
        fastMode: {
          type: 'boolean',
        },
        analysis: {
          $ref: '#/definitions/RepositoryGroundingSuccess',
        },
        materializedFeatureIds: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'string',
            pattern:
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
            description: 'Unique identifier for a task (branded type)',
            example: '550e8400-e29b-41d4-a716-446655440010',
            'x-typescript-type': 'TaskId',
            'x-brand': 'TaskId',
            'x-semantic-type': 'resource-identifier',
          },
        },
        workRequest: {
          type: 'string',
          minLength: 1,
        },
        followUpRoundCount: {
          type: 'integer',
          minimum: 0,
          maximum: 1,
        },
        followUpAnswers: {
          type: 'array',
          maxItems: 3,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['question', 'answer'],
            properties: {
              question: {
                type: 'string',
                minLength: 1,
              },
              answer: {
                type: 'string',
                minLength: 1,
              },
            },
          },
        },
      },
      description:
        'Stateless first-work request sent after final approval materialized the imported Features. The API owns the follow-up round count and answers so each turn is evaluated from complete state.',
    },
    RepositoryGroundingSuccess: {
      type: 'object',
      additionalProperties: false,
      required: [
        'outcome',
        'serviceId',
        'provider',
        'resolvedFrontierModel',
        'narrative',
        'hierarchy',
        'evidence',
        'briefDiscrepancies',
      ],
      properties: {
        outcome: {
          type: 'string',
          enum: ['success'],
        },
        serviceId: {
          $ref: '#/definitions/RepositoryFirstWorkRequest/properties/serviceId',
          description: 'Service identity analyzed by the paired CLI.',
        },
        provider: {
          type: 'string',
          minLength: 1,
          description:
            'Provider that produced the bounded repository analysis.',
        },
        resolvedFrontierModel: {
          type: 'string',
          minLength: 1,
          description: 'Resolved provider model used for the bounded analysis.',
        },
        narrative: {
          type: 'string',
          minLength: 1,
          description:
            'The single narrative describing the repository-grounded proposal.',
        },
        hierarchy: {
          $ref: '#/definitions/WorkTrackerImportSuccess/properties/hierarchy',
        },
        evidence: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'summary'],
            properties: {
              path: {
                type: 'string',
                minLength: 1,
                pattern:
                  '^(?!/)(?![A-Za-z]:)(?!.*\\\\)(?!.*(^|/)\\.\\.(?:/|$)).+',
                description:
                  'Repository-relative evidence path. It must not be absolute, traverse upward, or contain the machine-local Service root.',
              },
              summary: {
                type: 'string',
                minLength: 1,
                description:
                  'Concise interpretation of the evidence without source text.',
              },
              lineStart: {
                type: 'integer',
                minimum: 1,
              },
              lineEnd: {
                type: 'integer',
                minimum: 1,
              },
            },
            description:
              'Reference to repository evidence. Summaries and line locations are admissible; source bodies and arbitrary local paths are not.',
          },
          description: 'Repository-relative evidence supporting the result.',
        },
        briefDiscrepancies: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['summary', 'rationale', 'material'],
            properties: {
              summary: {
                type: 'string',
                minLength: 1,
                description:
                  'Material difference between the confirmed brief and evidence.',
              },
              rationale: {
                type: 'string',
                minLength: 1,
                description: 'Evidence-backed explanation of the difference.',
              },
              material: {
                type: 'boolean',
                enum: [true],
                description:
                  'Every discrepancy in a successful result is material.',
              },
              evidencePaths: {
                type: 'array',
                items: {
                  type: 'string',
                  minLength: 1,
                  pattern:
                    '^(?!/)(?![A-Za-z]:)(?!.*\\\\)(?!.*(^|/)\\.\\.(?:/|$)).+',
                },
                description:
                  'Repository-relative paths supporting the discrepancy.',
              },
            },
            description:
              'Material discrepancy between the user-confirmed Service brief and repository evidence.',
          },
          description:
            'Material discrepancies from the confirmed Service brief.',
        },
      },
      description:
        'Successful repository capability analysis: exactly one narrative and one tagged two-level hierarchy with repository-relative evidence and material brief discrepancies. Analysis controls and internal review bookkeeping are not part of this completion representation.',
    },
    WorkTrackerImportSuccess: {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'source', 'narrative', 'hierarchy', 'evidence'],
      properties: {
        outcome: {
          type: 'string',
          enum: ['success'],
        },
        source: {
          type: 'string',
          enum: ['jira', 'linear'],
        },
        narrative: {
          type: 'string',
          minLength: 1,
        },
        hierarchy: {
          type: 'object',
          additionalProperties: false,
          required: ['topLevels'],
          properties: {
            topLevels: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'name', 'description', 'tag', 'children'],
                properties: {
                  id: {
                    type: 'string',
                    minLength: 1,
                    description:
                      'Stable display identity for the proposed top-level feature.',
                  },
                  name: {
                    type: 'string',
                    minLength: 1,
                    description: 'Capability-oriented top-level feature name.',
                  },
                  description: {
                    type: 'string',
                    minLength: 1,
                    description:
                      'Markdown describing the capability. Enrichment retains supported purpose, behavior, boundaries, dependencies, and requirements here for review and materialization.',
                  },
                  tag: {
                    $ref: '#/definitions/RepositoryPlacementRequest/properties/candidates/items/properties/tag',
                  },
                  children: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['id', 'name', 'description', 'tag'],
                      properties: {
                        id: {
                          type: 'string',
                          minLength: 1,
                          description:
                            'Stable display identity for the proposed child feature.',
                        },
                        name: {
                          type: 'string',
                          minLength: 1,
                          description:
                            'Capability-oriented child feature name.',
                        },
                        description: {
                          type: 'string',
                          minLength: 1,
                          description:
                            'Markdown describing the capability. Enrichment retains supported purpose, behavior, boundaries, dependencies, and requirements here for review and materialization.',
                        },
                        tag: {
                          $ref: '#/definitions/RepositoryPlacementRequest/properties/candidates/items/properties/tag',
                        },
                      },
                      description:
                        'Leaf node of the proposed hierarchy. Children cannot nest below this level, making the result exactly two levels deep.',
                    },
                  },
                },
                description: 'Top-level node with one non-empty child level.',
              },
            },
          },
          description:
            'One tagged, exactly two-level proposed feature hierarchy.',
        },
        evidence: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['reference', 'summary'],
            properties: {
              reference: {
                type: 'string',
                minLength: 1,
                description:
                  'Source record URL or provider record identifier, never credentials.',
              },
              summary: {
                type: 'string',
                minLength: 1,
              },
            },
          },
        },
      },
      description:
        'Candidate outline only; final server-owned approval materializes Features.',
    },
    RunReferences: {
      type: 'object',
      required: ['resolved', 'unresolved'],
      properties: {
        resolved: {
          type: 'array',
          items: {
            type: 'string',
            minLength: 1,
          },
        },
        unresolved: {
          type: 'array',
          items: {
            type: 'string',
            minLength: 1,
          },
        },
      },
    },
    LocalEntityConversationInfluence: {
      type: 'object',
      required: ['entityId', 'entityType', 'reasoning', 'reasonType'],
      properties: {
        entityId: {
          type: 'string',
          format: 'uuid',
          description: 'ID of the influencing entity',
        },
        entityType: {
          type: 'string',
          description:
            'Type of the influencing entity (e.g. TASK, DESIGN_DOC, ARTIFACT)',
        },
        reasoning: {
          type: 'string',
          description: 'Explanation of how this entity influenced the decision',
        },
        reasonType: {
          type: 'string',
          description:
            "Type of influence relationship. Recognized values: `explicit_mention`, `implied`, `derived`, `origin`. The `origin` value is system-injected to mark the host conversation's workflow-about entity and is not declarable by agents.",
        },
        confidence: {
          type: 'number',
          format: 'float',
          minimum: 0,
          maximum: 1,
          description: 'Confidence score for this influence relationship',
        },
      },
    },
    RunCreatePayloadGoalPm: {
      allOf: [
        {
          type: 'object',
          required: ['promptType', 'userMessage'],
          properties: {
            promptType: {
              type: 'string',
              enum: ['goal_pm'],
            },
          },
        },
        {
          $ref: '#/definitions/LocalGoalPmPromptPayload',
        },
      ],
    },
    LocalGoalPmPromptPayload: {
      type: 'object',
      required: [
        'entity',
        'userMessage',
        'activeConversationId',
        'conversationInventory',
      ],
      properties: {
        entity: {
          $ref: '#/definitions/LocalGoalPmGoal',
        },
        userMessage: {
          type: 'string',
          description:
            'Free-form request to resolve into one Goal PM destination or explicit next action.',
        },
        activeConversationId: {
          type: 'string',
          format: 'uuid',
          description:
            'Canonical conversation active when the request was submitted.',
        },
        conversationInventory: {
          type: 'array',
          items: {
            $ref: '#/definitions/LocalGoalPmConversationInventoryItem',
          },
          description:
            'Authoritative inventory of canonical conversations owned by the active goal. Goal PM may use only these conversations as existing-conversation destinations and message-evidence sources.',
        },
      },
    },
    LocalGoalPmGoal: {
      allOf: [
        {
          $ref: '#/definitions/RunEntityReference',
        },
        {
          type: 'object',
          required: ['entityType', 'taskType'],
          properties: {
            entityType: {
              type: 'string',
              enum: ['TASK'],
            },
            taskType: {
              type: 'string',
              enum: ['GOAL'],
            },
            title: {
              type: 'string',
              description: 'Human-readable goal title',
            },
            description: {
              type: 'string',
              description: 'Goal description',
            },
            acceptanceCriteria: {
              type: 'string',
              description: 'Goal acceptance criteria, when present',
            },
            dueDate: {
              type: 'string',
              format: 'date-time',
              description: 'Goal deadline',
            },
            trackedEntities: {
              type: 'array',
              items: {
                $ref: '#/definitions/TrackedEntitySnapshot',
              },
              description: 'Existing work already tracked by this goal',
            },
          },
        },
      ],
    },
    LocalGoalPmConversationInventoryItem: {
      type: 'object',
      additionalProperties: false,
      required: ['conversationId', 'title', 'owner', 'workflowName'],
      properties: {
        conversationId: {
          type: 'string',
          format: 'uuid',
          description: 'Canonical CONVERSATION identity.',
        },
        title: {
          type: 'string',
          minLength: 1,
          description: 'Canonical meaningful conversation title.',
        },
        owner: {
          $ref: '#/definitions/LocalGoalPmConversationOwner',
        },
        workflowName: {
          type: 'string',
          enum: [
            'adr',
            'initiative-refinement',
            'onboarding',
            'repository-import',
            'work-tracker-import',
            'rfc',
            'task-generation',
            'task-refinement',
            'task-prioritization',
            'entity-conversation',
            'project-conversation',
            'brainstorm-refinement',
            'decision-refinement',
            'agent-session',
            'daily-session',
            'session-monitor',
            'task-monitor',
            'agent-task-refining',
            'agent-entity-conversation',
            'goal-pm',
            'open-items-triage',
            'agent-project-conversation',
            'agent-design-doc-refining',
            'agent-search',
            'agent-proposal-refining',
            'feature-sync',
            'plan-from-design-doc',
            'feature-tree-conversation',
          ],
          description:
            'Name of the workflow template from src/flows/templates/:\n- adr: Architecture Decision Record creation workflow\n- initiative-refinement: Initiative refinement conversations\n- onboarding: User onboarding flow\n- repository-import: Existing-project repository analysis, review, placement, and import workflow\n- work-tracker-import: One-time Jira or Linear import run on the paired CLI, reviewed and placed like repository import\n- plan-from-design-doc: CLI-driven plan generation seeded by an existing design-doc markdown blob. The first node materializes the design-doc and plan, then the workflow reuses the post-design-doc plan-shaping nodes through to task review.\n- rfc: Request for Comments creation workflow\n- task-generation: Task generation conversations\n- task-refinement: Task refinement conversations\n- task-prioritization: Find highest priority tasks\n- entity-conversation: Conversational agent about a specific entity\n- project-conversation: Conversational agent about an entire project\n- brainstorm-refinement: Brainstorm design doc refinement\n- decision-refinement: Decision design doc refinement\n- agent-session: Pseudo workflow name, no temporal workflow is run\n- daily-session: Daily session conversational agent for assisting with daily goals\n- task-monitor: Canonical coordinating agent for one TASK_MONITOR work item\n- agent-task-refining: Non-temporal agent session for task refinement\n- agent-entity-conversation: Non-temporal agent session for entity-scoped conversation\n- goal-pm: Non-temporal standing Goal PM routing conversation for a GOAL\n- open-items-triage: Non-temporal standing Open Items triage conversation for one user in a project\n- agent-project-conversation: Non-temporal agent session for project-scoped conversation\n- agent-design-doc-refining: Non-temporal agent session for design doc refinement\n- agent-search: Non-temporal agent session for AdvancedSearch agent-search chat\n- agent-proposal-refining: Non-temporal agent session for iterative proposal refinement\n- feature-sync: Initial feature-sync stage run at the start of a coding session, driven by an external CLI agent\n- feature-tree-conversation: Project-scoped conversational agent for exploring and restructuring the feature hierarchy — structural rebalancing, project insights, and competitive analysis. Launched from the Features page "Discuss" action.\n',
        },
      },
    },
    LocalGoalPmConversationOwner: {
      type: 'object',
      additionalProperties: false,
      required: ['entityType', 'entityId', 'taskType'],
      properties: {
        entityType: {
          type: 'string',
          enum: ['TASK'],
        },
        entityId: {
          type: 'string',
          format: 'uuid',
          description:
            'Canonical GOAL task identity that owns the conversation.',
        },
        taskType: {
          type: 'string',
          enum: ['GOAL'],
        },
      },
    },
    RunCreatePayloadFreeForm: {
      allOf: [
        {
          type: 'object',
          required: ['promptType', 'userMessage', 'entity'],
          properties: {
            promptType: {
              type: 'string',
              enum: ['free_form'],
            },
            entity: {
              $ref: '#/definitions/RunEntityReference',
            },
          },
        },
        {
          $ref: '#/definitions/LocalFreeFormPromptPayload',
        },
      ],
    },
    LocalFreeFormPromptPayload: {
      type: 'object',
      required: ['userMessage'],
      properties: {
        startupInput: {
          deprecated: true,
          description:
            'Deprecated compatibility input. Entity-scoped launches load canonical context from the persisted Run entity; this field is ignored by the CLI and will be removed in a later schema revision.',
          allOf: [
            {
              $ref: '#/definitions/LocalPromptStartupInput',
            },
          ],
        },
        userMessage: {
          type: 'string',
        },
      },
    },
    RunCreatePayloadDebug: {
      allOf: [
        {
          type: 'object',
          required: ['promptType', 'userMessage', 'entity'],
          properties: {
            promptType: {
              type: 'string',
              enum: ['debug'],
            },
            entity: {
              $ref: '#/definitions/RunEntityReference',
            },
          },
        },
        {
          $ref: '#/definitions/LocalDebugPromptPayload',
        },
      ],
    },
    LocalDebugPromptPayload: {
      type: 'object',
      required: ['userMessage'],
      properties: {
        startupInput: {
          deprecated: true,
          description:
            'Deprecated compatibility input. Entity-scoped launches load canonical context from the persisted Run entity; this field is ignored by the CLI and will be removed in a later schema revision.',
          allOf: [
            {
              $ref: '#/definitions/LocalPromptStartupInput',
            },
          ],
        },
        userMessage: {
          type: 'string',
        },
      },
    },
    RunCreatePayloadResearch: {
      allOf: [
        {
          type: 'object',
          required: ['promptType', 'userMessage', 'entity'],
          properties: {
            promptType: {
              type: 'string',
              enum: ['research'],
            },
            entity: {
              $ref: '#/definitions/RunEntityReference',
            },
          },
        },
        {
          $ref: '#/definitions/LocalResearchPromptPayload',
        },
      ],
    },
    LocalResearchPromptPayload: {
      type: 'object',
      required: ['userMessage'],
      properties: {
        startupInput: {
          deprecated: true,
          description:
            'Deprecated compatibility input. Entity-scoped launches load canonical context from the persisted Run entity; this field is ignored by the CLI and will be removed in a later schema revision.',
          allOf: [
            {
              $ref: '#/definitions/LocalPromptStartupInput',
            },
          ],
        },
        userMessage: {
          type: 'string',
        },
      },
    },
    RunCreatePayloadRunEval: {
      allOf: [
        {
          type: 'object',
          required: ['promptType', 'userMessage', 'entity'],
          properties: {
            promptType: {
              type: 'string',
              enum: ['run_eval'],
            },
            entity: {
              $ref: '#/definitions/RunEntityReference',
            },
          },
        },
        {
          $ref: '#/definitions/LocalRunEvalPromptPayload',
        },
      ],
    },
    LocalRunEvalPromptPayload: {
      type: 'object',
      required: [
        'userMessage',
        'evalRunId',
        'attempts',
        'judgeSetup',
        'settings',
      ],
      properties: {
        startupInput: {
          deprecated: true,
          description:
            'Deprecated compatibility input. Entity-scoped launches load canonical context from the persisted Run entity; this field is ignored by the CLI and will be removed in a later schema revision.',
          allOf: [
            {
              $ref: '#/definitions/LocalPromptStartupInput',
            },
          ],
        },
        userMessage: {
          type: 'string',
        },
        evalRunId: {
          type: 'string',
          format: 'uuid',
          description: 'Eval run this launch belongs to.',
        },
        judgeSetup: {
          type: 'object',
          required: ['provider', 'model'],
          properties: {
            provider: {
              type: 'string',
            },
            model: {
              type: 'string',
            },
            reasoningEffort: {
              type: 'string',
            },
            handlerConfig: {
              type: 'object',
              additionalProperties: true,
              description: 'Handler settings recorded from Agent Config.',
            },
          },
        },
        settings: {
          type: 'object',
          description: 'How the run executes. An absent limit means no limit.',
          required: ['maxConcurrentAttempts'],
          additionalProperties: false,
          properties: {
            maxConcurrentAttempts: {
              type: 'integer',
              minimum: 1,
              default: 3,
            },
            attemptTimeLimitSeconds: {
              type: 'integer',
              minimum: 1,
            },
            attemptTokenLimit: {
              type: 'integer',
              minimum: 1,
            },
          },
        },
        attempts: {
          type: 'array',
          minItems: 1,
          description:
            'Recorded case x configuration attempts. Each carries its case input and configuration.',
          items: {
            type: 'object',
            description:
              'One case x configuration attempt as recorded for the coordinator.',
            required: [
              'attemptId',
              'caseInput',
              'configuration',
              'targetSessionId',
              'targetConversationId',
            ],
            properties: {
              attemptId: {
                type: 'string',
                format: 'uuid',
              },
              targetSessionId: {
                type: 'string',
                format: 'uuid',
                description:
                  "Agent Session the attempt's target runs and writes under.",
              },
              targetConversationId: {
                type: 'string',
                format: 'uuid',
                description:
                  'Conversation prepared at launch alongside the target session.',
              },
              caseInput: {
                type: 'object',
                description:
                  'Approved case content and selections recorded when the run was launched. No project snapshot is implied; discovery reads the live project.\n',
                required: ['id', 'evalCaseId', 'title', 'target', 'grading'],
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  evalCaseId: {
                    type: 'string',
                    format: 'uuid',
                  },
                  title: {
                    type: 'string',
                  },
                  target: {
                    type: 'object',
                    description:
                      'Everything the target handler may see. Never contains checks or rubric.',
                    required: [
                      'situation',
                      'initiatingRequest',
                      'targetHandler',
                    ],
                    properties: {
                      situation: {
                        type: 'string',
                        description:
                          'Approved case content as recorded at launch.',
                      },
                      focalItemId: {
                        type: ['string', 'null'],
                        format: 'uuid',
                      },
                      supportingItemIds: {
                        type: 'array',
                        items: {
                          type: 'string',
                          format: 'uuid',
                        },
                      },
                      initiatingRequest: {
                        type: 'string',
                        description: 'The single request that starts the case.',
                      },
                      targetHandler: {
                        type: 'string',
                        description: 'Handler the case runs through.',
                      },
                    },
                  },
                  grading: {
                    type: 'object',
                    description:
                      'For the coordinator and judge only. Never passed to the target.',
                    required: ['checks', 'rubric'],
                    properties: {
                      expectations: {
                        type: 'string',
                        description:
                          'Expected and forbidden behavior recorded from the approved case.',
                      },
                      checks: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['id', 'description'],
                          properties: {
                            id: {
                              type: 'string',
                            },
                            description: {
                              type: 'string',
                            },
                          },
                        },
                      },
                      rubric: {
                        type: 'array',
                        description: 'Dimensions are data, not an enum.',
                        items: {
                          type: 'object',
                          required: ['key', 'name', 'description'],
                          properties: {
                            key: {
                              type: 'string',
                            },
                            name: {
                              type: 'string',
                            },
                            description: {
                              type: 'string',
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              configuration: {
                type: 'object',
                description:
                  'One model and handler setting a run is repeated across.',
                required: ['id', 'target'],
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  target: {
                    $ref: '#/definitions/LocalRunEvalPromptPayload/properties/judgeSetup',
                  },
                  preparation: {
                    allOf: [
                      {
                        $ref: '#/definitions/LocalRunEvalPromptPayload/properties/judgeSetup',
                      },
                    ],
                    description:
                      'Distinct preparation setting, present only when it differs from the target.',
                  },
                },
              },
            },
          },
        },
      },
    },
    RunCreatePayloadQuick: {
      allOf: [
        {
          type: 'object',
          required: ['promptType', 'userMessage', 'entity'],
          properties: {
            promptType: {
              type: 'string',
              enum: ['quick'],
            },
            entity: {
              $ref: '#/definitions/RunEntityReference',
            },
          },
        },
        {
          $ref: '#/definitions/LocalQuickPromptPayload',
        },
      ],
    },
    LocalQuickPromptPayload: {
      type: 'object',
      required: ['userMessage'],
      properties: {
        startupInput: {
          deprecated: true,
          description:
            'Deprecated compatibility input. Entity-scoped launches load canonical context from the persisted Run entity; this field is ignored by the CLI and will be removed in a later schema revision.',
          allOf: [
            {
              $ref: '#/definitions/LocalPromptStartupInput',
            },
          ],
        },
        userMessage: {
          type: 'string',
        },
      },
    },
    RunCreatePayloadProjectMode: {
      allOf: [
        {
          type: 'object',
          required: ['promptType', 'userMessage', 'entity'],
          properties: {
            promptType: {
              type: 'string',
              enum: ['project_mode'],
              description:
                'Stable routing discriminator for every project-defined MODE. The\nselected MODE work-item identity remains in AgentSession config.\n',
            },
            entity: {
              $ref: '#/definitions/RunEntityReference',
            },
          },
        },
        {
          $ref: '#/definitions/LocalQuickPromptPayload',
        },
      ],
      description:
        'Start-run payload for an explicitly selected project MODE. It preserves the\nordinary coding launch payload while routing through one trusted handler;\nselection and captured files travel in the accompanying AgentSession config.\n',
    },
    RunCreatePayloadDailySession: {
      allOf: [
        {
          type: 'object',
          required: ['promptType'],
          properties: {
            promptType: {
              type: 'string',
              enum: ['daily_session'],
            },
          },
        },
        {
          $ref: '#/definitions/LocalDailySessionPromptPayload',
        },
      ],
    },
    LocalDailySessionPromptPayload: {
      type: 'object',
      required: ['payloadVersion'],
      properties: {
        payloadVersion: {
          type: 'integer',
          minimum: 1,
          description: 'Schema version for backward compatibility.',
          example: 1,
        },
        userMessage: {
          type: 'string',
          description: 'User message to respond to.',
        },
      },
    },
    RunCreatePayloadProjectReport: {
      type: 'object',
      additionalProperties: false,
      required: ['promptType', 'request'],
      properties: {
        promptType: {
          type: 'string',
          enum: ['project_report'],
        },
        request: {
          $ref: '#/definitions/ProjectReportLaunchPayload',
        },
      },
    },
    ProjectReportLaunchPayload: {
      type: 'object',
      additionalProperties: false,
      required: ['requestId', 'attemptId', 'projectId'],
      properties: {
        requestId: {
          type: 'string',
          format: 'uuid',
        },
        attemptId: {
          type: 'string',
          format: 'uuid',
        },
        projectId: {
          type: 'string',
          format: 'uuid',
        },
      },
      description:
        'Bounded launch references shared by the project_report and release_notes prompt types. Load the durable request and page evidence through authorized operations; never embed the activity population or substitute Message IDs.',
    },
    RunCreatePayloadReleaseNotes: {
      type: 'object',
      additionalProperties: false,
      required: ['promptType', 'request'],
      properties: {
        promptType: {
          type: 'string',
          enum: ['release_notes'],
        },
        request: {
          $ref: '#/definitions/ProjectReportLaunchPayload',
        },
      },
      description:
        'Launches a RELEASE_NOTES project report request. Unlike project_report, the run is bound to every active project Service repository and has read-only git and file access to them.',
    },
    LocalTaskRefinerPromptPayload: {
      type: 'object',
      required: ['payloadVersion', 'task', 'userMessage'],
      properties: {
        payloadVersion: {
          type: 'integer',
          minimum: 1,
          description: 'Schema version for backward compatibility.',
          example: 1,
        },
        task: {
          $ref: '#/definitions/LocalPromptTaskInput',
        },
        userMessage: {
          type: 'string',
        },
      },
    },
    LocalFeatureRefinerPromptPayload: {
      type: 'object',
      required: ['payloadVersion', 'feature', 'userMessage'],
      properties: {
        payloadVersion: {
          type: 'integer',
          minimum: 1,
          description: 'Schema version for backward compatibility.',
          example: 1,
        },
        feature: {
          $ref: '#/definitions/LocalPromptTaskInput',
        },
        userMessage: {
          type: 'string',
        },
      },
    },
    LocalDesignDocRefinerPromptPayload: {
      type: 'object',
      required: ['payloadVersion', 'designDoc', 'userMessage'],
      properties: {
        payloadVersion: {
          type: 'integer',
          minimum: 1,
          description: 'Schema version for backward compatibility.',
          example: 1,
        },
        designDoc: {
          $ref: '#/definitions/LocalPromptDesignDocInput',
        },
        userMessage: {
          type: 'string',
          description:
            'User text for the first refiner turn; an empty bind seed before submission.',
        },
      },
    },
    LocalProposalRefinerPromptPayload: {
      type: 'object',
      required: ['payloadVersion', 'proposal', 'userMessage'],
      properties: {
        payloadVersion: {
          type: 'integer',
          minimum: 1,
          description: 'Schema version for backward compatibility.',
          example: 1,
        },
        proposal: {
          $ref: '#/definitions/LocalPromptProposalInput',
        },
        userMessage: {
          type: 'string',
          description:
            'User text for the first refiner turn; an empty bind seed before submission.',
        },
      },
    },
    LocalPromptProposalInput: {
      type: 'object',
      required: [
        'id',
        'action',
        'status',
        'targetEntityId',
        'targetEntityType',
        'updates',
      ],
      properties: {
        reconciliation: {
          description:
            'Server-owned original/current content and immutable revision history for reconciliation. Candidate submissions return to review and never approve or apply.',
          type: 'object',
          additionalProperties: false,
          required: [
            'status',
            'currentBases',
            'revisions',
            'conflictingPaths',
            'interveningProposals',
            'overlaps',
          ],
          properties: {
            status: {
              type: 'string',
              enum: [
                'NOT_APPLICABLE',
                'CURRENT',
                'RECONCILIATION_REQUIRED',
                'AGENT_FIX_REQUIRED',
                'READY_FOR_REVIEW',
              ],
            },
            futureRevision: {
              type: 'integer',
              minimum: 0,
              description:
                'Stored future revision used to prepare this context; include as expectedFutureRevision when submitting future reconciliation.',
            },
            writtenAt: {
              type: 'string',
              format: 'date-time',
              description:
                'When the change under review was originally written; for a merged replacement, when the proposal it reconciles was written.',
            },
            interveningProposals: {
              type: 'array',
              description:
                'Proposals approved on the same target after this change was written, oldest first. Empty for terminal proposals; approved unapplied futures remain reviewable.',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'proposalId',
                  'title',
                  'approvedById',
                  'approvedByName',
                  'approvedAt',
                  'changedPaths',
                  'overlappingPaths',
                  'changes',
                ],
                properties: {
                  proposalId: {
                    type: 'string',
                    format: 'uuid',
                  },
                  title: {
                    type: 'string',
                  },
                  approvedById: {
                    type: ['string', 'null'],
                  },
                  approvedByName: {
                    type: ['string', 'null'],
                  },
                  approvedAt: {
                    type: 'string',
                    format: 'date-time',
                  },
                  changedPaths: {
                    type: 'array',
                    description:
                      'Fields this intervening proposal changed, e.g. `name` or `sections.description`.',
                    items: {
                      type: 'string',
                    },
                  },
                  overlappingPaths: {
                    type: 'array',
                    description:
                      'Fields of `changedPaths` that overlap this proposal and could not be merged.',
                    items: {
                      type: 'string',
                    },
                  },
                  changes: {
                    type: 'array',
                    description:
                      "The intervening proposal's own change per field, from the content it was reviewed against to the result it applied. Empty when that record is unavailable.",
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['path'],
                      properties: {
                        path: {
                          type: 'string',
                        },
                        before: {},
                        after: {},
                      },
                    },
                  },
                },
              },
            },
            overlaps: {
              type: 'array',
              description:
                'Fields an intervening change and this proposal both changed in ways that cannot be combined automatically. Approval stays unavailable until they are resolved.',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['path', 'interveningProposalId'],
                properties: {
                  path: {
                    type: 'string',
                  },
                  proposedValue: {
                    description: "This proposal's value for the field.",
                  },
                  currentValue: {
                    description:
                      "The field's current value after intervening changes.",
                  },
                  interveningProposalId: {
                    type: ['string', 'null'],
                    format: 'uuid',
                  },
                },
              },
            },
            currentBases: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['entityType', 'entityId', 'version', 'content'],
                properties: {
                  entityType: {
                    type: 'string',
                    enum: [
                      'TASK',
                      'DESIGN_DOC',
                      'REPORT',
                      'SERVICE',
                      'AGENT_SESSION',
                      'CONVERSATION',
                      'WORK_ITEM_TYPE',
                      'ENTITY_PROMPT_TEMPLATE',
                      'EDGE',
                    ],
                  },
                  entityId: {
                    type: 'string',
                  },
                  version: {
                    type: 'string',
                    description:
                      'Server-owned version of the exact captured content, including section edits.',
                  },
                  content: {
                    type: 'object',
                    additionalProperties: true,
                    description:
                      'Complete canonical content produced by the owning entity adapter; never a client-supplied historical baseline.',
                  },
                },
              },
            },
            revisions: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'id',
                  'proposalId',
                  'source',
                  'bases',
                  'proposedResult',
                  'intent',
                  'createdAt',
                ],
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  proposalId: {
                    type: 'string',
                    format: 'uuid',
                  },
                  source: {
                    type: 'string',
                    enum: ['AUTHORING', 'MERGE', 'AGENT_FIX', 'MANUAL'],
                  },
                  previousRevisionId: {
                    type: ['string', 'null'],
                    format: 'uuid',
                  },
                  bases: {
                    type: 'array',
                    items: {
                      $ref: '#/definitions/LocalPromptProposalInput/properties/reconciliation/properties/currentBases/items',
                    },
                  },
                  proposedResult: {
                    type: 'object',
                    additionalProperties: true,
                    description:
                      'Complete canonical projected content. Graph change sets are keyed by target identity. Omitted patch fields are preserved from the exact authoring basis.',
                  },
                  intent: {
                    type: ['string', 'null'],
                    description:
                      'Exact authored explanation or title; null when neither was supplied.',
                  },
                  createdAt: {
                    type: 'string',
                    format: 'date-time',
                  },
                },
              },
            },
            conflictingPaths: {
              type: 'array',
              items: {
                type: 'string',
              },
            },
            candidateRevisionId: {
              type: 'string',
              format: 'uuid',
            },
            replacementGroupId: {
              type: 'string',
              format: 'uuid',
            },
            replacementProposalId: {
              type: 'string',
              format: 'uuid',
            },
          },
        },
        id: {
          type: 'string',
          description: 'Proposal ID.',
        },
        action: {
          type: 'string',
          description: 'Proposal action (CREATE, UPDATE, DELETE).',
        },
        status: {
          type: 'string',
          description: 'Current proposal status (DRAFT, APPROVED, REJECTED).',
        },
        targetEntityId: {
          type: 'string',
          description: 'ID of the entity this proposal targets.',
        },
        targetEntityType: {
          type: 'string',
          description: 'Type of the target entity (TASK, DESIGN_DOC, etc).',
        },
        title: {
          type: ['string', 'null'],
          description:
            "Per-action snapshot of the proposal target's display title at the moment the proposal was written. Mirrors `ProposalResponseDto.title` on the platform API. Null on legacy rows that pre-date the column.\n",
        },
        updates: {
          type: 'object',
          additionalProperties: true,
          description: 'The proposed changes payload.',
        },
        influences: {
          type: 'array',
          items: {
            $ref: '#/definitions/LocalPromptProposalInfluence',
          },
          description: 'Entities that influenced this proposal.',
        },
        approvals: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
          description: 'Approval history for this proposal.',
        },
      },
    },
    LocalPromptProposalInfluence: {
      type: 'object',
      required: ['entityId', 'entityType', 'reasoning', 'reasonType'],
      properties: {
        entityId: {
          type: 'string',
        },
        entityType: {
          type: 'string',
        },
        reasoning: {
          type: 'string',
        },
        reasonType: {
          type: 'string',
          description:
            "Type of influence relationship. Recognized values: `explicit_mention`, `implied`, `derived`, `origin`. The `origin` value is system-injected to mark the host conversation's workflow-about entity and is not declarable by agents.",
        },
      },
    },
    RunCreatePayloadAgentSearch: {
      allOf: [
        {
          type: 'object',
          required: ['promptType', 'userMessage', 'entity'],
          properties: {
            promptType: {
              type: 'string',
              enum: ['agent_search'],
            },
            entity: {
              $ref: '#/definitions/RunEntityReference',
            },
          },
        },
        {
          $ref: '#/definitions/LocalAgentSearchPromptPayload',
        },
      ],
    },
    LocalAgentSearchPromptPayload: {
      type: 'object',
      required: ['payloadVersion', 'userMessage'],
      properties: {
        payloadVersion: {
          type: 'integer',
          minimum: 1,
          description: 'Schema version for backward compatibility.',
          example: 1,
        },
        userMessage: {
          type: 'string',
          minLength: 1,
          description:
            'The user input. The agent decides whether it is a search request and, if so, uses unified_search (via MCP) to find matching entities.',
        },
        entityTypes: {
          type: 'array',
          items: {
            $ref: '#/definitions/LocalAgentSearchEntityType',
          },
          description:
            "Optional caller-imposed restriction on which entity types the search may target. The user's message may narrow further within this set.",
        },
      },
    },
    LocalAgentSearchEntityType: {
      type: 'string',
      enum: [
        'ARTIFACT',
        'INITIATIVE',
        'PROJECT',
        'TASK',
        'MESSAGE',
        'CONVERSATION',
        'DESIGN_DOC',
        'AGENT_SESSION',
        'VALIDATION_SESSION',
        'SERVICE',
        'REPORT',
        'IMPLEMENTATION_HINT',
      ],
      description:
        'Entity type supported by unified search. Mirrors the platform EntityType enum.',
    },
    LocalReportUpdatePromptPayload: {
      type: 'object',
      required: [
        'payloadVersion',
        'reportId',
        'reportType',
        'text',
        'entities',
        'changedEntities',
      ],
      properties: {
        payloadVersion: {
          type: 'integer',
          minimum: 1,
          description: 'Schema version for backward compatibility.',
          example: 1,
        },
        reportId: {
          type: 'string',
          minLength: 1,
          description: 'ID of the existing report being updated in place.',
        },
        reportType: {
          type: 'string',
          minLength: 1,
          description: 'Current report type (e.g. GOAL_PROGRESS).',
        },
        title: {
          type: 'string',
          description: 'Current title of the report, if any.',
        },
        text: {
          type: 'string',
          minLength: 1,
          description: 'Current text content of the report (will be replaced).',
        },
        entities: {
          type: 'array',
          items: {
            $ref: '#/definitions/LocalReportEntityRef',
          },
          description: 'Entity refs currently declared on the report.',
        },
        changedEntities: {
          type: 'array',
          items: {
            $ref: '#/definitions/LocalReportUpdateChangedEntity',
          },
          description:
            'Subset of `entities` whose changes triggered this incremental refresh.',
        },
        events: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
          description:
            'Platform events, in arrival order, that accumulated to the threshold.',
        },
      },
    },
    LocalReportEntityRef: {
      type: 'object',
      required: ['entityType', 'entityId', 'relation'],
      properties: {
        entityType: {
          type: 'string',
          description:
            'Entity type (e.g. TASK, FEATURE, INITIATIVE, AGENT_SESSION).',
        },
        entityId: {
          type: 'string',
          description: 'Entity UUID.',
        },
        relation: {
          $ref: '#/definitions/LocalReportEntityRelation',
        },
      },
    },
    LocalReportEntityRelation: {
      type: 'string',
      enum: ['PRIMARY', 'CONTEXT'],
      description:
        'Whether the entity is the primary subject of the report or provides context.',
    },
    LocalReportUpdateChangedEntity: {
      type: 'object',
      required: ['entityType', 'entityId'],
      properties: {
        entityType: {
          type: 'string',
          description:
            'Entity type whose change contributed to this incremental update.',
        },
        entityId: {
          type: 'string',
          description:
            'Entity UUID whose change contributed to this incremental update.',
        },
      },
    },
    RunCreatePayloadFeatureTreeConversation: {
      allOf: [
        {
          type: 'object',
          required: ['promptType', 'userMessage', 'entity'],
          properties: {
            promptType: {
              type: 'string',
              enum: ['feature_tree_conversation'],
            },
            entity: {
              $ref: '#/definitions/RunEntityReference',
            },
          },
        },
        {
          type: 'object',
          description:
            "Payload for the feature-tree-conversation EXTERNAL_AGENT node (promptType=feature_tree_conversation). The CLI fetches the project's feature tree skeleton at session init via `GET /projects/{projectId}/features/skeleton` and injects it into the agent's system prompt, so the wire payload only carries the project handle plus the optional user message that triggered the turn.\n",
          required: ['projectId'],
          properties: {
            projectId: {
              type: 'string',
              format: 'uuid',
              description:
                'Canonical id of the project whose feature tree the conversation is anchored on. Seeds the skeleton fetch the CLI performs at session init.\n',
            },
            userMessage: {
              type: 'string',
              description:
                'Optional free-form text from the user (e.g. the initial ask that opened the conversation). Termination is conversational — controlled by the user, not by the payload.\n',
            },
          },
        },
      ],
    },
    RunCreatePayloadOpenItemsTriage: {
      allOf: [
        {
          type: 'object',
          required: ['promptType', 'userMessage', 'entity'],
          properties: {
            promptType: {
              type: 'string',
              enum: ['open_items_triage'],
            },
            entity: {
              $ref: '#/definitions/RunEntityReference',
            },
          },
        },
        {
          $ref: '#/definitions/OpenItemsTriagePromptPayload',
        },
      ],
    },
    OpenItemsTriagePromptPayload: {
      type: 'object',
      description:
        "Payload for one Open Items triage turn (promptType=open_items_triage). The CLI reads current Open Items, attention and graph context itself on every turn; the requesting user's collection revision is input context only, never a guard on later suggestion application.\n",
      required: ['projectId', 'requestKind', 'mode'],
      properties: {
        projectId: {
          type: 'string',
          format: 'uuid',
        },
        requestKind: {
          $ref: '#/definitions/OpenItemsTriageRequestKind',
        },
        mode: {
          type: 'string',
          enum: ['tidyUp', 'springCleaning'],
          description:
            'tidyUp is the standard review. springCleaning adds a closing-focused pass over a wider attention lookback and can produce additional removeOpenItems suggestions.\n',
        },
        observedCollectionRevision: {
          type: 'integer',
          format: 'int64',
          minimum: 1,
          description:
            'Monotonic revision. Collection, item, and group revisions advance independently; every successful mutation advances the collection revision.',
        },
        userMessage: {
          type: 'string',
          description:
            "Optional user-authored text. For freshPass it is review guidance; for followUp it is the user's conversational message.\n",
        },
        guidance: {
          type: 'string',
          description:
            'Optional review guidance to retain across turns. Send it with followUp requests when userMessage contains the current conversational message.\n',
        },
      },
    },
    OpenItemsTriageRequestKind: {
      type: 'string',
      enum: ['freshPass', 'followUp'],
      description:
        'Run Again and the first turn ask for a fresh suggestion pass from current context; Send asks a follow-up about the existing suggestions.\n',
    },
    RunCreatePayloadVerifyFeature: {
      allOf: [
        {
          type: 'object',
          required: ['promptType', 'userMessage', 'entity'],
          properties: {
            promptType: {
              type: 'string',
              enum: ['verify_feature'],
            },
            entity: {
              $ref: '#/definitions/RunEntityReference',
            },
          },
        },
        {
          $ref: '#/definitions/VerifyFeaturePromptPayload',
        },
      ],
    },
    VerifyFeaturePromptPayload: {
      type: 'object',
      additionalProperties: false,
      description:
        'Payload for one Verify Feature turn (promptType=verify_feature). The session investigates only the flagged concern; the focal Feature is the Run entity and the parent session is the evidence source it reads itself.\n',
      required: ['concern', 'parentAgentSessionId', 'userMessage'],
      properties: {
        concern: {
          type: 'string',
          minLength: 1,
          description:
            'The flagged discrepancy this session investigates, and nothing else.',
        },
        parentAgentSessionId: {
          type: 'string',
          format: 'uuid',
          description:
            'The session whose conversation, Project Assistant findings and Feature Sync outcome the mode reads.\n',
        },
        impactedEntities: {
          type: 'array',
          default: [],
          description:
            'Possibly impacted entities named by the session that raised the concern, in its order. Starting points for the investigation, not its boundary. May be empty; launches from suggestions saved before the field existed omit it and read as empty.\n',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['entityType', 'entityId'],
            properties: {
              entityType: {
                type: 'string',
                minLength: 1,
                description:
                  'Entity type of a possibly impacted entity (any type, e.g. FEATURE, TASK, DESIGN_DOC, CONTRACT, MOCKUP, DIAGRAM, DECISION).',
              },
              entityId: {
                type: 'string',
                format: 'uuid',
              },
            },
          },
        },
        userMessage: {
          type: 'string',
          description:
            "The opening message (or the user's follow-up) for this turn.",
        },
      },
    },
    RunCreatePayloadRepositoryGrounding: {
      allOf: [
        {
          type: 'object',
          required: ['promptType'],
          properties: {
            promptType: {
              type: 'string',
              enum: ['repository_grounding'],
            },
          },
        },
        {
          description:
            'Machine-addressed repository-grounding request carried by the existing EXTERNAL_AGENT trigger rail. The selected machine resolves its own local Service binding; the payload contains no directory path or source body.',
          type: 'object',
          additionalProperties: false,
          required: [
            'projectId',
            'conversationId',
            'workflowId',
            'workflowNodeId',
            'entryMode',
            'serviceId',
            'confirmedServiceBrief',
            'machineId',
            'scope',
            'provider',
            'resolvedFrontierModel',
            'reasoningEffort',
            'bounds',
          ],
          properties: {
            promptType: {
              type: 'string',
              enum: ['repository_grounding'],
              description:
                'Optional transport routing discriminator. It is required by the start-run wrapper and omitted from the standalone machine request carried by a workflow trigger.',
            },
            projectId: {
              $ref: '#/definitions/WorkTrackerImportRequest/properties/projectId',
            },
            conversationId: {
              $ref: '#/definitions/ConversationControlStopRun/properties/conversationId',
            },
            workflowId: {
              $ref: '#/definitions/WorkTrackerImportRequest/properties/workflowId',
            },
            workflowNodeId: {
              type: 'string',
              minLength: 1,
            },
            entryMode: {
              type: 'string',
              enum: ['new_project', 'existing_project'],
              description:
                'Entry path into repository grounding. Both paths converge on the same accepted prerequisites and analysis handoff.',
            },
            serviceId: {
              $ref: '#/definitions/RepositoryFirstWorkRequest/properties/serviceId',
            },
            confirmedServiceBrief: {
              type: 'string',
              minLength: 1,
            },
            machineId: {
              $ref: '#/definitions/SignedEnvelopeFields/properties/machineId',
            },
            scope: {
              oneOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['scope', 'focus'],
                  properties: {
                    scope: {
                      type: 'string',
                      enum: ['focused'],
                    },
                    focus: {
                      type: 'string',
                      minLength: 1,
                      description:
                        'Non-empty user-confirmed focus for a focused analysis.',
                    },
                  },
                  description:
                    'Focused analysis scope, which requires a focus statement.',
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['scope'],
                  properties: {
                    scope: {
                      type: 'string',
                      enum: ['comprehensive'],
                    },
                  },
                  description:
                    'Comprehensive analysis scope. A focus statement is not accepted for this branch because the scope itself is the complete repository request.',
                },
              ],
              description:
                'Discriminated focused or comprehensive analysis scope.',
            },
            provider: {
              type: 'string',
              enum: ['claude', 'codex', 'opencode'],
            },
            resolvedFrontierModel: {
              type: 'string',
              minLength: 1,
            },
            reasoningEffort: {
              type: 'string',
              enum: [
                'none',
                'minimal',
                'low',
                'medium',
                'high',
                'xhigh',
                'max',
                'ultra',
                'default',
              ],
            },
            fastMode: {
              type: 'boolean',
              description:
                'Optional catalog-supported Fast mode preference forwarded unchanged to execution; omitted for unsupported selections.',
            },
            bounds: {
              type: 'object',
              additionalProperties: false,
              required: [
                'maxFiles',
                'maxTotalBytes',
                'maxFileBytes',
                'maxDepth',
                'maxGeneratedFiles',
                'maxIgnoredFiles',
                'maxUnsupportedFiles',
                'maxBinaryFiles',
              ],
              properties: {
                maxFiles: {
                  type: 'integer',
                  minimum: 1,
                  description:
                    'Maximum number of repository files the CLI may inspect.',
                },
                maxTotalBytes: {
                  type: 'integer',
                  minimum: 1,
                  description: 'Maximum aggregate bytes the CLI may read.',
                },
                maxFileBytes: {
                  type: 'integer',
                  minimum: 1,
                  description:
                    'Maximum bytes read from any one repository file.',
                },
                maxDepth: {
                  type: 'integer',
                  minimum: 0,
                  description:
                    'Maximum directory depth traversed from the Service root.',
                },
                maxGeneratedFiles: {
                  type: 'integer',
                  minimum: 0,
                  description:
                    'Maximum generated files admitted to the bounded read.',
                },
                maxIgnoredFiles: {
                  type: 'integer',
                  minimum: 0,
                  description:
                    'Maximum ignored files the CLI may consider during analysis.',
                },
                maxUnsupportedFiles: {
                  type: 'integer',
                  minimum: 0,
                  description:
                    'Maximum unsupported files the CLI may consider during analysis.',
                },
                maxBinaryFiles: {
                  type: 'integer',
                  minimum: 0,
                  description:
                    'Maximum binary files the CLI may consider during analysis.',
                },
              },
              description:
                'Explicit deterministic read bounds copied into the CLI request as analysis controls. They constrain execution and are not echoed in the success completion.',
            },
          },
        },
      ],
    },
    RepositoryFeatureEnrichmentPromptPayload: {
      description:
        'Complete-state Feature enrichment request. Every turn carries the latest accepted repository analysis snapshot, accepted runtime configuration, and all prior answers.',
      type: 'object',
      additionalProperties: false,
      required: [
        'projectId',
        'conversationId',
        'workflowId',
        'workflowNodeId',
        'serviceId',
        'machineId',
        'provider',
        'resolvedFrontierModel',
        'reasoningEffort',
        'analysis',
        'reviewedCandidates',
        'completedRounds',
        'answerBatches',
      ],
      properties: {
        promptType: {
          type: 'string',
          enum: ['repository_feature_enrichment'],
        },
        projectId: {
          $ref: '#/definitions/WorkTrackerImportRequest/properties/projectId',
        },
        conversationId: {
          $ref: '#/definitions/ConversationControlStopRun/properties/conversationId',
        },
        workflowId: {
          $ref: '#/definitions/WorkTrackerImportRequest/properties/workflowId',
        },
        workflowNodeId: {
          type: 'string',
          minLength: 1,
        },
        serviceId: {
          $ref: '#/definitions/RepositoryFirstWorkRequest/properties/serviceId',
        },
        machineId: {
          $ref: '#/definitions/SignedEnvelopeFields/properties/machineId',
        },
        provider: {
          type: 'string',
          enum: ['claude', 'codex', 'opencode'],
        },
        resolvedFrontierModel: {
          type: 'string',
          minLength: 1,
        },
        reasoningEffort: {
          type: 'string',
          enum: [
            'none',
            'minimal',
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
            'ultra',
            'default',
          ],
        },
        fastMode: {
          type: 'boolean',
        },
        analysis: {
          $ref: '#/definitions/RepositoryGroundingSuccess',
          description:
            'Latest accepted repository analysis snapshot. Continuing candidate IDs are preserved when a candidate remains in the analysis; candidates may be added, removed, reparented, or retagged within the two-level hierarchy.',
        },
        reviewedCandidates: {
          $ref: '#/definitions/WorkTrackerImportSuccess/properties/hierarchy',
          description:
            'User-reviewed candidates with stable analysis identities that guide deeper research, including accepted outline corrections.',
        },
        completedRounds: {
          type: 'integer',
          minimum: 0,
          maximum: 2,
        },
        answerBatches: {
          type: 'array',
          maxItems: 2,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['round', 'answers'],
            properties: {
              round: {
                type: 'integer',
                minimum: 1,
                maximum: 2,
              },
              answers: {
                type: 'array',
                minItems: 1,
                maxItems: 3,
                items: {
                  $ref: '#/definitions/RepositoryFirstWorkRequest/properties/followUpAnswers/items',
                },
              },
            },
          },
        },
      },
    },
    RepositoryFirstWorkPromptPayload: {
      description:
        'Complete-state first-work request carried by the EXTERNAL_AGENT trigger rail after imported Features are materialized.',
      type: 'object',
      additionalProperties: false,
      required: [
        'projectId',
        'conversationId',
        'workflowId',
        'workflowNodeId',
        'serviceId',
        'machineId',
        'provider',
        'resolvedFrontierModel',
        'reasoningEffort',
        'analysis',
        'materializedFeatureIds',
        'workRequest',
        'followUpRoundCount',
        'followUpAnswers',
      ],
      properties: {
        promptType: {
          type: 'string',
          enum: ['repository_first_work'],
        },
        projectId: {
          $ref: '#/definitions/WorkTrackerImportRequest/properties/projectId',
        },
        conversationId: {
          $ref: '#/definitions/ConversationControlStopRun/properties/conversationId',
        },
        workflowId: {
          $ref: '#/definitions/WorkTrackerImportRequest/properties/workflowId',
        },
        workflowNodeId: {
          type: 'string',
          minLength: 1,
        },
        serviceId: {
          type: 'string',
          pattern:
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          description: 'Unique identifier for a service (branded type)',
          example: '550e8400-e29b-41d4-a716-446655440015',
          'x-typescript-type': 'ServiceId',
          'x-brand': 'ServiceId',
          'x-semantic-type': 'resource-identifier',
        },
        machineId: {
          $ref: '#/definitions/SignedEnvelopeFields/properties/machineId',
        },
        provider: {
          type: 'string',
          enum: ['claude', 'codex', 'opencode'],
        },
        resolvedFrontierModel: {
          type: 'string',
          minLength: 1,
        },
        reasoningEffort: {
          type: 'string',
          enum: [
            'none',
            'minimal',
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
            'ultra',
            'default',
          ],
        },
        fastMode: {
          type: 'boolean',
        },
        analysis: {
          $ref: '#/definitions/RepositoryGroundingSuccess',
        },
        materializedFeatureIds: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'string',
            pattern:
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
            description: 'Unique identifier for a task (branded type)',
            example: '550e8400-e29b-41d4-a716-446655440010',
            'x-typescript-type': 'TaskId',
            'x-brand': 'TaskId',
            'x-semantic-type': 'resource-identifier',
          },
        },
        workRequest: {
          type: 'string',
          minLength: 1,
        },
        followUpRoundCount: {
          type: 'integer',
          minimum: 0,
          maximum: 1,
        },
        followUpAnswers: {
          type: 'array',
          maxItems: 3,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['question', 'answer'],
            properties: {
              question: {
                type: 'string',
                minLength: 1,
              },
              answer: {
                type: 'string',
                minLength: 1,
              },
            },
          },
        },
      },
    },
    FeatureSyncAnalyzePromptPayload: {
      type: 'object',
      required: ['taskId'],
      description:
        'Payload for the feature-sync analyze EXTERNAL_AGENT node (promptType=feature_sync_analyze). The wire payload binds the task id the analyze turn is anchored on — the task id is the seed for the feature-tree walk and is delivered explicitly rather than resolved server-side from contextMetadata.\n',
      properties: {
        taskId: {
          type: 'string',
          format: 'uuid',
          description:
            'Canonical id of the task the analyze turn is anchored on. Seeds the ancestor walk (`get_feature_sync_context`) and the provenance check (`get_context`).\n',
        },
        userMessage: {
          type: 'string',
          description:
            'Optional free-form hint from the user (e.g. "focus on the auth subtree"). The agent produces unstructured narrative; termination is enforced by the submit_no_discrepancy / submit_discrepancies submission tools, not by the payload.\n',
        },
        launchPlanId: {
          type: 'string',
          minLength: 1,
          description:
            "Plan that the analyze turn was launched from, when the task is part of a plan stage. Threaded onto the wire payload from the run's contextMetadata so the analyze prompt can branch on plan-membership pre-prompt without re-reading session state. Paired with `launchStepId` — both must be present for the planned-task variant of the prompt to engage; either field absent yields the free-task variant.\n",
        },
        launchStepId: {
          type: 'string',
          minLength: 1,
          description:
            'Plan step that the analyze turn was launched from. Paired with `launchPlanId` to identify which step within the plan stage the task is anchored to. Use `launchStageId` (not this field) when calling `get_plan_stage` for the stage catch-up read.\n',
        },
        launchStageId: {
          type: 'string',
          minLength: 1,
          description:
            "Plan stage that contains `launchStepId`. Threaded onto the wire payload from the run's contextMetadata so the agent can call `get_plan_stage(stageId: launchStageId)` directly to surface prior-step reports. Required by the planned-task variant alongside `launchPlanId` and `launchStepId`; if any of the three is absent the free-task variant runs.\n",
        },
      },
    },
    FeatureSyncIteratePromptPayload: {
      type: 'object',
      required: ['discrepancies'],
      description:
        'Payload for the feature-sync iterate EXTERNAL_AGENT node (promptType=feature_sync_iterate). The wire payload carries the outstanding discrepancies the previous analyze (or iterate) turn surfaced — the iterate prompt renders them directly rather than relying on conversation history.\n',
      properties: {
        discrepancies: {
          type: 'array',
          items: {
            $ref: '#/definitions/FeatureSyncDiscrepancy',
          },
          description:
            'The outstanding discrepancies the previous turn surfaced. Rendered into the iterate prompt as the "Outstanding items" section so the agent reasons over them explicitly.\n',
        },
        userMessage: {
          type: 'string',
          description:
            "The user's change request on the previously-surfaced discrepancy set. Termination is enforced by the submit_resolved / submit_revised submission tools.\n",
        },
      },
    },
    FeatureSyncDiscrepancy: {
      type: 'object',
      required: ['summary', 'rationale'],
      description:
        'A single discrepancy surfaced by the feature-sync analyze turn when it detects drift between a declared feature/task and the observed code. Mirrors the server-side `featureSyncDiscrepancySchema` in api/src/flows/nodes/feature-sync/schemas.ts and is the canonical wire shape carried into the iterate trigger payload so the iterate prompt can render the outstanding items directly instead of leaning on conversation history.\n',
      properties: {
        id: {
          type: 'string',
          minLength: 1,
          description:
            'Stable identifier the platform assigns to a flagged item so user decisions and later revised sets can refer back to it.\n',
        },
        summary: {
          type: 'string',
          description: 'Short product-language statement of what looks off.\n',
        },
        rationale: {
          type: 'string',
          description: 'One- or two-sentence reason the item was flagged.\n',
        },
        entityType: {
          type: 'string',
          enum: ['FEATURE', 'TASK', 'DESIGN_DOC', 'SERVICE', 'OTHER'],
          description:
            'The kind of entity the discrepancy points at, when it points at a specific entity. Omitted when the gap is structural rather than entity-scoped.\n',
        },
        entityId: {
          type: 'string',
          description:
            'Canonical id of the entity the discrepancy points at, paired with `entityType`.\n',
        },
        proposal: {
          type: 'string',
          description:
            'Concrete remediation the agent proposes for this discrepancy, when it has one in mind.\n',
        },
      },
    },
    PlanShapingFeatureSyncAnalyzePromptPayload: {
      type: 'object',
      required: ['planId', 'designDocId'],
      description:
        'Payload for the plan-shaping feature-sync analyze EXTERNAL_AGENT node (promptType=plan_shaping_feature_sync_analyze). Mirrors `FeatureSyncAnalyzePromptPayload` but anchors the analyze turn on a plan and its design doc rather than a task: the plan-shaping flow walks the design-doc-declared structure instead of a task-seeded feature-tree, so the wire payload binds the plan id and design doc id explicitly rather than the task seed.\n',
      properties: {
        planId: {
          type: 'string',
          minLength: 1,
          description:
            'Canonical id of the plan the analyze turn is anchored on. Seeds the plan-shaping structure walk.\n',
        },
        designDocId: {
          type: 'string',
          minLength: 1,
          description:
            "Canonical id of the plan's design doc — the declared structure the analyze turn compares against the observed plan shape.\n",
        },
        userMessage: {
          type: 'string',
          description:
            'Optional free-form hint from the user (e.g. "focus on the auth stage"). The agent produces unstructured narrative; termination is enforced by the submit_no_discrepancy / submit_discrepancies submission tools, not by the payload.\n',
        },
      },
    },
    PlanShapingFeatureSyncIteratePromptPayload: {
      type: 'object',
      required: ['planId', 'designDocId', 'discrepancies', 'decisions'],
      description:
        "Payload for the plan-shaping feature-sync iterate EXTERNAL_AGENT node (promptType=plan_shaping_feature_sync_iterate). Every trigger carries the outstanding flagged items in display order and the user's per-item choices, so the turn never depends on provider session history to know what the user is referring to.\n",
      properties: {
        planId: {
          type: 'string',
          minLength: 1,
          description:
            'Canonical delivering Plan identity from the persisted plan seed.',
        },
        designDocId: {
          type: 'string',
          minLength: 1,
          description:
            'Authoritative design document from the persisted plan seed.',
        },
        discrepancies: {
          type: 'array',
          items: {
            $ref: '#/definitions/FeatureSyncDiscrepancy',
          },
          description:
            'The outstanding flagged items, each with its stable `id`, in the order the user saw them.\n',
        },
        decisions: {
          type: 'array',
          items: {
            $ref: '#/definitions/PlanShapingFeatureSyncItemDecision',
          },
        },
        userMessage: {
          type: 'string',
          description:
            "The user's change request on the flagged items. Termination is enforced by the submit_revised submission tool.\n",
        },
      },
    },
    PlanShapingFeatureSyncItemDecision: {
      type: 'object',
      additionalProperties: false,
      required: ['itemId', 'choice'],
      description:
        "The user's choice on one flagged feature-sync item. Guides the next revision pass only; it never approves a proposal or advances the review.\n",
      properties: {
        itemId: {
          type: 'string',
          minLength: 1,
          description: 'The `id` of the flagged item the choice applies to.\n',
        },
        choice: {
          type: 'string',
          enum: ['accept', 'amend', 'dismiss'],
        },
        note: {
          type: 'string',
        },
      },
    },
    PlanShapingProposedStagesPromptPayload: {
      type: 'object',
      required: ['designDocId', 'planId'],
      description:
        "Payload for the plan-shaping proposed-stages EXTERNAL_AGENT node (promptType=plan_shaping_proposed_stages). The agent produces the plan's stages at theme fidelity, each stage carrying its step themes, as platform proposals via the plan-shaping MCP tools. The wire payload carries the canonical handles for the design doc and the plan being shaped — the agent reads their current state in a single batched get_full_entity call (passing both ids as `{ entities: [{ entityType, entityId }, ...] }`) rather than relying on conversation history — plus the optional user message that triggered the turn.\n",
      properties: {
        designDocId: {
          type: 'string',
          format: 'uuid',
          description:
            "Canonical id of the plan's design document. Included in the batched get_full_entity call to ground the proposed stages in the approved design.\n",
        },
        planId: {
          type: 'string',
          format: 'uuid',
          description:
            'Canonical id of the plan being shaped. Included in the batched get_full_entity call so the agent can read the plan and its existing stage/step proposals to author or revise stage proposals against the live plan state.\n',
        },
        userMessage: {
          type: 'string',
          description:
            'Optional free-form text from the user (e.g. feedback on the proposed stages). Termination is enforced by the submit_ready submission tool, not by the payload.\n',
        },
      },
    },
    PlanShapingRefineStagePromptPayload: {
      type: 'object',
      required: ['planId', 'stageId', 'validation'],
      description:
        "Payload for the plan-shaping refine-stage EXTERNAL_AGENT node (promptType=plan_shaping_refine_stage). Fires when the user opens a stage in REFINING status from the plan UI; the agent reads the plan and stage in a single batched get_full_entity call (passing both ids as `{ entities: [{ entityType, entityId }, ...] }`) and expands the stage's theme rows into concrete step proposals via the plan-shaping MCP tools. The wire payload carries the canonical handles for the plan and the specific stage being refined, plus the validation toggle and the optional user message that triggered the turn.\n",
      properties: {
        planId: {
          type: 'string',
          format: 'uuid',
          description:
            'Canonical id of the plan whose stage is being refined. Included in the batched get_full_entity call to keep the expanded steps consistent with the surrounding stages.\n',
        },
        stageId: {
          type: 'string',
          format: 'uuid',
          description:
            "Canonical id of the specific stage being refined. Included in the batched get_full_entity call so the agent can read the stage's existing theme rows and expand them into concrete step proposals.\n",
        },
        validation: {
          $ref: '#/definitions/PlanShapingValidationMode',
        },
        userMessage: {
          type: 'string',
          description:
            'Optional free-form text from the user. Termination is enforced by the submit_ready submission tool, not by the payload.\n',
        },
      },
    },
    PlanShapingValidationMode: {
      type: 'string',
      enum: ['on', 'off'],
      description:
        'Toggle controlling whether the agent runs the post-creation validation pass on its step proposals before submitting. `on` enables the validation pass (the agent re-reads its proposals and revises before terminating); `off` skips it so the agent submits its first-pass proposals directly. Used by the refine-stage node.\n',
    },
    PlanShapingVisualPreviewPromptPayload: {
      type: 'object',
      additionalProperties: false,
      required: [
        'designDocId',
        'planId',
        'featureId',
        'refinementRound',
        'entries',
      ],
      properties: {
        designDocId: {
          type: 'string',
          format: 'uuid',
        },
        planId: {
          type: 'string',
          format: 'uuid',
        },
        featureId: {
          type: 'string',
          format: 'uuid',
        },
        refinementRound: {
          type: 'integer',
          minimum: 0,
        },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'proposalId',
              'artifactFamily',
              'presentationOrder',
              'status',
            ],
            properties: {
              proposalId: {
                type: 'string',
                format: 'uuid',
              },
              artifactFamily: {
                type: 'string',
                enum: ['mockup', 'diagram'],
              },
              presentationOrder: {
                type: 'integer',
                minimum: 0,
              },
              status: {
                type: 'string',
                enum: ['DRAFT', 'APPROVED', 'REJECTED'],
              },
              relationship: {
                type: 'object',
                additionalProperties: false,
                required: ['kind', 'proposalId'],
                properties: {
                  kind: {
                    type: 'string',
                    enum: ['depends_on', 'refines'],
                  },
                  proposalId: {
                    type: 'string',
                    minLength: 1,
                  },
                },
              },
              materializedEntity: {
                type: 'object',
                additionalProperties: false,
                required: ['entityId', 'entityType'],
                properties: {
                  entityId: {
                    type: 'string',
                    format: 'uuid',
                  },
                  entityType: {
                    type: 'string',
                    enum: ['TASK'],
                  },
                },
                description:
                  'The Mockup or Diagram work item an APPROVED visual proposal has been enacted as. Present only when the proposal is APPROVED and its target work item exists; such an unchanged reused visual is presented to the user as its content rather than as a proposal card. Absent for DRAFT, REJECTED, or unresolvable entries.\n',
              },
            },
          },
        },
        acceptedProposalIds: {
          type: 'array',
          items: {
            type: 'string',
            format: 'uuid',
          },
        },
        feedback: {
          type: 'string',
        },
        userMessage: {
          type: 'string',
          description:
            'Optional user-authored refinement note for the current turn.',
        },
      },
      description:
        'Complete API-owned context for one visual-preview refinement turn. Proposal status is a live snapshot supplied by the API; proposal identity, presentation order, and same-family relationship metadata are carried explicitly so the CLI can revise affected visuals and carry unchanged proposals without reconstructing state from conversation text.',
    },
    PlanShapingPhaseBreakdownPromptPayload: {
      type: 'object',
      required: [
        'journeyStep',
        'stageIdx',
        'phaseIdx',
        'phasesInStage',
        'totalPhases',
        'designDocId',
        'planId',
        'approvedVisuals',
      ],
      description:
        "Payload for the plan-shaping phase-breakdown EXTERNAL_AGENT node (promptType=plan_shaping_phase_breakdown). Fires once per journey step after the user approves the JourneyMap. Phase identity is the 2-D `(stageIdx, phaseIdx)` cursor — `stageIdx` indexes the plan's durable stages, `phaseIdx` indexes the journey step within that stage's journey — derived API-side from the already-accumulated phases on FlowContext rather than from a separate counter. The agent investigates the journey step (reading the design doc, the parent feature hierarchy, and the relevant code) and emits a steps-only `{ stageIdx, phaseIdx, plan: { steps } }` payload via `submit_phase_breakdown`. The agent does NOT author PLAN_STEP proposals during the turn and never authors stages — the stage backbone is durable and pre-existing. The workflow accumulates each phase's payload on FlowContext and materializes every phase's steps in one transaction immediately before the FINALIZE transition fires.\n",
      properties: {
        journeyStep: {
          $ref: '#/definitions/JourneyStep',
        },
        stageIdx: {
          type: 'integer',
          minimum: 0,
          description:
            "Zero-based index of the current stage within the plan's ordered durable stages. The first half of the 2-D `(stageIdx, phaseIdx)` cursor. The agent MUST echo this value back verbatim on its `submit_phase_breakdown` payload so the API can detect cursor divergence and synthesize an ERROR-class completion.\n",
        },
        phaseIdx: {
          type: 'integer',
          minimum: 0,
          description:
            "Zero-based index of `journeyStep` within stage `stageIdx`'s journey. The second half of the 2-D `(stageIdx, phaseIdx)` cursor. The agent MUST echo this value back verbatim on its `submit_phase_breakdown` payload so the API can detect cursor divergence and synthesize an ERROR-class completion.\n",
        },
        phasesInStage: {
          type: 'integer',
          minimum: 1,
          description:
            'Number of journey steps in stage `stageIdx`\'s journey — the count of phases that share this stage. Derived API-side by grouping `FlowContext.journeySteps` by stage. Pairs with `phaseIdx` (which is per-stage) so the prompt can render an honest "phase N of M in this stage" header; `totalPhases` counts the whole map and would mismatch a per-stage `phaseIdx`.\n',
        },
        totalPhases: {
          type: 'integer',
          minimum: 1,
          description:
            'Total number of journey steps in `FlowContext.journeySteps` across every stage. Used for whole-map accounting, not the per-stage position header (that pairs `phaseIdx` with `phasesInStage`).\n',
        },
        designDocId: {
          type: 'string',
          format: 'uuid',
          description:
            "Canonical id of the plan's design document. Read via get_full_entity({ entities: [{ entityType: 'DESIGN_DOC', entityId: designDocId }] }) to keep stage/step proposals consistent with the approved design.\n",
        },
        planId: {
          type: 'string',
          format: 'uuid',
          description:
            'Canonical id of the plan being expanded. The agent creates stages and steps against this plan.\n',
        },
        priorPhases: {
          type: 'array',
          items: {
            $ref: '#/definitions/PhaseBreakdownPriorPhase',
          },
          description:
            "Steps-only output of every earlier phase in this journey, derived API-side from the entries in `FlowContext.accumulatedPhases` whose `(stageIdx, phaseIdx)` cursor precedes the trigger's. Sorted ascending by cursor. Absent or empty on the first phase. Each entry carries the actual steps the earlier phase emitted, so the current phase agent can stay consistent with what is already in the accumulating plan without re-reading prose summaries.\n",
        },
        approvedVisuals: {
          type: 'array',
          items: {
            $ref: '#/definitions/PlanShapingStepReviewPromptPayload/properties/approvedVisuals/items',
          },
          description:
            'Every Mockup and Diagram the user approved as the visual set, in presentation order. Binding planning context: the steps must implement what these visuals show.\n',
        },
        userMessage: {
          type: 'string',
          description:
            'Optional free-form text from the user. Carried for wire-shape symmetry; phase-breakdown does not accept user messages in v1.\n',
        },
      },
    },
    JourneyStep: {
      type: 'object',
      required: [
        'id',
        'stageId',
        'title',
        'description',
        'isUserInteractive',
        'implementationNotes',
      ],
      description:
        'One ordered step in a user-journey plan view — one *phase* of the journey. Describes what the user does or sees (not what the code does), plus the implementation work required and the services involved. `stageId` binds the step to the durable PlanStage whose journey it belongs to: the journey-map agent emits one journey per existing stage, so every step names its parent stage. `isUserInteractive` is the validation anchor flag — steps marked true are where ValidateIntegration checkpoints attach when validation is enabled. Authored by the journey-map agent and consumed downstream by each phase-breakdown agent turn.\n',
      properties: {
        id: {
          type: 'string',
          minLength: 1,
          description:
            'Stable slug identifying this step within the JourneyMap (e.g. `step-1-open-conversation`). Used as a join key when the phase-breakdown agent reports against this step.\n',
        },
        stageId: {
          type: 'string',
          format: 'uuid',
          description:
            'UUID of the durable PlanStage this journey step (phase) belongs under. Authored by proposed-stages before the journey-map turn runs; the phase-breakdown agent binds every `PhaseBreakdownStep` it emits for this phase to this same stage.\n',
        },
        title: {
          type: 'string',
          minLength: 1,
          description:
            'Short user-facing label naming what the user does or sees.\n',
        },
        description: {
          type: 'string',
          minLength: 1,
          description:
            'One- or two-sentence plain-language description of what the user does or sees in this step. Implementation detail belongs in `implementationNotes`, not here.\n',
        },
        isUserInteractive: {
          type: 'boolean',
          description:
            'True when the user submits a form, clicks a button, or receives a direct UI response in this step. Used by ValidateIntegration as the anchor flag for validation checkpoints.\n',
        },
        implementationNotes: {
          type: 'array',
          items: {
            $ref: '#/definitions/ServiceNote',
          },
          description:
            'Plain-language implementation bullets for this step, each annotated with the platform service that owns the work (or null for cross-cutting notes).\n',
        },
      },
    },
    ServiceNote: {
      type: 'object',
      required: ['text', 'serviceIds', 'serviceName'],
      description:
        'One implementation-note bullet attached to a JourneyStep. Names a plain-language piece of implementation work and the platform service that owns it. `serviceId` and `serviceName` are nullable to express cross-cutting notes that no single service clearly owns; both fields must be present (nullable) so consumers do not have to distinguish "missing" from "intentionally null".\n',
      properties: {
        text: {
          type: 'string',
          minLength: 1,
          description:
            'Plain-language implementation bullet attached to the parent journey step.\n',
        },
        serviceId: {
          type: ['string', 'null'],
          format: 'uuid',
          description:
            'Canonical id of the platform service clearly responsible for the note, or null when the work is cross-cutting / no single service is clearly responsible.\n',
        },
        serviceName: {
          type: ['string', 'null'],
          description:
            'Human-readable name of the service identified by `serviceId`. Null when `serviceId` is null.\n',
        },
      },
    },
    PhaseBreakdownPriorPhase: {
      type: 'object',
      required: ['stageIdx', 'phaseIdx', 'journeyStep', 'plan'],
      description:
        'One entry in the `priorPhases` trigger-payload array — the steps-only output an earlier phase-breakdown turn emitted, paired with the journey step that earlier turn was expanding and its 2-D `(stageIdx, phaseIdx)` cursor. The journey-step is included so the current-phase prompt can render each prior phase under a human-readable label without re-deriving it from `journeySteps` on FlowContext (the trigger payload no longer carries `journeySteps`).\n',
      properties: {
        stageIdx: {
          type: 'integer',
          minimum: 0,
          description:
            "Zero-based stage index of the prior phase. With `phaseIdx`, the 2-D cursor that located the prior phase. Used only as a label here; the current phase's expected cursor is the top-level trigger field.\n",
        },
        phaseIdx: {
          type: 'integer',
          minimum: 0,
          description:
            "Zero-based index of the prior phase's journey step within stage `stageIdx`'s journey. Used only as a label here; the current phase's expected cursor is the top-level trigger field.\n",
        },
        journeyStep: {
          $ref: '#/definitions/JourneyStep',
        },
        plan: {
          $ref: '#/definitions/PhaseBreakdownPlan',
        },
      },
    },
    PhaseBreakdownPlan: {
      type: 'object',
      required: ['steps'],
      description:
        "The structured plan the phase-breakdown agent emits for one journey step — a flat list of steps, each bound by `stageId` to the durable PlanStage the journey step belongs under. A phase emits steps only; it never authors stages, because the stage backbone is already durable from proposed-stages. Carried on the `DONE` completion's payload and accumulated on `PlanFromDesignDocFlowContext.accumulatedPhases` keyed by the `(stageIdx, phaseIdx)` cursor. The platform materializes every accumulated phase's steps in one transaction immediately before the FINALIZE transition fires; nothing is materialized during the agent loop.\n",
      properties: {
        steps: {
          type: 'array',
          items: {
            $ref: '#/definitions/PhaseBreakdownStep',
          },
          description:
            "Steps to materialize under their durable stages. Each step's `stageId` must resolve to an existing PlanStage on the plan.\n",
        },
      },
    },
    PhaseBreakdownStep: {
      type: 'object',
      required: [
        'id',
        'stageId',
        'title',
        'description',
        'type',
        'sequenceOrder',
        'implementation',
        'acceptanceCriteria',
        'designDocMotivation',
      ],
      description:
        'One step the phase-breakdown agent asks the platform to materialize under the durable PlanStage identified by `stageId`. `id` is a\n    stable UUID handle minted by the agent for the reviewed change set.\n    The platform materializes the step directly as a canonical STANDARD\n    Task; no PlanStep or duplicate backing entity is created.\n',
      properties: {
        id: {
          type: 'string',
          format: 'uuid',
          description:
            'Stable UUID handle for this step within the reviewed atomic change set.\n',
        },
        dependsOnStepIds: {
          type: 'array',
          items: {
            type: 'string',
            format: 'uuid',
          },
          description:
            'Explicit prerequisite step handles, directed from this dependent step to each prerequisite. Omission or an empty array declares no prerequisites; sequenceOrder never implies a dependency. References must resolve within the complete retained plan. Full-set review must preserve intended prerequisites, redirect references from merged steps to retained handles, and remove references only when the prerequisite is no longer intended.\n',
        },
        stageId: {
          type: 'string',
          format: 'uuid',
          description:
            "UUID of the durable PlanStage this step is materialized under — the same `stageId` carried on the trigger's `journeyStep`. The stage is authored by proposed-stages and already exists; this phase emits no stages of its own. Materialization fails if this id does not resolve to a stage on the plan.\n",
        },
        title: {
          type: 'string',
          minLength: 1,
          pattern: '\\S',
          description:
            'Short product-language title for the step. Follows the same title conventions `create_step` / `create_steps` document.\n',
        },
        description: {
          type: 'string',
          minLength: 1,
          pattern: '\\S',
          description:
            "Product-language description of the step's intent and scope. Acceptance criteria belong on `acceptanceCriteria`, not here.\n",
        },
        implementation: {
          type: 'string',
          minLength: 1,
          pattern: '\\S',
          description:
            "Per-step prose description of the concrete change this step delivers, bound to a file from the paired PHASE_GROUNDING report's `touchPoints`. The submission tool cross-validates that this string references at least one repo-relative path the agent named in that report, so each step the platform materializes points back at the touch point that motivated it.\n",
        },
        type: {
          $ref: '#/definitions/PhaseBreakdownStepType',
        },
        acceptanceCriteria: {
          type: 'string',
          minLength: 1,
          pattern: '\\S',
          description:
            "Required acceptance-criteria body for the step's backing entity. The value is one string containing newline-delimited markdown bullets (for example, `- First condition\\n- Second condition`), never a JSON array of strings. Every step must declare how its done-state will be verified; missing or empty is rejected at the submission boundary.\n",
        },
        sequenceOrder: {
          type: 'integer',
          minimum: 0,
          description:
            'Zero-based ordering position of this step relative to its siblings under the same `stageId`.\n',
        },
        serviceIds: {
          type: 'array',
          items: {
            type: 'string',
            format: 'uuid',
          },
          description:
            'Optional complete known set of platform Services that own or are modified by the work. Resolve every entry via `list_services` during the investigation pass. When supplied, materialization associates the backing task and PlanStep with every Service in the set. Omit only when Service scope is genuinely unresolved; never guess. Cross-Service work may remain one coherent step when its complete Service set is recorded.\n',
        },
        designDocMotivation: {
          type: 'string',
          minLength: 1,
          pattern: '\\S',
          description:
            'A quoted excerpt or paraphrase of the design-doc passage that motivated this step — used to record a derived influence on the materialized proposal pointing back at the design doc. The agent must supply a non-empty value for every step; empty string is rejected at the submission boundary.\n',
        },
      },
    },
    PhaseBreakdownStepType: {
      type: 'string',
      description:
        'The step kind the phase-breakdown agent is asking the platform to materialize. Every step is a `TASK` — an implementation unit on the platform `PlanStepType` surface.\n',
      enum: ['TASK'],
    },
    PlanShapingStepReviewPromptPayload: {
      type: 'object',
      required: [
        'steps',
        'stageIdx',
        'totalStages',
        'designDocId',
        'planId',
        'approvedVisuals',
      ],
      description:
        "Payload for the plan-shaping step-review EXTERNAL_AGENT node (promptType=plan_shaping_step_review). Fires once per stage after every phase has been expanded by phase-breakdown and before any step is saved. The agent reads the stage's full set of drafted steps together with the design doc and returns the tightened step set for the stage (replace-the-stage-set semantics: drop by omission, merge by returning one in place of two, add with a fresh UUID, rewrite by keeping the UUID and changing fields). The drafted steps arrive on the trigger payload — flattened across the stage's phases in phaseIdx order, each preserving its durable `stageId` and `sequenceOrder` — not via the SDK transcript, because the agent runs with a turn-lived provider session per stage.\n",
      properties: {
        steps: {
          type: 'array',
          items: {
            $ref: '#/definitions/PhaseBreakdownStep',
          },
          description:
            "The stage's drafted steps flattened from `accumulatedPhases[stageIdx]` in phaseIdx order. Every step carries its durable `stageId` and `sequenceOrder` from the phase-breakdown turn that produced it; the agent's tightened set must keep `stageId` unchanged and set `sequenceOrder` in intended final order (materialization sorts by it within a phase before re-numbering per stage).\n",
        },
        stageIdx: {
          type: 'integer',
          minimum: 0,
          description:
            "Zero-based index of the stage under review within the plan's ordered durable stages. The agent MUST echo this value back verbatim on its `submit_step_review` payload so the API can detect cursor divergence and synthesize an ERROR-class completion.\n",
        },
        totalStages: {
          type: 'integer',
          minimum: 1,
          description:
            "Total number of stages in the plan's ordered durable stages (derived API-side from `buildStageJourneys(journeySteps).length`). Used for the per-stage position header the prompt renders.\n",
        },
        designDocId: {
          type: 'string',
          format: 'uuid',
          description:
            "Canonical id of the plan's design document. The handler fetches the design-doc body at `prepare()` and injects it inline into the review prompt so the tightening pass can ground the kept/dropped/rewritten steps in the approved design.\n",
        },
        planId: {
          type: 'string',
          format: 'uuid',
          description:
            'Canonical id of the plan being reviewed. Carried for symmetry with the phase-breakdown payload and surfaced in the prompt for orientation; the agent does not author any platform proposals during the step-review turn.\n',
        },
        approvedVisuals: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'proposalId',
              'entityId',
              'entityType',
              'title',
              'summary',
            ],
            description:
              'One Mockup or Diagram from the approved visual set, resolved server-side when the user approves the set. Approved visuals whose work item cannot be resolved are not listed.\n',
            properties: {
              proposalId: {
                type: 'string',
                format: 'uuid',
              },
              entityId: {
                type: 'string',
                format: 'uuid',
                description:
                  'The Mockup or Diagram work item the approved proposal was enacted as.',
              },
              entityType: {
                type: 'string',
                enum: ['MOCKUP', 'DIAGRAM'],
              },
              title: {
                type: 'string',
                minLength: 1,
              },
              summary: {
                type: 'string',
                description:
                  "First paragraph of the work item's description; empty when the description is empty.\n",
              },
            },
          },
          description:
            'Every Mockup and Diagram the user approved as the visual set, in presentation order. Binding review context: the tightened steps must implement what these visuals show.\n',
        },
        userMessage: {
          type: 'string',
          description:
            'Optional free-form text from the user. Carried for wire-shape symmetry with the other plan-shaping payloads; step-review does not accept user messages in v1.\n',
        },
      },
    },
    PlanShapingFinalizePromptPayload: {
      type: 'object',
      description:
        'Payload for the terminal plan-shaping finalize EXTERNAL_AGENT node (promptType=plan_shaping_finalize). The plan has already landed as platform proposals by this point; the finalize turn confirms and terminates via submit_done. The wire payload carries only the optional user message that triggered the turn.\n',
      properties: {
        userMessage: {
          type: 'string',
          description:
            'Optional free-form text from the user. Termination is enforced by the submit_done submission tool, not by the payload.\n',
        },
      },
    },
    RunCreatePayloadValidationWalkthrough: {
      allOf: [
        {
          type: 'object',
          required: ['promptType', 'entity'],
          properties: {
            promptType: {
              type: 'string',
              enum: ['validation_walkthrough'],
            },
            entity: {
              $ref: '#/definitions/RunEntityReference',
            },
          },
        },
        {
          $ref: '#/definitions/LocalValidationWalkthroughPromptPayload',
        },
      ],
    },
    LocalValidationWalkthroughPromptPayload: {
      type: 'object',
      description:
        'Payload for the validation_walkthrough prompt type. The validation agent reads `scope` plus `entityId` as the launch context the validation session is exercising — a single task, a parent task and its split children, or a plan stage. The agent uses these inputs to decide which prior plan/implement reports to pull and which integration seams to cover when authoring the VALIDATION_WALKTHROUGH report.\n',
      required: ['scope', 'entityId'],
      properties: {
        scope: {
          type: 'string',
          description:
            "The scope of the validation walkthrough. `task` covers a single task. `parent_task` covers a parent task and each split child, with explicit integration-seam checks across the children. `plan_stage` covers a plan stage's design doc plus every step's plan/implement reports.\n",
          enum: ['task', 'parent_task', 'plan_stage'],
        },
        entityId: {
          type: 'string',
          format: 'uuid',
          description:
            'ID of the in-scope entity (task id, parent task id, or plan stage id, matching `scope`).\n',
        },
      },
    },
    RunCreatePayloadSetSplitting: {
      allOf: [
        {
          type: 'object',
          required: ['promptType', 'userMessage', 'entity'],
          properties: {
            promptType: {
              type: 'string',
              enum: ['set_splitting'],
            },
            entity: {
              $ref: '#/definitions/RunEntityReference',
            },
          },
        },
        {
          $ref: '#/definitions/LocalSetSplittingPromptPayload',
        },
      ],
    },
    LocalSetSplittingPromptPayload: {
      type: 'object',
      required: ['splitMode', 'userMessage'],
      properties: {
        startupInput: {
          deprecated: true,
          description:
            'Deprecated compatibility input. Entity-scoped launches load canonical context from the persisted Run entity; this field is ignored by the CLI and will be removed in a later schema revision.',
          allOf: [
            {
              $ref: '#/definitions/LocalPromptStartupInput',
            },
          ],
        },
        splitMode: {
          $ref: '#/definitions/LocalSetSplittingSplitMode',
        },
        userGuidance: {
          type: 'string',
        },
        services: {
          type: 'array',
          items: {
            $ref: '#/definitions/LocalSetSplittingService',
          },
          description:
            'Services to split across. OPTIONAL in both modes — the producer may omit it. In service mode, an explicit list pins the split to exactly those services; when absent the agent discovers the services from the task context. In feature mode the list is only a starting point for code exploration. Because the producer can omit it, every consumer MUST treat this as possibly-undefined; the absence is a supported runtime state, not an error.',
        },
        userMessage: {
          type: 'string',
        },
      },
    },
    LocalSetSplittingSplitMode: {
      type: 'string',
      enum: ['feature', 'service'],
    },
    LocalSetSplittingService: {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: {
          type: 'string',
          description: 'Service identifier',
        },
        name: {
          type: 'string',
          description: 'Human-readable service name',
        },
      },
    },
    SessionMonitorPromptPayload: {
      type: 'object',
      required: ['targetSessionId', 'settledTurn', 'workflowContext'],
      description:
        "Payload for the session-monitor EXTERNAL_AGENT node (promptType=session_monitor). Body rides inside `SignedConversationTriggerEnvelope` on the `trigger.conversation` channel just like the other AgentTrigger variants. Carries the work locator, one settled Turn's canonical evidence, and the target conversation's current workflow state. The agent loads every referenced Report via `get_report_body`, evaluates whether Agent Session work remains, and emits one typed continue, defer, or release decision. The CLI owns the selected durable effect and reports handled only after it succeeds.\n",
      properties: {
        targetSessionId: {
          type: 'string',
          format: 'uuid',
          description:
            'Canonical id of the agent session being monitored — the session whose newly-settled Turn this monitor invocation is reviewing.\n',
        },
        settledTurn: {
          $ref: '#/definitions/SessionMonitorSettledTurnEvidence',
        },
        workflowContext: {
          type: 'object',
          required: [
            'state',
            'promptType',
            'nodeId',
            'triggerMessageId',
            'actions',
          ],
          additionalProperties: false,
          properties: {
            state: {
              type: 'string',
              enum: ['agent-pending', 'live-non-agent', 'terminal'],
              description:
                'Canonical current workflow state for the target conversation.',
            },
            promptType: {
              type: ['string', 'null'],
              description:
                'Current or terminal workflow prompt type, when one exists.',
            },
            nodeId: {
              type: ['string', 'null'],
              description:
                'Current EXTERNAL_AGENT node id in the agent-pending state.',
            },
            triggerMessageId: {
              type: ['string', 'null'],
              description:
                'Current pending trigger Message id in the agent-pending state.',
            },
            actions: {
              type: 'array',
              items: {
                type: 'string',
                minLength: 1,
              },
              description:
                'Canonical continuation vocabulary observed for the current workflow boundary. Empty means continuation, when applicable, is response-only.\n',
            },
          },
        },
      },
    },
    SessionMonitorSettledTurnEvidence: {
      type: 'object',
      required: [
        'turnId',
        'promptType',
        'terminalOutcome',
        'completedAssistantMessage',
        'reports',
      ],
      additionalProperties: false,
      properties: {
        turnId: {
          type: 'string',
          minLength: 1,
          description: 'Stable identity of the settled local Turn.',
        },
        promptType: {
          type: 'string',
          minLength: 1,
          description:
            'Prompt or workflow phase evaluated by the settled Turn.',
        },
        terminalOutcome: {
          type: 'string',
          enum: ['COMPLETED', 'FAILED', 'ABORTED'],
          description: 'Terminal outcome recorded by the Turn lifecycle owner.',
        },
        completedAssistantMessage: {
          anyOf: [
            {
              type: 'null',
            },
            {
              allOf: [
                {
                  $ref: '#/definitions/SessionMonitorCompletedAssistantMessage',
                },
              ],
              description:
                'Completed assistant Message evidence. Null when no canonical assistant Message was persisted, including report-only completed subagent Turns and Turns that failed or aborted before message publication.\n',
            },
          ],
        },
        reports: {
          type: 'array',
          items: {
            $ref: '#/definitions/SessionMonitorSettledTurnReport',
          },
          description:
            'Zero or more canonical Reports emitted by the settled Turn.',
        },
      },
    },
    SessionMonitorCompletedAssistantMessage: {
      type: 'object',
      required: ['messageId', 'content'],
      additionalProperties: false,
      properties: {
        messageId: {
          type: 'string',
          format: 'uuid',
          description:
            'Canonical id of the assistant Message that completed the Turn.',
        },
        content: {
          type: 'string',
          minLength: 1,
          description: 'Canonical user-visible assistant Message content.',
        },
      },
    },
    SessionMonitorSettledTurnReport: {
      type: 'object',
      required: ['reportId', 'reportType'],
      additionalProperties: false,
      properties: {
        reportId: {
          type: 'string',
          format: 'uuid',
          description: 'Canonical Report id attached to the settled Turn.',
        },
        reportType: {
          type: 'string',
          minLength: 1,
          description:
            'Canonical Report discriminator read at Turn settlement.',
        },
      },
    },
    TaskMonitorPromptPayload: {
      type: 'object',
      additionalProperties: false,
      required: ['monitorId', 'cause', 'correlationId'],
      properties: {
        monitorId: {
          type: 'string',
          format: 'uuid',
        },
        cause: {
          $ref: '#/definitions/TaskMonitorLifecycleCause',
        },
        correlationId: {
          type: 'string',
          format: 'uuid',
        },
        coordinatorAttemptId: {
          type: 'string',
          format: 'uuid',
          description:
            'Stable committed delivery identity; independent of released Turn correlation.',
        },
        correction: {
          type: 'object',
          additionalProperties: false,
          required: ['attempt', 'validationFailure'],
          properties: {
            attempt: {
              type: 'integer',
              minimum: 1,
              maximum: 2,
            },
            validationFailure: {
              type: 'object',
              additionalProperties: false,
              required: ['code', 'message', 'issues'],
              properties: {
                code: {
                  type: 'string',
                },
                message: {
                  type: 'string',
                },
                issues: {
                  type: 'array',
                  items: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        userMessage: {
          type: 'string',
          maxLength: 5000,
        },
        launchConfig: {
          $ref: '#/definitions/TaskMonitorLaunchConfig',
        },
        judgment: {
          $ref: '#/definitions/TaskMonitorJudgmentResponse',
        },
        settledTurn: {
          $ref: '#/definitions/SessionMonitorSettledTurnEvidence',
          description:
            'Canonical settled-Turn evidence supplied for CONTINUE. The correlationId is the same stable turnId; Reports are optional evidence references and never select Task Monitor admission.\n',
        },
      },
      description:
        'Complete typed Task Monitor lifecycle input. The UI authors this payload on the platform API; the API preserves it inside the signed CLI dispatch envelope. It is never posted to a browser-local CLI endpoint.\n',
    },
    TaskMonitorLifecycleCause: {
      type: 'string',
      enum: [
        'START',
        'PAUSE',
        'RESUME',
        'STOP',
        'JUDGMENT_RESOLVED',
        'CONTINUE',
        'COMPLETE',
        'HALT',
      ],
      description:
        'Lifecycle cause delivered to the Task Monitor handler through the signed start-run or user-message dispatch rail.\n',
    },
    RunCreatePayloadHtmlCssMockupRevision: {
      allOf: [
        {
          type: 'object',
          required: ['promptType', 'entity'],
          properties: {
            promptType: {
              type: 'string',
              enum: ['html_css_mockup_revision'],
            },
            entity: {
              $ref: '#/definitions/RunEntityReference',
            },
          },
        },
        {
          $ref: '#/definitions/LocalHtmlCssMockupRevisionPromptPayload',
        },
      ],
    },
    LocalHtmlCssMockupRevisionPromptPayload: {
      type: 'object',
      additionalProperties: false,
      description:
        'Immutable authoritative HTML/CSS snapshot and selected open, current review annotations used to request one source-plus-resolution proposal. The run entity is the focal task identity.\n',
      required: ['payloadVersion', 'section', 'annotations'],
      properties: {
        payloadVersion: {
          type: 'integer',
          enum: [1],
        },
        section: {
          $ref: '#/definitions/LocalHtmlCssMockupRevisionSection',
        },
        annotations: {
          type: 'array',
          minItems: 1,
          items: {
            $ref: '#/definitions/LocalHtmlCssMockupRevisionAnnotation',
          },
        },
      },
    },
    LocalHtmlCssMockupRevisionSection: {
      type: 'object',
      additionalProperties: false,
      required: [
        'key',
        'html',
        'css',
        'sizeKey',
        'renderedSize',
        'materializedProposalId',
      ],
      properties: {
        key: {
          type: 'string',
          minLength: 1,
        },
        html: {
          type: 'string',
        },
        css: {
          type: 'string',
        },
        sizeKey: {
          type: 'string',
          minLength: 1,
        },
        renderedSize: {
          $ref: '#/definitions/LocalHtmlCssMockupRevisionRenderedSize',
        },
        materializedProposalId: {
          type: 'string',
          format: 'uuid',
        },
      },
    },
    LocalHtmlCssMockupRevisionRenderedSize: {
      type: 'object',
      additionalProperties: false,
      required: ['width', 'height'],
      properties: {
        width: {
          type: 'number',
          exclusiveMinimum: 0,
          minimum: 0,
        },
        height: {
          type: 'number',
          exclusiveMinimum: 0,
          minimum: 0,
        },
      },
    },
    LocalHtmlCssMockupRevisionAnnotation: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'note',
        'category',
        'lifecycle',
        'authoredProposalId',
        'authoredSizeKey',
        'target',
      ],
      properties: {
        id: {
          type: 'string',
          format: 'uuid',
        },
        note: {
          type: 'string',
          minLength: 1,
          maxLength: 4000,
        },
        category: {
          type: 'string',
          enum: ['context', 'suggestion', 'question', 'issue'],
        },
        lifecycle: {
          type: 'string',
          enum: ['open'],
        },
        authoredProposalId: {
          type: 'string',
          format: 'uuid',
        },
        authoredSizeKey: {
          type: 'string',
          minLength: 1,
        },
        target: {
          $ref: '#/definitions/LocalHtmlCssMockupRevisionTarget',
        },
      },
    },
    LocalHtmlCssMockupRevisionTarget: {
      oneOf: [
        {
          $ref: '#/definitions/LocalHtmlCssMockupRevisionElementTarget',
        },
        {
          $ref: '#/definitions/LocalHtmlCssMockupRevisionPositionTarget',
        },
      ],
    },
    LocalHtmlCssMockupRevisionElementTarget: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'nodeId', 'renderedContext'],
      properties: {
        type: {
          type: 'string',
          enum: ['element'],
        },
        nodeId: {
          type: 'string',
          minLength: 1,
        },
        renderedContext: {
          $ref: '#/definitions/LocalHtmlCssMockupRevisionRenderedContext',
        },
      },
    },
    LocalHtmlCssMockupRevisionRenderedContext: {
      type: 'object',
      additionalProperties: false,
      required: ['outerHtmlExcerpt', 'bounds'],
      properties: {
        outerHtmlExcerpt: {
          type: 'string',
          minLength: 1,
          maxLength: 4000,
          description:
            'Bounded sanitized outer HTML for the stable target element.',
        },
        bounds: {
          $ref: '#/definitions/LocalHtmlCssMockupRevisionBounds',
        },
      },
    },
    LocalHtmlCssMockupRevisionBounds: {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y', 'width', 'height'],
      properties: {
        x: {
          type: 'number',
        },
        y: {
          type: 'number',
        },
        width: {
          type: 'number',
          minimum: 0,
        },
        height: {
          type: 'number',
          minimum: 0,
        },
      },
    },
    LocalHtmlCssMockupRevisionPositionTarget: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'x', 'y', 'sizeKey'],
      properties: {
        type: {
          type: 'string',
          enum: ['position'],
        },
        x: {
          type: 'number',
          minimum: 0,
          maximum: 1,
        },
        y: {
          type: 'number',
          minimum: 0,
          maximum: 1,
        },
        sizeKey: {
          type: 'string',
          minLength: 1,
        },
      },
    },
    AgentSessionConfig: {
      oneOf: [
        {
          type: 'object',
          required: ['type', 'version'],
          properties: {
            type: {
              type: 'string',
              enum: ['CODING_SESSION_V1'],
              description:
                'Legacy config-level discriminator for coding-session launch context stored before\nthe current config variant. New callers should emit AgentSessionConfigV2.\n',
            },
            version: {
              type: 'string',
              enum: ['v1'],
              description:
                'Schema-version literal for the legacy coding-session config shape. Required const\nso a future required-field bump can mint a new schema version without mutating\npersisted rows.\n',
            },
            method: {
              $ref: '#/definitions/AgentSessionConfigV2/properties/method',
              description:
                'Wizard-selected launch method. Persisted on the session so it survives reload\nand deep-link navigation, instead of riding URL params and being lost.\n',
            },
          },
          description:
            'Originating versioned blob. Carries only `method`. Retained for read compatibility\nwith rows persisted before V2 landed; the read path normalizes legacy stored rows by\nadding the config-level `type` discriminator. New callers should not emit V1.\n',
        },
        {
          $ref: '#/definitions/AgentSessionConfigV2',
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'version', 'model'],
          properties: {
            type: {
              type: 'string',
              enum: ['ENTITY_CONVERSATION'],
              description:
                'Config-level discriminator for Entity Conversation launch context.\n',
            },
            version: {
              type: 'string',
              enum: ['v1'],
              description:
                'Schema-version literal for the first Entity Conversation config variant.\n',
            },
            model: {
              type: 'string',
              minLength: 1,
              description:
                'Model selected when the Entity Conversation session was launched.\n',
            },
            effort: {
              type: 'string',
              enum: [
                'none',
                'minimal',
                'low',
                'medium',
                'high',
                'xhigh',
                'max',
                'ultra',
                'default',
              ],
              description:
                'Optional reasoning effort selected at launch. Omission preserves the\nhandler-owned default rather than recording an inferred selection.\n',
            },
            projectAssistant: {
              $ref: '#/definitions/AgentSessionConfigV2/properties/projectAssistant',
              description:
                'Optional participation intent for the one-shot Project Assistant\nbootstrap. Omission preserves handler-default behavior; enabled false\nremains distinct from enabled true.\n',
            },
            disableCodexSystemPrompt: {
              type: 'boolean',
              description:
                "Optional Codex-only pilot selection. True replaces Codex's built-in\nbase instructions with the assembled Hey Hey platform prompt when a\nfresh provider thread is started. False or omission preserves the\nexisting initial-prefix delivery mode. The persisted value remains\nauthoritative when the AgentSession is resumed.\n",
            },
            verifyFeature: {
              type: 'object',
              additionalProperties: false,
              required: ['concern', 'parentAgentSessionId'],
              properties: {
                concern: {
                  type: 'string',
                  minLength: 1,
                },
                parentAgentSessionId: {
                  type: 'string',
                  format: 'uuid',
                },
                impactedEntities: {
                  type: 'array',
                  default: [],
                  description:
                    'Starting points named by the session that raised the concern, in its order. May be empty; sessions created before the field existed read as empty.',
                  items: {
                    $ref: '#/definitions/VerifyFeaturePromptPayload/properties/impactedEntities/items',
                  },
                },
              },
              description:
                "Present only on a Verify Feature session. Its presence keeps the\nsession's replies in the verify_feature handler mode, with the\nflagged concern, the session that raised it and the possibly\nimpacted entities it named as starting points.\n",
            },
          },
          description:
            'Typed, versioned launch context for an Entity Conversation AgentSession.\nProvider remains on AgentSession itself, and this graph-only config carries\nno Service, repository, directory, or worktree identity.\n',
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'version', 'requestId', 'attemptId', 'model'],
          properties: {
            type: {
              type: 'string',
              enum: ['PROJECT_REPORT'],
            },
            version: {
              type: 'string',
              enum: ['v1'],
            },
            requestId: {
              type: 'string',
              format: 'uuid',
            },
            attemptId: {
              type: 'string',
              format: 'uuid',
            },
            model: {
              type: 'string',
              minLength: 1,
            },
            effort: {
              type: 'string',
              minLength: 1,
            },
            fastMode: {
              type: 'boolean',
            },
          },
        },
      ],
      description:
        'Discriminated union of all `AgentSessionConfig` variants. The server selects the\nagent-specific config model via the required `type` discriminator and uses `version`\nonly to evolve the schema within that config variant. Callers emit the latest\nvariant for their AgentSession type.\n',
    },
    AgentSessionConfigV2: {
      type: 'object',
      required: ['type', 'version', 'model'],
      properties: {
        type: {
          type: 'string',
          enum: ['CODING_SESSION'],
          description:
            'Config-level discriminator for coding-session launch context. Agent-specific\nconfig variants are selected by this `type`; `version` only evolves the schema\nwithin the selected variant.\n',
        },
        version: {
          type: 'string',
          enum: ['v2'],
          description:
            'Schema-version literal for the current coding-session config variant. Following\nthe rule encoded on V1, a future required-field bump mints a new version const\nrather than mutating this shape; the UI always emits the latest version.\n',
        },
        method: {
          description:
            'Wizard-selected launch method. Persisted on the session so it survives reload\nand deep-link navigation, instead of riding URL params and being lost.\n',
          type: 'string',
          enum: [
            'plan',
            'open',
            'quick',
            'debug',
            'research',
            'split_by_service',
            'split_by_function',
          ],
        },
        model: {
          type: 'string',
          description:
            "Wizard-selected model for the session. Required in V2 so that a session's\nfull launch context can be reconstructed from `config` alone.\n",
        },
        effort: {
          type: 'string',
          description:
            'Wizard-selected reasoning effort, if any. Omitted entirely when the user did\nnot pick one — V2 optionality is "absent", not "explicit null".\n',
        },
        fastMode: {
          type: 'boolean',
          description:
            'Optional provider-neutral Fast mode preference selected for a session.\n`true`, `false`, and omission remain distinct; the provider runner decides\nhow omission applies. This shared persisted intent never carries\nprovider-native values.\n',
        },
        worktree: {
          type: 'string',
          minLength: 1,
          description:
            'Branch name to materialize as a git worktree per selected service at launch.\nPresence means worktree-enabled (the branch to materialize); absence means\nworktree off. Omitted entirely when the wizard has not enabled worktree.\n',
        },
        sessionMonitorTerminalPolicy: {
          description:
            'Optional explicit policy consumed by the session-monitor when terminal\nreports arrive for this coding session. Absence preserves the existing\nmonitoringEnabled/autoDecide behavior.\n',
          type: 'object',
          required: ['implementationDone'],
          additionalProperties: false,
          properties: {
            implementationDone: {
              description:
                'Policy arm applied to canonical IMPLEMENT evidence.',
              type: 'object',
              additionalProperties: false,
              anyOf: [
                {
                  required: ['completion'],
                },
                {
                  required: ['requestReview'],
                },
              ],
              properties: {
                completion: {
                  type: 'object',
                  required: ['action'],
                  additionalProperties: false,
                  properties: {
                    action: {
                      type: 'string',
                      minLength: 1,
                      description:
                        "Workflow action key the monitor may choose. The API validates this against\nthe originating report's `reportGuidance.actions` vocabulary before it writes\nany continuation completion message.\n",
                    },
                    response: {
                      type: 'string',
                      description:
                        'Optional response text to carry on the completion envelope.\n',
                    },
                  },
                },
                requestReview: {
                  type: 'boolean',
                  enum: [true],
                  description:
                    'Request the canonical Review path instead of settling from implementation\nevidence. The report type is intrinsic to this semantic policy arm.\n',
                },
              },
            },
            reviewDone: {
              description:
                'Optional policy arm applied to canonical REVIEW evidence.',
              type: 'object',
              required: ['completion'],
              additionalProperties: false,
              properties: {
                completion: {
                  $ref: '#/definitions/AgentSessionConfigV2/properties/sessionMonitorTerminalPolicy/properties/implementationDone/properties/completion',
                  description:
                    'Completion applied after Session Monitor interprets a canonical REVIEW\noutcome. The report type is intrinsic to this semantic policy arm.\n',
                },
              },
            },
          },
        },
        taskMonitorId: {
          type: 'string',
          format: 'uuid',
          description:
            'Canonical TASK_MONITOR work-item identity that launched this coding\nsession. Present only for Task Monitor-owned sessions and immutable\nafter creation. The platform validates the referenced active work item\nbelongs to the same project before creating the AgentSession.\n',
        },
        projectAssistant: {
          description:
            'Optional Project Assistant behavior flags for this coding session.\nAbsence preserves read-only/default behavior.\n',
          type: 'object',
          additionalProperties: false,
          properties: {
            enabled: {
              type: 'boolean',
              description:
                "Whether the consuming handler's Project Assistant bootstrap may run for\nthis session. False disables only Project Assistant; true or omission\npreserves the handler-declared participation baseline.\n",
            },
            allowEdgeUpdates: {
              type: 'boolean',
            },
            notifyDiscrepancies: {
              type: 'boolean',
            },
            allowUpdateProposals: {
              type: 'boolean',
            },
          },
        },
        planCombinationAggressiveness: {
          description:
            'Optional launch/session choice consumed by the plan-shaping step-review\nsweep to decide how aggressively drafted steps may be combined before\nmaterialization. Absence means medium.\n',
          type: 'string',
          enum: ['low', 'medium', 'high'],
        },
        projectModeSelection: {
          $ref: '#/definitions/ProjectModeSelection',
          description:
            'Explicit project MODE identity. When present, `projectModeSnapshot` is\nalso required by the session-creation and Agent Bridge admission\nboundaries; built-in selections continue to use `method` unchanged.\n',
        },
        projectModeSnapshot: {
          $ref: '#/definitions/ProjectModeSnapshot',
          description:
            'Immutable platform-captured configuration for `projectModeSelection`.\nIt is never reconstructed from live work-item state by a consumer.\n',
        },
      },
      description:
        'Typed, versioned blob that persists wizard-selected launch context on the\nAgentSession entity. Grows the V1 shape with a config-level `type` discriminator,\n`model` (required), `effort`, `fastMode`, and `worktree`. The field grows when a\nnew launch-time concept needs a durable home. Built-in routing remains on\n`method`; an explicit project MODE is represented by the paired selection\nand snapshot fields and routes through the dedicated `project_mode` prompt\ntype without using `modeId` as a prompt type.\n',
    },
    ProjectModeSelection: {
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersion', 'modeId'],
      properties: {
        schemaVersion: {
          type: 'string',
          enum: ['project-mode-selection.v1'],
        },
        modeId: {
          type: 'string',
          format: 'uuid',
          description:
            'Canonical work-item identity of the explicitly selected MODE.',
        },
      },
      description:
        'Stable identity of an explicitly selected project MODE. This is launch\nselection data, not a CLI prompt type or logical provider-session agent\nidentity.\n',
    },
    ProjectModeSnapshot: {
      type: 'object',
      additionalProperties: false,
      required: [
        'schemaVersion',
        'modeId',
        'catalogDescription',
        'applicableWorkItemTypeKeys',
        'files',
        'snapshotHash',
      ],
      properties: {
        schemaVersion: {
          type: 'string',
          enum: [
            'project-mode-snapshot.v1',
            'project-mode-snapshot.v2',
            'project-mode-snapshot.v3',
          ],
          description:
            'v3 adds the resolved `sessionRole`. v2 adds `projectAssistant`.\nv1/v2 retain their original hash inputs for resume compatibility.\n',
        },
        modeId: {
          type: 'string',
          format: 'uuid',
          description:
            'MODE identity this immutable launch snapshot was captured from.',
        },
        catalogDescription: {
          type: 'string',
          description:
            'Canonical catalog description captured when the session was created.',
        },
        applicableWorkItemTypeKeys: {
          type: 'array',
          items: {
            type: 'string',
            minLength: 1,
          },
          description:
            'Stable effective work-item type keys the MODE applied to at capture time.',
        },
        files: {
          $ref: '#/definitions/ProjectModeFiles',
        },
        projectAssistant: {
          $ref: '#/definitions/ProjectModeProjectAssistantSetting',
        },
        sessionRole: {
          $ref: '#/definitions/SessionRole',
        },
        snapshotHash: {
          type: 'string',
          pattern: '^[a-f0-9]{64}$',
          description:
            'Lowercase hexadecimal SHA-256 digest of the platform-canonicalized\nsnapshot content. Consumers preserve and compare this value; they do\nnot refresh the snapshot from the live MODE.\n',
        },
      },
      description:
        'Platform-captured immutable MODE configuration persisted with a coding\nsession. The repeated mode identity lets admission verify that the snapshot\nmatches `ProjectModeSelection` before constructing a Run or Turn.\nv3 requires sessionRole and projectAssistant; v2 requires projectAssistant\nand excludes sessionRole; v1 excludes both fields.\n',
    },
    ProjectModeFiles: {
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersion', 'files'],
      properties: {
        schemaVersion: {
          type: 'string',
          enum: ['project-mode-files.v1'],
          description: 'Version of the project MODE file-bundle schema.',
        },
        files: {
          type: 'object',
          minProperties: 1,
          required: ['MODE.md'],
          'x-propertyNames': {
            pattern:
              '^(?!/)(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*//)(?!.*\\\\)[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$',
          },
          properties: {
            'MODE.md': {
              type: 'string',
              minLength: 1,
              description:
                'Required entry instructions for the selected project MODE.',
            },
          },
          additionalProperties: {
            type: 'string',
          },
          description:
            'Text files keyed by safe relative POSIX paths. `MODE.md` is the required\nentry document; supporting files remain available for on-demand reads.\n',
        },
      },
      description:
        "Closed, versioned value stored in a MODE work item's schema-backed `files`\nsection. File paths are relative and file values are text; the bundle does\nnot carry executable hooks, tool grants, or provider configuration.\n",
    },
    ProjectModeProjectAssistantSetting: {
      type: 'object',
      additionalProperties: false,
      required: ['enabled'],
      properties: {
        enabled: {
          type: 'boolean',
          description:
            "Whether Project Assistant runs before the MODE's first turn.",
        },
      },
      description:
        "Project Assistant participation chosen by the MODE author. It is the\nproject-mode handler's participation baseline rather than a\nsession-configuration override, which is why it may turn participation on.\n",
    },
    SessionRole: {
      type: 'string',
      description:
        'Kind of work performed by a mode session, independent of mode identity and work-item-type registry role.',
      enum: ['implementation', 'research', 'planning', 'review'],
      default: 'implementation',
    },
    AgentSkillSelection: {
      type: 'object',
      required: ['provider', 'name', 'catalogScope'],
      properties: {
        provider: {
          $ref: '#/definitions/AgentSkillProvider',
        },
        name: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description:
            'Provider-owned Skill name. Host paths are never part of the selection.',
        },
        catalogScope: {
          $ref: '#/definitions/AgentSkillCatalogScope',
        },
      },
      additionalProperties: false,
    },
    AgentSkillCatalogScope: {
      type: 'string',
      enum: ['user', 'repo', 'system', 'admin'],
    },
    UserMessagePromptPayload: {
      type: 'object',
      required: ['handlerPromptType', 'userMessage', 'attachments'],
      description:
        "Payload for the user-message follow-up variant (AgentTriggerUserMessage, sentinel promptType=`user_message`). Carried on the SYSTEM trigger emitted when a USER message lands on a conversation with an active AgentSession binding. The CLI dispatcher routes off `handlerPromptType` (the actual LocalPromptType routing key) rather than the sentinel `user_message` discriminator, and forwards `userMessage` as the user's text body on the resulting Agent Bridge prompt operation. Most follow-ups use the already-loaded CLI run state; feature-sync iterate follow-ups also carry their typed outstanding-item context so prompt reconstruction never depends on a provider session retaining its original startup payload.\n",
      properties: {
        handlerPromptType: {
          type: 'string',
          minLength: 1,
          description:
            "The actual LocalPromptType routing key from the Agent Bridge contract that the CLI should dispatch the follow-up turn against (e.g. `feature_sync_analyze`, `feature_tree_conversation`, `implement`). The API resolves it from the conversation's current node via `FlowExecutionService.resolveConversationPromptType` so the follow-up turn lands on the same handler the conversation is already paused on. Carried as a plain string because the LocalPromptType enum is owned by the transport-neutral Agent Bridge contract; the CLI narrows this string against its own enum at the dispatcher boundary.\n",
        },
        userMessage: {
          type: 'string',
          description:
            "Plain-text body of the USER message this trigger follows up on. Extracted server-side via `UserMessageExtractor.extractContent` so the field matches whatever the rest of the engine treats as the user's text content (the extractor tries `message → comment → feedback → message-keyword fields → first non-empty string`).\n",
        },
        attachments: {
          type: 'array',
          items: {
            $ref: '#/definitions/StartRunPromptPayload/properties/attachments/items',
          },
          description:
            'Files the user attached to this USER message, copied from `UserMessageData.attachments`; empty when none. The CLI resolves each reference to the file it stored for this Run and sends its contents as separate provider input without changing userMessage. Supported files are UTF-8 text/code files and PNG, JPEG or WebP images. Unsupported formats are rejected; an unresolvable reference rejects the message.\n',
        },
        skillSelection: {
          $ref: '#/definitions/AgentSkillSelection',
          description:
            'Optional pathless Skill identity for this follow-up turn. The provider resolves it locally from the active Run workspace.\n',
        },
        taskMonitorPayload: {
          $ref: '#/definitions/TaskMonitorPromptPayload',
          description:
            'Typed Task Monitor fields preserved from UserMessageData.agentInput when handlerPromptType is task_monitor. Absent for every other handler.\n',
        },
        featureSyncContext: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['discrepancies'],
              description:
                'The feature-sync iterate fields copied from the active flow context for a follow-up turn. The handler is selected by the enclosing `handlerPromptType`; its outstanding discrepancies are passed through in their existing order. An empty array means the flow explicitly has no outstanding discrepancies.\n',
              properties: {
                discrepancies: {
                  type: 'array',
                  items: {
                    $ref: '#/definitions/FeatureSyncDiscrepancy',
                  },
                },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['planId', 'designDocId', 'discrepancies', 'decisions'],
              description:
                'The plan-shaping feature-sync iterate fields copied from the active flow context for a follow-up turn. The handler is selected by the enclosing `handlerPromptType`; outstanding discrepancies remain in their existing order and every explicit decision is preserved. Empty arrays are valid when the flow explicitly has no findings or pending choices.\n',
              properties: {
                planId: {
                  type: 'string',
                  minLength: 1,
                  description:
                    'Canonical delivering Plan identity from the persisted plan seed.',
                },
                designDocId: {
                  type: 'string',
                  minLength: 1,
                  description:
                    'Authoritative design document from the persisted plan seed.',
                },
                discrepancies: {
                  type: 'array',
                  items: {
                    $ref: '#/definitions/FeatureSyncDiscrepancy',
                  },
                },
                decisions: {
                  type: 'array',
                  items: {
                    $ref: '#/definitions/PlanShapingFeatureSyncItemDecision',
                  },
                },
              },
            },
          ],
          description:
            'Typed iterate context preserved from UserMessageData.agentInput for feature_sync_iterate and plan_shaping_feature_sync_iterate follow-ups. Required for those two handlerPromptType values and absent otherwise.\n',
        },
        runtime: {
          $ref: '#/definitions/ImplementRuntimeSelection',
          description:
            "The provider, model, reasoning effort and Fast mode the user picked for this one `commit` or `code_review` follow-up, preserved from UserMessageData.agentInput. The sub-agent for that Turn runs on exactly this selection and the Run's stored runtime is left unchanged; an omitted `reasoningEffort` or `fastMode` is not filled from the Run. Absent when the user made no selection, in which case the sub-agent uses the Run's current settings. Valid only for those two handlerPromptType values.\n",
        },
      },
    },
    ImplementRuntimeSelection: {
      type: 'object',
      required: ['provider', 'model'],
      properties: {
        provider: {
          type: 'string',
          enum: ['claude', 'codex', 'opencode'],
          description: 'Agent provider selected for the implementation run.',
        },
        model: {
          type: 'string',
          minLength: 1,
          description: 'Provider model selected for the implementation run.',
        },
        reasoningEffort: {
          type: 'string',
          enum: [
            'none',
            'minimal',
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
            'ultra',
            'default',
          ],
          description:
            'Reasoning-effort level selected for the implementation run.',
        },
        fastMode: {
          type: 'boolean',
          description:
            'Optional provider-neutral Fast mode selection; omit for unsupported selections.',
        },
      },
      additionalProperties: false,
    },
  },
};

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { createHash } from 'node:crypto';

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validateAction = ajv.compile<HostActionPreparation>({
  ...controllerActionRuntimeSchema,
  $ref: '#/definitions/HostActionPreparation',
});
export const isHostActionPreparation = (
  value: object,
): value is HostActionPreparation => validateAction(value);
const validateInputs = ajv.compile<ControllerActionInputs>({
  ...controllerActionRuntimeSchema,
  $ref: '#/definitions/ControllerActionInputs',
});
export const isControllerActionInputs = (
  value: object,
): value is ControllerActionInputs => validateInputs(value);

function serialize<T>(value: T): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('Cannot canonicalize a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return '[' + value.map((item) => serialize(item ?? null)).join(',') + ']';
  if (typeof value === 'object') {
    const members = Object.entries(value)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return (
      '{' +
      members
        .map(([key, member]) => JSON.stringify(key) + ':' + serialize(member))
        .join(',') +
      '}'
    );
  }
  throw new Error('Cannot canonicalize a non-JSON value');
}

/** Every execution/disclosure input is included by construction. Only read
 * correlation and the preparation's retry identity are transport metadata.
 * Legacy machine catalog selectors retain their existing hash for continuity.
 */
export function hashControllerAction(action: HostActionPreparation): string {
  if (action.targetKind === 'CLI_READ' || !action.inputs) {
    return createHash('sha256').update(serialize(action), 'utf8').digest('hex');
  }
  const { requestId: _retryIdentity, ...semanticAction } = action;
  const inputs = action.inputs;
  if (inputs?.kind === 'CLI_READ') {
    const { requestId: _correlation, ...body } = inputs.body;
    return createHash('sha256')
      .update(
        serialize({ ...semanticAction, inputs: { kind: inputs.kind, body } }),
        'utf8',
      )
      .digest('hex');
  }
  if (
    inputs?.kind === 'CONTROL' &&
    inputs.body.kind === 'permission_decision'
  ) {
    return createHash('sha256')
      .update(
        serialize({
          ...semanticAction,
          inputs: {
            kind: inputs.kind,
            body: { ...inputs.body, reason: inputs.body.reason ?? null },
          },
        }),
        'utf8',
      )
      .digest('hex');
  }
  return createHash('sha256')
    .update(serialize(semanticAction), 'utf8')
    .digest('hex');
}

import type {
  ConversationStartRunRequestDto,
  ControllerStartInputs,
  ControllerMessageInputs,
  UserMessageData,
} from './model/models';
/** Build the delivered start payload before approval. Keep this mapping shared
 * with the API producer, so newly introduced execution inputs have one owner. */
export function startControllerInputs(
  request:
    | ConversationStartRunRequestDto
    | Omit<
        ConversationStartRunRequestDto,
        'authorization' | 'operationId' | 'operationFingerprint' | 'machineId'
      >,
): ControllerStartInputs {
  const semanticRequest =
    'authorization' in request
      ? (({
          authorization: _proof,
          operationId: _operation,
          operationFingerprint: _fingerprint,
          machineId: _machine,
          ...inputs
        }) => inputs)(request)
      : request;
  const { initialMessage, ...payload } = semanticRequest;
  const {
    serviceIds,
    launchServiceId,
    triggersAgent,
    attachments,
    stagedBrowserTab,
    runId: _legacyRunId,
    skillSelection: _unusedStartSkill,
    ...common
  } = payload;
  const services =
    serviceIds && serviceIds.length > 0
      ? {
          serviceIds,
          ...(launchServiceId !== undefined ? { launchServiceId } : {}),
        }
      : {};
  if (request.workflowName) {
    return { kind: 'START_RUN', payload: { ...common, ...services } };
  }
  const suppressDispatch =
    triggersAgent === false ||
    (initialMessage?.role === 'SYSTEM' &&
      initialMessage.triggersAgent === false);
  return {
    kind: 'START_RUN',
    payload: {
      ...common,
      ...services,
      ...(attachments !== undefined ? { attachments } : {}),
      ...(stagedBrowserTab !== undefined ? { stagedBrowserTab } : {}),
      ...(suppressDispatch ? { triggersAgent: false } : {}),
    },
  };
}

function controllerMessageText(data: UserMessageData): string {
  const inputText = data.agentInput?.userMessage;
  if (typeof inputText === 'string' && inputText.trim())
    return inputText.trim();
  for (const text of [data['message'], data['comment'], data['feedback']]) {
    if (typeof text === 'string' && text) return text.trim();
  }
  for (const [key, value] of Object.entries(data)) {
    if (
      typeof value === 'string' &&
      value.trim() &&
      ['message', 'response', 'input', 'text', 'content'].some((word) =>
        key.toLowerCase().includes(word),
      )
    )
      return value.trim();
  }
  for (const value of Object.values(data)) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function messageControllerInputs(
  data: UserMessageData,
): ControllerMessageInputs {
  const input = data.agentInput;
  if (!input || !('promptType' in input))
    throw new Error('Direct messages require a typed prompt input');
  const featureSyncContext =
    input.promptType === 'feature_sync_iterate'
      ? { discrepancies: input.discrepancies }
      : input.promptType === 'plan_shaping_feature_sync_iterate'
        ? {
            planId: input.planId,
            designDocId: input.designDocId,
            discrepancies: input.discrepancies,
            decisions: input.decisions,
          }
        : undefined;
  return {
    kind: 'USER_MESSAGE',
    payload: {
      handlerPromptType: input.promptType,
      userMessage: controllerMessageText(data),
      attachments: data.attachments ?? [],
      ...(input.skillSelection ? { skillSelection: input.skillSelection } : {}),
      ...(input.promptType === 'task_monitor'
        ? {
            taskMonitorPayload: {
              monitorId: input.monitorId,
              cause: input.cause,
              correlationId: input.correlationId,
              ...(input.userMessage ? { userMessage: input.userMessage } : {}),
              ...(input.launchConfig
                ? { launchConfig: input.launchConfig }
                : {}),
              ...(input.judgment ? { judgment: input.judgment } : {}),
            },
          }
        : {}),
      ...(featureSyncContext ? { featureSyncContext } : {}),
      ...((input.promptType === 'commit' ||
        input.promptType === 'code_review') &&
      input.runtime
        ? { runtime: input.runtime }
        : {}),
    },
  };
}
