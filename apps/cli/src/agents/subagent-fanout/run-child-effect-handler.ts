import type { ServerLogger } from '../../server/logger';
import type { AgenticSession } from '../../session/types';
import type { ChildAgentLauncher } from '../../run/child-agent-launcher';
import type { ProjectAssistantChildChecks } from '../prompts/project-assistant';
import type { ResearchChildPayload } from '../research/research.handler';
import type { EffectHandler, EffectSettlement, EffectSettlementStatus } from '../../state-machine';
import type { SubagentChildOutcome, SubagentFanoutEffect, SubagentFanoutOutcome } from './machine';

/** The only registered handler a fan-out child may run in this release. */
const SUBAGENT_FANOUT_CHILD_HANDLER_ID = 'research';

/** In-process state of a tool call that is still waiting for its children. */
export interface SubagentFanoutLiveCall {
  readonly parentSession: AgenticSession;
  readonly projectAssistantChecks: ProjectAssistantChildChecks;
  readonly signal: AbortSignal;
}

export interface RunChildEffectHandlerDependencies {
  readonly launcher: Pick<ChildAgentLauncher, 'launchRegistered'>;
  readonly findLiveCall: (instanceId: string) => SubagentFanoutLiveCall | undefined;
  readonly logger: ServerLogger;
}

const settlementStatus: Record<SubagentChildOutcome, EffectSettlementStatus> = {
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
  interrupted: 'uncertain',
};

const settle = (
  effect: SubagentFanoutEffect,
  outcome: SubagentChildOutcome,
  detail: { outputText?: string | undefined; reason?: string } = {},
): EffectSettlement<SubagentFanoutOutcome> => ({
  status: settlementStatus[outcome],
  outcome: {
    type: 'child_settled',
    index: effect.index,
    outcome,
    ...(detail.outputText ? { outputText: detail.outputText } : {}),
    ...(detail.reason ? { reason: detail.reason } : {}),
  },
});

const CANCELLED_REASON = 'The parent turn was cancelled.';

/**
 * Runs one research child for a fan-out. A child whose tool call is no longer
 * waiting in this process — after a CLI restart — is settled as interrupted
 * rather than started again.
 */
export const createRunChildEffectHandler = (
  deps: RunChildEffectHandlerDependencies,
): EffectHandler<SubagentFanoutEffect, SubagentFanoutOutcome> => ({
  execute: async (effect, execution) => {
    const call = deps.findLiveCall(execution.instanceId);
    if (!call) {
      deps.logger.debug('subagent_fanout.child.interrupted', {
        instanceId: execution.instanceId,
        index: effect.index,
        cause: 'no_live_call',
      });
      return settle(effect, 'interrupted', {
        reason: 'The requesting tool call is no longer waiting for this child.',
      });
    }
    // Read through a function: the signal can abort while the child runs.
    const aborted = (): boolean => call.signal.aborted;
    if (aborted()) return settle(effect, 'cancelled', { reason: CANCELLED_REASON });

    deps.logger.debug('subagent_fanout.child.started', {
      instanceId: execution.instanceId,
      index: effect.index,
    });
    try {
      const result = await deps.launcher.launchRegistered(SUBAGENT_FANOUT_CHILD_HANDLER_ID, {
        parentSession: call.parentSession,
        payload: {
          userMessage: effect.objective,
          _projectAssistantChecks: call.projectAssistantChecks,
        } satisfies ResearchChildPayload,
        signal: call.signal,
        // A parent with no launch Service has no workspace to share; run the child graph-only.
        ...(call.parentSession.launchServiceId ? {} : { serviceIds: [] }),
        ...(call.parentSession.model ? { model: call.parentSession.model } : {}),
        ...(call.parentSession.reasoningEffort
          ? { reasoningEffort: call.parentSession.reasoningEffort }
          : {}),
      });
      deps.logger.debug('subagent_fanout.child.completed', {
        instanceId: execution.instanceId,
        index: effect.index,
        assistantCompleted: result.assistantCompleted,
        outputLength: result.outputText?.length ?? 0,
      });
      if (aborted()) {
        return settle(effect, 'cancelled', {
          outputText: result.outputText,
          reason: CANCELLED_REASON,
        });
      }
      return result.assistantCompleted
        ? settle(effect, 'succeeded', { outputText: result.outputText })
        : settle(effect, 'failed', {
            outputText: result.outputText,
            reason: 'The research child ended without completing its answer.',
          });
    } catch (error) {
      if (aborted()) return settle(effect, 'cancelled', { reason: CANCELLED_REASON });
      deps.logger.error('subagent_fanout.child.failed', {
        instanceId: execution.instanceId,
        index: effect.index,
        error,
      });
      return settle(effect, 'failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  },
  recovery: {
    strategy: 'reconcile',
    reconcile: (effect) =>
      Promise.resolve(
        settle(effect, 'interrupted', {
          reason: 'The CLI restarted while this child was running.',
        }),
      ),
  },
});
