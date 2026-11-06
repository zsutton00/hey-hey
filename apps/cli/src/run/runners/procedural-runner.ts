import { ProceduralProvider } from './procedural-provider';
import type { SessionRunnerFacade } from '../../server/runtime/providers/select';
import type { AgentOutputMessage } from '../../agents/agent-event-stream';
import type { Runner } from '../../turn/turn';
import type { RunnerContext } from './types';

/**
 * Runs a Turn whose handler is plain code. No provider session is started;
 * the handler's procedure owns any child agents it needs. Its closing summary
 * is published as the Turn's assistant message.
 */
export class ProceduralRunner implements Runner {
  public constructor(
    private readonly context: RunnerContext,
    private readonly providers: SessionRunnerFacade,
  ) {}

  public async run(signal: AbortSignal): Promise<void> {
    const { run, handler, input, preparedPayload, handlerDeps } = this.context;
    if (!handler.runProcedure) {
      throw new Error(`Procedural handler "${handler.promptType}" has no runProcedure.`);
    }
    if (!handlerDeps) {
      throw new Error(`Procedural handler "${handler.promptType}" requires handler dependencies.`);
    }
    // A provider call made by the procedure saves its session identity on the Run, and the Run
    // store requires that session to name its owning handler. A provider Turn gets that owner when
    // the Run resolves its handler; a procedural Turn skips that step, so claim it here.
    if (!run.session.provider_session_agent_id) {
      run.refreshSessionFields({ provider_session_agent_id: handler.id });
    }
    const summary = await handler.runProcedure(
      preparedPayload !== undefined ? preparedPayload : input.payload,
      {
        session: run.session,
        deps: handlerDeps,
        provider: new ProceduralProvider(run, this.providers),
      },
      signal,
    );
    const message: AgentOutputMessage = {
      event: {
        source: 'provider',
        eventType: 'agent_output',
        timestamp: new Date().toISOString(),
        sessionId: null,
        agentId: handler.id,
        payload: { messageType: 'assistant', taskComplete: true, summary },
      },
    };
    run.onAgentOutput(message);
  }
}
