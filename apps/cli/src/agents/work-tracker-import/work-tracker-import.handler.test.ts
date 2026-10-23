import { describe, expect, it, vi } from 'vitest';
import {
  LocalPromptType,
  type WorkTrackerImportRequest,
  type WorkTrackerImportSuccess,
} from '../../shared/agent-bridge-contract/generated/api';
import type { AssistantCompleteEvent } from '../../run/types';
import type { AgenticSession } from '../../session/types';
import type {
  OnCompleteContext,
  OnCompleteDeps,
  PromptTypeHandlerDeps,
} from '../prompt-type-handler';
import { workTrackerConnectHandler, workTrackerImportHandler } from './work-tracker-import.handler';
import { parseWorkTrackerCompletion, workTrackerRequestSchema } from './schemas';
import { buildWorkTrackerConnectionInstructions } from './connection-instructions';

const payload = {
  projectId: '11111111-1111-4111-8111-111111111111',
  conversationId: '22222222-2222-4222-8222-222222222222',
  workflowId: '33333333-3333-4333-8333-333333333333',
  workflowNodeId: 'tracker-connect',
  machineId: '44444444-4444-4444-8444-444444444444',
  source: 'linear',
  provider: 'codex',
  resolvedFrontierModel: 'selected-model',
  reasoningEffort: 'high',
  fastMode: true,
} satisfies WorkTrackerImportRequest;
const event = (value: object): AssistantCompleteEvent =>
  ({ summary: JSON.stringify(value) }) as AssistantCompleteEvent;
const success = {
  outcome: 'success',
  source: 'linear',
  narrative: 'Existing account capabilities.',
  hierarchy: {
    topLevels: [
      {
        id: 'accounts',
        name: 'Accounts',
        description: 'Manage accounts',
        tag: 'product',
        children: [
          {
            id: 'account-access',
            name: 'Account Access',
            description: 'Access accounts',
            tag: 'backend',
          },
        ],
      },
    ],
  },
  evidence: [{ reference: 'https://linear.app/team/project/accounts', summary: 'Account project' }],
} satisfies WorkTrackerImportSuccess;

describe('work tracker import', () => {
  it('uses distinct fresh, read-only provider contexts without Service requirements', async () => {
    expect(workTrackerConnectHandler.id).not.toBe(workTrackerImportHandler.id);
    for (const handler of [workTrackerConnectHandler, workTrackerImportHandler]) {
      expect(handler).toMatchObject({
        runnerKind: 'provider_session',
        providerSessionStart: 'fresh',
        providerSessionLifetime: 'turn',
        readOnlyFilesystem: true,
        builtinTools: [],
        submissionTools: [],
        reports: [],
      });
      const deps = {
        logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
      } as unknown as PromptTypeHandlerDeps;
      await expect(
        handler.prepare(
          { agentic_session_id: 'run', services: [] } as unknown as AgenticSession,
          payload,
          deps,
        ),
      ).resolves.toEqual({ payload });
      expect(handler.resolveProviderExecution(payload)).toEqual({
        provider: 'codex',
        model: 'selected-model',
      });
    }
  });

  it.each(['claude', 'codex'] as const)(
    'snapshots %s connection instructions for both sources',
    (provider) => {
      for (const source of ['jira', 'linear'] as const) {
        expect(buildWorkTrackerConnectionInstructions({ provider, source })).toMatchSnapshot();
      }
    },
  );

  it('snapshots complete connect and import prompts', () => {
    expect(workTrackerConnectHandler.buildPrompt(payload)).toMatchSnapshot();
    expect(workTrackerImportHandler.buildPrompt(payload)).toMatchSnapshot();
  });

  it('returns to connect if the fresh import context has no source access', () => {
    const missing = event({ outcome: 'connection_required', source: 'linear' });
    expect(workTrackerImportHandler.getCompletionAction(missing, payload)).toMatchObject({
      action: { action: 'connection_required', payload: { source: 'linear' } },
      hidden: false,
    });
    expect(workTrackerImportHandler.transformCompletionOutput(missing, payload)).toMatchObject({
      data: { response: expect.stringContaining('codex mcp add linear') },
    });
  });

  it('rejects wrong-source, wrong-phase and invalid output without advancing work', () => {
    for (const invalid of [
      { outcome: 'connected', source: 'jira' },
      success,
      { outcome: 'connected', source: 'linear', token: 'private' },
    ]) {
      expect(workTrackerConnectHandler.validateCompletion(event(invalid), payload).ok).toBe(false);
      expect(workTrackerConnectHandler.getCompletionAction(event(invalid), payload)).toBeNull();
    }
    expect(
      workTrackerImportHandler.validateCompletion(
        event({ outcome: 'connected', source: 'linear' }),
        payload,
      ).ok,
    ).toBe(false);
    expect(parseWorkTrackerCompletion('{')).toMatchObject({ ok: false });
    expect(workTrackerRequestSchema.safeParse({ ...payload, source: 'notion' }).success).toBe(
      false,
    );
    expect(
      workTrackerRequestSchema.safeParse({ ...payload, serviceId: 'repository' }).success,
    ).toBe(false);
  });

  it('accepts fenced and plain schema-backed outlines and rejects duplicate identities', () => {
    expect(parseWorkTrackerCompletion(JSON.stringify(success))).toEqual({
      ok: true,
      value: success,
    });
    expect(parseWorkTrackerCompletion('```json\n' + JSON.stringify(success) + '\n```')).toEqual({
      ok: true,
      value: success,
    });
    expect(workTrackerImportHandler.getCompletionAction(event(success), payload)?.action).toEqual({
      action: 'success',
      payload: success,
    });
    expect(
      workTrackerImportHandler.validateCompletion(
        event({
          ...success,
          hierarchy: {
            topLevels: [success.hierarchy.topLevels[0], success.hierarchy.topLevels[0]],
          },
        }),
        payload,
      ).ok,
    ).toBe(false);
  });

  it('writes only server-confirmed choices to the Run memo', async () => {
    const appendMemo = vi.fn();
    const ctx = { runId: 'run', payload, run: { appendMemo } } as unknown as OnCompleteContext;
    const deps = { logger: { info: vi.fn(), debug: vi.fn() } } as unknown as OnCompleteDeps;
    const connected = event({ outcome: 'connected', source: 'linear' });
    await workTrackerConnectHandler.onComplete(connected, ctx, deps);
    expect(appendMemo).not.toHaveBeenCalled();
    await workTrackerConnectHandler.onComplete(
      connected,
      { ...ctx, payload: { ...payload, connectionConfirmed: true } },
      deps,
    );
    expect(appendMemo).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'work-tracker-connect',
        content: expect.stringContaining('reasoning effort: high, fast mode: true'),
      }),
    );
  });
});
