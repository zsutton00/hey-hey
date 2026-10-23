import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { canonicalizeJson } from '../jcs';
import { TriggerVerifier, TIMESTAMP_WINDOW_MS } from '../verify';
import type { ServerLogger } from '../../logger';

const noopLogger: ServerLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

const MACHINE_ID = 'machine-1';
const USER_ID = 'user-1';
const ED25519_SPKI_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

const generateServerSigningKeys = (): { privateKey: crypto.KeyObject; rawPublicKey: Buffer } => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  // Strip the 12-byte SPKI prefix to get the raw 32-byte key, matching the
  // server-delivered format.
  const rawPublicKey = (spki as Buffer).subarray(ED25519_SPKI_PREFIX.length);
  return { privateKey, rawPublicKey };
};

const signEnvelope = (
  privateKey: crypto.KeyObject,
  envelope: {
    event: unknown;
    machineId: string;
    userId: string;
    nonce: string;
    timestampMs: number;
  },
): string => {
  const canonical = Buffer.from(canonicalizeJson(envelope), 'utf8');
  return crypto.sign(null, canonical, privateKey).toString('base64');
};

interface BuildOptions {
  privateKey: crypto.KeyObject;
  machineId?: string;
  userId?: string;
  nonce?: string;
  timestampMs?: number;
  payload?: Record<string, unknown>;
  promptType?: string;
  triggerMessageId?: string | null;
}

const buildConversationFrame = (
  options: BuildOptions,
): {
  type: 'trigger.conversation';
  timestamp: string;
  organizationId: string;
  conversationId: string;
  envelope: {
    event: Record<string, unknown>;
    machineId: string;
    userId: string;
    nonce: string;
    timestampMs: number;
    signature: string;
  };
} => {
  const machineId = options.machineId ?? MACHINE_ID;
  const userId = options.userId ?? USER_ID;
  const nonce = options.nonce ?? '11111111-1111-1111-1111-111111111111';
  const timestampMs = options.timestampMs ?? 1_700_000_000_000;
  // Default to a populated triggerMessageId; pass `null` to omit the field
  // entirely (covers the missing-field schema rejection case).
  const event: Record<string, unknown> = {
    promptType: options.promptType ?? 'implement',
    nodeId: 'node-1',
    payload: options.payload ?? { foo: 1 },
  };
  if (options.triggerMessageId !== null) {
    event['triggerMessageId'] = options.triggerMessageId ?? 'trigger-msg-1';
  }
  if (options.promptType === 'user_message') {
    event['operationId'] = '90000000-0000-4000-8000-000000000009';
    event['operationFingerprint'] = 'a'.repeat(64);
    event['sourceUserMessageId'] = '80000000-0000-4000-8000-000000000008';
    event['admittedServiceScope'] = {
      serviceIds: ['70000000-0000-4000-8000-000000000007'],
      launchServiceId: '70000000-0000-4000-8000-000000000007',
    };
  }
  const signature = signEnvelope(options.privateKey, {
    event,
    machineId,
    userId,
    nonce,
    timestampMs,
  });
  return {
    type: 'trigger.conversation',
    timestamp: new Date(timestampMs).toISOString(),
    organizationId: 'org-1',
    conversationId: 'conv-1',
    envelope: { event, machineId, userId, nonce, timestampMs, signature },
  };
};

const buildControlFrame = (
  options: BuildOptions & { kind?: string },
): {
  type: 'trigger.control';
  timestamp: string;
  organizationId: string;
  conversationId: string;
  envelope: {
    event: { kind: string; conversationId: string; runId: string };
    machineId: string;
    userId: string;
    nonce: string;
    timestampMs: number;
    signature: string;
  };
} => {
  const machineId = options.machineId ?? MACHINE_ID;
  const userId = options.userId ?? USER_ID;
  const nonce = options.nonce ?? '33333333-3333-3333-3333-333333333333';
  const timestampMs = options.timestampMs ?? 1_700_000_000_000;
  const event = {
    kind: options.kind ?? 'stop_run',
    conversationId: 'conv-1',
    runId: 'run-1',
  };
  const signature = signEnvelope(options.privateKey, {
    event,
    machineId,
    userId,
    nonce,
    timestampMs,
  });
  return {
    type: 'trigger.control',
    timestamp: new Date(timestampMs).toISOString(),
    organizationId: 'org-1',
    conversationId: 'conv-1',
    envelope: { event, machineId, userId, nonce, timestampMs, signature },
  };
};

const buildMonitorCommandFrame = (
  options: BuildOptions & {
    projectId?: string;
    command?: Record<string, unknown>;
    expiresAtMs?: number;
  },
) => {
  const machineId = options.machineId ?? MACHINE_ID;
  const userId = options.userId ?? USER_ID;
  const nonce = options.nonce ?? '44444444-4444-4444-8444-444444444444';
  const timestampMs = options.timestampMs ?? 1_700_000_000_000;
  const organizationId = '10000000-0000-4000-8000-000000000001';
  const projectId = options.projectId ?? '20000000-0000-4000-8000-000000000002';
  const event = {
    version: 1,
    kind: 'task_monitor_command',
    commandId: '30000000-0000-4000-8000-000000000003',
    createdAt: new Date(timestampMs).toISOString(),
    expiresAt: new Date(options.expiresAtMs ?? timestampMs + 60_000).toISOString(),
    organizationId,
    projectId,
    target: {
      workItemType: 'TASK_MONITOR',
      workItemId: '40000000-0000-4000-8000-000000000004',
    },
    command: options.command ?? {
      cause: 'START',
      launchConfig: {
        taskId: '70000000-0000-4000-8000-000000000007',
        method: 'quick',
        provider: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
      },
    },
  };
  const signature = signEnvelope(options.privateKey, {
    event,
    machineId,
    userId,
    nonce,
    timestampMs,
  });
  return {
    type: 'trigger.monitor_command' as const,
    timestamp: new Date(timestampMs).toISOString(),
    organizationId,
    projectId,
    userId,
    envelope: { event, machineId, userId, nonce, timestampMs, signature },
  };
};

