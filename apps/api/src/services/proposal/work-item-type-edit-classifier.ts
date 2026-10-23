import { BadRequestException } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import type { WorkItemTypeDefinitionDto } from '../../generated/model/workItemTypeDefinitionDto';
import type { WorkItemTypeSummaryDto } from '../../generated/model/workItemTypeSummaryDto';

export type WorkItemTypeEditClassificationKind =
  | 'unchanged'
  | 'authorable'
  | 'supported_destructive'
  | 'unsupported';

export type WorkItemTypeEditUnsupportedReasonCode = 'IDENTITY_KEY_CHANGED';

export interface WorkItemTypeEditClassification {
  readonly kind: WorkItemTypeEditClassificationKind;
  readonly removedSectionKeys: readonly string[];
  readonly revokedTrackingSourceTypeKeys: readonly string[];
  readonly unsupportedReasonCodes: readonly WorkItemTypeEditUnsupportedReasonCode[];
  readonly unsupportedReasons: readonly string[];
  readonly guidance?: string;
}

const RECREATE_GUIDANCE =
  'The stable type key cannot be edited. Recreate the type only when a different identity is required.';

export function classifyWorkItemTypeEdit(
  existing: WorkItemTypeSummaryDto,
  proposed: WorkItemTypeDefinitionDto,
): WorkItemTypeEditClassification {
  const current = existing.definition;
  const removedSectionKeys = removedKeys(
    current.sections.map(({ key }) => key),
    proposed.sections.map(({ key }) => key),
  );
  const revokedTrackingSourceTypeKeys = removedKeys(
    current.tracking?.allowedSourceTaskTypes ?? [],
    proposed.tracking?.allowedSourceTaskTypes ?? [],
  );
  const unsupportedReasons: UnsupportedReason[] = [
    ...(proposed.key === current.key
      ? []
      : [
          reason(
            'IDENTITY_KEY_CHANGED',
            'Changing definition.key changes the stable type identity.',
          ),
        ]),
  ];

  if (unsupportedReasons.length > 0) {
    return {
      kind: 'unsupported',
      removedSectionKeys,
      revokedTrackingSourceTypeKeys,
      unsupportedReasonCodes: unsupportedReasons.map(({ code }) => code),
      unsupportedReasons: unsupportedReasons.map(({ message }) => message),
      guidance: RECREATE_GUIDANCE,
    };
  }

  if (isDeepStrictEqual(current, proposed)) {
    return {
      kind: 'unchanged',
      removedSectionKeys: [],
      revokedTrackingSourceTypeKeys: [],
      unsupportedReasonCodes: [],
      unsupportedReasons: [],
    };
  }

  if (
    removedSectionKeys.length > 0 ||
    revokedTrackingSourceTypeKeys.length > 0
  ) {
    return {
      kind: 'supported_destructive',
      removedSectionKeys,
      revokedTrackingSourceTypeKeys,
      unsupportedReasonCodes: [],
      unsupportedReasons: [],
    };
  }

  return {
    kind: 'authorable',
    removedSectionKeys: [],
    revokedTrackingSourceTypeKeys: [],
    unsupportedReasonCodes: [],
    unsupportedReasons: [],
  };
}

export function assertWorkItemTypeEditSupported(
  existing: WorkItemTypeSummaryDto,
  proposed: WorkItemTypeDefinitionDto,
): WorkItemTypeEditClassification {
  if (
    proposed.colorKey !== undefined &&
    existing.effectiveSource !== 'PROJECT_CUSTOM'
  ) {
    throw new BadRequestException(
      'Only project-custom work-item types may author colorKey.',
    );
  }
  const classification = classifyWorkItemTypeEdit(existing, proposed);
  if (classification.kind !== 'unsupported') {
    return classification;
  }

  throw new BadRequestException({
    message: 'Unsupported work-item type edit',
    errors: classification.unsupportedReasons,
    guidance: classification.guidance,
  });
}

interface UnsupportedReason {
  readonly code: WorkItemTypeEditUnsupportedReasonCode;
  readonly message: string;
}

function reason(
  code: WorkItemTypeEditUnsupportedReasonCode,
  message: string,
): UnsupportedReason {
  return { code, message };
}

function removedKeys(
  current: readonly string[],
  proposed: readonly string[],
): string[] {
  return [...new Set(current.filter((key) => !proposed.includes(key)))].sort();
}
