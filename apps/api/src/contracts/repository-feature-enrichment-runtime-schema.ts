/* eslint-disable */
/**
 * Auto-generated from specs/agent-bridge/openapi.yaml.
 * Do not edit manually; regenerate from the OpenAPI source.
 */
export const repositoryFeatureEnrichmentRuntimeSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  definitions: {
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
    WorkTrackerImportCompletion: {
      oneOf: [
        {
          $ref: '#/definitions/WorkTrackerConnectionCompletion',
        },
        {
          $ref: '#/definitions/WorkTrackerImportSuccess',
        },
      ],
    },
    WorkTrackerConnectionCompletion: {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'source'],
      properties: {
        outcome: {
          type: 'string',
          enum: ['connected', 'connection_required'],
        },
        source: {
          type: 'string',
          enum: ['jira', 'linear'],
        },
      },
      description:
        'Runtime tool reachability. CLI code owns connection instructions.',
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
    RepositoryGroundingCompletion: {
      oneOf: [
        {
          $ref: '#/definitions/RepositoryGroundingSuccess',
        },
        {
          $ref: '#/definitions/RepositoryGroundingRetryableFailure',
        },
        {
          $ref: '#/definitions/RepositoryGroundingTerminalFailure',
        },
      ],
      description:
        'Exactly one mutually exclusive completion outcome for a repository analysis handoff.',
    },
    RepositoryGroundingRetryableFailure: {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'code', 'message'],
      properties: {
        outcome: {
          type: 'string',
          enum: ['retryable_failure'],
        },
        code: {
          type: 'string',
          enum: [
            'machine_unavailable',
            'directory_unresolved',
            'provider_unavailable',
            'provider_timeout',
            'rate_limited',
            'transient_read_failure',
          ],
        },
        message: {
          type: 'string',
          minLength: 1,
          description: 'User-safe explanation of the retryable failure.',
        },
        retryAfterSeconds: {
          type: 'integer',
          minimum: 0,
          description: 'Optional hint for the next retry attempt.',
        },
      },
      description:
        'Typed failure outcome that preserves the accepted choices and may be retried without changing the contract family.',
    },
    RepositoryGroundingTerminalFailure: {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'code', 'message'],
      properties: {
        outcome: {
          type: 'string',
          enum: ['terminal_failure'],
        },
        code: {
          type: 'string',
          enum: [
            'invalid_request',
            'unsupported_scope',
            'unsupported_provider',
            'unsupported_model',
            'access_denied',
            'invalid_completion',
          ],
        },
        message: {
          type: 'string',
          minLength: 1,
          description: 'User-safe explanation of the terminal failure.',
        },
      },
      description:
        'Typed failure outcome that requires user correction or cannot be retried under the accepted choices.',
    },
    RepositoryFeatureEnrichmentRequest: {
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
            'Repository discovery evidence supplied once at the handoff to a continuing CLI conversation.',
        },
        reviewedCandidates: {
          $ref: '#/definitions/WorkTrackerImportSuccess/properties/hierarchy',
          deprecated: true,
          description:
            'Legacy stored-input reader projection only. New handoffs use materializedFeatureIds.',
        },
        materializedFeatureIds: {
          type: 'array',
          minItems: 1,
          items: {
            $ref: '#/definitions/RepositoryFirstWorkRequest/properties/materializedFeatureIds/items',
          },
          description:
            'Approved Features created by this import. Enrichment proposes edits only to these Features.',
        },
        userMessage: {
          type: 'string',
          description:
            'Optional user reply within the continuing enrichment conversation.',
        },
      },
    },
    RepositoryFeatureEnrichmentCompletion: {
      oneOf: [
        {
          $ref: '#/definitions/RepositoryFeatureEnrichmentQuestions',
        },
        {
          $ref: '#/definitions/RepositoryFeatureEnrichmentSuccess',
        },
        {
          $ref: '#/definitions/RepositoryFeatureEnrichmentRetryableFailure',
        },
        {
          $ref: '#/definitions/RepositoryFeatureEnrichmentTerminalFailure',
        },
      ],
    },
    RepositoryFeatureEnrichmentQuestions: {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'questionGroup'],
      properties: {
        outcome: {
          type: 'string',
          enum: ['questions'],
        },
        questionGroup: {
          $ref: '#/definitions/RepositoryFirstWorkQuestions/properties/questionGroup',
        },
      },
    },
    RepositoryFirstWorkQuestions: {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'questionGroup'],
      properties: {
        outcome: {
          type: 'string',
          enum: ['questions'],
        },
        questionGroup: {
          type: 'object',
          additionalProperties: false,
          required: ['questions'],
          properties: {
            questions: {
              type: 'array',
              minItems: 1,
              maxItems: 3,
              items: {
                type: 'string',
                minLength: 1,
              },
            },
          },
          description:
            'Bounded specialization of the existing QuestionsGroupPayload shape so the standard question_group renderer can be reused without a second UI contract.',
        },
      },
    },
    RepositoryFeatureEnrichmentSuccess: {
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
        'support',
      ],
      properties: {
        outcome: {
          type: 'string',
          enum: ['success'],
        },
        serviceId: {
          $ref: '#/definitions/RepositoryFirstWorkRequest/properties/serviceId',
        },
        provider: {
          type: 'string',
          minLength: 1,
        },
        resolvedFrontierModel: {
          type: 'string',
          minLength: 1,
        },
        narrative: {
          type: 'string',
          minLength: 1,
        },
        hierarchy: {
          $ref: '#/definitions/WorkTrackerImportSuccess/properties/hierarchy',
        },
        evidence: {
          type: 'array',
          minItems: 1,
          items: {
            $ref: '#/definitions/RepositoryGroundingSuccess/properties/evidence/items',
          },
        },
        briefDiscrepancies: {
          type: 'array',
          items: {
            $ref: '#/definitions/RepositoryGroundingSuccess/properties/briefDiscrepancies/items',
          },
        },
        support: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['candidateKey', 'detail', 'source'],
            properties: {
              candidateKey: {
                type: 'string',
                minLength: 1,
              },
              detail: {
                type: 'string',
                minLength: 1,
              },
              source: {
                type: 'string',
                enum: ['repository_evidence', 'user_answer'],
              },
              evidencePaths: {
                type: 'array',
                items: {
                  type: 'string',
                  minLength: 1,
                  pattern:
                    '^(?!/)(?![A-Za-z]:)(?!.*\\\\)(?!.*(^|/)\\.\\.(?:/|$)).+',
                },
              },
              answerRound: {
                type: 'integer',
                minimum: 1,
                maximum: 2,
              },
              answerQuestion: {
                type: 'string',
                minLength: 1,
              },
            },
          },
        },
      },
      description:
        'Complete enrichment success carrying the latest accepted tagged hierarchy, narrative, repository-relative evidence, material brief discrepancies, and evidence-or-answer support. Analysis controls and internal review bookkeeping are not part of this completion representation.',
    },
    RepositoryFeatureEnrichmentRetryableFailure: {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'code', 'message'],
      properties: {
        outcome: {
          type: 'string',
          enum: ['retryable_failure'],
        },
        code: {
          type: 'string',
          enum: [
            'provider_unavailable',
            'provider_timeout',
            'rate_limited',
            'transient_read_failure',
          ],
        },
        message: {
          type: 'string',
          minLength: 1,
        },
        retryAfterSeconds: {
          type: 'integer',
          minimum: 0,
        },
      },
    },
    RepositoryFeatureEnrichmentTerminalFailure: {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'code', 'message'],
      properties: {
        outcome: {
          type: 'string',
          enum: ['terminal_failure'],
        },
        code: {
          type: 'string',
          enum: [
            'invalid_request',
            'unsupported_provider',
            'unsupported_model',
            'access_denied',
            'invalid_completion',
          ],
        },
        message: {
          type: 'string',
          minLength: 1,
        },
      },
    },
    RepositoryFeatureEnrichmentDecisionCompletion: {
      oneOf: [
        {
          $ref: '#/definitions/RepositoryFeatureEnrichmentQuestions',
        },
        {
          $ref: '#/definitions/RepositoryFeatureEnrichmentSuccessDecision',
        },
        {
          $ref: '#/definitions/RepositoryFeatureEnrichmentRetryableFailure',
        },
        {
          $ref: '#/definitions/RepositoryFeatureEnrichmentTerminalFailure',
        },
      ],
    },
    RepositoryFeatureEnrichmentSuccessDecision: {
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
        'support',
      ],
      properties: {
        outcome: {
          type: 'string',
          enum: ['success'],
        },
        serviceId: {
          $ref: '#/definitions/RepositoryFirstWorkRequest/properties/serviceId',
        },
        provider: {
          type: 'string',
          minLength: 1,
        },
        resolvedFrontierModel: {
          type: 'string',
          minLength: 1,
        },
        narrative: {
          type: 'string',
          minLength: 1,
        },
        hierarchy: {
          $ref: '#/definitions/WorkTrackerImportSuccess/properties/hierarchy',
        },
        evidence: {
          type: 'array',
          minItems: 1,
          items: {
            $ref: '#/definitions/RepositoryGroundingSuccess/properties/evidence/items',
          },
        },
        briefDiscrepancies: {
          type: 'array',
          items: {
            $ref: '#/definitions/RepositoryGroundingSuccess/properties/briefDiscrepancies/items',
          },
        },
        support: {
          type: 'array',
          items: {
            $ref: '#/definitions/RepositoryFeatureEnrichmentSuccess/properties/support/items',
          },
        },
      },
      description:
        'Provider-facing success decision containing the complete latest analysis snapshot. The provider may evolve evidence, narrative, and the two-level tagged hierarchy; continuing candidates keep their IDs, while additions, removals, reparenting, and tag changes are represented directly in the returned snapshot.',
    },
    RepositoryPlacementCompletion: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['outcome', 'placements'],
          properties: {
            outcome: {
              type: 'string',
              enum: ['success'],
            },
            placements: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['rootKey', 'target', 'rationale', 'confidence'],
                properties: {
                  rootKey: {
                    type: 'string',
                    format: 'uuid',
                  },
                  target: {
                    oneOf: [
                      {
                        type: 'object',
                        additionalProperties: false,
                        required: ['kind'],
                        properties: {
                          kind: {
                            type: 'string',
                            enum: ['PROJECT_ROOT'],
                          },
                        },
                      },
                      {
                        type: 'object',
                        additionalProperties: false,
                        required: ['kind', 'featureId'],
                        properties: {
                          kind: {
                            type: 'string',
                            enum: ['EXISTING_FEATURE'],
                          },
                          featureId: {
                            $ref: '#/definitions/RepositoryFirstWorkRequest/properties/materializedFeatureIds/items',
                          },
                        },
                      },
                    ],
                  },
                  rationale: {
                    type: 'string',
                    minLength: 1,
                  },
                  confidence: {
                    type: 'number',
                    minimum: 0,
                    maximum: 1,
                  },
                },
              },
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['outcome', 'code', 'message'],
          properties: {
            outcome: {
              type: 'string',
              enum: ['retryable_failure'],
            },
            code: {
              type: 'string',
              enum: [
                'provider_unavailable',
                'provider_timeout',
                'rate_limited',
                'graph_unavailable',
              ],
            },
            message: {
              type: 'string',
              minLength: 1,
            },
            retryAfterSeconds: {
              type: 'integer',
              minimum: 0,
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['outcome', 'code', 'message'],
          properties: {
            outcome: {
              type: 'string',
              enum: ['terminal_failure'],
            },
            code: {
              type: 'string',
              enum: [
                'invalid_request',
                'unsupported_provider',
                'unsupported_model',
                'access_denied',
                'invalid_completion',
              ],
            },
            message: {
              type: 'string',
              minLength: 1,
            },
          },
        },
      ],
    },
    RepositoryFirstWorkCompletion: {
      oneOf: [
        {
          $ref: '#/definitions/RepositoryFirstWorkQuestions',
        },
        {
          $ref: '#/definitions/RepositoryFirstWorkSuccess',
        },
        {
          $ref: '#/definitions/RepositoryFirstWorkRetryableFailure',
        },
        {
          $ref: '#/definitions/RepositoryFirstWorkTerminalFailure',
        },
      ],
    },
    RepositoryFirstWorkSuccess: {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'summary', 'taskProposalIds', 'featureProposalIds'],
      properties: {
        outcome: {
          type: 'string',
          enum: ['success'],
        },
        summary: {
          type: 'string',
          minLength: 1,
        },
        taskProposalIds: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'string',
            pattern:
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
            description: 'Unique identifier for a proposal (branded type)',
            example: '550e8400-e29b-41d4-a716-446655440025',
            'x-typescript-type': 'ProposalId',
            'x-brand': 'ProposalId',
            'x-semantic-type': 'resource-identifier',
          },
        },
        featureProposalIds: {
          type: 'array',
          items: {
            $ref: '#/definitions/RepositoryFirstWorkSuccess/properties/taskProposalIds/items',
          },
        },
      },
      description:
        'Proposals already created through the ordinary proposal tools; the completion carries only their identities so review stays on the normal proposal surface.',
    },
    RepositoryFirstWorkRetryableFailure: {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'code', 'message'],
      properties: {
        outcome: {
          type: 'string',
          enum: ['retryable_failure'],
        },
        code: {
          type: 'string',
          enum: [
            'provider_unavailable',
            'provider_timeout',
            'rate_limited',
            'transient_read_failure',
          ],
        },
        message: {
          type: 'string',
          minLength: 1,
        },
        retryAfterSeconds: {
          type: 'integer',
          minimum: 0,
        },
      },
    },
    RepositoryFirstWorkTerminalFailure: {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'code', 'message'],
      properties: {
        outcome: {
          type: 'string',
          enum: ['terminal_failure'],
        },
        code: {
          type: 'string',
          enum: [
            'invalid_request',
            'unsupported_provider',
            'unsupported_model',
            'access_denied',
            'invalid_completion',
          ],
        },
        message: {
          type: 'string',
          minLength: 1,
        },
      },
    },
  },
};
