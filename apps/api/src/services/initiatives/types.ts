import { Influence } from '../../generated';

/**
 * Internal InitiativeDraft interface with influences as a required field
 * This replaces the OpenAPI-generated InitiativeDraft for internal use
 */
export interface InitiativeDraft {
  /**
   * Unique identifier for the initiative draft
   */
  id: string;

  /**
   * Name of the initiative
   */
  name: string;

  /**
   * Description of the initiative
   */
  description: string;

  /**
   * Detailed information about the initiative
   */
  details: string;

  /**
   * Acceptance criteria for the initiative
   */
  acceptanceCriteria: string;

  /**
   * Reasoning for why this initiative was suggested
   */
  reasoning?: string;

  /**
   * Estimated effort level for the initiative
   */
  estimatedEffort?: 'small' | 'medium' | 'large';

  /**
   * Priority level of the initiative
   */
  priority?: 'low' | 'medium' | 'high' | 'critical';

  /**
   * Tags for categorizing the initiative
   */
  tags: Array<string>;

  /**
   * Current refinement level
   */
  currentLevel?: 'description' | 'details' | 'acceptanceCriteria';

  /**
   * Review status
   */
  reviewStatus?: 'unreviewed' | 'in_progress' | 'approved';

  /**
   * LLM-generated influences that informed this initiative (REQUIRED)
   * This field tracks which entities influenced the creation of this initiative
   */
  influences: Influence[];
}

/**
 * Type alias for backward compatibility during migration
 * @deprecated Use InitiativeDraft directly
 */
export type InitiativeDraftWithInfluences = InitiativeDraft;
