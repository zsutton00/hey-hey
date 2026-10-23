import type { AgentSessionRunner } from '../../agents/providers/session-runner';
import type { Run } from '../run';
import type { Runner } from '../../turn/turn';
import { NewSessionRunner } from './new-session-runner';
import { ResumeRunner } from './resume-runner';
import { SubagentRunner } from './subagent-runner';
import { ProceduralRunner } from './procedural-runner';
import type { RunnerPickerDependencies, RunnerContext } from './types';
import { DeterministicE2ERunner } from './deterministic-e2e-runner';

/**
 * Own the per-Turn runner selection collaborators. `pick` is invoked by Run
 * once prompt resolution, handler lookup, and message posting have
 * all completed — the `RunnerContext` passed in carries the fully-resolved
 * state.
 *
 * Picker contract:
 *
 * - `handler.runnerKind === 'subagent'`: construct `SubagentRunner` from
 *   `handler.subagentConfig`. Throws when `subagentConfig` is missing.
 * - `handler.runnerKind === 'provider_session'`: branch on
 *   `ctx.run.hasProviderSession` — `ResumeRunner` when the Run already
 *   has a session, `NewSessionRunner` for the first turn.
 *
 * - `handler.runnerKind === 'procedural'`: construct `ProceduralRunner`,
 *   which runs the handler's code without a provider session.
 *
 * Throws on an unrecognized `runnerKind`. `ctx.handler` is always
 * non-null by contract (Run rejects unregistered promptTypes before
 * calling the picker), so there is no null-handler branch.
 */
export class RunnerPicker {
  public constructor(private readonly dependencies: RunnerPickerDependencies) {}

  /** The Run's provider runner, created on first use — available before a Turn is picked. */
  public runnerFor(run: Run): AgentSessionRunner {
    return this.dependencies.sessionRunnerFacade.forRun(run);
  }

  public pick(ctx: RunnerContext): Runner {
    const { handler } = ctx;

    if (handler.runnerKind === 'subagent') {
      if (!this.dependencies.childAgentLauncher) {
        throw new Error('pickRunner: child agent launcher is required for subagent handlers.');
      }
      if (!handler.subagentConfig) {
        throw new Error(
          `pickRunner: handler "${handler.promptType}" declares ` +
            `runnerKind="subagent" but has no subagentConfig.`,
        );
      }
      this.dependencies.logger.info('runtime.pick_runner.decision', {
        runId: ctx.run.runId,
        promptType: handler.promptType,
        runnerKind: 'subagent',
        reason: 'subagent-config',
      });
      return new SubagentRunner(ctx, handler.subagentConfig, {
        childAgentLauncher: this.dependencies.childAgentLauncher,
        logger: this.dependencies.logger,
        runChangedFilesReader: this.dependencies.runChangedFilesReader,
      });
    }

    if (handler.runnerKind === 'procedural') {
      this.dependencies.logger.info('runtime.pick_runner.decision', {
        runId: ctx.run.runId,
        promptType: handler.promptType,
        runnerKind: 'procedural',
        reason: 'procedural-handler',
      });
      return new ProceduralRunner(ctx);
    }

    if (handler.runnerKind === 'provider_session') {
      if (this.dependencies.deterministicE2EScenarioRegistry) {
        this.dependencies.logger.info('runtime.pick_runner.decision', {
          runId: ctx.run.runId,
          promptType: handler.promptType,
          runnerKind: 'provider_session',
          reason: 'deterministic-e2e-scenario',
        });
        return new DeterministicE2ERunner(ctx, this.dependencies.deterministicE2EScenarioRegistry);
      }
      this.dependencies.sessionRunnerFacade.forRun(ctx.run);
      if (ctx.run.hasProviderSession) {
        this.dependencies.logger.info('runtime.pick_runner.decision', {
          runId: ctx.run.runId,
          promptType: handler.promptType,
          runnerKind: 'provider_session',
          reason: 'provider-session-resume',
        });
        return new ResumeRunner(ctx, {
          sessionRunnerFacade: this.dependencies.sessionRunnerFacade,
          logger: this.dependencies.logger,
        });
      }
      const reason =
        ctx.providerSessionMintReason === 'agent-transition'
          ? 'provider-session-agent-transition'
          : 'provider-session-new';
      this.dependencies.logger.info('runtime.pick_runner.decision', {
        runId: ctx.run.runId,
        promptType: handler.promptType,
        runnerKind: 'provider_session',
        reason,
      });
      return new NewSessionRunner(ctx, {
        sessionRunnerFacade: this.dependencies.sessionRunnerFacade,
        logger: this.dependencies.logger,
      });
    }

    throw new Error(
      `pickRunner: handler "${handler.promptType}" has unrecognized ` +
        `runnerKind="${String((handler as { runnerKind: unknown }).runnerKind)}".`,
    );
  }
}
