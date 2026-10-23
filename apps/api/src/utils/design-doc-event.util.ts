import type {
  DesignDocResponseDto,
  MaterializedDesignDocSection,
} from '../generated';
import type { DesignDocWithSectionsRecord } from '../types/design-doc.types';

export function mapDesignDocSections(
  prismaDoc: DesignDocWithSectionsRecord,
): MaterializedDesignDocSection[] {
  return [...prismaDoc.sections]
    .sort((a, b) => a.order - b.order)
    .map((section) => {
      const materializedMarkdown = section.materializedMarkdown ?? '';

      return {
        id: section.id,
        key: section.key,
        content: materializedMarkdown,
        materializedMarkdown,
        order: section.order,
      };
    });
}

export function buildDesignDocEventDoc(
  prismaDoc: DesignDocWithSectionsRecord,
): DesignDocResponseDto {
  const sections = mapDesignDocSections(prismaDoc);
  return {
    id: prismaDoc.id,
    name: prismaDoc.name,
    template: prismaDoc.template,
    status: prismaDoc.status,
    organizationId: prismaDoc.organizationId,
    projectId: prismaDoc.projectId ?? undefined,
    tags: prismaDoc.tags,
    summary: prismaDoc.summary ?? undefined,
    parentEntityId: prismaDoc.parentEntityId ?? null,
    parentEntityType: prismaDoc.parentEntityType ?? null,
    createdAt: prismaDoc.createdAt.toISOString(),
    updatedAt: prismaDoc.updatedAt.toISOString(),
    sections,
  };
}
