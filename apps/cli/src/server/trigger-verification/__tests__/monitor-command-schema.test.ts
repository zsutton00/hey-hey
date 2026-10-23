import { describe, expect, it } from 'vitest';

import { monitorCommandBodySchema } from '../schemas';

const command = () => ({
  version: 1,
  kind: 'task_monitor_command',
  commandId: '10000000-0000-4000-8000-000000000001',
  createdAt: '2026-08-08T12:01:00.000Z',
  expiresAt: '2026-08-08T12:02:00.000Z',
  organizationId: '20000000-0000-4000-8000-000000000002',
  projectId: '30000000-0000-4000-8000-000000000003',
  target: {
    workItemType: 'TASK_MONITOR',
    workItemId: '40000000-0000-4000-8000-000000000004',
  },
  command: {
    cause: 'HUMAN_DECISION',
    interventionId: '50000000-0000-4000-8000-000000000005',
    providerActionId: 'provider-action-1',
    runId: '60000000-0000-4000-8000-000000000006',
    agentSessionId: '70000000-0000-4000-8000-000000000007',
    fingerprint: 'sha256:exact-action',
    resolution: 'APPROVE',
    human: {
      userId: '80000000-0000-4000-8000-000000000008',
      authenticatedAt: '2026-08-08T12:00:59.000Z',
    },
  },
});

describe('HUMAN_DECISION monitor command schema', () => {
  it('accepts the strict generated correlation and authenticated-human evidence', () => {
    expect(monitorCommandBodySchema.parse(command()).command).toEqual(command().command);
  });

  it.each(['ALLOW', 'REJECT', 'CONTINUE'])('rejects non-contract resolution %s', (resolution) => {
    expect(
      monitorCommandBodySchema.safeParse({
        ...command(),
        command: { ...command().command, resolution },
      }).success,
    ).toBe(false);
  });

  it('rejects caller-created effect identity', () => {
    expect(
      monitorCommandBodySchema.safeParse({
        ...command(),
        command: {
          ...command().command,
          effectId: '90000000-0000-4000-8000-000000000009',
        },
      }).success,
    ).toBe(false);
  });
});

describe('JUDGMENT_RESOLVED monitor command schema', () => {
  const command = () => ({
    version: 1,
    kind: 'task_monitor_command',
    commandId: '10000000-0000-4000-8000-000000000001',
    createdAt: '2026-08-08T12:01:00.000Z',
    expiresAt: '2026-08-08T12:02:00.000Z',
    organizationId: '20000000-0000-4000-8000-000000000002',
    projectId: '30000000-0000-4000-8000-000000000003',
    target: {
      workItemType: 'TASK_MONITOR',
      workItemId: '40000000-0000-4000-8000-000000000004',
    },
    command: {
      cause: 'JUDGMENT_RESOLVED',
      judgment: {
        requestMessageId: '50000000-0000-4000-8000-000000000005',
        label: 'Your judgment',
        conclusion: 'Proceed with the safer behavior.',
      },
    },
  });

  it('accepts the generated judgment response shape', () => {
    expect(monitorCommandBodySchema.parse(command()).command).toEqual(command().command);
  });

  it('rejects an incomplete or extended judgment response', () => {
    expect(
      monitorCommandBodySchema.safeParse({
        ...command(),
        command: {
          ...command().command,
          judgment: { ...command().command.judgment, conclusion: undefined },
        },
      }).success,
    ).toBe(false);
    expect(
      monitorCommandBodySchema.safeParse({
        ...command(),
        command: {
          ...command().command,
          judgment: { ...command().command.judgment, unexpected: 'field' },
        },
      }).success,
    ).toBe(false);
  });
});
