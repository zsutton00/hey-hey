import type {
  PromptTypeHandler,
  PromptTypeHandlerBaseDeps,
  PromptTypeHandlerDeps,
} from '../agents/prompt-type-handler';
import type { AgentSessionRunner } from '../agents/providers/session-runner';
import type { AgenticSession } from '../session/types';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import { resolveTurnEffective } from '../turn/turn-effective';
import type { ProviderPhase } from './types';

export interface PromptOnceBinding {
  handler: PromptTypeHandler<unknown>;
  session: AgenticSession;
  input: Pick<InternalRunPromptRequest, 'turnRuntime'>;
  /** The Turn's abort signal, read when the call is made. */
  abortSignal: () => AbortSignal | undefined;
  /** The Run's provider runner, resolved when the call is made. */
  runner: () => AgentSessionRunner;
  /** The Run's state writer; handlers name phases but never call it. */
  observeProviderPhase: (phase: ProviderPhase) => void;
}

/**
 * Handler deps with `promptOnce` bound to one Run's provider, the Turn's model
 * and effort, and the Turn's abort signal. The runner is resolved at call time so
 * a first Turn's `prepare` can use it before the Turn's own runner is picked.
 */
export const bindPromptOnce = (
  deps: PromptTypeHandlerBaseDeps,
  { handler, session, input, abortSignal, runner, observeProviderPhase }: PromptOnceBinding,
): PromptTypeHandlerDeps => {
  const effective = resolveTurnEffective(handler, session);
  const model = input.turnRuntime?.model ?? effective.model;
  const reasoningEffort = input.turnRuntime
    ? (input.turnRuntime.reasoningEffort ?? null)
    : effective.reasoningEffort;
  return {
    ...deps,
    promptOnce: async ({ prompt, startPhase, endPhase }) => {
      const signal = abortSignal();
      if (!signal) {
        throw new Error('promptOnce was called outside of a Turn that is being prepared.');
      }
      if (startPhase) observeProviderPhase(startPhase);
      try {
        return await runner().promptOnce({
          session,
          prompt,
          signal,
          ...(model ? { model } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
        });
      } finally {
        if (endPhase) observeProviderPhase(endPhase);
      }
    },
  };
};
