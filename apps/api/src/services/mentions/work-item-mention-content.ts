import { Logger } from '@nestjs/common';
import type { WorkItemTypeSectionDefinition } from '../../generated/model/workItemTypeSectionDefinition';
import { inspectFeatureRequirementsSection } from '../tasks/feature-requirements-reader';
import { resolveWorkItemSectionContentKind } from '../tasks/task-section-schema-validator.registry';
import { WORK_ITEM_TYPE_KEYS } from '../tasks/work-item-type-keys';

export interface WorkItemMentionSectionRow {
  key: string;
  materializedMarkdown: string | null;
}

type SectionMentionExtractor = (content: string) => string;

const logger = new Logger('WorkItemMentionContent');

function requirementStatements(content: string): string {
  const result = inspectFeatureRequirementsSection(content);
  if (result.state === 'malformed') {
    logger.warn(
      `Skipping mention scan of malformed requirements section (${result.error.code})`,
    );
    return '';
  }
  return (result.section?.records ?? [])
    .map((record) => record.statement)
    .join('\n');
}

/**
 * Sections whose stored form is not free prose get a kind-specific extractor
 * so only their prose reaches the `@[…]` scan. FEATURE requirement citation
 * slots become graph edges through the requirement-citation path, so only
 * record statements are scanned here.
 */
const SECTION_MENTION_EXTRACTORS: ReadonlyMap<
  string,
  ReadonlyMap<string, SectionMentionExtractor>
> = new Map([
  [
    WORK_ITEM_TYPE_KEYS.Feature,
    new Map([['requirements', requirementStatements]]),
  ],
]);

/**
 * Join the mention-bearing text of a work item's sections, driven by the
 * type's section definitions. Rows for keys the type does not define are
 * ignored. json, html/css and structured-mockup sections are skipped unless
 * an extractor is registered: their serialized form is not prose, and a raw
 * regex over it would turn incidental strings into graph edges.
 */
export function collectWorkItemMentionContent(
  typeKey: string,
  sectionDefinitions: readonly WorkItemTypeSectionDefinition[],
  sections: readonly WorkItemMentionSectionRow[],
): string {
  const definitionsByKey = new Map(
    sectionDefinitions.map((definition) => [definition.key, definition]),
  );
  const extractors = SECTION_MENTION_EXTRACTORS.get(typeKey);

  const parts: string[] = [];
  for (const section of sections) {
    const content = section.materializedMarkdown;
    if (!content) continue;
    const definition = definitionsByKey.get(section.key);
    if (!definition) continue;

    const extractor = extractors?.get(section.key);
    if (extractor) {
      parts.push(extractor(content));
    } else if (resolveWorkItemSectionContentKind(definition) === 'markdown') {
      parts.push(content);
    }
  }
  return parts.join('\n\n');
}
