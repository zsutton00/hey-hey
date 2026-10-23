import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import { Influence } from '../../generated';

/**
 * Internal TaskDraft interface for task generation
 * Represents a task before database persistence
 * Similar to InitiativeDraft but task-specific
 */
export interface TaskDraft {
  /**
   * Unique identifier for the draft (temporary, replaced by DB-generated ID)
   */
  id: string;

  /**
   * Task title/name
   */
  title: string;

  /**
   * Brief description of the task
   */
  description: string;

  /**
   * Detailed implementation plan with technical specs
   */
  acceptanceCriteria?: string;

  /**
   * Task content profile type
   */
  taskType?: WorkItemTypeKey;

  /**
   * Optional parent task id
   */
  parentTaskId?: string;

  /**
   * Task priority level
   */
  priority: 'low' | 'medium' | 'high';

  /**
   * Estimated effort (not stored in DB, goes to artifact)
   */
  estimatedEffort?: 'small' | 'medium' | 'large';

  /**
   * Task category (not stored in DB, could use tags)
   */
  category?: string;

  /**
   * LLM reasoning for task creation (stored in artifact)
   */
  reasoning?: string;

  /**
   * Influences that informed this task (polymorphic references)
   */
  influences: Influence[];
}
