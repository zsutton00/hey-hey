import type { AgentOutputMessage } from '../../agents/agent-event-stream';
import type { Runner } from '../../turn/turn';
import type { RunnerContext } from './types';

/**
 * Runs a Turn whose handler is plain code. No provider session is started;
 * the handler's procedure owns any child agents it needs. Its closing summary
 * is published as the Turn's assistant message.
 */
export class ProceduralRunner implements Runner {
  public constructor(private readonly context: RunnerContext) {}

  public async run(signal: AbortSignal): Promise<void> {
    const { run, handler, input, preparedPayload, handlerDeps } = this.context;
    if (!handler.runProcedure) {
      throw new Error(`Procedural handler "${handler.promptType}" has no runProcedure.`);
    }
    if (!handlerDeps) {
      throw new Error(`Procedural handler "${handler.promptType}" requires handler dependencies.`);
    }
    const summary = await handler.runProcedure(
      preparedPayload !== undefined ? preparedPayload : input.payload,
      { session: run.session, deps: handlerDeps },
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
