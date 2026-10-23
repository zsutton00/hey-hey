import { DeterministicE2EEvidence } from './deterministic-e2e-evidence';
import type { AgentOutputMessage } from '../../agents/agent-event-stream';
import type { Runner } from '../../turn/turn';
import type { RunConformanceProviderOutput } from '../conformance/protocol';
import type { RunnerContext } from './types';
import { DeterministicE2EScenarioRegistry } from './deterministic-e2e-scenario-registry';

export class DeterministicE2ERunner implements Runner {
  public constructor(
    private readonly context: RunnerContext,
    private readonly registry: DeterministicE2EScenarioRegistry,
  ) {}

  public async run(signal: AbortSignal): Promise<void> {
    const scenario = this.registry.claim(this.context.run.runId);
    await DeterministicE2EEvidence.current()?.beforeProvider(signal);
    for (const command of scenario.commands) {
      if (signal.aborted) throw signal.reason;
      if (command.kind === 'start' || command.kind === 'observe') continue;
      if (command.kind === 'emit') {
        this.emit(command.output);
        this.registry.recordOutput(this.context.run.runId, command.output);
        await Promise.resolve();
        continue;
      }
      if (command.kind === 'settle' && command.outcome.kind === 'failed') {
        throw new Error(`Deterministic E2E terminal failure: ${command.outcome.code}`);
      }
      throw new Error(
        `Unexpected deterministic E2E command "${command.kind}" in browser scenario "${scenario.name}".`,
      );
    }
    this.registry.complete(this.context.run.runId);
    this.context.run.setHasProviderSession(true, 'new-session-mint');
  }

  private emit(output: RunConformanceProviderOutput): void {
    const timestamp = new Date().toISOString();
    let message: AgentOutputMessage;
    if (output.kind === 'thinking' || output.kind === 'writing') {
      message = {
        event: {
          source: 'local',
          eventType: 'processing_status',
          timestamp,
          sessionId: null,
          agentId: 'deterministic-e2e',
          payload: { kind: 'loading.update', loadingText: output.kind, phase: output.kind },
        },
      };
    } else {
      message = {
        event: {
          source: 'provider',
          eventType: 'agent_output',
          timestamp,
          sessionId: null,
          agentId: 'deterministic-e2e',
          payload: {
            messageType: 'assistant',
            taskComplete: output.kind === 'assistant_complete',
            summary: output.text,
          },
        },
      };
    }
    this.context.run.onAgentOutput(message);
  }
}
