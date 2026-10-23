import { describe, expect, it } from 'vitest';

import {
  cliReadFrameV2Schema,
  CLI_READ_OPERATION_SCHEMAS,
  PROTECTED_CLI_READ_OPERATIONS,
  executableAuthorizationSchema,
  triggerMonitorCommandFrameV2Schema,
  triggerConversationFrameV2Schema,
} from './protocol-v2';
import { CURRENT_AGENT_OPERATIONS } from '../controller-authorization/types';
import type {
  AgentTriggerStartRun,
  ControllerAuthorizedSignedConversationTriggerEnvelope,
} from '../../shared/api/generated/api';

const issuedAtMs = 1_700_000_000_000;
const activation = {
  kind: 'controller_assertion' as const,
  intent: {
    version: 2 as const,
    authorizationId: '00000000-0000-4000-8000-000000000001',
    controllerCredentialId: 'credential_1',
    controllerInstallationId: '00000000-0000-4000-8000-000000000002',
    machineId: '00000000-0000-4000-8000-000000000003',
    userId: '00000000-0000-4000-8000-000000000004',
    organizationId: '00000000-0000-4000-8000-000000000005',
    projectId: '00000000-0000-4000-8000-000000000006',
    cadence: 'FIVE_MINUTES' as const,
    policyRevision: 1,
    effectiveGrantExpiresAtMs: issuedAtMs + 300_000,
    grantDescriptorHash: 'a'.repeat(64),
    actionCategory: 'CONVERSATION' as const,
    actionType: 'CONVERSATION_TRIGGER' as const,
    actionPayloadHash: 'b'.repeat(64),
    allowedActionTypes: [...CURRENT_AGENT_OPERATIONS],
    allowedActionCategories: ['CONVERSATION' as const],
    target: {
      kind: 'CONVERSATION' as const,
      id: '00000000-0000-4000-8000-000000000007',
      revision: null,
    },
    agentSessionId: null,
    taskMonitorId: null,
    nonce: 'A'.repeat(43),
    issuedAtMs,
    expiresAtMs: issuedAtMs + 120_000,
  },
  credentialId: 'credential_1',
  clientDataJSON: 'client-data',
  authenticatorData: 'authenticator-data',
  signature: 'signature',
  userHandle: null,
  grantId: '00000000-0000-4000-8000-000000000008',
  grantDescriptor: {
    scope: 'controller_device_window' as const,
    controllerCredentialId: 'credential_1',
    controllerInstallationId: '00000000-0000-4000-8000-000000000002',
    machineId: '00000000-0000-4000-8000-000000000003',
    userId: '00000000-0000-4000-8000-000000000004',
    organizationId: '00000000-0000-4000-8000-000000000005',
    cadence: 'FIVE_MINUTES' as const,
    policyRevision: 1,
    allowedActionTypes: [...CURRENT_AGENT_OPERATIONS],
    allowedActionCategories: ['CONVERSATION' as const],
    issuedAtMs,
    effectiveExpiresAtMs: issuedAtMs + 300_000,
  },
};

describe('protocol-2 executable authorization schema', () => {
  it('keeps the protected read inventory closed over the exhaustive schema registry', () => {
    expect(PROTECTED_CLI_READ_OPERATIONS).toEqual(Object.keys(CLI_READ_OPERATION_SCHEMAS));
  });

  it('accepts the complete activation arm and compact reuse arm', () => {
    expect(executableAuthorizationSchema.safeParse(activation).success).toBe(true);
    expect(
      executableAuthorizationSchema.safeParse({
        kind: 'bounded_grant',
        grantId: '00000000-0000-4000-8000-000000000008',
      }).success,
    ).toBe(true);
  });

  it('rejects a future host action that is outside the generated current-operation bundle', () => {
    expect(
      executableAuthorizationSchema.safeParse({
        ...activation,
        intent: {
          ...activation.intent,
          actionType: 'FUTURE_HOST_ACTION',
        },
      }).success,
    ).toBe(false);
    expect(
      executableAuthorizationSchema.safeParse({
        ...activation,
        grantDescriptor: {
          ...activation.grantDescriptor,
          allowedActionTypes: [...CURRENT_AGENT_OPERATIONS.slice(0, -1), 'FUTURE_HOST_ACTION'],
        },
      }).success,
    ).toBe(false);
  });

  it.each(['EVERY_ACTION', 'CURRENT_BROWSER_SESSION'])(
    'rejects the removed %s cadence in fresh activation',
    (cadence) => {
      expect(
        executableAuthorizationSchema.safeParse({
          ...activation,
          intent: { ...activation.intent, cadence },
          grantDescriptor: { ...activation.grantDescriptor, cadence },
        }).success,
      ).toBe(false);
    },
  );

  it('rejects reference-carried scope and duplicate activation action classes', () => {
    expect(
      executableAuthorizationSchema.safeParse({
        kind: 'bounded_grant',
        grantId: '00000000-0000-4000-8000-000000000008',
        actionCategory: 'CONVERSATION',
      }).success,
    ).toBe(false);
    expect(
      executableAuthorizationSchema.safeParse({
        ...activation,
        intent: {
          ...activation.intent,
          allowedActionCategories: ['CONVERSATION', 'CONVERSATION'],
        },
      }).success,
    ).toBe(false);
  });
});

