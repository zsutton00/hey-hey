import { createBrowserApiRuntime } from '../../../../../packages/ui-common/src/clients/shared';
import { createTestKeyPairStore } from '../../credentials/keypair.test-support';
import { createTestMessagePoster, createTestRunStore } from '../../run/run.test-support';
import type { RunRegistry } from '../../run/run-registry';
import type { RunStore } from '../../run-store/run-store';
import { createTestRunRegistryWiring } from '../__tests__/helpers/test-run-registry';
import { NOOP_LOGGER } from '../logger';
import {
  createTestPlatformAuthContext,
  createTestPlatformWebSocketManager,
} from '../monitors/test-owners.test-support';
import { MonitorProjectContext } from '../monitors/project-context';
import { createTestLocalAgentService } from '../local-agent-service.test-support';
import { createTestTaskMonitorStateMachineInputAdapter } from '../state-machine-input-adapter.test-support';
import { TriggerVerificationRuntime } from './trigger-verification-runtime';
import { RunReadRestoreCoordinator } from '../restore-persisted-runs';

interface TestTriggerVerificationRuntimeOptions {
  runStore?: RunStore;
  runRegistry?: RunRegistry;
}

export const createTestTriggerVerificationRuntime = (
  options: TestTriggerVerificationRuntimeOptions = {},
): TriggerVerificationRuntime => {
  const runStore = options.runStore ?? createTestRunStore();
  const runRegistryWiring = createTestRunRegistryWiring({ runStore });
  const runRegistry = options.runRegistry ?? runRegistryWiring.runRegistry;
  const runRestoreCoordinator = new RunReadRestoreCoordinator({
    runStore,
    runRegistry,
    logger: NOOP_LOGGER,
  });
  const apiRuntime = createBrowserApiRuntime({ baseUrl: 'https://api.trigger.test' });
  return new TriggerVerificationRuntime({
    keyPairStore: createTestKeyPairStore(),
    initialAccessToken: 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ0ZXN0LXVzZXIifQ.',
    machinesApi: apiRuntime.clients.machines,
    runStore,
    agentService: createTestLocalAgentService({ runStore }),
    promptTypeRegistry: runRegistryWiring.promptTypeRegistry,
    runRegistry,
    runRestoreCoordinator,
    poster: createTestMessagePoster(),
    projectContext: new MonitorProjectContext({
      runStore,
      platformWebSocketManager: createTestPlatformWebSocketManager(),
      logger: NOOP_LOGGER,
    }),
    taskMonitorStateMachineInputAdapter: createTestTaskMonitorStateMachineInputAdapter(),
    logger: NOOP_LOGGER,
  });
};
