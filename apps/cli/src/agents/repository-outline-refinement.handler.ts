import { LocalPromptType, SessionRole } from '@hey-hey/contracts/agent-bridge';
import type { RepositoryOutlineRefinementRequest } from '@hey-hey/contracts/api/models';
import type { CompletionAction, PromptTypeHandler } from './prompt-type-handler';
import { runtimeFromHandoff } from './handoff-runtime';

function failure(code: string, message: string): CompletionAction {
  return {
    action: { action: 'failure', payload: { code, message } },
    hidden: true,
  };
}

export const repositoryOutlineRefinementHandler: PromptTypeHandler<RepositoryOutlineRefinementRequest> =
  {
    id: 'repository-outline-refinement',
    promptType: LocalPromptType.RepositoryOutlineRefinement,
    sessionRole: SessionRole.Research,
    service: 'required',
    launchEntity: 'none',
    implementationReadiness: 'none',
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    providerSessionStart: 'fresh',
    providerSessionLifetime: 'turn',
    readOnlyFilesystem: true,
    builtinTools: [],
    reports: [],
    resolveRuntime: runtimeFromHandoff,
    async prepare(run, payload) {
      if (run.launchServiceId !== payload.serviceId) {
        throw new Error('Outline refinement does not match the selected Service workspace.');
      }
      return { payload };
    },
    buildPrompt: (payload) => payload.prompt,
    buildStartingMessage: () => 'Revising the Feature outline...',
    getCompletionAction(event) {
      if (!event.summary.trim()) {
        return failure('empty_output', 'The provider returned an empty Feature outline.');
      }
      return {
        action: { action: 'success', payload: { output: event.summary } },
        hidden: true,
      };
    },
    getRunnerFailureAction(error) {
      return failure('provider_error', error instanceof Error ? error.message : String(error));
    },
  };
