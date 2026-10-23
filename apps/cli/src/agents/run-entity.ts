import type { AgenticSession } from '../session/types';
import type { RunEntityReference } from '../shared/agent-bridge-contract/contract';
import type { PromptTypeHandlerContext } from './prompt-type-handler';

const taskIdFromRunEntity = (entity: RunEntityReference | null | undefined): string | null =>
  entity?.entityType === 'TASK' ? entity.entityId : null;

export const taskIdFromSession = (session: AgenticSession): string | null =>
  taskIdFromRunEntity(session.entity);

export const taskIdFromHandlerContext = (
  context: PromptTypeHandlerContext | undefined,
): string | null => taskIdFromRunEntity(context?.entity);
