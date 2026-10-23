import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { AssistantCompleteEvent } from '../../run/types';
import { AgentSessionRunnerError } from '../providers/session-runner';
import type { AgenticSession } from '../../session/types';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import {
  RepositoryAnalysisPreparationError,
  repositoryAnalysisHandler,
} from './repository-analysis.handler';
import type {
  RepositoryAnalysisBounds,
  RepositoryAnalysisPromptPayload,
  RepositoryAnalysisSuccess,
} from './types';

const bounds: RepositoryAnalysisBounds = {
  maxFiles: 5,
  maxTotalBytes: 500,
  maxFileBytes: 100,
  maxDepth: 2,
  maxGeneratedFiles: 5,
  maxIgnoredFiles: 5,
  maxUnsupportedFiles: 5,
  maxBinaryFiles: 5,
};

const payload: RepositoryAnalysisPromptPayload = {
  promptType: LocalPromptType.RepositoryGrounding,
  projectId: '11111111-1111-4111-8111-111111111111',
  conversationId: '22222222-2222-4222-8222-222222222222',
  workflowId: '33333333-3333-4333-8333-333333333333',
  workflowNodeId: 'repository-grounding-node',
  entryMode: 'existing_project',
  serviceId: '44444444-4444-4444-8444-444444444444',
  confirmedServiceBrief: 'Customer account management.',
  machineId: '55555555-5555-4555-8555-555555555555',
  scope: { scope: 'comprehensive' },
  provider: 'claude',
  resolvedFrontierModel: 'frontier-model',
  reasoningEffort: 'high',
  fastMode: false,
  bounds,
};

const success: RepositoryAnalysisSuccess = {
  outcome: 'success',
  serviceId: payload.serviceId,
  provider: payload.provider,
  resolvedFrontierModel: payload.resolvedFrontierModel,
  narrative: 'Customers can manage account information.',
  hierarchy: {
    topLevels: [
      {
        id: 'account-management',
        name: 'Account Management',
        description: 'Customers manage account information.',
        tag: 'product',
        children: [
          {
            id: 'account-settings',
            name: 'Account Settings',
            description: 'Customers edit account settings.',
            tag: 'frontend',
          },
          {
            id: 'account-access',
            name: 'Account Access',
            description: 'Customers access their accounts.',
            tag: 'backend',
          },
        ],
      },
    ],
  },
  evidence: [{ path: 'src/accounts.ts', summary: 'Account management code.' }],
  briefDiscrepancies: [],
};

const eventFor = (value: unknown): AssistantCompleteEvent =>
  ({ summary: JSON.stringify(value) }) as AssistantCompleteEvent;

