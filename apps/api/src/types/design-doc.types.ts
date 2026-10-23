/**
 * Design Document Types
 *
 * TypeScript type definitions for the design document domain.
 * Follows existing patterns from initiative and task types.
 */

import { DesignDocParentEntityType } from '@prisma/client';
import {
  CreateDesignDocDto,
  DesignDocResponseDto,
  MaterializedDesignDocSection,
} from 'src/generated';

/**
 * Design Document entity (branded type for type safety)
 */
export type DesignDocId = string & { __brand: 'DesignDocId' };

export type DesignDocTemplateType = NonNullable<CreateDesignDocDto['template']>;

export const SUPPORTED_DESIGN_DOC_TEMPLATES = [
  'ADR',
  'DECISION',
  'BRAINSTORM',
  'PLAN_DOCUMENT',
] as const;

export type SupportedDesignDocTemplate =
  (typeof SUPPORTED_DESIGN_DOC_TEMPLATES)[number];

export function isSupportedDesignDocTemplate(
  template: string,
): template is SupportedDesignDocTemplate {
  return (SUPPORTED_DESIGN_DOC_TEMPLATES as readonly string[]).includes(
    template,
  );
}

export interface DesignDocSectionRecord {
  id: string;
  key: string;
  order: number;
  materializedMarkdown: string | null;
}

export interface DesignDocWithSectionsRecord {
  id: string;
  name: string;
  template: DesignDocTemplateType;
  status: string;
  organizationId: string;
  projectId: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  summary: string | null;
  parentEntityId: string | null;
  parentEntityType: DesignDocParentEntityType | null;
  sections: DesignDocSectionRecord[];
}

export type MaterializedDesignDocResponseDto = Omit<
  DesignDocResponseDto,
  'sections'
> & {
  sections: MaterializedDesignDocSection[];
};

/**
 * Standard section definitions for all Design Document templates.
 * This is the single source of truth for what sections constitute a specific template.
 */
export const TEMPLATE_SECTION_SPECS: Record<string, string[]> = {
  ADR: ['context', 'decision', 'consequences', 'statusNotes'],
  DECISION: ['content'],
  BRAINSTORM: ['content'],
  PLAN_DOCUMENT: ['content'],
};

export const TEMPLATE_STAGE_SPECS: Record<
  SupportedDesignDocTemplate,
  string[]
> = {
  ADR: ['context', 'decision', 'consequences', 'review'],
  DECISION: ['content', 'review', 'ready'],
  BRAINSTORM: ['content', 'review', 'ready'],
  PLAN_DOCUMENT: ['content', 'review', 'ready'],
};

/**
 * Utility function to get current level from status
 */
export function getCurrentSectionFromStatus(status: string): string {
  switch (status) {
    case 'ADR_CONTEXT':
    case 'ADR_REFINING_CONTEXT':
      return 'context';
    case 'ADR_GENERATING_DECISION':
    case 'ADR_REFINING_DECISION':
    case 'ADR_DECISION':
      return 'decision';
    case 'ADR_GENERATING_CONSEQUENCES':
    case 'ADR_REFINING_CONSEQUENCES':
    case 'ADR_CONSEQUENCES':
      return 'consequences';
    case 'ADR_REVIEW':
      return 'review';
    default:
      throw new Error(`Unknown ADR status: ${status}`);
  }
}

export function getCurrentSectionForTemplate(
  template: string,
  status: string,
): string {
  if (template === 'ADR') {
    return getCurrentSectionFromStatus(status);
  }

  if (
    template === 'DECISION' ||
    template === 'BRAINSTORM' ||
    template === 'PLAN_DOCUMENT'
  ) {
    switch (status) {
      case 'REFINING_CONTENT':
        return 'content';
      case 'IN_REVIEW':
        return 'review';
      case 'READY':
        return 'ready';
      default:
        throw new Error(`Unknown ${template} status: ${status}`);
    }
  }

  throw new Error(`Unsupported design doc template: ${template}`);
}

/**
 * Utility function to get next level
 */
export function getNextSection(section: string): string | null {
  switch (section) {
    case 'content':
      return null;
    case 'context':
      return 'decision';
    case 'decision':
      return 'consequences';
    case 'consequences':
      return 'review';
    case 'concept':
      return 'requirements';
    case 'requirements':
      return 'architecture';
    case 'architecture':
      return 'implementation';
    case 'implementation':
      return 'review';
    case 'review':
      return null;
    default:
      return null;
  }
}

/**
 * Utility function to get status from level
 */
export function getStatusFromSection(section: string): string {
  switch (section) {
    case 'content':
      return 'REFINING_CONTENT';
    case 'context':
      return 'ADR_CONTEXT';
    case 'decision':
      return 'ADR_DECISION';
    case 'consequences':
      return 'ADR_CONSEQUENCES';
    case 'review':
      return 'ADR_REVIEW';
    case 'concept':
      return 'DRAFT_CONCEPT';
    case 'requirements':
      return 'DRAFT_REQUIREMENTS';
    case 'architecture':
      return 'DRAFT_ARCHITECTURE';
    case 'implementation':
      return 'DRAFT_IMPLEMENTATION';
    default:
      return 'ADR_CONTEXT';
  }
}
