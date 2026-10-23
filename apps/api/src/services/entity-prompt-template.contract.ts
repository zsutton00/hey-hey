import {
  EntityPromptTemplateFixedEntitySelectorDto,
  EntityPromptTemplateSyntaxVersion,
  EntityPromptTemplateWorkItemSelectorDto,
} from 'src/generated';
import type { EntityPromptTemplateSelectorDto } from 'src/generated';
import type { ProjectId } from 'src/types';
import { z } from 'zod';

const WORK_ITEM_TEMPLATE_KEY_PREFIX = 'entity_context.work_item.';

export const entityPromptTemplateKeyForWorkItemType = (
  workItemTypeKey: string,
): string => `${WORK_ITEM_TEMPLATE_KEY_PREFIX}${workItemTypeKey.toLowerCase()}`;

export const workItemTypeKeyFromEntityPromptTemplateKey = (
  templateKey: string,
): string | null => {
  if (!templateKey.startsWith(WORK_ITEM_TEMPLATE_KEY_PREFIX)) return null;
  const workItemTypeKey = templateKey.slice(
    WORK_ITEM_TEMPLATE_KEY_PREFIX.length,
  );
  return workItemTypeKey.length > 0 ? workItemTypeKey : null;
};

const entityPromptTemplateFixedEntitySelectorSchema = z
  .object({
    entityType: z.nativeEnum(
      EntityPromptTemplateFixedEntitySelectorDto.EntityTypeEnum,
    ),
  })
  .strict();

const entityPromptTemplateWorkItemSelectorSchema = z
  .object({
    entityType: z.literal(
      EntityPromptTemplateWorkItemSelectorDto.EntityTypeEnum.WorkItem,
    ),
    workItemTypeKey: z.string(),
  })
  .strict();

export const entityPromptTemplateSelectorSchema = z.discriminatedUnion(
  'entityType',
  [
    entityPromptTemplateFixedEntitySelectorSchema,
    entityPromptTemplateWorkItemSelectorSchema,
  ],
);

export const entityPromptTemplateSyntaxVersionSchema = z.enum([
  EntityPromptTemplateSyntaxVersion.V1,
]);

const entityPromptTemplateExpectedEffectiveRevisionSchema = z
  .object({
    revisionId: z.string().uuid(),
    revisionNumber: z.number().int().min(1),
  })
  .strict();

const projectIdSchema = z.string().uuid() as unknown as z.ZodType<ProjectId>;

export const entityPromptTemplateUpsertUpdatesSchema = z
  .object({
    operation: z.literal('UPSERT'),
    projectId: projectIdSchema,
    selector: entityPromptTemplateSelectorSchema,
    syntaxVersion: entityPromptTemplateSyntaxVersionSchema,
    content: z.string().min(1),
    expectedEffectiveRevision:
      entityPromptTemplateExpectedEffectiveRevisionSchema,
  })
  .strict();

export const entityPromptTemplateRetireUpdatesSchema = z
  .object({
    operation: z.literal('RETIRE'),
    projectId: projectIdSchema,
    selector: entityPromptTemplateSelectorSchema,
    expectedEffectiveRevision:
      entityPromptTemplateExpectedEffectiveRevisionSchema,
  })
  .strict();

export const entityPromptTemplateProposalUpdatesSchema = z.union([
  entityPromptTemplateUpsertUpdatesSchema,
  entityPromptTemplateRetireUpdatesSchema,
]);

export type EntityPromptTemplateSelector = z.output<
  typeof entityPromptTemplateSelectorSchema
>;
export type EntityPromptTemplateProposalUpdates = z.output<
  typeof entityPromptTemplateProposalUpdatesSchema
>;

const _selectorMatchesGeneratedType = (
  value: EntityPromptTemplateSelector,
): EntityPromptTemplateSelectorDto => value;

void _selectorMatchesGeneratedType;

// Empty drafts are admitted so the authoritative validator can explain them.
export const entityPromptTemplateDraftValidationRequestSchema = z
  .object({
    selector: entityPromptTemplateSelectorSchema,
    syntaxVersion: entityPromptTemplateSyntaxVersionSchema,
    content: z.string(),
  })
  .strict();