const V2_MACHINE_ID = '80000000-0000-4000-8000-000000000008';
const V2_USER_ID = '90000000-0000-4000-8000-000000000009';
const V2_ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';
const V2_PROJECT_ID = '20000000-0000-4000-8000-000000000002';

const buildProtocolV2ConversationFrame = (
  privateKey: crypto.KeyObject,
  eventOverrides: Record<string, unknown> = {},
) => {
  const event = {
    operationId: '30000000-0000-4000-8000-000000000003',
    operationFingerprint: 'a'.repeat(64),
    promptType: 'user_message' as const,
    triggerMessageId: '40000000-0000-4000-8000-000000000004',
    sourceUserMessageId: '50000000-0000-4000-8000-000000000005',
    payload: {
      handlerPromptType: 'coding_freeform',
      userMessage: 'Continue with the requested change.',
      attachments: [],
    },
    ...eventOverrides,
  };
  const unsignedEnvelope = {
    authorization: {
      kind: 'bounded_grant' as const,
      grantId: '60000000-0000-4000-8000-000000000006',
    },
    event,
    machineId: V2_MACHINE_ID,
    nonce: '70000000-0000-4000-8000-000000000007',
    protocolVersion: 2 as const,
    timestampMs: 1_700_000_000_000,
    userId: V2_USER_ID,
  };
  const signature = crypto
    .sign(null, Buffer.from(canonicalizeJson(unsignedEnvelope), 'utf8'), privateKey)
    .toString('base64');

  return {
    type: 'trigger.conversation' as const,
    timestamp: '2023-11-14T22:13:20.000Z',
    organizationId: V2_ORGANIZATION_ID,
    projectId: V2_PROJECT_ID,
    conversationId: '80000000-0000-4000-8000-000000000008',
    userId: V2_USER_ID,
    envelope: { ...unsignedEnvelope, signature },
  };
};

const buildProtocolV2MonitorFrame = (
  privateKey: crypto.KeyObject,
  options: {
    reduction?: boolean;
    neutral?: boolean;
    neutralCommand?: Record<string, unknown>;
    outerProjectId?: string;
  } = {},
) => {
  const timestampMs = 1_700_000_000_000;
  const event = {
    version: 2 as const,
    kind: options.neutral
      ? ('task_monitor_authority_neutral' as const)
      : options.reduction
        ? ('task_monitor_authority_reduction' as const)
        : ('task_monitor_command' as const),
    commandId: '30000000-0000-4000-8000-000000000003',
    createdAt: new Date(timestampMs).toISOString(),
    expiresAt: new Date(timestampMs + 60_000).toISOString(),
    organizationId: V2_ORGANIZATION_ID,
    projectId: V2_PROJECT_ID,
    target: {
      workItemType: 'TASK_MONITOR' as const,
      workItemId: '40000000-0000-4000-8000-000000000004',
    },
    command: options.neutral
      ? (options.neutralCommand ?? {
          cause: 'HUMAN_DECISION',
          interventionId: 'a0000000-0000-4000-8000-000000000001',
          providerActionId: 'provider-action-1',
          runId: 'a0000000-0000-4000-8000-000000000002',
          agentSessionId: 'a0000000-0000-4000-8000-000000000003',
          fingerprint: 'immutable-fingerprint',
          resolution: 'APPROVE',
          human: {
            userId: V2_USER_ID,
            authenticatedAt: new Date(timestampMs).toISOString(),
          },
        })
      : options.reduction
        ? ({ cause: 'PAUSE' } as const)
        : ({
            cause: 'START' as const,
            launchConfig: {
              taskId: '70000000-0000-4000-8000-000000000007',
              method: 'quick',
              provider: 'codex',
              model: 'gpt-5.4',
              reasoningEffort: 'high',
            },
          } as const),
  };
  const authorization =
    options.reduction || options.neutral
      ? undefined
      : {
          kind: 'bounded_grant' as const,
          grantId: '50000000-0000-4000-8000-000000000005',
        };
  const unsignedEnvelope = {
    ...(authorization ? { authorization } : {}),
    event,
    machineId: V2_MACHINE_ID,
    nonce: options.reduction
      ? '60000000-0000-4000-8000-000000000006'
      : options.neutral
        ? '70000000-0000-4000-8000-000000000007'
        : '50000000-0000-4000-8000-000000000005',
    protocolVersion: 2 as const,
    timestampMs,
    userId: V2_USER_ID,
  };
  const signature = crypto
    .sign(null, Buffer.from(canonicalizeJson(unsignedEnvelope), 'utf8'), privateKey)
    .toString('base64');

  return {
    type: options.reduction
      ? ('trigger.monitor_reduction' as const)
      : ('trigger.monitor_command' as const),
    timestamp: new Date(timestampMs).toISOString(),
    organizationId: V2_ORGANIZATION_ID,
    projectId: options.outerProjectId ?? V2_PROJECT_ID,
    userId: V2_USER_ID,
    envelope: { ...unsignedEnvelope, signature },
  };
};

const buildProtocolV2PermissionDecisionFrame = (
  privateKey: crypto.KeyObject,
  options: { agentSessionId?: string } = {},
) => {
  const timestampMs = 1_700_000_000_000;
  const event = {
    kind: 'permission_decision' as const,
    agentSessionId: options.agentSessionId ?? '30000000-0000-4000-8000-000000000003',
    decision: 'always_approve' as const,
    requestId: '0',
    sessionId: 'provider-session',
    agentType: 'codex' as const,
    reason: null,
    idempotencyToken: 'decision-0',
  };
  const unsignedEnvelope = {
    authorization: {
      kind: 'bounded_grant' as const,
      grantId: '40000000-0000-4000-8000-000000000004',
    },
    event,
    machineId: V2_MACHINE_ID,
    nonce: '50000000-0000-4000-8000-000000000005',
    protocolVersion: 2 as const,
    timestampMs,
    userId: V2_USER_ID,
  };
  const signature = crypto
    .sign(null, Buffer.from(canonicalizeJson(unsignedEnvelope), 'utf8'), privateKey)
    .toString('base64');

  return {
    type: 'trigger.control' as const,
    timestamp: new Date(timestampMs).toISOString(),
    organizationId: V2_ORGANIZATION_ID,
    projectId: V2_PROJECT_ID,
    conversationId: '60000000-0000-4000-8000-000000000006',
    userId: V2_USER_ID,
    envelope: { ...unsignedEnvelope, signature },
  };
};

