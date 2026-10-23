import type { RepoMappingStore } from '../repo';
import type { RunStore } from '../run-store';
import { createTestRepoMappingStore, createTestRunStore } from '../run/run.test-support';
import {
  createTestRunRegistryWiring,
  LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
} from './__tests__/helpers/test-run-registry';
import { LocalAgentService } from './local-agent-service';
import { SETTLED_CATALOG_AVAILABILITY } from '../test-support/capability-catalog';

export interface CreateTestLocalAgentServiceOptions {
  runStore?: RunStore;
  repoStore?: RepoMappingStore;
}

/** Constructs the real LocalAgentService owner with fail-loud external test boundaries. */
export const createTestLocalAgentService = (
  options: CreateTestLocalAgentServiceOptions = {},
): LocalAgentService => {
  const runStore = options.runStore ?? createTestRunStore();
  const repoStore = options.repoStore ?? createTestRepoMappingStore();
  const wiring = createTestRunRegistryWiring({ runStore, repoStore });
  return new LocalAgentService({
    capabilityCatalog: SETTLED_CATALOG_AVAILABILITY,
    ...LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
    runStore,
    repoStore,
    runRegistry: wiring.runRegistry,
    promptTypeRegistry: wiring.promptTypeRegistry,
    workflowsApi: wiring.workflowsApi,
    messagesApi: wiring.messagesApi,
  });
};
