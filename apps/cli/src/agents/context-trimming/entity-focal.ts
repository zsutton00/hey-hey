import type { Focal, FocalParent } from '../../jev/scenarios';
import type { MaterializedWorkItemSection } from '../../shared/api/generated';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import { readDiagramElements } from './diagram-elements';

export interface FocalWorkItem {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  type: string;
  sections?: readonly MaterializedWorkItemSection[] | null;
}

const sectionText = (sections: readonly MaterializedWorkItemSection[], key: string): string =>
  sections.find((section) => section.key === key)?.materializedMarkdown.trim() ?? '';

export const allSectionsText = (sections: readonly MaterializedWorkItemSection[]): string =>
  [...sections]
    .sort((a, b) => a.order - b.order)
    .map((section) => section.materializedMarkdown.trim())
    .filter((markdown) => markdown.length > 0)
    .join('\n\n');

/**
 * The Jev focal for a feature, mockup, diagram or task; shared by `get_context` trimming and the
 * parent-requirements filter so both judge the same entity the same way. The parent is read only
 * when the kind has one; it is extra context, so a missing parent still yields a focal.
 */
export const workItemFocal = async (
  entity: FocalWorkItem,
  readParent: () => Promise<FocalParent | undefined>,
  deps: Pick<PromptTypeHandlerDeps, 'auth' | 'apiBaseUrl' | 'logger'>,
): Promise<Focal> => {
  const sections = entity.sections ?? [];
  const description = sectionText(sections, 'description');
  if (entity.type === 'FEATURE') {
    return { kind: 'feature', name: entity.name, description };
  }
  const resolved = await readParent();
  const parent = resolved ? { parent: resolved } : {};
  if (entity.type === 'mockup') {
    return { kind: 'mockup', name: entity.name, description, ...parent };
  }
  if (entity.type === 'DIAGRAM') {
    const elements = await readDiagramElements(
      { organizationId: entity.organizationId, projectId: entity.projectId, diagramId: entity.id },
      deps,
    );
    return { kind: 'diagram', name: entity.name, description, elements, ...parent };
  }
  return {
    kind: 'task',
    name: entity.name,
    description,
    acceptanceCriteria: sectionText(sections, 'acceptanceCriteria'),
    ...parent,
  };
};
