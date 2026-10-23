import { z } from 'zod';
import type { LocalCreateRunRequest } from '../../shared/agent-bridge-contract/contract';
import type { RunEntityReference } from '../../shared/agent-bridge-contract/generated/api';
import { LocalAgentApiError } from '../../shared/agent-bridge-contract/errors';
import { runEntityReferenceSchema } from '../../run/run-entity';
import type { PromptTypeRegistry } from '../../agents/prompt-type-registry';

const goalPmLaunchEntitySchema = runEntityReferenceSchema.extend({
  entityType: z.literal('TASK'),
  taskType: z.literal('GOAL'),
});

/**
 * Reads the launch-time focal entity from the start-run payload. Each handler
 * declares what its payload must carry in `launchEntity`; `workflow_kickoff`
 * is a payload variant rather than a prompt type, so it has no handler and is
 * the one case where the entity is optional.
 */
export const readLaunchEntity = (
  payload: LocalCreateRunRequest['payload'],
  promptTypeRegistry: PromptTypeRegistry,
): RunEntityReference | null => {
  if (payload === undefined) return null;

  if (payload.promptType === 'workflow_kickoff') {
    if (!('entity' in payload)) return null;
    const parsed = runEntityReferenceSchema.safeParse(payload.entity);
    if (!parsed.success) {
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        `Prompt type ${payload.promptType} has an invalid payload.entity.`,
        400,
      );
    }
    return parsed.data;
  }

  const handler = promptTypeRegistry.get(payload.promptType);
  if (!handler) {
    throw new LocalAgentApiError(
      'INVALID_REQUEST',
      `Prompt type ${payload.promptType} has no registered handler.`,
      400,
    );
  }

  if (handler.launchEntity === 'none') {
    if ('entity' in payload) {
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        `Prompt type ${payload.promptType} does not accept payload.entity.`,
        400,
      );
    }
    return null;
  }

  if (!('entity' in payload)) {
    throw new LocalAgentApiError(
      'INVALID_REQUEST',
      `Prompt type ${payload.promptType} requires payload.entity.`,
      400,
    );
  }

  if (handler.launchEntity === 'required_goal') {
    const goalParsed = goalPmLaunchEntitySchema.safeParse(payload.entity);
    if (!goalParsed.success) {
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        `Prompt type ${payload.promptType} requires payload.entity to be a GOAL TASK.`,
        400,
      );
    }
    return {
      entityType: goalParsed.data.entityType,
      entityId: goalParsed.data.entityId,
    };
  }

  const parsed = runEntityReferenceSchema.safeParse(payload.entity);
  if (!parsed.success) {
    throw new LocalAgentApiError(
      'INVALID_REQUEST',
      `Prompt type ${payload.promptType} has an invalid payload.entity.`,
      400,
    );
  }

  return parsed.data;
};