describe('repository-grounding handler', () => {
  const deps = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as unknown as PromptTypeHandlerDeps;

  it('registers one generated-contract handler with a fresh read-only posture', () => {
    expect(repositoryAnalysisHandler).toMatchObject({
      id: 'repository-analysis',
      promptType: LocalPromptType.RepositoryGrounding,
      runnerKind: 'provider_session',
      providerSessionStart: 'fresh',
      providerSessionLifetime: 'turn',
      readOnlyFilesystem: true,
      repositoryResearch: { delegation: 'allowed' },
      mcpToolUseCase: 'repository_grounding',
      reports: [],
    });
    expect(repositoryAnalysisHandler.expectedResponseTypes).toBeUndefined();
  });

  it('prepares concise metadata only for the Run launch Service binding', async () => {
    const run = {
      agentic_session_id: 'run-1',
      launchServiceId: payload.serviceId,
      services: [{ id: payload.serviceId, path: '/resolved/workspace' }],
    } as unknown as AgenticSession;

    await expect(repositoryAnalysisHandler.prepare?.(run, payload, deps)).resolves.toEqual({
      payload,
      sessionContext: {
        repositoryGrounding: { serviceId: payload.serviceId, researchMode: 'adaptive' },
      },
    });
  });

  it('does not read or embed a repository larger than the former prompt ceiling', async () => {
    const repository = await fs.mkdtemp(path.join(os.tmpdir(), 'repository-analysis-large-'));
    try {
      const sourceMarker = 'SOURCE_BODY_MUST_NOT_ENTER_PROMPT';
      await fs.writeFile(path.join(repository, 'large.txt'), sourceMarker.repeat(10_000));
      const run = {
        agentic_session_id: 'run-large',
        launchServiceId: payload.serviceId,
        services: [{ id: payload.serviceId, path: repository }],
      } as unknown as AgenticSession;

      const prepared = await repositoryAnalysisHandler.prepare?.(run, payload, deps);
      const prompt = repositoryAnalysisHandler.buildPrompt(prepared?.payload ?? payload);
      expect(prompt.length).toBeLessThan(10_000);
      expect(prompt).not.toContain(sourceMarker);
      expect(prompt).not.toContain('large.txt');
    } finally {
      await fs.rm(repository, { recursive: true, force: true });
    }
  });

  it('retains typed failure when the selected Service is not the Run launch workspace', async () => {
    const run = {
      agentic_session_id: 'run-1',
      launchServiceId: 'different-service',
      services: [{ id: payload.serviceId, path: '/resolved/workspace' }],
    } as unknown as AgenticSession;

    await expect(repositoryAnalysisHandler.prepare?.(run, payload, deps)).rejects.toMatchObject({
      name: RepositoryAnalysisPreparationError.name,
      code: 'SERVICE_BINDING_UNAVAILABLE',
    });
  });

  it.each([
    ['claude', 'claude-opus-4-5-20251101'],
    ['codex', 'gpt-5.1'],
  ] as const)(
    'carries the accepted %s provider and frontier model to runner selection',
    (provider, resolvedFrontierModel) => {
      expect(
        repositoryAnalysisHandler.resolveProviderExecution?.({
          ...payload,
          provider,
          resolvedFrontierModel,
        }),
      ).toEqual({ provider, model: resolvedFrontierModel });
    },
  );

  it('maps an unsupported runner selection to a typed terminal failure', () => {
    expect(
      repositoryAnalysisHandler.getRunnerFailureAction?.(
        new AgentSessionRunnerError('NOT_SUPPORTED', 'unsupported'),
        payload,
      ),
    ).toMatchObject({
      action: {
        action: 'terminal_failure',
        payload: { outcome: 'terminal_failure', code: 'unsupported_provider' },
      },
    });
  });

  it('builds a concise adaptive prompt without repository bodies', () => {
    const prompt = repositoryAnalysisHandler.buildPrompt(payload);
    expect(prompt).toBe(repositoryAnalysisHandler.buildPrompt(payload));
    expect(prompt).not.toContain('src/accounts.ts');
    expect(prompt).toContain('set of hypotheses');
    expect(prompt).toContain('distinct coherence challenge');
    expect(prompt).not.toContain('qualifiedUsageClass');
    expect(prompt).toContain('repository_grounding');
    expect(prompt).not.toContain('/Users/');
  });

  it('maps a valid generated success into a hidden workflow completion action', () => {
    const event = eventFor({
      ...success,
      evidence: [{ path: 'docs/product/capabilities.md', summary: 'Capability evidence.' }],
    });
    expect(repositoryAnalysisHandler.validateCompletion?.(event, payload)).toEqual({ ok: true });

    const action = repositoryAnalysisHandler.getCompletionAction?.(event, payload);
    expect(action).toMatchObject({
      action: {
        action: 'success',
        payload: expect.objectContaining({
          evidence: [{ path: 'docs/product/capabilities.md', summary: 'Capability evidence.' }],
        }),
      },
      hidden: true,
      userFacingResponse: '',
    });
  });

  it.each(['/tmp/source.ts', '../outside.ts', 'C:\\repo\\source.ts'])(
    'rejects unsafe evidence path %s',
    (path) => {
      const event = eventFor({ ...success, evidence: [{ path, summary: 'Unsafe evidence.' }] });
      expect(repositoryAnalysisHandler.validateCompletion?.(event, payload)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_COMPLETION' },
      });
    },
  );

  it('rejects removed analysis bookkeeping instead of silently carrying it downstream', () => {
    const event = eventFor({
      ...success,
      confidence: 0.8,
    });
    expect(repositoryAnalysisHandler.validateCompletion?.(event, payload)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_COMPLETION' },
    });
  });

  it('rejects missing authoritative result data and supplies a typed terminal fallback', () => {
    const incomplete = { ...success } as Record<string, unknown>;
    delete incomplete['evidence'];
    const event = eventFor(incomplete);

    expect(repositoryAnalysisHandler.validateCompletion?.(event, payload)).toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_COMPLETION',
        issues: ["/evidence: must have required property 'evidence'"],
      },
    });
    expect(repositoryAnalysisHandler.getCompletionAction?.(event, payload)).toMatchObject({
      action: {
        action: 'terminal_failure',
        payload: {
          outcome: 'terminal_failure',
          code: 'invalid_completion',
          message:
            'The provider did not return the required typed repository grounding outcome. Invalid fields: /evidence.',
        },
      },
      hidden: true,
    });
  });

  it('names mismatched identity fields in the correction errors and exhausted failure', () => {
    const event = eventFor({ ...success, provider: 'not-the-accepted-provider' });

    expect(repositoryAnalysisHandler.validateCompletion?.(event, payload)).toEqual({
      ok: false,
      error: {
        code: 'INVALID_COMPLETION',
        message: 'The completion provider identity does not match the accepted analysis request.',
        issues: [`/provider: must equal the accepted provider ${payload.provider}`],
      },
    });
    expect(repositoryAnalysisHandler.getCompletionAction?.(event, payload)).toMatchObject({
      action: {
        payload: {
          message:
            'The completion provider identity does not match the accepted analysis request. Invalid fields: /provider.',
        },
      },
    });
  });

  it('keeps raw provider output out of the exhausted failure diagnostics', () => {
    const event = {
      kind: 'assistant_complete',
      summary: '{"token": secret-value',
    } as AssistantCompleteEvent;

    const action = repositoryAnalysisHandler.getCompletionAction?.(event, payload);

    expect(action).toMatchObject({
      action: { action: 'terminal_failure', payload: { code: 'invalid_completion' } },
    });
    expect(JSON.stringify(action)).not.toContain('secret-value');
  });

  it('maps a provider-runner failure to a redacted retryable workflow outcome', () => {
    const action = repositoryAnalysisHandler.getRunnerFailureAction?.(
      new Error('HTTP 429: provider rate limit exceeded; request token=secret'),
      payload,
    );

    expect(action).toEqual({
      action: {
        action: 'retryable_failure',
        payload: {
          outcome: 'retryable_failure',
          code: 'provider_unavailable',
          message: 'Repository analysis was temporarily unavailable. Please try again.',
        },
      },
      hidden: true,
      userFacingResponse: '',
    });
    expect(JSON.stringify(action)).not.toContain('secret');
  });

  it('does not turn an aborted runner into a retryable workflow outcome', () => {
    expect(
      repositoryAnalysisHandler.getRunnerFailureAction?.(
        new Error('Claude request aborted'),
        payload,
      ),
    ).toBeNull();
  });
});
