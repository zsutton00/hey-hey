import type { SearchEntity } from "../types";

const TASK_ENTITY_TYPE = "task";

/**
 * Mention type for a picked search result. Work-item results arrive with the
 * generic `task` type and carry their registry key in `metadata.taskType`; the
 * token must carry that key exactly so renderers can resolve it through the
 * registry. Results already resolved to a specific type keep it.
 */
export const resolveSearchEntityMentionType = (
  entity: SearchEntity,
): string => {
  if (entity.type !== TASK_ENTITY_TYPE) return entity.type;
  const taskType = entity.metadata?.taskType;
  return typeof taskType === "string" && taskType.trim()
    ? taskType.trim()
    : entity.type;
};
