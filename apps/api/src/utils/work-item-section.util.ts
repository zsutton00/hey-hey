import {
  MaterializedWorkItemSection,
  WorkItemSectionInput,
} from 'src/generated';
import { WorkItemSectionKey } from 'src/types/work-item-section.types';

export const WORK_ITEM_SECTION_KEYS: WorkItemSectionKey[] = [
  'description',
  'details',
  'acceptanceCriteria',
  'requirements',
];

export function materializedSectionsToContentMap(
  sections?: MaterializedWorkItemSection[],
): Record<WorkItemSectionKey, string> {
  const content = {
    description: '',
    details: '',
    acceptanceCriteria: '',
    requirements: '',
  };

  if (!sections) {
    return content;
  }

  for (const section of sections) {
    if (WORK_ITEM_SECTION_KEYS.includes(section.key as WorkItemSectionKey)) {
      content[section.key as WorkItemSectionKey] =
        section.materializedMarkdown ?? '';
    }
  }

  return content;
}

export function inputSectionsToContentMap(
  sections?: WorkItemSectionInput[],
): Partial<Record<WorkItemSectionKey, string>> {
  const content: Partial<Record<WorkItemSectionKey, string>> = {};
  if (!sections) {
    return content;
  }

  for (const section of sections) {
    if (WORK_ITEM_SECTION_KEYS.includes(section.key as WorkItemSectionKey)) {
      content[section.key as WorkItemSectionKey] = section.content ?? '';
    }
  }

  return content;
}
