import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import { createTestKeyPairStore } from '../credentials/keypair.test-support';
import { MessagePoster } from '../run/message-poster';
import { RunStore } from '../run-store/run-store';
import { NOOP_LOGGER } from '../server/logger';
import { TaskMonitorManagedTurnRuntime } from '../server/task-monitor-managed-turn-runtime';
import { PlatformWebSocketManager } from '../server/platform-ws';
import { EntityReportIndex } from '../server/reports/entity-report-index';
import { createTestOAuthClient as createProviderTestOAuthClient } from '../auth/oauth-client.test-support';
import { SubmissionToolAuth } from './submission-tools/submission-tool-auth';
import { TaskMonitorDecisionStore } from './task-monitor/task-monitor-decision-store';
import { SessionMonitorEvaluationStore } from './session-monitor';
import type { OnCompleteDeps, PromptTypeHandlerDeps } from './prompt-type-handler';
import type { MachineEffectProofSigner } from '../auth/machine-effect-proof';
import { AgentStartupPromptInput } from '../commands/agent-startup-prompt-input';
import { EntityContextLoader } from './entity-context/entity-context-loader';

const testPath = (owner: string): string =>
  path.join(os.tmpdir(), `heyhey-handler-owner-${crypto.randomUUID()}`, owner);

export const createPromptTypeHandlerTestRunStore = (): RunStore => {
  const baseDir = testPath('run-store');
  const runsDir = path.join(baseDir, 'runs');
  const store = new RunStore({
    paths: {
      baseDir,
      runsDir,
      indexPath: path.join(runsDir, 'run-index.json'),
      preferencesPath: path.join(baseDir, 'preferences.json'),
    },
  });
  vi.spyOn(store, 'getRun').mockResolvedValue(null);
  return store;
};

export const createPromptTypeHandlerTestAuth = (token = 'test-access-token'): SubmissionToolAuth =>
  new SubmissionToolAuth(createProviderTestOAuthClient({ success: true, data: token }));

const createPromptTypeHandlerTestDecisionStore = (): TaskMonitorDecisionStore => {
  const store = new TaskMonitorDecisionStore(
    NOOP_LOGGER,
    new TaskMonitorManagedTurnRuntime(NOOP_LOGGER),
  );
  vi.spyOn(store, 'bind');
  vi.spyOn(store, 'publish');
  return store;
};

export const createOnCompleteTestMessagePoster = (): MessagePoster => {
  const poster = new MessagePoster({
    apiClient: {
      postMessage: async () => {
        throw new Error('Handler test MessagePoster post boundary was called unexpectedly.');
      },
      updateMessage: async () => {
        throw new Error('Handler test MessagePoster update boundary was called unexpectedly.');
      },
    },
    logger: NOOP_LOGGER,
    dataDir: testPath('message-poster'),
  });
  vi.spyOn(poster, 'createOutOfBand').mockResolvedValue('test-message-id');
  vi.spyOn(poster, 'update').mockResolvedValue(undefined);
  return poster;
};

const createOnCompleteTestPlatformWebSocketManager = (): PlatformWebSocketManager => {
  const manager = new PlatformWebSocketManager({
    serverUrl: 'https://ws.example.test',
    oauthClient: createProviderTestOAuthClient({
      success: false,
      error: 'test auth unavailable',
    }),
    logger: NOOP_LOGGER,
    keyPairStore: createTestKeyPairStore(),
  });
  vi.spyOn(manager, 'emitDailySessionUpdate').mockImplementation(() => undefined);
  return manager;
};

const unusedFetch = (() =>
  Promise.reject(
    new Error('Handler test fetch boundary was called unexpectedly.'),
  )) as typeof fetch;

export const createPromptTypeHandlerTestDeps = (
  overrides: Partial<PromptTypeHandlerDeps> = {},
): PromptTypeHandlerDeps => {
  const auth = overrides.auth ?? createPromptTypeHandlerTestAuth();
  const apiBaseUrl = overrides.apiBaseUrl ?? 'https://api.example.test/api/v1';
  const logger = overrides.logger ?? NOOP_LOGGER;
  const entityContextLoader = new EntityContextLoader({ auth, apiBaseUrl, logger });
  const startupPromptInput =
    overrides.startupPromptInput ??
    new AgentStartupPromptInput({ auth, apiBaseUrl, logger, entityContextLoader });
  if (!overrides.startupPromptInput) {
    vi.spyOn(startupPromptInput, 'resolve').mockImplementation(async (request) => ({
      startupInput: {
        task: { id: request.runEntity.entityId, taskType: 'STANDARD', description: '' },
        focalEntity: request.runEntity,
        adjacentScopeTasks: [],
        evidenceItems: [],
      },
      renderedInput: 'CURRENT ENTITY CONTEXT',
      loadedEntityContext: {
        kind: 'entity',
        focalEntity: request.runEntity,
        entity: {} as never,
        context: {} as never,
      },
      provenance: {
        templateKey: 'test',
        ownershipSource: { scope: 'CANONICAL' },
        revisionId: 'test-revision',
        revisionNumber: 1,
      },
    }));
  }
  return {
    runStore: createPromptTypeHandlerTestRunStore(),
    fetchImpl: unusedFetch,
    auth,
    apiBaseUrl,
    logger,
    taskMonitorDecisionStore: createPromptTypeHandlerTestDecisionStore(),
    sessionMonitorEvaluationStore: new SessionMonitorEvaluationStore(NOOP_LOGGER),
    startupPromptInput,
    childAgentLauncher: {
      launchRegistered: () => Promise.reject(new Error('No child launcher in this test')),
    },
    promptOnce: () => Promise.reject(new Error('No promptOnce in this test')),
    ...overrides,
  };
};

export const createOnCompleteTestDeps = (
  overrides: Partial<OnCompleteDeps> = {},
): OnCompleteDeps => {
  const reportIndex = new EntityReportIndex();
  vi.spyOn(reportIndex, 'registerReport');
  return {
    fetchImpl: unusedFetch,
    auth: createPromptTypeHandlerTestAuth(),
    apiBaseUrl: 'https://api.example.test/api/v1',
    machineEffectProofSigner: {
      sign: vi.fn(async () => ({
        machineCredential: 'machine-credential',
        proof: {
          version: 1,
          operationId: 'submitSessionMonitorDecision',
          method: 'POST',
          path: '/session-monitor-decisions',
          bodySha256: '0'.repeat(64),
          organizationId: 'org-1',
          effectId: '00000000-0000-4000-8000-000000000004',
          nonce: '00000000-0000-4000-8000-000000000005',
          timestampMs: 0,
          signature: 'a'.repeat(86),
        },
      })),
    } as unknown as MachineEffectProofSigner,
    logger: NOOP_LOGGER,
    taskMonitorDecisionStore: createPromptTypeHandlerTestDecisionStore(),
    sessionMonitorEvaluationStore: new SessionMonitorEvaluationStore(NOOP_LOGGER),
    poster: createOnCompleteTestMessagePoster(),
    runStore: createPromptTypeHandlerTestRunStore(),
    reportIndex,
    platformWebSocketManager: createOnCompleteTestPlatformWebSocketManager(),
    ...overrides,
  };
};