describe('protocol-2 Run context-usage read contract', () => {
  const frame = {
    timestamp: '2026-08-21T00:00:00.000Z',
    organizationId: '00000000-0000-4000-8000-000000000005',
    projectId: '00000000-0000-4000-8000-000000000006',
    conversationId: '00000000-0000-4000-8000-000000000013',
    userId: '00000000-0000-4000-8000-000000000004',
    type: 'cli.read.request',
    envelope: {
      machineId: '00000000-0000-4000-8000-000000000003',
      userId: '00000000-0000-4000-8000-000000000004',
      nonce: '00000000-0000-4000-8000-000000000012',
      timestampMs: issuedAtMs,
      signature: 'signature',
      protocolVersion: 2,
      authorization: {
        kind: 'bounded_grant',
        grantId: '00000000-0000-4000-8000-000000000008',
      },
      event: {
        requestId: '00000000-0000-4000-8000-000000000014',
        agentSessionId: '00000000-0000-4000-8000-000000000015',
        operation: 'run.context_usage.get',
        runId: '00000000-0000-4000-8000-000000000015',
        providerSessionId: 'provider-session-1',
      },
    },
  };

  it('accepts the closed operation and rejects unknown request fields', () => {
    expect(cliReadFrameV2Schema.safeParse(frame).success).toBe(true);
    expect(
      cliReadFrameV2Schema.safeParse({
        ...frame,
        envelope: {
          ...frame.envelope,
          event: { ...frame.envelope.event, localUrl: 'http://localhost:4100' },
        },
      }).success,
    ).toBe(false);
  });

  it('accepts the pathless Skill catalog operation and rejects host-path fields', () => {
    const skillFrame = {
      ...frame,
      envelope: {
        ...frame.envelope,
        event: {
          requestId: '00000000-0000-4000-8000-000000000014',
          agentSessionId: '00000000-0000-4000-8000-000000000015',
          operation: 'run.skills.list' as const,
          runId: '00000000-0000-4000-8000-000000000015',
        },
      },
    };

    expect(cliReadFrameV2Schema.safeParse(skillFrame).success).toBe(true);
    expect(
      cliReadFrameV2Schema.safeParse({
        ...skillFrame,
        envelope: {
          ...skillFrame.envelope,
          event: {
            ...skillFrame.envelope.event,
            path: '/Users/example/.codex/skills/release-check/SKILL.md',
          },
        },
      }).success,
    ).toBe(false);
  });

  it('admits the latest-Turn tool-call read and rejects extra fields', () => {
    const toolCallsFrame = {
      ...frame,
      envelope: {
        ...frame.envelope,
        event: {
          requestId: '00000000-0000-4000-8000-000000000014',
          agentSessionId: '00000000-0000-4000-8000-000000000015',
          operation: 'run.tool_calls.latest_turn' as const,
          runId: '00000000-0000-4000-8000-000000000015',
        },
      },
    };

    expect(PROTECTED_CLI_READ_OPERATIONS).toContain('run.tool_calls.latest_turn');
    expect(cliReadFrameV2Schema.safeParse(toolCallsFrame).success).toBe(true);
    expect(
      cliReadFrameV2Schema.safeParse({
        ...toolCallsFrame,
        envelope: {
          ...toolCallsFrame.envelope,
          event: { ...toolCallsFrame.envelope.event, turnId: 'turn-1' },
        },
      }).success,
    ).toBe(false);
  });
});

