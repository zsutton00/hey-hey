/* eslint-disable @typescript-eslint/no-unused-vars */
// Generated from OpenAPI by scripts/generate-goal-pm-decision-schema.js.
export const GoalPmRoutingSelectionPayloadSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceMessageId', 'uiElementId', 'selectedOptionId'],
  properties: {
    sourceMessageId: {
      type: 'string',
      format: 'uuid',
      description:
        'Canonical routing MESSAGE whose offered options are being resolved',
    },
    uiElementId: {
      type: 'string',
      minLength: 1,
      description:
        'Identity of the originating typed UI Field on sourceMessageId',
    },
    selectedOptionId: {
      type: 'string',
      minLength: 1,
      description:
        'Exactly one optionId currently offered by sourceMessageId; never an enactment payload',
    },
  },
} as const;

export const GoalPmRoutingPayloadSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['goalId', 'options'],
  properties: {
    goalId: {
      type: 'string',
      format: 'uuid',
      description: 'Canonical GOAL task id for the routing response',
    },
    options: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: [
              'optionId',
              'kind',
              'conversationId',
              'title',
              'evidence',
              'rationale',
            ],
            properties: {
              optionId: {
                type: 'string',
                minLength: 1,
              },
              kind: {
                type: 'string',
                enum: ['existingConversation'],
              },
              conversationId: {
                type: 'string',
                format: 'uuid',
                description:
                  'Canonical CONVERSATION identity; never a MESSAGE identity',
              },
              title: {
                type: 'string',
                minLength: 1,
                description:
                  'Meaningful canonical conversation title; placeholder labels are invalid',
              },
              evidence: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['messageId', 'excerpt', 'rationale'],
                  properties: {
                    messageId: {
                      type: 'string',
                      format: 'uuid',
                      description:
                        'Canonical MESSAGE identity supporting this conversation match',
                    },
                    excerpt: {
                      type: 'string',
                      minLength: 1,
                      description:
                        'Bounded excerpt from the canonical message; never a serialized message object',
                    },
                    rationale: {
                      type: 'string',
                      minLength: 1,
                      description:
                        'Why this message supports the proposed destination',
                    },
                  },
                },
              },
              rationale: {
                type: 'string',
                minLength: 1,
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: [
              'optionId',
              'kind',
              'title',
              'rationale',
              'requiresConfirmation',
            ],
            properties: {
              optionId: {
                type: 'string',
                minLength: 1,
              },
              kind: {
                type: 'string',
                enum: ['startNewConversation'],
              },
              title: {
                type: 'string',
                minLength: 1,
              },
              rationale: {
                type: 'string',
                minLength: 1,
              },
              requiresConfirmation: {
                type: 'boolean',
                enum: [true],
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['optionId', 'kind', 'title', 'prompt', 'rationale'],
            properties: {
              optionId: {
                type: 'string',
                minLength: 1,
              },
              kind: {
                type: 'string',
                enum: ['refineSearch'],
              },
              title: {
                type: 'string',
                minLength: 1,
              },
              prompt: {
                type: 'string',
                minLength: 1,
              },
              rationale: {
                type: 'string',
                minLength: 1,
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: [
              'optionId',
              'kind',
              'target',
              'rationale',
              'requiresSelection',
            ],
            properties: {
              optionId: {
                type: 'string',
                minLength: 1,
              },
              kind: {
                type: 'string',
                enum: ['trackExistingWork'],
              },
              target: {
                oneOf: [
                  {
                    type: 'object',
                    additionalProperties: false,
                    required: ['entityType', 'entityId', 'title'],
                    properties: {
                      entityType: {
                        type: 'string',
                        enum: ['TASK'],
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
                  {
                    type: 'object',
                    additionalProperties: false,
                    required: ['entityType', 'entityId', 'title'],
                    properties: {
                      entityType: {
                        type: 'string',
                        enum: ['PLAN'],
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
                ],
                discriminator: {
                  propertyName: 'entityType',
                },
              },
              rationale: {
                type: 'string',
                minLength: 1,
              },
              requiresSelection: {
                type: 'boolean',
                enum: [true],
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: [
              'optionId',
              'kind',
              'parentFeatureId',
              'workItemType',
              'title',
              'description',
              'acceptanceCriteria',
              'authoringMode',
              'rationale',
              'requiresSelection',
            ],
            properties: {
              optionId: {
                type: 'string',
                minLength: 1,
              },
              kind: {
                type: 'string',
                enum: ['createMissingWork'],
              },
              parentFeatureId: {
                type: 'string',
                format: 'uuid',
              },
              workItemType: {
                type: 'string',
                enum: ['TASK'],
              },
              title: {
                type: 'string',
                minLength: 1,
              },
              description: {
                type: 'string',
                minLength: 1,
              },
              acceptanceCriteria: {
                type: 'string',
                minLength: 1,
              },
              authoringMode: {
                type: 'string',
                enum: ['PROPOSAL'],
              },
              rationale: {
                type: 'string',
                minLength: 1,
              },
              requiresSelection: {
                type: 'boolean',
                enum: [true],
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: [
              'optionId',
              'kind',
              'proposalId',
              'title',
              'rationale',
              'requiresSelection',
            ],
            properties: {
              optionId: {
                type: 'string',
                minLength: 1,
              },
              kind: {
                type: 'string',
                enum: ['proposal'],
              },
              proposalId: {
                type: 'string',
                format: 'uuid',
                description:
                  'Canonical PROPOSAL identity; this option is not a conversation destination',
              },
              title: {
                type: 'string',
                minLength: 1,
              },
              rationale: {
                type: 'string',
                minLength: 1,
              },
              requiresSelection: {
                type: 'boolean',
                enum: [true],
              },
            },
          },
        ],
        discriminator: {
          propertyName: 'kind',
          mapping: {
            existingConversation: '#/GoalPmExistingConversationOption',
            startNewConversation: '#/GoalPmStartNewConversationOption',
            refineSearch: '#/GoalPmRefineSearchOption',
            trackExistingWork: '#/GoalPmTrackExistingWorkOption',
            createMissingWork: '#/GoalPmCreateMissingWorkOption',
            proposal: '#/GoalPmProposalOption',
          },
        },
      },
      description:
        'Ordered, bounded choices offered for explicit user selection',
    },
  },
  description:
    'Typed Goal PM routing choices passed to the existing goal_pm_action UI Field',
} as const;

export const GoalPmRoutingDecisionResponseDtoSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'sourceConversationId',
    'sourceMessageId',
    'uiElementId',
    'selectedOption',
    'decidedBy',
    'createdAt',
  ],
  properties: {
    sourceConversationId: {
      type: 'string',
      format: 'branded-ConversationId',
      pattern:
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      description: 'Unique identifier for a conversation (branded type)',
      example: '550e8400-e29b-41d4-a716-446655440003',
      'x-typescript-type': 'ConversationId',
      'x-brand': 'ConversationId',
      'x-semantic-type': 'resource-identifier',
    },
    sourceMessageId: {
      type: 'string',
      format: 'branded-MessageId',
      pattern:
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      description: 'Unique identifier for a message (branded type)',
      example: '550e8400-e29b-41d4-a716-446655440005',
      'x-typescript-type': 'MessageId',
      'x-brand': 'MessageId',
      'x-semantic-type': 'resource-identifier',
    },
    uiElementId: {
      type: 'string',
      minLength: 1,
    },
    selectedOption: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'optionId',
            'kind',
            'conversationId',
            'title',
            'evidence',
            'rationale',
          ],
          properties: {
            optionId: {
              type: 'string',
              minLength: 1,
            },
            kind: {
              type: 'string',
              enum: ['existingConversation'],
            },
            conversationId: {
              type: 'string',
              format: 'uuid',
              description:
                'Canonical CONVERSATION identity; never a MESSAGE identity',
            },
            title: {
              type: 'string',
              minLength: 1,
              description:
                'Meaningful canonical conversation title; placeholder labels are invalid',
            },
            evidence: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['messageId', 'excerpt', 'rationale'],
                properties: {
                  messageId: {
                    type: 'string',
                    format: 'uuid',
                    description:
                      'Canonical MESSAGE identity supporting this conversation match',
                  },
                  excerpt: {
                    type: 'string',
                    minLength: 1,
                    description:
                      'Bounded excerpt from the canonical message; never a serialized message object',
                  },
                  rationale: {
                    type: 'string',
                    minLength: 1,
                    description:
                      'Why this message supports the proposed destination',
                  },
                },
              },
            },
            rationale: {
              type: 'string',
              minLength: 1,
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'optionId',
            'kind',
            'title',
            'rationale',
            'requiresConfirmation',
          ],
          properties: {
            optionId: {
              type: 'string',
              minLength: 1,
            },
            kind: {
              type: 'string',
              enum: ['startNewConversation'],
            },
            title: {
              type: 'string',
              minLength: 1,
            },
            rationale: {
              type: 'string',
              minLength: 1,
            },
            requiresConfirmation: {
              type: 'boolean',
              enum: [true],
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['optionId', 'kind', 'title', 'prompt', 'rationale'],
          properties: {
            optionId: {
              type: 'string',
              minLength: 1,
            },
            kind: {
              type: 'string',
              enum: ['refineSearch'],
            },
            title: {
              type: 'string',
              minLength: 1,
            },
            prompt: {
              type: 'string',
              minLength: 1,
            },
            rationale: {
              type: 'string',
              minLength: 1,
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'optionId',
            'kind',
            'target',
            'rationale',
            'requiresSelection',
          ],
          properties: {
            optionId: {
              type: 'string',
              minLength: 1,
            },
            kind: {
              type: 'string',
              enum: ['trackExistingWork'],
            },
            target: {
              oneOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['entityType', 'entityId', 'title'],
                  properties: {
                    entityType: {
                      type: 'string',
                      enum: ['TASK'],
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
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['entityType', 'entityId', 'title'],
                  properties: {
                    entityType: {
                      type: 'string',
                      enum: ['PLAN'],
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
              ],
              discriminator: {
                propertyName: 'entityType',
              },
            },
            rationale: {
              type: 'string',
              minLength: 1,
            },
            requiresSelection: {
              type: 'boolean',
              enum: [true],
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'optionId',
            'kind',
            'parentFeatureId',
            'workItemType',
            'title',
            'description',
            'acceptanceCriteria',
            'authoringMode',
            'rationale',
            'requiresSelection',
          ],
          properties: {
            optionId: {
              type: 'string',
              minLength: 1,
            },
            kind: {
              type: 'string',
              enum: ['createMissingWork'],
            },
            parentFeatureId: {
              type: 'string',
              format: 'uuid',
            },
            workItemType: {
              type: 'string',
              enum: ['TASK'],
            },
            title: {
              type: 'string',
              minLength: 1,
            },
            description: {
              type: 'string',
              minLength: 1,
            },
            acceptanceCriteria: {
              type: 'string',
              minLength: 1,
            },
            authoringMode: {
              type: 'string',
              enum: ['PROPOSAL'],
            },
            rationale: {
              type: 'string',
              minLength: 1,
            },
            requiresSelection: {
              type: 'boolean',
              enum: [true],
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'optionId',
            'kind',
            'proposalId',
            'title',
            'rationale',
            'requiresSelection',
          ],
          properties: {
            optionId: {
              type: 'string',
              minLength: 1,
            },
            kind: {
              type: 'string',
              enum: ['proposal'],
            },
            proposalId: {
              type: 'string',
              format: 'uuid',
              description:
                'Canonical PROPOSAL identity; this option is not a conversation destination',
            },
            title: {
              type: 'string',
              minLength: 1,
            },
            rationale: {
              type: 'string',
              minLength: 1,
            },
            requiresSelection: {
              type: 'boolean',
              enum: [true],
            },
          },
        },
      ],
      discriminator: {
        propertyName: 'kind',
        mapping: {
          existingConversation: '#/GoalPmExistingConversationOption',
          startNewConversation: '#/GoalPmStartNewConversationOption',
          refineSearch: '#/GoalPmRefineSearchOption',
          trackExistingWork: '#/GoalPmTrackExistingWorkOption',
          createMissingWork: '#/GoalPmCreateMissingWorkOption',
          proposal: '#/GoalPmProposalOption',
        },
      },
    },
    decidedBy: {
      type: 'string',
      format: 'branded-UserId',
      pattern:
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      description: 'Unique identifier for a user (branded type)',
      example: '550e8400-e29b-41d4-a716-446655440001',
      'x-typescript-type': 'UserId',
      'x-brand': 'UserId',
      'x-semantic-type': 'resource-identifier',
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
    },
  },
} as const;

export const GoalPmRoutingEnactmentRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['selection'],
  properties: {
    selection: {
      type: 'object',
      additionalProperties: false,
      required: ['sourceMessageId', 'uiElementId', 'selectedOptionId'],
      properties: {
        sourceMessageId: {
          type: 'string',
          format: 'uuid',
          description:
            'Canonical routing MESSAGE whose offered options are being resolved',
        },
        uiElementId: {
          type: 'string',
          minLength: 1,
          description:
            'Identity of the originating typed UI Field on sourceMessageId',
        },
        selectedOptionId: {
          type: 'string',
          minLength: 1,
          description:
            'Exactly one optionId currently offered by sourceMessageId; never an enactment payload',
        },
      },
    },
    creation: {
      type: 'object',
      additionalProperties: false,
      required: ['config', 'provider', 'machineId'],
      properties: {
        config: {
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
              description:
                'Optional launch-time Project Assistant participation and behavior settings\npersisted on AgentSession config. Omitting the object or an individual flag\npreserves the handler-declared baseline.\n',
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
              },
              description:
                "Present only on a Verify Feature session. Its presence keeps the\nsession's replies in the verify_feature handler mode, with the\nflagged concern, the session that raised it and the possibly\nimpacted entities it named as starting points.\n",
            },
          },
          description:
            'Typed, versioned launch context for an Entity Conversation AgentSession.\nProvider remains on AgentSession itself, and this graph-only config carries\nno Service, repository, directory, or worktree identity.\n',
        },
        provider: {
          type: 'string',
          enum: ['claude', 'codex', 'opencode'],
        },
        machineId: {
          type: 'string',
          format: 'uuid',
        },
        fastMode: {
          type: 'boolean',
        },
      },
    },
    pendingRequest: {
      type: 'string',
    },
  },
  description:
    'Recover the committed answer before consulting creation inputs. A fresh new-conversation selection requires creation settings. Legacy record-only choices cannot be enacted.',
} as const;

export const GoalPmRoutingAnswerSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'type',
    'selectedOption',
    'operationId',
    'state',
    'requestedAt',
    'pendingRequest',
  ],
  description:
    'Durable linked USER form answer. Destination creation and this answer commit together. Local execution is separately authorized using the stable operationId; PENDING retains a recoverable handoff and never authorizes creating another destination.',
  properties: {
    type: {
      type: 'string',
      enum: ['GOAL_PM_ROUTING'],
    },
    selectedOption: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'optionId',
            'kind',
            'conversationId',
            'title',
            'evidence',
            'rationale',
          ],
          properties: {
            optionId: {
              type: 'string',
              minLength: 1,
            },
            kind: {
              type: 'string',
              enum: ['existingConversation'],
            },
            conversationId: {
              type: 'string',
              format: 'uuid',
              description:
                'Canonical CONVERSATION identity; never a MESSAGE identity',
            },
            title: {
              type: 'string',
              minLength: 1,
              description:
                'Meaningful canonical conversation title; placeholder labels are invalid',
            },
            evidence: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['messageId', 'excerpt', 'rationale'],
                properties: {
                  messageId: {
                    type: 'string',
                    format: 'uuid',
                    description:
                      'Canonical MESSAGE identity supporting this conversation match',
                  },
                  excerpt: {
                    type: 'string',
                    minLength: 1,
                    description:
                      'Bounded excerpt from the canonical message; never a serialized message object',
                  },
                  rationale: {
                    type: 'string',
                    minLength: 1,
                    description:
                      'Why this message supports the proposed destination',
                  },
                },
              },
            },
            rationale: {
              type: 'string',
              minLength: 1,
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'optionId',
            'kind',
            'title',
            'rationale',
            'requiresConfirmation',
          ],
          properties: {
            optionId: {
              type: 'string',
              minLength: 1,
            },
            kind: {
              type: 'string',
              enum: ['startNewConversation'],
            },
            title: {
              type: 'string',
              minLength: 1,
            },
            rationale: {
              type: 'string',
              minLength: 1,
            },
            requiresConfirmation: {
              type: 'boolean',
              enum: [true],
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['optionId', 'kind', 'title', 'prompt', 'rationale'],
          properties: {
            optionId: {
              type: 'string',
              minLength: 1,
            },
            kind: {
              type: 'string',
              enum: ['refineSearch'],
            },
            title: {
              type: 'string',
              minLength: 1,
            },
            prompt: {
              type: 'string',
              minLength: 1,
            },
            rationale: {
              type: 'string',
              minLength: 1,
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'optionId',
            'kind',
            'target',
            'rationale',
            'requiresSelection',
          ],
          properties: {
            optionId: {
              type: 'string',
              minLength: 1,
            },
            kind: {
              type: 'string',
              enum: ['trackExistingWork'],
            },
            target: {
              oneOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['entityType', 'entityId', 'title'],
                  properties: {
                    entityType: {
                      type: 'string',
                      enum: ['TASK'],
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
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['entityType', 'entityId', 'title'],
                  properties: {
                    entityType: {
                      type: 'string',
                      enum: ['PLAN'],
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
              ],
              discriminator: {
                propertyName: 'entityType',
              },
            },
            rationale: {
              type: 'string',
              minLength: 1,
            },
            requiresSelection: {
              type: 'boolean',
              enum: [true],
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'optionId',
            'kind',
            'parentFeatureId',
            'workItemType',
            'title',
            'description',
            'acceptanceCriteria',
            'authoringMode',
            'rationale',
            'requiresSelection',
          ],
          properties: {
            optionId: {
              type: 'string',
              minLength: 1,
            },
            kind: {
              type: 'string',
              enum: ['createMissingWork'],
            },
            parentFeatureId: {
              type: 'string',
              format: 'uuid',
            },
            workItemType: {
              type: 'string',
              enum: ['TASK'],
            },
            title: {
              type: 'string',
              minLength: 1,
            },
            description: {
              type: 'string',
              minLength: 1,
            },
            acceptanceCriteria: {
              type: 'string',
              minLength: 1,
            },
            authoringMode: {
              type: 'string',
              enum: ['PROPOSAL'],
            },
            rationale: {
              type: 'string',
              minLength: 1,
            },
            requiresSelection: {
              type: 'boolean',
              enum: [true],
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'optionId',
            'kind',
            'proposalId',
            'title',
            'rationale',
            'requiresSelection',
          ],
          properties: {
            optionId: {
              type: 'string',
              minLength: 1,
            },
            kind: {
              type: 'string',
              enum: ['proposal'],
            },
            proposalId: {
              type: 'string',
              format: 'uuid',
              description:
                'Canonical PROPOSAL identity; this option is not a conversation destination',
            },
            title: {
              type: 'string',
              minLength: 1,
            },
            rationale: {
              type: 'string',
              minLength: 1,
            },
            requiresSelection: {
              type: 'boolean',
              enum: [true],
            },
          },
        },
      ],
      discriminator: {
        propertyName: 'kind',
        mapping: {
          existingConversation: '#/GoalPmExistingConversationOption',
          startNewConversation: '#/GoalPmStartNewConversationOption',
          refineSearch: '#/GoalPmRefineSearchOption',
          trackExistingWork: '#/GoalPmTrackExistingWorkOption',
          createMissingWork: '#/GoalPmCreateMissingWorkOption',
          proposal: '#/GoalPmProposalOption',
        },
      },
    },
    operationId: {
      type: 'string',
      format: 'uuid',
    },
    state: {
      type: 'string',
      enum: ['PENDING', 'COMPLETED'],
    },
    requestedAt: {
      type: 'string',
      format: 'date-time',
    },
    pendingRequest: {
      type: 'string',
    },
    creation: {
      type: 'object',
      additionalProperties: false,
      required: ['config', 'provider', 'machineId'],
      properties: {
        config: {
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
              description:
                'Optional launch-time Project Assistant participation and behavior settings\npersisted on AgentSession config. Omitting the object or an individual flag\npreserves the handler-declared baseline.\n',
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
              },
              description:
                "Present only on a Verify Feature session. Its presence keeps the\nsession's replies in the verify_feature handler mode, with the\nflagged concern, the session that raised it and the possibly\nimpacted entities it named as starting points.\n",
            },
          },
          description:
            'Typed, versioned launch context for an Entity Conversation AgentSession.\nProvider remains on AgentSession itself, and this graph-only config carries\nno Service, repository, directory, or worktree identity.\n',
        },
        provider: {
          type: 'string',
          enum: ['claude', 'codex', 'opencode'],
        },
        machineId: {
          type: 'string',
          format: 'uuid',
        },
        fastMode: {
          type: 'boolean',
        },
      },
    },
    outcome: {
      type: 'object',
      additionalProperties: false,
      required: ['entityType', 'entityId', 'title'],
      properties: {
        entityType: {
          type: 'string',
          enum: ['CONVERSATION', 'TASK', 'PROPOSAL'],
        },
        entityId: {
          type: 'string',
          format: 'uuid',
        },
        title: {
          type: 'string',
          minLength: 1,
        },
        agentSessionId: {
          type: 'string',
          format: 'uuid',
        },
      },
    },
  },
} as const;

export const GoalPmRoutingCompletionRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['selection'],
  properties: {
    selection: {
      type: 'object',
      additionalProperties: false,
      required: ['sourceMessageId', 'uiElementId', 'selectedOptionId'],
      properties: {
        sourceMessageId: {
          type: 'string',
          format: 'uuid',
          description:
            'Canonical routing MESSAGE whose offered options are being resolved',
        },
        uiElementId: {
          type: 'string',
          minLength: 1,
          description:
            'Identity of the originating typed UI Field on sourceMessageId',
        },
        selectedOptionId: {
          type: 'string',
          minLength: 1,
          description:
            'Exactly one optionId currently offered by sourceMessageId; never an enactment payload',
        },
      },
    },
  },
} as const;
