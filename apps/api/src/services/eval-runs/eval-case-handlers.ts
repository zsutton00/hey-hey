import { BadRequestException } from '@nestjs/common';
import {
  EvalAssessedOutput,
  EvalConsumerHandlerKey,
  EvalTargetHandlerKey,
  WorkStatus,
  type EvalCaseTarget,
  type EvalHandlerConfig,
  type EvalResolvedExecution,
  type ProjectedWorkItem,
} from 'src/generated';

const TARGET_HANDLER_KEYS: readonly string[] =
  Object.values(EvalTargetHandlerKey);
const CONSUMER_HANDLER_KEYS: readonly string[] = Object.values(
  EvalConsumerHandlerKey,
);

function isTargetHandlerKey(value: string): value is EvalTargetHandlerKey {
  return TARGET_HANDLER_KEYS.includes(value);
}

function isConsumerHandlerKey(value: string): value is EvalConsumerHandlerKey {
  return CONSUMER_HANDLER_KEYS.includes(value);
}

function sectionText(
  sections: ReadonlyArray<{ key: string; content: unknown }>,
  key: string,
): string {
  const content = sections.find((section) => section.key === key)?.content;
  return typeof content === 'string' ? content.trim() : '';
}

/**
 * Approval makes an Eval Case runnable, so a case that would be rejected at
 * launch is rejected here, before anyone can select it. A case leaving the
 * runnable state is not checked.
 */
export function assertApprovedEvalCaseHandlers(
  root: Pick<ProjectedWorkItem, 'name' | 'status' | 'sections'>,
): void {
  if (
    root.status === WorkStatus.Archived ||
    root.status === WorkStatus.Superseded
  ) {
    return;
  }

  resolveEvalCaseHandlers(
    root.name,
    sectionText(root.sections, 'handler'),
    sectionText(root.sections, 'consumerHandler'),
  );
}

/**
 * Eval attempts never change the project, so Project Assistant research that
 * has no consumer of its own runs under entity conversation's real policy:
 * edge updates, discrepancy notices and work item proposals all off.
 */
const PROJECT_ASSISTANT_ALONE_CONSUMER =
  EvalConsumerHandlerKey.EntityConversation;

/** Launch rejects a run-level handler that is not an evaluable handler key. */
export function assertEvaluableRunHandler(
  handlerConfig: EvalHandlerConfig | undefined,
): void {
  const handler = handlerConfig?.handler;
  if (handler !== undefined && !isTargetHandlerKey(handler)) {
    throw new BadRequestException(
      `Eval run cannot start: handler "${handler}" is not evaluable. Evaluable handlers: ${TARGET_HANDLER_KEYS.join(', ')}.`,
    );
  }
}

/**
 * What one attempt executes. The run's chosen handler replaces the handler the
 * case names, without editing the case; without one the case's own handler
 * runs. A real handler is prepared by Project Assistant unless the setup turns
 * it off or the handler declares no Project Assistant policy. Resolved once at
 * launch and recorded, so the CLI and results read the same answer.
 */
export function resolveEvalExecution(
  caseTarget: Pick<EvalCaseTarget, 'targetHandler' | 'consumerHandler'>,
  handlerConfig: EvalHandlerConfig | undefined,
): EvalResolvedExecution {
  const handler = handlerConfig?.handler ?? caseTarget.targetHandler;

  if (handler === EvalTargetHandlerKey.ProjectAssistant) {
    const consumerHandler = handlerConfig?.handler
      ? PROJECT_ASSISTANT_ALONE_CONSUMER
      : caseTarget.consumerHandler;
    return {
      handler,
      ...(consumerHandler ? { consumerHandler } : {}),
      projectAssistantPrepares: false,
      assessedOutput: EvalAssessedOutput.ResearchReport,
    };
  }

  return {
    handler,
    projectAssistantPrepares:
      isConsumerHandlerKey(handler) &&
      handlerConfig?.projectAssistant?.enabled !== false,
    assessedOutput: EvalAssessedOutput.HandlerReply,
  };
}

/**
 * The one check shared by Eval Case approval and eval run launch: the case
 * names an evaluable handler by registry key, and names its consumer handler
 * exactly when that handler is Project Assistant. Keys are the generated
 * enums, which the CLI tests against the handlers it registers.
 */
export function resolveEvalCaseHandlers(
  caseName: string,
  handler: string,
  consumer: string,
): Pick<EvalCaseTarget, 'targetHandler' | 'consumerHandler'> {
  if (!isTargetHandlerKey(handler)) {
    throw new BadRequestException(
      `Eval case "${caseName}" cannot run: handler "${handler}" is not evaluable. Evaluable handlers: ${TARGET_HANDLER_KEYS.join(', ')}.`,
    );
  }

  if (handler !== EvalTargetHandlerKey.ProjectAssistant) {
    if (consumer) {
      throw new BadRequestException(
        `Eval case "${caseName}" cannot run: only a ${EvalTargetHandlerKey.ProjectAssistant} case names a consumer handler.`,
      );
    }
    return { targetHandler: handler };
  }

  if (!isConsumerHandlerKey(consumer)) {
    throw new BadRequestException(
      consumer
        ? `Eval case "${caseName}" cannot run: consumer handler "${consumer}" is not evaluable. Consumer handlers: ${CONSUMER_HANDLER_KEYS.join(', ')}.`
        : `Eval case "${caseName}" cannot run: a ${EvalTargetHandlerKey.ProjectAssistant} case must name its consumer handler. Consumer handlers: ${CONSUMER_HANDLER_KEYS.join(', ')}.`,
    );
  }
  return { targetHandler: handler, consumerHandler: consumer };
}
