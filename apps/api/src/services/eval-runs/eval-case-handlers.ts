import { BadRequestException } from '@nestjs/common';
import {
  EvalConsumerHandlerKey,
  EvalTargetHandlerKey,
  WorkStatus,
  type EvalCaseTarget,
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
