import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated';
import { NOOP_LOGGER } from '../server/logger';
import { TaskMonitorManagedTurnRuntime } from '../server/task-monitor-managed-turn-runtime';
import { AgentApplicationRuntime } from './agent-application-runtime';
import { CREATE_REPORT_TOOL_NAME } from './submission-tools/create-report-tool';
import { createTestOAuthClient as createProviderTestOAuthClient } from '../auth/oauth-client.test-support';
import { JevClient } from '../jev/client';

describe('AgentApplicationRuntime', () => {
  it('captures the optional Jev client once at startup', () => {
    const createRuntime = () =>
      new AgentApplicationRuntime({
        oauthClient: createProviderTestOAuthClient(),
        apiBaseUrl: 'https://api.test/api/v1',
        logger: NOOP_LOGGER,
        taskMonitorManagedTurnRuntime: new TaskMonitorManagedTurnRuntime(NOOP_LOGGER),
        isJevParentFeatureFilterEnabled: () => Promise.resolve(true),
      });
    try {
      vi.stubEnv('TYPESAFE_API_KEY', undefined);
      const disabled = createRuntime();
      expect(disabled.jevClient).toBeUndefined();
      vi.stubEnv('TYPESAFE_API_KEY', 'local-test-key');
      const enabled = createRuntime();
      expect(enabled.jevClient).toBeInstanceOf(JevClient);
      expect(disabled.jevClient).toBeUndefined();
      vi.stubEnv('TYPESAFE_API_KEY', undefined);
      expect(enabled.jevClient).toBeInstanceOf(JevClient);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('builds the parent requirements filter only with a Jev key, reading the setting per use', () => {
    const isEnabled = vi.fn().mockResolvedValue(true);
    const createRuntime = () =>
      new AgentApplicationRuntime({
        oauthClient: createProviderTestOAuthClient(),
        apiBaseUrl: 'https://api.test/api/v1',
        logger: NOOP_LOGGER,
        taskMonitorManagedTurnRuntime: new TaskMonitorManagedTurnRuntime(NOOP_LOGGER),
        isJevParentFeatureFilterEnabled: isEnabled,
      });
    try {
      vi.stubEnv('TYPESAFE_API_KEY', undefined);
      expect(createRuntime().jevClient).toBeUndefined();
      expect(isEnabled).not.toHaveBeenCalled();
      vi.stubEnv('TYPESAFE_API_KEY', 'local-test-key');
      expect(createRuntime().jevClient).toBeInstanceOf(JevClient);
      expect(isEnabled).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('constructs one shared registry, report channel, and Task Monitor handoff', () => {
    const taskMonitorManagedTurnRuntime = new TaskMonitorManagedTurnRuntime(NOOP_LOGGER);
    const runtime = new AgentApplicationRuntime({
      oauthClient: createProviderTestOAuthClient(),
      apiBaseUrl: 'https://api.test/api/v1',
      logger: NOOP_LOGGER,
      fetchImpl: vi.fn() as typeof fetch,
      taskMonitorManagedTurnRuntime,
      isJevParentFeatureFilterEnabled: () => Promise.resolve(true),
    });

    expect(runtime.promptTypeRegistry.get(LocalPromptType.TaskMonitor)).toBeDefined();
    expect(
      runtime.promptTypeRegistry
        .get(LocalPromptType.EntityConversation)
        ?.submissionTools?.map((tool) => tool.name),
    ).toEqual(['report_changed_files', 'request_agent_session_service_scope', 'submit_session_name', 'search_session']);
    expect(runtime.baseSubmissionTools.map((tool) => tool.name)).toEqual([
      CREATE_REPORT_TOOL_NAME,
      'suggest_feature_verification',
    ]);
    expect(runtime.submissionToolRegistry).toBeDefined();
    expect(runtime.reportEmissionEvents).toBeDefined();
    expect(runtime.taskMonitorDecisionStore).toBeDefined();
  });

  it('wires canonical managed-Turn settlement into the shared Task Monitor handoff', async () => {
    const taskMonitorManagedTurnRuntime = new TaskMonitorManagedTurnRuntime(NOOP_LOGGER);
    const runtime = new AgentApplicationRuntime({
      oauthClient: createProviderTestOAuthClient(),
      apiBaseUrl: 'https://api.test/api/v1',
      logger: NOOP_LOGGER,
      fetchImpl: vi.fn() as typeof fetch,
      taskMonitorManagedTurnRuntime,
      isJevParentFeatureFilterEnabled: () => Promise.resolve(true),
    });
    runtime.taskMonitorDecisionStore.bind('coordinator-session', 'source-turn');
    const waiting = runtime.taskMonitorDecisionStore.wait('coordinator-session');

    taskMonitorManagedTurnRuntime.publishSettledTurn({
      agentSessionId: 'coordinator-session',
      turnId: 'coordinator-turn',
      promptType: LocalPromptType.TaskMonitor,
      terminalOutcome: 'FAILED',
      completedAssistantMessageId: null,
      reports: [],
      settledAt: '2026-08-04T00:00:00.000Z',
    });

    await expect(waiting).resolves.toEqual({
      status: 'TURN_SETTLED',
      terminalOutcome: 'FAILED',
    });
  });

  describe('HEYHEY_RUN_SUBAGENTS', () => {
    const createRuntime = () =>
      new AgentApplicationRuntime({
        oauthClient: createProviderTestOAuthClient(),
        apiBaseUrl: 'https://api.test/api/v1',
        logger: NOOP_LOGGER,
        fetchImpl: vi.fn() as typeof fetch,
        taskMonitorManagedTurnRuntime: new TaskMonitorManagedTurnRuntime(NOOP_LOGGER),
        isJevParentFeatureFilterEnabled: () => Promise.resolve(true),
      });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('leaves run_subagents disabled when unset', () => {
      vi.stubEnv('HEYHEY_RUN_SUBAGENTS', undefined);
      expect(createRuntime().runSubagentsTool).toBeNull();
    });

    it('enables run_subagents when on', () => {
      vi.stubEnv('HEYHEY_RUN_SUBAGENTS', 'on');
      expect(createRuntime().runSubagentsTool).not.toBeNull();
    });

    it('disables run_subagents when off', () => {
      vi.stubEnv('HEYHEY_RUN_SUBAGENTS', 'off');
      expect(createRuntime().runSubagentsTool).toBeNull();
    });

    it('rejects any other value', () => {
      vi.stubEnv('HEYHEY_RUN_SUBAGENTS', 'maybe');
      expect(createRuntime).toThrow("HEYHEY_RUN_SUBAGENTS must be 'on' or 'off', got 'maybe'.");
    });
  });
});
