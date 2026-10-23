/**
 * Staged Design Document Types
 *
 * Type definitions for design documents within the staged content framework.
 * Extends the minimal base with design document-specific fields.
 * Note: NO priority or assigneeId - these don't belong on design documents.
 */

import { StagedContentBase } from './staged-content-base.types';

/**
 * Staged Design Document entity with design document-specific fields
 * Contains only fields that are semantically correct for design documents
 */
export interface StagedDesignDoc extends StagedContentBase {
  name: string;
  template: string;
  tags?: string[];

  // Dynamic access to sections
  sections: Record<string, string>;

  // Legacy fields kept for backward compatibility (mapped from sections)
  content?: string;
  context?: string;
  decision?: string;
  consequences?: string;
  statusNotes?: string;
}

/**
 * Type guard for runtime type checking
 */
export function isStagedDesignDoc(obj: unknown): obj is StagedDesignDoc {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as StagedDesignDoc).name === 'string' &&
    typeof (obj as StagedDesignDoc).sections === 'object'
  );
}
