/**
 * Event dispatcher — pure router.
 *
 * Receives pre-normalized NormalizedEvents, switches on `kind`,
 * calls the correct handler. No normalization, no extraction, no
 * payload interpretation. That's the normalizer's job.
 */

import type { NormalizedEvent, HandlerDeps } from './types';
import type { Run } from './run';
import { handleRunStarted } from './handlers/run-started';
import { handleRunCompleted } from './handlers/run-completed';
import { handleAssistantDelta } from './handlers/assistant-delta';
import { handleAssistantComplete } from './handlers/assistant-complete';
import { handleProcessingStatus } from './handlers/processing-status';
import { handleConversationPhase } from './handlers/conversation-phase';
import { handleDiff } from './handlers/diff';
import { handlePermission } from './handlers/permission';
import { handlePermissionDecisionRecorded } from './handlers/permission-decision-recorded';
import { handleAgentQuestion } from './handlers/agent-question';
import { handleQuestionAnswered } from './handlers/question-answered';
import { handleToolResult, handleToolUse } from './handlers/tool-use';

// ---------------------------------------------------------------------------
// Dispatcher — receives normalized events and routes to handlers
// ---------------------------------------------------------------------------

export class EventDispatcher {
  public constructor(private readonly dependencies: HandlerDeps) {}

  public async dispatch(event: NormalizedEvent, ctx: Run, dispatchId: symbol): Promise<void> {
    // Snapshot the currently-active Turn at event-arrival time. The reference
    // is threaded into handlers whose async chains outlive the Turn, so they
    // read the originating Turn's handler rather than re-deriving it from
    // `ctx.promptType` (which a later Turn's `begin()` may have overwritten).
    const eventTurn = ctx.activeTurn;
    try {
      switch (event.kind) {
        case 'run_started':
          await handleRunStarted(event, ctx, this.dependencies);
          break;
        case 'run_completed':
          await handleRunCompleted(event, ctx, this.dependencies);
          break;
        case 'assistant_delta':
          await handleAssistantDelta(event, ctx, this.dependencies, eventTurn);
          break;
        case 'assistant_complete':
          await handleAssistantComplete(event, ctx, this.dependencies, eventTurn, dispatchId);
          break;
        case 'processing_status':
          await handleProcessingStatus(event, ctx, this.dependencies);
          break;
        case 'conversation_phase':
          handleConversationPhase(event, ctx);
          break;
        case 'diff':
          await handleDiff(event, ctx, this.dependencies);
          break;
        case 'permission':
          await handlePermission(event, ctx, this.dependencies);
          break;
        case 'permission_decision_recorded':
          await handlePermissionDecisionRecorded(event, ctx, this.dependencies);
          break;
        case 'agent_question':
          await handleAgentQuestion(event, ctx, this.dependencies);
          break;
        case 'question_answered':
          await handleQuestionAnswered(event, ctx, this.dependencies);
          break;
        case 'tool_use':
          await handleToolUse(event, ctx, this.dependencies);
          break;
        case 'tool_result':
          await handleToolResult(event, ctx, this.dependencies);
          break;
        case 'other':
          break;
      }
    } catch (error) {
      this.dependencies.logger.error('local.event_dispatcher.handler_error', {
        runId: ctx.runId,
        kind: event.kind,
        eventType: event.eventType,
        error,
      });
    }
  }
}
