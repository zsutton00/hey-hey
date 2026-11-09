import { describe, it, expect, vi } from 'vitest';
import type { AgentSessionRunner } from '../providers/session-runner';
import { createTestRun, createTestSessionRunnerFacade } from '../../run/run.test-support';
import { createPromptTypeHandlerTestDeps } from '../prompt-type-handler.test-support';
import { ProceduralProvider } from '../../run/runners/procedural-provider';
import { localOnboardingHandler } from './local-onboarding.handler';

// Started by the API's PostgreSQL journey suite. No HTTP methods are mocked:
// the generated client talks to the real local-step controller/service owner.
const endpoint = process.env['LOCAL_ONBOARDING_DATABASE_URL'];
const suite = endpoint ? describe : describe.skip;
suite('CLI provider boundary joined to PostgreSQL onboarding', () => {
  it('runs the admitted configuration and follows durable server progress', async () => {
    const fixture = await fetch(`${endpoint}/fixture`).then((response) => response.json());
    const run = createTestRun({});
    Object.assign(run.session, {
      agentic_session_id: fixture.agentSessionId,
      model: fixture.runtime.model,
      provider: fixture.provider,
      reasoningEffort: fixture.runtime.effort,
      fastMode: fixture.runtime.fastMode,
      services: [],
      launchServiceId: undefined,
      contextMetadata: {
        ...run.session.contextMetadata,
        organizationId: fixture.organizationId,
        projectId: fixture.projectId,
      },
    });
    const runPrompt = vi.fn<AgentSessionRunner['runPrompt']>(async (input) => {
      expect(input).toMatchObject({
        model: 'selected-model',
        reasoningEffort: 'high',
        session: { fastMode: true },
      });
      const output = await fetch(`${endpoint}/provider-output`).then((response) => response.json());
      run.onAgentOutput({
        event: {
          source: 'provider',
          eventType: 'agent_output',
          timestamp: new Date().toISOString(),
          sessionId: null,
          agentId: 'local_onboarding',
          payload: {
            messageType: 'assistant',
            taskComplete: true,
            summary: JSON.stringify(output),
          },
        },
      });
      return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
    });
    const runner: AgentSessionRunner = {
      runPrompt,
      resumeSession: runPrompt,
      getContextUsage: async () => {
        throw new Error('Context usage is not queried by onboarding generation');
      },
    };
    const deps = createPromptTypeHandlerTestDeps();
    deps.apiBaseUrl = endpoint!;
    const result = localOnboardingHandler.runProcedure!(
      { promptType: 'local_onboarding', conversationId: fixture.conversationId, userMessage: '' },
      {
        session: run.session,
        deps,
        provider: new ProceduralProvider(run, createTestSessionRunnerFacade(runner)),
      },
      new AbortController().signal,
    );
    if (fixture.expectDisconnect) {
      await expect(result).rejects.toThrow();
    } else {
      await expect(result).resolves.toBe('Project onboarding is complete.');
    }
    if (fixture.route === 'existing') {
      expect(runPrompt).not.toHaveBeenCalled();
    }
  }, 120000);
});