const buildProtocolV2Verifier = (rawPublicKey: Buffer): TriggerVerifier =>
  new TriggerVerifier({
    serverSigningPublicKey: rawPublicKey,
    expectedMachineId: V2_MACHINE_ID,
    expectedUserId: V2_USER_ID,
    expectedOrganizationId: V2_ORGANIZATION_ID,
    requireProtocolVersion2: true,
    now: () => 1_700_000_000_000,
    logger: noopLogger,
  });

const buildCliReadFrame = (
  options: BuildOptions & {
    event?: Record<string, unknown>;
    projectId?: string;
  },
) => {
  const machineId = options.machineId ?? MACHINE_ID;
  const userId = options.userId ?? USER_ID;
  const nonce = options.nonce ?? '55555555-5555-4555-8555-555555555555';
  const timestampMs = options.timestampMs ?? 1_700_000_000_000;
  const projectId = options.projectId ?? '20000000-0000-4000-8000-000000000002';
  const event = options.event ?? {
    requestId: '60000000-0000-4000-8000-000000000006',
    operation: 'project.session_costs.list',
    projectId,
    limit: 25,
  };
  const signature = signEnvelope(options.privateKey, {
    event,
    machineId,
    userId,
    nonce,
    timestampMs,
  });
  return {
    type: 'cli.read.request' as const,
    timestamp: new Date(timestampMs).toISOString(),
    organizationId: '10000000-0000-4000-8000-000000000001',
    projectId,
    userId,
    envelope: { event, machineId, userId, nonce, timestampMs, signature },
  };
};

const buildLegacyCliSettingsFrame = (
  options: BuildOptions & {
    event?: Record<string, unknown>;
    projectId?: string;
  },
) => {
  const machineId = options.machineId ?? MACHINE_ID;
  const userId = options.userId ?? USER_ID;
  const nonce = options.nonce ?? '66666666-6666-4666-8666-666666666666';
  const timestampMs = options.timestampMs ?? 1_700_000_000_000;
  const projectId = options.projectId ?? '20000000-0000-4000-8000-000000000002';
  const event = options.event ?? {
    requestId: '60000000-0000-4000-8000-000000000006',
    operation: 'daily_session.settings.get',
    projectId,
  };
  const signature = signEnvelope(options.privateKey, {
    event,
    machineId,
    userId,
    nonce,
    timestampMs,
  });
  return {
    type: 'cli.settings.request' as const,
    timestamp: new Date(timestampMs).toISOString(),
    organizationId: '10000000-0000-4000-8000-000000000001',
    projectId,
    userId,
    envelope: { event, machineId, userId, nonce, timestampMs, signature },
  };
};

const buildProtocolV2CliSettingsFrame = (
  privateKey: crypto.KeyObject,
  event: Record<string, unknown> = {
    requestId: '60000000-0000-4000-8000-000000000006',
    operation: 'daily_session.settings.get',
    projectId: V2_PROJECT_ID,
  },
) => {
  const unsignedEnvelope = {
    authorization: {
      kind: 'bounded_grant' as const,
      grantId: '50000000-0000-4000-8000-000000000005',
    },
    event,
    machineId: V2_MACHINE_ID,
    nonce: '60000000-0000-4000-8000-000000000006',
    protocolVersion: 2 as const,
    timestampMs: 1_700_000_000_000,
    userId: V2_USER_ID,
  };
  const signature = crypto
    .sign(null, Buffer.from(canonicalizeJson(unsignedEnvelope), 'utf8'), privateKey)
    .toString('base64');

  return {
    type: 'cli.settings.request' as const,
    timestamp: '2023-11-14T22:13:20.000Z',
    organizationId: V2_ORGANIZATION_ID,
    projectId: V2_PROJECT_ID,
    userId: V2_USER_ID,
    envelope: { ...unsignedEnvelope, signature },
  };
};

const buildVerifier = (rawPublicKey: Buffer, options: { nowMs?: number } = {}): TriggerVerifier => {
  return new TriggerVerifier({
    serverSigningPublicKey: rawPublicKey,
    expectedMachineId: MACHINE_ID,
    expectedUserId: USER_ID,
    now: () => options.nowMs ?? 1_700_000_000_000,
    logger: noopLogger,
  });
};

const AUTHORITY_MACHINE_ID = '10000000-0000-4000-8000-000000000001';
const AUTHORITY_USER_ID = '20000000-0000-4000-8000-000000000002';
const AUTHORITY_ORGANIZATION_ID = '30000000-0000-4000-8000-000000000003';