describe('protocol-2 provider-usage read contract', () => {
  const frame = {
    timestamp: '2026-08-21T00:00:00.000Z',
    organizationId: '00000000-0000-4000-8000-000000000005',
    projectId: '00000000-0000-4000-8000-000000000006',
    conversationId: '00000000-0000-4000-8000-000000000013',
    userId: '00000000-0000-4000-8000-000000000004',
    type: 'cli.read.request',
    envelope: {
      machineId: '00000000-0000-4000-8000-000000000003',
      userId: '00000000-0000-4000-8000-000000000004',
      nonce: '00000000-0000-4000-8000-000000000012',
      timestampMs: issuedAtMs,
      signature: 'signature',
      protocolVersion: 2,
      authorization: {
        kind: 'bounded_grant',
        grantId: '00000000-0000-4000-8000-000000000008',
      },
      event: {
        requestId: '00000000-0000-4000-8000-000000000014',
        agentSessionId: '00000000-0000-4000-8000-000000000015',
        operation: 'provider.usage.get',
      },
    },
  };

  it('accepts the protected provider read and rejects unrelated request fields', () => {
    expect(cliReadFrameV2Schema.safeParse(frame).success).toBe(true);
    expect(PROTECTED_CLI_READ_OPERATIONS).toContain('provider.usage.get');
    expect(PROTECTED_CLI_READ_OPERATIONS).toContain('runtime.model_catalog.get');
    const modelCatalogEvent = {
      requestId: frame.envelope.event.requestId,
      authorizationRequestId: '00000000-0000-4000-8000-000000000016',
      organizationId: frame.organizationId,
      projectId: frame.projectId,
      machineId: frame.envelope.machineId,
      operation: 'runtime.model_catalog.get',
    };
    expect(
      cliReadFrameV2Schema.safeParse({
        ...frame,
        envelope: { ...frame.envelope, event: modelCatalogEvent },
      }).success,
    ).toBe(true);
    expect(
      cliReadFrameV2Schema.safeParse({
        ...frame,
        envelope: {
          ...frame.envelope,
          event: { ...modelCatalogEvent, agentSessionId: frame.envelope.event.agentSessionId },
        },
      }).success,
    ).toBe(false);
    expect(
      cliReadFrameV2Schema.safeParse({
        ...frame,
        envelope: {
          ...frame.envelope,
          event: { ...frame.envelope.event, localPath: '/Users/example/.codex' },
        },
      }).success,
    ).toBe(false);
  });
});

describe('protocol-2 changed-files read contract', () => {
  const frame = {
    timestamp: '2026-08-21T00:00:00.000Z',
    organizationId: '00000000-0000-4000-8000-000000000005',
    projectId: '00000000-0000-4000-8000-000000000006',
    conversationId: '00000000-0000-4000-8000-000000000013',
    userId: '00000000-0000-4000-8000-000000000004',
    type: 'cli.read.request',
    envelope: {
      machineId: '00000000-0000-4000-8000-000000000003',
      userId: '00000000-0000-4000-8000-000000000004',
      nonce: '00000000-0000-4000-8000-000000000012',
      timestampMs: issuedAtMs,
      signature: 'signature',
      protocolVersion: 2,
      authorization: {
        kind: 'bounded_grant',
        grantId: '00000000-0000-4000-8000-000000000008',
      },
      event: {
        requestId: '00000000-0000-4000-8000-000000000014',
        agentSessionId: '00000000-0000-4000-8000-000000000015',
        operation: 'run.changed_files.inventory',
        runId: '00000000-0000-4000-8000-000000000016',
      },
    },
  };

  it('accepts inventory and detail operations from the generated contract', () => {
    expect(cliReadFrameV2Schema.safeParse(frame).success).toBe(true);
    expect(
      cliReadFrameV2Schema.safeParse({
        ...frame,
        envelope: {
          ...frame.envelope,
          event: {
            ...frame.envelope.event,
            operation: 'run.changed_files.detail',
            file: {
              serviceId: '00000000-0000-4000-8000-000000000017',
              repoPath: '/workspace/service',
              filePath: 'src/example.ts',
            },
          },
        },
      }).success,
    ).toBe(true);
  });

  it('rejects the retired diff operation', () => {
    expect(
      cliReadFrameV2Schema.safeParse({
        ...frame,
        envelope: {
          ...frame.envelope,
          event: { ...frame.envelope.event, operation: 'run.changed_files.diff' },
        },
      }).success,
    ).toBe(false);
  });
});

