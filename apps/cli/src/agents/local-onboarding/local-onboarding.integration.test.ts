import axios, { AxiosError, type AxiosAdapter } from 'axios';
import { CredentialStore, type OAuthCredential } from '../../credentials/store';
import { OAuthClient } from '../../auth/oauth-client';
import { SubmissionToolAuth } from '../submission-tools/submission-tool-auth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationsApi, type LocalOnboardingStepResponse } from '../../shared/api/generated';
import { LocalReasoningEffort } from '../../shared/agent-bridge-contract/contract';
import type { AgentSessionRunner } from '../providers/session-runner';
import { createTestRun, createTestSessionRunnerFacade } from '../../run/run.test-support';
import { createPromptTypeHandlerTestDeps } from '../prompt-type-handler.test-support';
import { ProceduralProvider } from '../../run/runners/procedural-provider';
import { localOnboardingHandler } from './local-onboarding.handler';

const originalAdapter = axios.defaults.adapter;
const conversationId = '09b4e16e-27ea-4c63-a44f-d48f9b77ef55';
const requestId = '45639f04-4c17-4b41-96bb-a7e3767b4881';
const payload = { promptType: 'local_onboarding', conversationId, userMessage: '' } as const;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalAdapter === undefined) {
    delete axios.defaults.adapter;
  } else {
    axios.defaults.adapter = originalAdapter;
  }
});

function setup(onGenerate: () => void = () => {}) {
  const run = createTestRun({});
  run.session.services = [];
  delete run.session.launchServiceId;
  run.session.model = 'selected-model';
  run.session.reasoningEffort = LocalReasoningEffort.High;
  run.session.fastMode = true;
  const runPrompt = vi.fn<AgentSessionRunner['runPrompt']>(async () => {
    onGenerate();
    run.onAgentOutput({
      event: {
        source: 'provider',
        eventType: 'agent_output',
        timestamp: new Date().toISOString(),
        sessionId: null,
        agentId: 'local_onboarding',
        payload: { messageType: 'assistant', taskComplete: true, summary: '{"result":"reviewed"}' },
      },
    });
    return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
  });
  const runner: AgentSessionRunner = {
    runPrompt,
    resumeSession: runPrompt,
    getContextUsage: async () => {
      throw new Error('This generation test does not query context usage');
    },
  };
  const provider = new ProceduralProvider(run, createTestSessionRunnerFacade(runner));
  const context = { session: run.session, deps: createPromptTypeHandlerTestDeps(), provider };
  return { run, runPrompt, context };
}

function respond(step: LocalOnboardingStepResponse) {
  return { data: { data: step } } as Awaited<
    ReturnType<ConversationsApi['advanceLocalOnboarding']>
  >;
}

describe('CLI-owned onboarding provider integration', () => {
  it('completes existing-work onboarding without a provider call', async () => {
    const { context, runPrompt } = setup();
    vi.spyOn(ConversationsApi.prototype, 'advanceLocalOnboarding').mockResolvedValue(
      respond({ state: 'COMPLETED' }),
    );
    await localOnboardingHandler.runProcedure!(payload, context, new AbortController().signal);
    expect(runPrompt).not.toHaveBeenCalled();
  });

  it('executes discovery and refinement with the complete saved runtime at the provider boundary', async () => {
    const { context, runPrompt } = setup();
    const advance = vi
      .spyOn(ConversationsApi.prototype, 'advanceLocalOnboarding')
      .mockResolvedValueOnce(
        respond({
          state: 'PROVIDER_REQUIRED',
          requestId,
          prompt: 'Discover the initial product structure',
        }),
      )
      .mockResolvedValueOnce(
        respond({
          state: 'PROVIDER_REQUIRED',
          requestId: conversationId,
          prompt: 'Refine using the reviewed feedback',
        }),
      )
      .mockResolvedValueOnce(respond({ state: 'COMPLETED' }));
    await localOnboardingHandler.runProcedure!(payload, context, new AbortController().signal);
    expect(runPrompt).toHaveBeenCalledTimes(2);
    for (const [call] of runPrompt.mock.calls) {
      expect(call).toMatchObject({
        model: 'selected-model',
        reasoningEffort: 'high',
        session: { fastMode: true },
        mcpToolUseCase: 'local_onboarding',
        builtinTools: [],
        readOnlyFilesystem: true,
      });
    }
    expect(advance.mock.calls[1]?.[0].localOnboardingStepRequest).toMatchObject({
      requestId,
      outputText: '{"result":"reviewed"}',
    });
    expect(advance.mock.calls[2]?.[0].localOnboardingStepRequest.requestId).toBe(conversationId);
  });

  it('reads canonical progress after a lost acknowledgement instead of replaying an accepted review', async () => {
    const { context, runPrompt } = setup();
    let accepted = false;
    const advance = vi
      .spyOn(ConversationsApi.prototype, 'advanceLocalOnboarding')
      .mockImplementation(async ({ localOnboardingStepRequest }) => {
        if (accepted) {
          return respond({ state: 'COMPLETED' });
        }
        if (localOnboardingStepRequest.requestId) {
          accepted = true;
          throw new Error('Connection lost after commit');
        }
        return respond({
          state: 'PROVIDER_REQUIRED',
          requestId,
          prompt: 'Review product structure',
        });
      });
    await expect(
      localOnboardingHandler.runProcedure!(payload, context, new AbortController().signal),
    ).rejects.toThrow('Connection lost after commit');
    await localOnboardingHandler.runProcedure!(payload, context, new AbortController().signal);
    expect(runPrompt).toHaveBeenCalledTimes(1);
    expect(advance).toHaveBeenCalledTimes(3);
  });
});

