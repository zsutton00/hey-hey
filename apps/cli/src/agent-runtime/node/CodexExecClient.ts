import { AgentAdapterRegistry, type AgentSessionMetadata } from '../core/index';
import type {
  AgentInitOptions,
  AgentSessionStore,
  SessionMetadataFactory,
  SubmitPromptOptions,
} from '../core/index';
import { NodeAgentClient } from './NodeAgentClient';
import type { NodeAgentOrchestratorOptions } from './NodeAgentOrchestrator';
import { CodexExecAdapter, type CodexExecAdapterConfig } from './CodexExecAdapter';

export interface CodexExecClientOptions<
  TSessionMetadata extends AgentSessionMetadata = AgentSessionMetadata,
> {
  initOptions: AgentInitOptions;
  promptOptions?: SubmitPromptOptions | undefined;
  sessionStore?: (AgentSessionStore<TSessionMetadata> | null) | undefined;
  createSessionMetadata?: SessionMetadataFactory<TSessionMetadata> | undefined;
  retryPolicies?: NodeAgentOrchestratorOptions<TSessionMetadata>['retryPolicies'] | undefined;
  errorVerbosity?: NodeAgentOrchestratorOptions<TSessionMetadata>['errorVerbosity'] | undefined;
  onNormalizedError?:
    | NodeAgentOrchestratorOptions<TSessionMetadata>['onNormalizedError']
    | undefined;
  codex?: CodexExecAdapterConfig | undefined;
}

export const createCodexExecRegistry = (
  codexOptions: CodexExecAdapterConfig = {},
): AgentAdapterRegistry => {
  const registry = new AgentAdapterRegistry();
  registry.register('codex', () => new CodexExecAdapter(codexOptions));
  return registry;
};

export const createCodexExecClient = <
  TSessionMetadata extends AgentSessionMetadata = AgentSessionMetadata,
>(
  options: CodexExecClientOptions<TSessionMetadata>,
): NodeAgentClient<TSessionMetadata> =>
  new NodeAgentClient<TSessionMetadata>({
    adapterId: 'codex',
    initOptions: options.initOptions,
    promptOptions: options.promptOptions,
    sessionStore: options.sessionStore,
    createSessionMetadata: options.createSessionMetadata,
    retryPolicies: options.retryPolicies,
    errorVerbosity: options.errorVerbosity,
    onNormalizedError: options.onNormalizedError,
    registry: createCodexExecRegistry(options.codex),
  });