describe('protocol-2 generated conversation trigger contract', () => {
  const startRunEvent = {
    operationId: '00000000-0000-4000-8000-000000000009',
    operationFingerprint: 'c'.repeat(64),
    promptType: 'start_run',
    triggerMessageId: '00000000-0000-4000-8000-000000000010',
    payload: {
      attachments: [],
      handlerPromptType: 'daily_session',
      payload: {
        promptType: 'daily_session',
        payloadVersion: 1,
        userMessage: 'Run the daily session.',
      },
      model: 'gpt-5.6-luna',
      reasoningEffort: 'medium',
      provider: 'codex',
      contextMetadata: {
        organizationId: '00000000-0000-4000-8000-000000000005',
        projectId: '00000000-0000-4000-8000-000000000006',
        capturedAt: '2026-08-21T00:00:00.000Z',
        agentSessionId: '00000000-0000-4000-8000-000000000011',
        userComments: [],
        fileReferences: { resolved: [], unresolved: [] },
      },
      agentSessionId: '00000000-0000-4000-8000-000000000011',
    },
  } satisfies AgentTriggerStartRun;

  const envelope = {
    machineId: '00000000-0000-4000-8000-000000000003',
    userId: '00000000-0000-4000-8000-000000000004',
    nonce: '00000000-0000-4000-8000-000000000012',
    timestampMs: issuedAtMs,
    signature: 'signature',
    protocolVersion: 2,
    authorization: {
      kind: 'bounded_grant',
      grantId: '00000000-0000-4000-8000-000000000008',
    },
    event: startRunEvent,
  } satisfies ControllerAuthorizedSignedConversationTriggerEnvelope;

  const frame = {
    timestamp: '2026-08-21T00:00:00.000Z',
    organizationId: '00000000-0000-4000-8000-000000000005',
    projectId: '00000000-0000-4000-8000-000000000006',
    conversationId: '00000000-0000-4000-8000-000000000013',
    type: 'trigger.conversation' as const,
    envelope,
  };

  it('accepts the generated start-run variant without stripping operation identity', () => {
    const parsed = triggerConversationFrameV2Schema.safeParse(frame);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.envelope.event).toEqual(startRunEvent);
  });

  it('rejects a start-run frame that omits a generated required field', () => {
    const { operationFingerprint: _omitted, ...incompleteEvent } = startRunEvent;

    expect(
      triggerConversationFrameV2Schema.safeParse({
        ...frame,
        envelope: { ...envelope, event: incompleteEvent },
      }).success,
    ).toBe(false);
  });

  it('accepts a user-message trigger only with a closed complete admitted Service scope', () => {
    const userMessageEvent = {
      operationId: '00000000-0000-4000-8000-000000000020',
      operationFingerprint: 'd'.repeat(64),
      promptType: 'user_message' as const,
      triggerMessageId: '00000000-0000-4000-8000-000000000021',
      sourceUserMessageId: '00000000-0000-4000-8000-000000000022',
      admittedServiceScope: {
        serviceIds: [
          '00000000-0000-4000-8000-000000000023',
          '00000000-0000-4000-8000-000000000024',
        ],
        launchServiceId: '00000000-0000-4000-8000-000000000023',
      },
      payload: {
        handlerPromptType: 'coding_freeform',
        userMessage: 'Inspect both Services.',
        attachments: [],
      },
    };

    expect(
      triggerConversationFrameV2Schema.safeParse({
        ...frame,
        envelope: { ...envelope, event: userMessageEvent },
      }).success,
    ).toBe(true);
    expect(
      triggerConversationFrameV2Schema.safeParse({
        ...frame,
        envelope: {
          ...envelope,
          event: {
            ...userMessageEvent,
            admittedServiceScope: {
              ...userMessageEvent.admittedServiceScope,
              unexpected: true,
            },
          },
        },
      }).success,
    ).toBe(false);
  });

  it('accepts a legacy user-message trigger without admitted scope but rejects corrupt supplied scope', () => {
    const event = {
      operationId: '00000000-0000-4000-8000-000000000020',
      operationFingerprint: 'd'.repeat(64),
      promptType: 'user_message' as const,
      triggerMessageId: '00000000-0000-4000-8000-000000000021',
      sourceUserMessageId: '00000000-0000-4000-8000-000000000022',
      payload: {
        handlerPromptType: 'coding_freeform',
        userMessage: 'Inspect both Services.',
        attachments: [],
      },
    };
    expect(
      triggerConversationFrameV2Schema.safeParse({
        ...frame,
        envelope: { ...envelope, event },
      }).success,
    ).toBe(true);
    expect(
      triggerConversationFrameV2Schema.safeParse({
        ...frame,
        envelope: {
          ...envelope,
          event: {
            ...event,
            admittedServiceScope: {
              serviceIds: ['00000000-0000-4000-8000-000000000023'],
              launchServiceId: '00000000-0000-4000-8000-000000000024',
            },
          },
        },
      }).success,
    ).toBe(false);
  });
});