describe('onboarding OAuth expiration recovery', () => {
  it.each(['waiting', 'output'] as const)(
    'refreshes credentials after expiration during %s without regenerating or applying output twice',
    async (stage) => {
      let now = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      let credential: OAuthCredential = {
        accessToken: 'initial-access',
        refreshToken: 'refresh-credential',
        expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        tokenType: 'Bearer',
        scope: ['read', 'write'],
      };
      const store = new CredentialStore();
      vi.spyOn(store, 'retrieve').mockImplementation(async () => credential);
      vi.spyOn(store, 'update').mockImplementation(async (_key, updated) => {
        credential = updated;
      });
      const refresh = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: 'renewed-access',
              token_type: 'Bearer',
              expires_in: 86400,
            }),
            { status: 200 },
          ),
      );
      vi.stubGlobal('fetch', refresh);
      const { context, runPrompt } = setup(() => {
        if (stage === 'output') {
          now += 25 * 60 * 60 * 1000;
        }
      });
      context.deps.auth = new SubmissionToolAuth(
        new OAuthClient({
          credentialStore: store,
          config: { baseUrl: 'http://onboarding.test' },
        }),
      );
      let waited = false;
      let applied = 0;
      const adapter = vi.fn<AxiosAdapter>(async (config) => {
        const body = JSON.parse(config.data);
        const token = config.headers.get('Authorization');
        if (stage === 'waiting' && !waited) {
          expect(token).toBe('Bearer initial-access');
          waited = true;
          now += 25 * 60 * 60 * 1000;
          return {
            config,
            status: 200,
            statusText: 'OK',
            headers: {},
            data: { data: { state: 'WAITING_FOR_USER' } },
          };
        }
        if (body.requestId || stage === 'waiting') {
          if (token !== 'Bearer renewed-access') {
            throw new AxiosError('Expired access credential', 'ERR_BAD_REQUEST', config);
          }
        }
        if (body.requestId) {
          expect(body).toMatchObject({ requestId, outputText: '{"result":"reviewed"}' });
          applied += 1;
          return {
            config,
            status: 200,
            statusText: 'OK',
            headers: {},
            data: { data: { state: 'COMPLETED' } },
          };
        }
        return {
          config,
          status: 200,
          statusText: 'OK',
          headers: {},
          data: {
            data: { state: 'PROVIDER_REQUIRED', requestId, prompt: 'Review product structure' },
          },
        };
      });
      axios.defaults.adapter = adapter;
      await expect(
        localOnboardingHandler.runProcedure!(payload, context, new AbortController().signal),
      ).resolves.toBe('Project onboarding is complete.');
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(store.update).toHaveBeenCalledTimes(1);
      expect(runPrompt).toHaveBeenCalledTimes(1);
      expect(applied).toBe(1);
      expect(adapter).toHaveBeenCalledTimes(stage === 'waiting' ? 3 : 2);
    },
  );
});