const buildAuthorityReductionFrame = (
  privateKey: crypto.KeyObject,
  options: {
    kind?: 'controller' | 'machine';
    machineId?: string;
    eventMachineId?: string;
    nonce?: string;
  } = {},
): Record<string, unknown> => {
  const machineId = options.machineId ?? AUTHORITY_MACHINE_ID;
  const eventMachineId = options.eventMachineId ?? machineId;
  const nonce = options.nonce ?? '40000000-0000-4000-8000-000000000004';
  const controller = options.kind !== 'machine';
  const event = controller
    ? {
        version: 2,
        kind: 'controller_revocation_reduction',
        action: 'CONTROLLER_REVOKE',
        machineId: eventMachineId,
        controllerCredentialId: 'controller-1',
        revokedAt: '2023-11-14T22:13:20.000Z',
        enrollmentState: 'CONTROLLER_ENROLLMENT_REQUIRED',
        executionReadiness: 'CONTROLLER_REVOKED',
      }
    : {
        version: 2,
        kind: 'machine_revocation_reduction',
        action: 'MACHINE_REVOKE',
        machineId: eventMachineId,
        revokedAt: '2023-11-14T22:13:20.000Z',
        executionReadiness: 'MACHINE_REVOKED',
      };
  const unsignedEnvelope = {
    protocolVersion: 2,
    machineId,
    userId: AUTHORITY_USER_ID,
    ...(controller ? { controllerCredentialId: 'controller-1' } : {}),
    nonce,
    timestampMs: 1_700_000_000_000,
    event,
  };
  const signature = crypto
    .sign(null, Buffer.from(canonicalizeJson(unsignedEnvelope), 'utf8'), privateKey)
    .toString('base64');
  return {
    type: 'trigger.authority_reduction',
    timestamp: '2023-11-14T22:13:20.000Z',
    organizationId: AUTHORITY_ORGANIZATION_ID,
    userId: AUTHORITY_USER_ID,
    envelope: { ...unsignedEnvelope, signature },
  };
};

