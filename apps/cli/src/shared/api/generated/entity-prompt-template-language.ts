// Generated from specs/fixtures/entity-prompt-template-language-v1.json. Do not edit.
import { EntityPromptTemplateSyntaxVersion } from './api.js';

export interface EntityPromptTemplatePathFamily {
  readonly template: string;
  readonly pattern: string;
}

export interface EntityPromptTemplateLanguage {
  readonly syntaxVersion: EntityPromptTemplateSyntaxVersion;
  readonly supportedPaths: readonly string[];
  readonly pathFamilies: readonly EntityPromptTemplatePathFamily[];
  readonly missingPathBehavior: 'ERROR';
  readonly malformedSubstitutionBehavior: 'ERROR';
  readonly malformedSubstitutions: readonly string[];
}

export const ENTITY_PROMPT_TEMPLATE_LANGUAGES = {
  [EntityPromptTemplateSyntaxVersion.V1]: {
    syntaxVersion: 'V1',
    supportedPaths: [
      'entity.id',
      'entity.name',
      'entity.title',
      'entity.type',
      'entity.status',
      'entity.description',
      'entity.outcome',
      'entity.summary',
      'entity.acceptanceCriteria',
      'entity.sections',
      'context.entityId',
      'context.entityType',
      'context.taskType',
      'context.displayName',
      'context.createdAt',
      'context.content.status',
      'context.content.priority',
      'context.content.dueDate',
      'context.relatedEntities',
      'context.featureHierarchy',
      'context.proposals',
      'context.agentSessions',
    ],
    pathFamilies: [
      {
        template: 'entity.sections.<key>',
        pattern: '^entity\\.sections\\.[a-z][A-Za-z0-9_]*$',
      },
      {
        template: 'context.content.sections.<key>',
        pattern: '^context\\.content\\.sections\\.[a-z][A-Za-z0-9_]*$',
      },
    ],
    missingPathBehavior: 'ERROR',
    malformedSubstitutionBehavior: 'ERROR',
    malformedSubstitutions: ['{{entity.name', 'entity.name}}', '{{}}', '{{entity.{name}}}'],
  },
} as const satisfies Readonly<
  Record<EntityPromptTemplateSyntaxVersion, EntityPromptTemplateLanguage>
>;