describe('protocol-2 generated monitor judgment contract', () => {
  const frame = {
    timestamp: '2026-08-21T00:00:00.000Z',
    organizationId: '00000000-0000-4000-8000-000000000005',
    projectId: '00000000-0000-4000-8000-000000000006',
    type: 'trigger.monitor_command' as const,
    envelope: {
      machineId: '00000000-0000-4000-8000-000000000003',
      userId: '00000000-0000-4000-8000-000000000004',
      nonce: '00000000-0000-4000-8000-000000000012',
      timestampMs: issuedAtMs,
      signature: 'signature',
      protocolVersion: 2,
      authorization: {
        kind: 'bounded_grant' as const,
        grantId: '00000000-0000-4000-8000-000000000008',
      },
      event: {
        version: 2,
        kind: 'task_monitor_command' as const,
        commandId: '00000000-0000-4000-8000-000000000009',
        createdAt: '2026-08-21T00:00:00.000Z',
        expiresAt: '2026-08-21T00:01:00.000Z',
        organizationId: '00000000-0000-4000-8000-000000000005',
        projectId: '00000000-0000-4000-8000-000000000006',
        target: {
          workItemType: 'TASK_MONITOR' as const,
          workItemId: '00000000-0000-4000-8000-000000000010',
        },
        command: {
          cause: 'JUDGMENT_RESOLVED' as const,
          judgment: {
            requestMessageId: '00000000-0000-4000-8000-000000000011',
            label: 'Your judgment',
            conclusion: 'Proceed with the safer behavior.',
          },
        },
      },
    },
  };

  it('accepts the generated judgment response shape', () => {
    expect(triggerMonitorCommandFrameV2Schema.safeParse(frame).success).toBe(true);
  });

  it('rejects an untyped judgment payload', () => {
    expect(
      triggerMonitorCommandFrameV2Schema.safeParse({
        ...frame,
        envelope: {
          ...frame.envelope,
          event: {
            ...frame.envelope.event,
            command: {
              ...frame.envelope.event.command,
              judgment: { ...frame.envelope.event.command.judgment, unexpected: 'field' },
            },
          },
        },
      }).success,
    ).toBe(false);
  });
});

describe('workspace catalog protocol', () => {
  const body = {
    operation: 'workspace.skills.list',
    requestId: activation.intent.authorizationId,
    authorizationRequestId: activation.intent.authorizationId,
    organizationId: activation.intent.organizationId,
    projectId: activation.intent.projectId,
    machineId: activation.intent.machineId,
    provider: 'codex',
    catalogContext: { policy: 'non_repository' },
  };
  it('admits a signed catalog body with no session or repository', () => {
    expect(CLI_READ_OPERATION_SCHEMAS['workspace.skills.list'].safeParse(body).success).toBe(true);
  });
  it.each([
    { catalogContext: { policy: 'non_repository', serviceId: activation.intent.machineId } },
    { catalogContext: { policy: 'service_workspace' } },
    { catalogContext: { policy: 'service_workspace', cwd: '/incidental/repo' } },
    { organizationId: undefined },
    { machineId: undefined },
    { authorizationRequestId: undefined },
    { runId: activation.intent.machineId },
    { agentSessionId: activation.intent.machineId },
  ])('rejects missing or widened scope %o', (overrides) => {
    expect(
      CLI_READ_OPERATION_SCHEMAS['workspace.skills.list'].safeParse({ ...body, ...overrides })
        .success,
    ).toBe(false);
  });
});