describe('TriggerVerifier', () => {
  it.each(['controller', 'machine'] as const)(
    'accepts a signed and addressed %s authority reduction',
    (kind) => {
      const { privateKey, rawPublicKey } = generateServerSigningKeys();
      const verifier = new TriggerVerifier({
        serverSigningPublicKey: rawPublicKey,
        expectedMachineId: AUTHORITY_MACHINE_ID,
        expectedUserId: AUTHORITY_USER_ID,
        expectedOrganizationId: AUTHORITY_ORGANIZATION_ID,
        now: () => 1_700_000_000_000,
        logger: noopLogger,
      });

      const result = verifier.verifyTriggerFrame(
        buildAuthorityReductionFrame(privateKey, { kind }),
      );

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.verified.kind).toBe('trigger.authority_reduction');
    },
  );

  it('rejects a signed authority reduction whose body addresses another machine', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = new TriggerVerifier({
      serverSigningPublicKey: rawPublicKey,
      expectedMachineId: AUTHORITY_MACHINE_ID,
      expectedUserId: AUTHORITY_USER_ID,
      expectedOrganizationId: AUTHORITY_ORGANIZATION_ID,
      now: () => 1_700_000_000_000,
      logger: noopLogger,
    });

    const result = verifier.verifyTriggerFrame(
      buildAuthorityReductionFrame(privateKey, {
        eventMachineId: '50000000-0000-4000-8000-000000000005',
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: 'routing_mismatch' });
  });

  it('rejects a replayed authority-reduction nonce on the second presentation', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = new TriggerVerifier({
      serverSigningPublicKey: rawPublicKey,
      expectedMachineId: AUTHORITY_MACHINE_ID,
      expectedUserId: AUTHORITY_USER_ID,
      expectedOrganizationId: AUTHORITY_ORGANIZATION_ID,
      now: () => 1_700_000_000_000,
      logger: noopLogger,
    });
    const frame = buildAuthorityReductionFrame(privateKey);

    expect(verifier.verifyTriggerFrame(frame).ok).toBe(true);
    expect(verifier.verifyTriggerFrame(frame)).toMatchObject({
      ok: false,
      reason: 'nonce_replay',
    });
  });

  it('accepts the signed project-session Costs collection request', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);

    const result = verifier.verifyCliReadFrame(buildCliReadFrame({ privateKey }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verified.body).toMatchObject({
      operation: 'project.session_costs.list',
      projectId: '20000000-0000-4000-8000-000000000002',
      limit: 25,
    });
  });

  it('rejects a legacy Daily Session settings request in protocol-v2-only runtime', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildProtocolV2Verifier(rawPublicKey);

    const result = verifier.verifyCliSettingsFrame(buildLegacyCliSettingsFrame({ privateKey }));

    expect(result).toMatchObject({
      ok: false,
      reason: 'protocol_version',
      details: { frameType: 'cli.settings.request' },
    });
  });

  it('accepts a protocol-v2 Daily Session settings request with the bound project', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildProtocolV2Verifier(rawPublicKey);

    const result = verifier.verifyCliSettingsFrame(buildProtocolV2CliSettingsFrame(privateKey));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verified.envelope).toMatchObject({
      protocolVersion: 2,
      authorization: {
        kind: 'bounded_grant',
        grantId: '50000000-0000-4000-8000-000000000005',
      },
    });
    expect(result.verified.body).toMatchObject({
      operation: 'daily_session.settings.get',
      projectId: V2_PROJECT_ID,
    });
  });

  it('rejects malformed Daily Session settings values before execution', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildProtocolV2Verifier(rawPublicKey);

    const result = verifier.verifyCliSettingsFrame(
      buildProtocolV2CliSettingsFrame(privateKey, {
        requestId: '60000000-0000-4000-8000-000000000006',
        operation: 'daily_session.settings.replace',
        projectId: V2_PROJECT_ID,
        expectedPersistenceRevision: 0,
        value: {
          enabled: true,
          provider: 'codex',
          model: 'gpt-5.6-luna',
          reasoningEffort: 'xhigh',
          countThreshold: 0,
          eventTypes: [],
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('schema');
  });

  it('rejects mixed project-session and Run read fields before execution', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);

    const result = verifier.verifyCliReadFrame(
      buildCliReadFrame({
        privateKey,
        event: {
          requestId: '60000000-0000-4000-8000-000000000006',
          operation: 'project.session_costs.list',
          projectId: '20000000-0000-4000-8000-000000000002',
          limit: 25,
          runId: '70000000-0000-4000-8000-000000000007',
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('schema');
  });

  it('accepts a signed monitor command addressed by durable work-item identity', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);

    const result = verifier.verifyTriggerFrame(buildMonitorCommandFrame({ privateKey }));

    expect(result.ok).toBe(true);
    if (!result.ok || result.verified.kind !== 'trigger.monitor_command') return;
    expect(result.verified.body.target).toEqual({
      workItemType: 'TASK_MONITOR',
      workItemId: '40000000-0000-4000-8000-000000000004',
    });
    expect(result.verified.body).not.toHaveProperty('runId');
    expect(result.verified.body).not.toHaveProperty('conversationId');
  });

  it('accepts a signed monitor START command with a worktree launch configuration', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);

    const result = verifier.verifyTriggerFrame(
      buildMonitorCommandFrame({
        privateKey,
        command: {
          cause: 'START',
          launchConfig: {
            taskId: '70000000-0000-4000-8000-000000000007',
            method: 'quick',
            provider: 'codex',
            model: 'gpt-5.4',
            reasoningEffort: 'high',
            worktree: { enabled: true, branch: 'feature/plan-worktree' },
          },
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.verified.kind !== 'trigger.monitor_command') return;
    expect(result.verified.body.command).toMatchObject({
      cause: 'START',
      launchConfig: {
        taskId: '70000000-0000-4000-8000-000000000007',
        method: 'quick',
        worktree: { enabled: true, branch: 'feature/plan-worktree' },
      },
    });
  });

  it('rejects a monitor worktree configuration that does not request an enabled worktree', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);

    const result = verifier.verifyTriggerFrame(
      buildMonitorCommandFrame({
        privateKey,
        command: {
          cause: 'START',
          launchConfig: {
            taskId: '70000000-0000-4000-8000-000000000007',
            method: 'quick',
            provider: 'codex',
            model: 'gpt-5.4',
            reasoningEffort: 'high',
            worktree: { enabled: false, branch: 'feature/plan-worktree' },
          },
        },
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: 'schema' });
  });

  it('rejects START before dispatch when its typed launch context is missing', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const frame = buildMonitorCommandFrame({
      privateKey,
      command: { cause: 'START' },
    });

    const result = verifier.verifyTriggerFrame(frame);

    expect(result).toMatchObject({ ok: false, reason: 'schema' });
  });

  it('accepts canonical-state lifecycle commands without a duplicated handoff identity', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);

    const result = verifier.verifyTriggerFrame(
      buildMonitorCommandFrame({ privateKey, command: { cause: 'CONTINUE' } }),
    );

    expect(result.ok).toBe(true);
  });

  it('accepts bounded guidance changes and rejects empty, oversized, or caller-correlated forms', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);

    expect(
      verifier.verifyTriggerFrame(
        buildMonitorCommandFrame({
          privateKey,
          command: { cause: 'GUIDANCE_CHANGED', guidance: 'Prioritize the safety checks.' },
        }),
      ),
    ).toMatchObject({ ok: true });
    for (const command of [
      { cause: 'GUIDANCE_CHANGED', guidance: '' },
      { cause: 'GUIDANCE_CHANGED', guidance: 'x'.repeat(5001) },
      { cause: 'GUIDANCE_CHANGED', guidance: 'Valid', revision: 4 },
      { cause: 'GUIDANCE_CHANGED', guidance: 'Valid', effectId: 'caller-effect' },
    ]) {
      expect(
        verifier.verifyTriggerFrame(buildMonitorCommandFrame({ privateKey, command })),
      ).toMatchObject({ ok: false, reason: 'schema' });
    }
  });

  it('accepts a resolved judgment correlated by request Message identity', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);

    const result = verifier.verifyTriggerFrame(
      buildMonitorCommandFrame({
        privateKey,
        command: {
          cause: 'JUDGMENT_RESOLVED',
          judgment: {
            requestMessageId: '50000000-0000-4000-8000-000000000005',
            label: 'Your judgment',
            conclusion: 'Proceed with the safer behavior.',
          },
        },
      }),
    );

    expect(result.ok).toBe(true);
  });

  it('rejects the retired judgmentId command field', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);

    const result = verifier.verifyTriggerFrame(
      buildMonitorCommandFrame({
        privateKey,
        command: {
          cause: 'JUDGMENT_RESOLVED',
          judgment: {
            judgmentId: '50000000-0000-4000-8000-000000000005',
            label: 'Your judgment',
            conclusion: 'Proceed with the safer behavior.',
          },
        },
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: 'schema' });
  });

  it('rejects unsigned routing disagreement before monitor admission', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const frame = buildMonitorCommandFrame({ privateKey });
    frame.projectId = '50000000-0000-4000-8000-000000000005';

    const result = verifier.verifyTriggerFrame(frame);

    expect(result).toMatchObject({ ok: false, reason: 'routing_mismatch' });
  });

  it.each([
    ['command', false],
    ['reduction', true],
  ] as const)(
    'accepts a protocol-v2 monitor %s when outer and signed-body projects match',
    (_label, reduction) => {
      const { privateKey, rawPublicKey } = generateServerSigningKeys();
      const verifier = buildProtocolV2Verifier(rawPublicKey);

      const result = verifier.verifyTriggerFrame(
        buildProtocolV2MonitorFrame(privateKey, { reduction }),
      );

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.verified.kind).toBe('trigger.monitor_command');
    },
  );

  it('accepts a protocol-v2 authority-neutral human decision with platform evidence', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildProtocolV2Verifier(rawPublicKey);

    const result = verifier.verifyTriggerFrame(
      buildProtocolV2MonitorFrame(privateKey, { neutral: true }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.verified.kind !== 'trigger.monitor_command') return;
    expect(result.verified.body.command).toMatchObject({
      cause: 'HUMAN_DECISION',
      human: { userId: V2_USER_ID },
    });
  });

  it('rejects a protocol-v2 authority-neutral human decision without platform evidence', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildProtocolV2Verifier(rawPublicKey);

    const result = verifier.verifyTriggerFrame(
      buildProtocolV2MonitorFrame(privateKey, {
        neutral: true,
        neutralCommand: {
          cause: 'HUMAN_DECISION',
          interventionId: 'a0000000-0000-4000-8000-000000000001',
          providerActionId: 'provider-action-1',
          runId: 'a0000000-0000-4000-8000-000000000002',
          agentSessionId: 'a0000000-0000-4000-8000-000000000003',
          fingerprint: 'immutable-fingerprint',
          resolution: 'APPROVE',
        },
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: 'schema' });
  });

  it.each([
    ['command', false],
    ['reduction', true],
  ] as const)(
    'rejects a protocol-v2 monitor %s when outer and signed-body projects differ',
    (_label, reduction) => {
      const { privateKey, rawPublicKey } = generateServerSigningKeys();
      const verifier = buildProtocolV2Verifier(rawPublicKey);

      const result = verifier.verifyTriggerFrame(
        buildProtocolV2MonitorFrame(privateKey, {
          reduction,
          outerProjectId: '70000000-0000-4000-8000-000000000007',
        }),
      );

      expect(result).toMatchObject({ ok: false, reason: 'routing_mismatch' });
    },
  );

  it('accepts opaque provider identities in a protocol-v2 permission decision', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildProtocolV2Verifier(rawPublicKey);

    const result = verifier.verifyTriggerFrame(buildProtocolV2PermissionDecisionFrame(privateKey));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verified.kind).toBe('trigger.control');
    if (result.verified.kind !== 'trigger.control') return;
    expect(result.verified.body).toMatchObject({
      kind: 'permission_decision',
      agentSessionId: '30000000-0000-4000-8000-000000000003',
      requestId: '0',
      sessionId: 'provider-session',
      idempotencyToken: 'decision-0',
    });
  });

  it('still rejects a non-UUID Agent Session target in a protocol-v2 permission decision', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildProtocolV2Verifier(rawPublicKey);

    const result = verifier.verifyTriggerFrame(
      buildProtocolV2PermissionDecisionFrame(privateKey, {
        agentSessionId: 'not-an-agent-session-uuid',
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: 'schema' });
  });

  it('reports safe schema issue details for a rejected protocol-v2 conversation frame', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildProtocolV2Verifier(rawPublicKey);
    const result = verifier.verifyTriggerFrame(
      buildProtocolV2ConversationFrame(privateKey, {
        unrecognizedContractField: { sensitivePayload: 'must not be logged' },
      }),
    );

    expect(result).toEqual({
      ok: false,
      reason: 'schema',
      details: {
        frameType: 'trigger.conversation',
        issues: [
          {
            path: 'envelope.event',
            message: "Unrecognized key(s) in object: 'unrecognizedContractField'",
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('must not be logged');
  });

  it('accepts a well-formed conversation frame and surfaces the body', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const frame = buildConversationFrame({ privateKey });

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verified.kind).toBe('trigger.conversation');
    if (result.verified.kind !== 'trigger.conversation') return;
    expect(result.verified.body.promptType).toBe('implement');
  });

  it('accepts the signed USER-message rail for a coding_freeform follow-up', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const frame = buildConversationFrame({
      privateKey,
      promptType: 'user_message',
      payload: {
        handlerPromptType: 'coding_freeform',
        userMessage: 'Address the remaining acceptance evidence.',
        attachments: [],
      },
    });

    const result = verifier.verifyTriggerFrame(frame);

    expect(result.ok).toBe(true);
    if (!result.ok || result.verified.kind !== 'trigger.conversation') return;
    expect(result.verified.body).toMatchObject({
      promptType: 'user_message',
      payload: {
        handlerPromptType: 'coding_freeform',
        userMessage: 'Address the remaining acceptance evidence.',
        attachments: [],
      },
    });
    expect(result.verified.body).not.toHaveProperty('workflowName');
  });

  it('rejects the retired platform Plan-stage-guidance event route', () => {
    const { rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);

    const result = verifier.verifyTriggerFrame({
      type: 'trigger.platform_event',
      envelope: {
        event: { kind: 'stage_guidance_regenerate', planId: 'plan-1', stageId: 'stage-1' },
      },
    });

    expect(result).toEqual({
      ok: false,
      reason: 'unknown_frame_type',
      details: { frameType: 'trigger.platform_event' },
    });
  });

  it('rejects a frame whose signature does not match the canonical bytes', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const frame = buildConversationFrame({ privateKey });
    frame.envelope.event['payload'] = { foo: 999 };

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('signature_invalid');
  });

  it('rejects when machineId does not match the registered CLI', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const frame = buildConversationFrame({ privateKey, machineId: 'other-machine' });

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('machine_id_mismatch');
  });

  it('rejects when userId does not match the registered owner', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const frame = buildConversationFrame({ privateKey, userId: 'other-user' });

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('user_id_mismatch');
  });

  it('accepts a timestamp exactly at the +30s boundary', () => {
    const baseTime = 1_700_000_000_000;
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey, { nowMs: baseTime });
    const frame = buildConversationFrame({
      privateKey,
      timestampMs: baseTime + TIMESTAMP_WINDOW_MS,
    });

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(true);
  });

  it('rejects a timestamp beyond +30s', () => {
    const baseTime = 1_700_000_000_000;
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey, { nowMs: baseTime });
    const frame = buildConversationFrame({
      privateKey,
      timestampMs: baseTime + TIMESTAMP_WINDOW_MS + 1,
    });

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('timestamp_window');
  });

  it('rejects a replayed nonce on the second presentation', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const frame = buildConversationFrame({ privateKey });

    expect(verifier.verifyTriggerFrame(frame).ok).toBe(true);
    const second = verifier.verifyTriggerFrame(frame);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe('nonce_replay');
  });

  it('rejects an unknown top-level field on the envelope', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const frame = buildConversationFrame({ privateKey });
    (frame.envelope as unknown as Record<string, unknown>)['extraField'] = 'oops';

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('schema');
  });

  it('rejects an unknown top-level field on the frame wrapper', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const frame = buildConversationFrame({ privateKey });
    (frame as unknown as Record<string, unknown>)['extraField'] = 'oops';

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('schema');
  });

  it('rejects a conversation frame whose envelope event omits triggerMessageId', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const frame = buildConversationFrame({ privateKey, triggerMessageId: null });

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('schema');
  });

  it('rejects a conversation frame whose triggerMessageId is empty', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const frame = buildConversationFrame({ privateKey, triggerMessageId: '' });

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('schema');
  });

  it('accepts a plan_shaping_step_review conversation frame', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const frame = buildConversationFrame({
      privateKey,
      promptType: 'plan_shaping_step_review',
    });

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verified.kind).toBe('trigger.conversation');
    if (result.verified.kind !== 'trigger.conversation') return;
    expect(result.verified.body.promptType).toBe('plan_shaping_step_review');
  });

  it('accepts a plan_shaping_visual_preview conversation frame', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const frame = buildConversationFrame({
      privateKey,
      promptType: 'plan_shaping_visual_preview',
    });

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verified.kind).toBe('trigger.conversation');
    if (result.verified.kind !== 'trigger.conversation') return;
    expect(result.verified.body.promptType).toBe('plan_shaping_visual_preview');
  });

  it('rejects a conversation frame whose promptType is not on the allowlist', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const frame = buildConversationFrame({
      privateKey,
      promptType: 'not_a_real_prompt_type',
    });

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('allowlist');
  });

  it('accepts a well-formed compact_run control frame and surfaces the body', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const frame = buildControlFrame({ privateKey, kind: 'compact_run' });

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verified.kind).toBe('trigger.control');
    if (result.verified.kind !== 'trigger.control') return;
    expect(result.verified.body.kind).toBe('compact_run');
  });

  it('accepts a well-formed permission_decision control frame and surfaces the body', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const nonce = '44444444-4444-4444-4444-444444444444';
    const timestampMs = 1_700_000_000_000;
    const event = {
      kind: 'permission_decision',
      decision: 'approve',
      requestId: 'req-1',
      sessionId: 'sess-1',
      agentType: 'claude',
      reason: null,
      idempotencyToken: 'idem-1',
    };
    const signature = signEnvelope(privateKey, {
      event,
      machineId: MACHINE_ID,
      userId: USER_ID,
      nonce,
      timestampMs,
    });
    const frame = {
      type: 'trigger.control',
      timestamp: new Date(timestampMs).toISOString(),
      organizationId: 'org-1',
      conversationId: 'conv-1',
      envelope: { event, machineId: MACHINE_ID, userId: USER_ID, nonce, timestampMs, signature },
    };

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verified.kind).toBe('trigger.control');
    if (result.verified.kind !== 'trigger.control') return;
    expect(result.verified.body.kind).toBe('permission_decision');
    if (result.verified.body.kind !== 'permission_decision') return;
    expect(result.verified.body.requestId).toBe('req-1');
    expect(result.verified.body.decision).toBe('approve');
    expect(result.verified.body.agentType).toBe('claude');
  });

  it('accepts a well-formed question_answer control frame and surfaces the body', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const nonce = '66666666-6666-6666-6666-666666666666';
    const timestampMs = 1_700_000_000_000;
    const event = {
      kind: 'question_answer',
      requestId: 'claude_question_1',
      sessionId: 'sess-1',
      agentType: 'claude',
      answers: { 'Which colour?': 'Teal' },
      idempotencyToken: 'idem-q-1',
    };
    const signature = signEnvelope(privateKey, {
      event,
      machineId: MACHINE_ID,
      userId: USER_ID,
      nonce,
      timestampMs,
    });
    const frame = {
      type: 'trigger.control',
      timestamp: new Date(timestampMs).toISOString(),
      organizationId: 'org-1',
      conversationId: 'conv-1',
      envelope: { event, machineId: MACHINE_ID, userId: USER_ID, nonce, timestampMs, signature },
    };

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.verified.kind !== 'trigger.control') throw new Error('expected trigger.control');
    if (result.verified.body.kind !== 'question_answer') throw new Error('expected question_answer');
    expect(result.verified.body.requestId).toBe('claude_question_1');
    expect(result.verified.body.answers).toEqual({ 'Which colour?': 'Teal' });
    expect(result.verified.body.idempotencyToken).toBe('idem-q-1');
  });

  it('rejects a question_answer frame whose answers are not strings', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const nonce = '77777777-7777-7777-7777-777777777777';
    const timestampMs = 1_700_000_000_000;
    const event = {
      kind: 'question_answer',
      requestId: 'claude_question_1',
      sessionId: 'sess-1',
      agentType: 'claude',
      answers: { 'Which colour?': ['Teal'] },
      idempotencyToken: 'idem-q-1',
    };
    const signature = signEnvelope(privateKey, {
      event,
      machineId: MACHINE_ID,
      userId: USER_ID,
      nonce,
      timestampMs,
    });
    const frame = {
      type: 'trigger.control',
      timestamp: new Date(timestampMs).toISOString(),
      organizationId: 'org-1',
      conversationId: 'conv-1',
      envelope: { event, machineId: MACHINE_ID, userId: USER_ID, nonce, timestampMs, signature },
    };

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('schema');
  });

  it('rejects a permission_decision frame with an invalid decision value', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const nonce = '55555555-5555-5555-5555-555555555555';
    const timestampMs = 1_700_000_000_000;
    const event = {
      kind: 'permission_decision',
      decision: 'maybe',
      requestId: 'req-1',
      sessionId: 'sess-1',
      agentType: 'claude',
      idempotencyToken: 'idem-1',
    };
    const signature = signEnvelope(privateKey, {
      event,
      machineId: MACHINE_ID,
      userId: USER_ID,
      nonce,
      timestampMs,
    });
    const frame = {
      type: 'trigger.control',
      timestamp: new Date(timestampMs).toISOString(),
      organizationId: 'org-1',
      conversationId: 'conv-1',
      envelope: { event, machineId: MACHINE_ID, userId: USER_ID, nonce, timestampMs, signature },
    };

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The strict discriminated-union schema rejects the bad enum before the
    // CONTROL_KIND_ALLOWLIST is consulted.
    expect(result.reason).toBe('schema');
  });

  it('rejects a control frame with an unknown kind', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const frame = buildControlFrame({ privateKey, kind: 'something_else' });

    const result = verifier.verifyTriggerFrame(frame);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Like the platform-event channel, the control body is a discriminated
    // union on `kind`, so an unknown kind fails the strict schema before the
    // CONTROL_KIND_ALLOWLIST is consulted — both gates drop it, schema first.
    expect(result.reason).toBe('schema');
  });

  it('rejects a frame whose `type` field is unrecognized', () => {
    const { privateKey, rawPublicKey } = generateServerSigningKeys();
    const verifier = buildVerifier(rawPublicKey);
    const result = verifier.verifyTriggerFrame({
      type: 'conversation.updated',
      envelope: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown_frame_type');
  });
});

