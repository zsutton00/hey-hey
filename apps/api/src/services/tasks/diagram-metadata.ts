import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';
import {
  DiagramMetadataSchema,
  DiagramElementMetadataSchema,
  DiagramElementPolicySchema,
} from '../../generated/diagram.schemas';
import type { Prisma } from '@prisma/client';
import { DiagramKind } from '../../generated/model/diagramKind';
import { DiagramLevel } from '../../generated/model/diagramLevel';
import type { DiagramMetadata } from '../../generated/model/diagramMetadata';
import type { DiagramElementMetadata } from '../../generated/model/diagramElementMetadata';
import type { WorkItemSectionInput } from '../../generated/model/workItemSectionInput';
import type { WorkItemTypeSectionDefinition } from '../../generated/model/workItemTypeSectionDefinition';
import type { DiagramElementPolicy } from '../../generated/model/diagramElementPolicy';

export const DIAGRAM_METADATA_SCHEMA_REF =
  '#/components/schemas/DiagramMetadata';
export const DIAGRAM_ELEMENT_METADATA_SCHEMA_REF =
  '#/components/schemas/DiagramElementMetadata';

/** Durable discriminator compatibility; never changes an entity identity. */
export function canonicalDiagramType(type: string): string {
  if (type === 'workflow' || type === 'WORKFLOW') return 'DIAGRAM';
  if (type === 'workflow_step' || type === 'WORKFLOW_STEP')
    return 'DIAGRAM_ELEMENT';
  return type;
}

export const diagramMetadataSchema: z.ZodType<DiagramMetadata> =
  DiagramMetadataSchema;
export const diagramElementMetadataSchema: z.ZodType<DiagramElementMetadata> =
  DiagramElementMetadataSchema;
export const diagramElementPolicySchema: z.ZodType<DiagramElementPolicy> =
  DiagramElementPolicySchema;

export function parseDiagramJson(content: unknown): unknown {
  if (typeof content !== 'string') return content;
  try {
    return JSON.parse(content);
  } catch {
    throw new BadRequestException('Diagram metadata must contain valid JSON.');
  }
}

export function withDiagramDefaults(
  type: string,
  sections: WorkItemSectionInput[] = [],
): WorkItemSectionInput[] {
  const canonical = type;
  const value =
    canonical === 'DIAGRAM'
      ? {
          key: 'diagramMetadata',
          content: { kind: DiagramKind.General, level: DiagramLevel.Overview },
        }
      : canonical === 'DIAGRAM_ELEMENT'
        ? { key: 'diagramElementMetadata', content: { role: 'GENERIC' } }
        : undefined;
  return value && !sections.some((section) => section.key === value.key)
    ? [...sections, value]
    : sections;
}

export type DiagramCanonicalReference = NonNullable<
  DiagramElementMetadata['canonicalReference']
>;

/** A live canonical target in the project, or null when unavailable. */
export type DiagramTargetLookup = (
  reference: DiagramCanonicalReference,
) => { type?: string } | null;

/** Validate the final semantic value, including canonical target access. */
export async function validateDiagramSections(params: {
  db: {
    task: {
      findFirst(args: {
        where: Prisma.TaskWhereInput;
        select: { type: true };
      }): PromiseLike<{ type: string } | null>;
    };
    service: {
      findFirst(args: {
        where: Prisma.ServiceWhereInput;
        select: { id: true };
      }): PromiseLike<{ id: string } | null>;
    };
  };
  organizationId: string;
  projectId: string;
  type: string;
  sections: WorkItemSectionInput[];
  definitions: readonly WorkItemTypeSectionDefinition[];
}): Promise<void> {
  const reference = elementCanonicalReference(params.type, params.sections);
  let target: { type?: string } | null = null;
  if (reference) {
    const where = {
      id: reference.entityId,
      organizationId: params.organizationId,
      projectId: params.projectId,
      archivedAt: null,
      status: { not: 'ARCHIVED' as const },
    };
    target =
      reference.entityType === 'TASK'
        ? await params.db.task.findFirst({ where, select: { type: true } })
        : (await params.db.service.findFirst({ where, select: { id: true } }))
          ? {}
          : null;
  }
  checkDiagramSections({ ...params, lookupTarget: () => target });
}

/** The element's canonical reference when its metadata parses; the check reports otherwise. */
function elementCanonicalReference(
  type: string,
  sections: WorkItemSectionInput[],
): DiagramCanonicalReference | undefined {
  if (type !== 'DIAGRAM_ELEMENT') return undefined;
  const section = sections.find(
    (value) => value.key === 'diagramElementMetadata',
  );
  if (!section) return undefined;
  try {
    return (
      diagramElementMetadataSchema.safeParse(parseDiagramJson(section.content))
        .data?.canonicalReference ?? undefined
    );
  } catch {
    return undefined;
  }
}

/** Synchronous core of `validateDiagramSections`; targets come from `lookupTarget`. */
export function checkDiagramSections(params: {
  type: string;
  sections: WorkItemSectionInput[];
  definitions: readonly WorkItemTypeSectionDefinition[];
  lookupTarget: DiagramTargetLookup;
}): void {
  const type = params.type;
  if (type !== 'DIAGRAM' && type !== 'DIAGRAM_ELEMENT') return;
  const key = type === 'DIAGRAM' ? 'diagramMetadata' : 'diagramElementMetadata';
  const section = params.sections.find((value) => value.key === key);
  if (!section) throw new BadRequestException(`${key} is required.`);
  const value = parseDiagramJson(section.content);
  if (type === 'DIAGRAM') {
    const result = diagramMetadataSchema.safeParse(value);
    if (!result.success) throw new BadRequestException(result.error.message);
    return;
  }
  const parsed = diagramElementMetadataSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException(parsed.error.message);
  const metadata = parsed.data;
  const policy = params.definitions.find(
    (value) => value.key === key,
  )?.diagramElementPolicy;
  if (!policy?.roles.some((role) => role.key === metadata.role)) {
    throw new BadRequestException(
      'Diagram element role is not declared by the effective type definition.',
    );
  }
  const reference = metadata.canonicalReference;
  if (!reference) {
    if (metadata.role === 'DIAGRAM_REFERENCE')
      throw new BadRequestException(
        'DIAGRAM_REFERENCE requires a Diagram target.',
      );
    return;
  }
  const target = params.lookupTarget(reference);
  if (!target)
    throw new BadRequestException(
      'Canonical reference target is unavailable in this project.',
    );
  const targetType =
    target.type !== undefined ? canonicalDiagramType(target.type) : undefined;
  if (
    !policy.referenceTargets.some(
      (rule) =>
        rule.entityType === reference.entityType &&
        (!rule.workItemTypeKeys ||
          (targetType !== undefined &&
            rule.workItemTypeKeys.some(
              (key) => canonicalDiagramType(key) === targetType,
            ))),
    )
  ) {
    throw new BadRequestException(
      'Canonical reference target is not allowed by the effective type definition.',
    );
  }
  if ((targetType === 'DIAGRAM') !== (metadata.role === 'DIAGRAM_REFERENCE')) {
    throw new BadRequestException(
      'Diagram targets and DIAGRAM_REFERENCE roles require each other.',
    );
  }
}