describe('TriggerVerifier.reload', () => {
  const NOW = 1_700_000_000_000;

  const buildVerifierWith = (rawPublicKey: Buffer, machineId: string): TriggerVerifier => {
    return new TriggerVerifier({
      serverSigningPublicKey: rawPublicKey,
      expectedMachineId: machineId,
      expectedUserId: USER_ID,
      now: () => NOW,
      logger: noopLogger,
    });
  };

  it('swaps the signing key and machineId so the new pairing verifies', () => {
    const keyA = generateServerSigningKeys();
    const keyB = generateServerSigningKeys();
    const verifier = buildVerifierWith(keyA.rawPublicKey, 'machine-A');

    // Pre-reload: a frame from pairing A is accepted.
    expect(
      verifier.verifyTriggerFrame(
        buildConversationFrame({
          privateKey: keyA.privateKey,
          machineId: 'machine-A',
          nonce: 'n-A-1',
          timestampMs: NOW,
        }),
      ).ok,
    ).toBe(true);

    verifier.reload({ serverSigningPublicKey: keyB.rawPublicKey, expectedMachineId: 'machine-B' });

    // Post-reload: a frame signed by B for machine-B is accepted.
    const accepted = verifier.verifyTriggerFrame(
      buildConversationFrame({
        privateKey: keyB.privateKey,
        machineId: 'machine-B',
        nonce: 'n-B-1',
        timestampMs: NOW,
      }),
    );
    expect(accepted.ok).toBe(true);
  });

  it('rejects frames signed by the old key after reload (signature stays enforced)', () => {
    const keyA = generateServerSigningKeys();
    const keyB = generateServerSigningKeys();
    const verifier = buildVerifierWith(keyA.rawPublicKey, 'machine-A');
    verifier.reload({ serverSigningPublicKey: keyB.rawPublicKey, expectedMachineId: 'machine-B' });

    const result = verifier.verifyTriggerFrame(
      buildConversationFrame({
        privateKey: keyA.privateKey,
        machineId: 'machine-B',
        nonce: 'n-old-key',
        timestampMs: NOW,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('signature_invalid');
  });

  it('rejects the old machineId after reload (machineId stays enforced)', () => {
    const keyA = generateServerSigningKeys();
    const keyB = generateServerSigningKeys();
    const verifier = buildVerifierWith(keyA.rawPublicKey, 'machine-A');
    verifier.reload({ serverSigningPublicKey: keyB.rawPublicKey, expectedMachineId: 'machine-B' });

    const result = verifier.verifyTriggerFrame(
      buildConversationFrame({
        privateKey: keyB.privateKey,
        machineId: 'machine-A',
        nonce: 'n-old-machine',
        timestampMs: NOW,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('machine_id_mismatch');
  });

  it('keeps userId, timestamp, and nonce checks intact after reload (AC3)', () => {
    const keyA = generateServerSigningKeys();
    const keyB = generateServerSigningKeys();
    const verifier = buildVerifierWith(keyA.rawPublicKey, 'machine-A');
    verifier.reload({ serverSigningPublicKey: keyB.rawPublicKey, expectedMachineId: 'machine-B' });

    // userId still bound to the original owner.
    const userMismatch = verifier.verifyTriggerFrame(
      buildConversationFrame({
        privateKey: keyB.privateKey,
        machineId: 'machine-B',
        userId: 'other-user',
        nonce: 'n-user',
        timestampMs: NOW,
      }),
    );
    expect(userMismatch.ok).toBe(false);
    if (!userMismatch.ok) expect(userMismatch.reason).toBe('user_id_mismatch');

    // Timestamp freshness still enforced.
    const stale = verifier.verifyTriggerFrame(
      buildConversationFrame({
        privateKey: keyB.privateKey,
        machineId: 'machine-B',
        nonce: 'n-stale',
        timestampMs: NOW + TIMESTAMP_WINDOW_MS + 1,
      }),
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe('timestamp_window');

    // Nonce replay still enforced.
    const fresh = buildConversationFrame({
      privateKey: keyB.privateKey,
      machineId: 'machine-B',
      nonce: 'n-replay',
      timestampMs: NOW,
    });
    expect(verifier.verifyTriggerFrame(fresh).ok).toBe(true);
    const replay = verifier.verifyTriggerFrame(fresh);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toBe('nonce_replay');
  });

  it('throws and keeps the prior key when reloaded with a malformed key', () => {
    const keyA = generateServerSigningKeys();
    const verifier = buildVerifierWith(keyA.rawPublicKey, 'machine-A');

    expect(() =>
      verifier.reload({
        serverSigningPublicKey: Buffer.from([0x00, 0x01]),
        expectedMachineId: 'machine-B',
      }),
    ).toThrow();

    // Prior key/identity remain in force — a machine-A frame still verifies.
    const result = verifier.verifyTriggerFrame(
      buildConversationFrame({
        privateKey: keyA.privateKey,
        machineId: 'machine-A',
        nonce: 'n-after-throw',
        timestampMs: NOW,
      }),
    );
    expect(result.ok).toBe(true);
  });
});
