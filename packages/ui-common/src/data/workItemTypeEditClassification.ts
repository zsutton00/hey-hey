import isEqual from "lodash/isEqual.js";
import type { WorkItemTypeDefinitionDto, WorkItemTypeSummaryDto } from "../api";

type WorkItemTypeEditClassificationKind =
  "unchanged" | "authorable" | "supported_destructive" | "unsupported";

type WorkItemTypeEditUnsupportedReasonCode =
  "IDENTITY_KEY_CHANGED" | "REQUIRES_PARENT_CANNOT_SHOW_IN_EXPLORER_SIDEBAR";

export interface WorkItemTypeEditClassification {
  readonly kind: WorkItemTypeEditClassificationKind;
  readonly removedSectionKeys: readonly string[];
  readonly revokedTrackingSourceTypeKeys: readonly string[];
  readonly unsupportedReasonCodes: readonly WorkItemTypeEditUnsupportedReasonCode[];
  readonly unsupportedReasons: readonly string[];
  readonly guidance?: string;
}

export interface WorkItemTypeEditAnalysis extends WorkItemTypeEditClassification {
  readonly addedSectionKeys: readonly string[];
  readonly requiresConfirmation: boolean;
}

export function resolveWorkItemTypeKey(
  existing: WorkItemTypeSummaryDto | undefined,
  formKey: string,
): string {
  return existing?.definition.key ?? formKey.trim().toUpperCase();
}

const RECREATE_GUIDANCE =
  "The stable type key cannot be edited. Recreate the type only when a different identity is required.";
const INCOMPATIBLE_EXPLORER_CAPABILITIES_MESSAGE =
  "Explorer Sidebar entries are top-level, so a work-item type that requires a parent cannot be shown there.";

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
    ...getDefinitionInvariantViolations(proposed),
    ...(proposed.key === current.key
      ? []
      : [
          reason(
            "IDENTITY_KEY_CHANGED",
            "Changing definition.key changes the stable type identity.",
          ),
        ]),
  ];

  if (unsupportedReasons.length > 0) {
    const requiresRecreation = unsupportedReasons.some(
      ({ code }) => code === "IDENTITY_KEY_CHANGED",
    );

    return {
      kind: "unsupported",
      removedSectionKeys,
      revokedTrackingSourceTypeKeys,
      unsupportedReasonCodes: unsupportedReasons.map(({ code }) => code),
      unsupportedReasons: unsupportedReasons.map(({ message }) => message),
      ...(requiresRecreation ? { guidance: RECREATE_GUIDANCE } : {}),
    };
  }

  if (isEqual(current, proposed)) {
    return {
      kind: "unchanged",
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
      kind: "supported_destructive",
      removedSectionKeys,
      revokedTrackingSourceTypeKeys,
      unsupportedReasonCodes: [],
      unsupportedReasons: [],
    };
  }

  return {
    kind: "authorable",
    removedSectionKeys: [],
    revokedTrackingSourceTypeKeys: [],
    unsupportedReasonCodes: [],
    unsupportedReasons: [],
  };
}

export function analyzeWorkItemTypeEdit(
  existing: WorkItemTypeSummaryDto | undefined,
  proposed: WorkItemTypeDefinitionDto,
): WorkItemTypeEditAnalysis {
  if (!existing) {
    const unsupportedReasons = getDefinitionInvariantViolations(proposed);

    return {
      addedSectionKeys: [],
      kind: unsupportedReasons.length > 0 ? "unsupported" : "authorable",
      removedSectionKeys: [],
      revokedTrackingSourceTypeKeys: [],
      unsupportedReasonCodes: unsupportedReasons.map(({ code }) => code),
      unsupportedReasons: unsupportedReasons.map(({ message }) => message),
      requiresConfirmation: false,
    };
  }

  const classification = classifyWorkItemTypeEdit(existing, proposed);
  return {
    ...classification,
    addedSectionKeys: difference(
      proposed.sections.map(({ key }) => key),
      existing.definition.sections.map(({ key }) => key),
    ),
    requiresConfirmation: classification.kind === "supported_destructive",
  };
}

interface UnsupportedReason {
  readonly code: WorkItemTypeEditUnsupportedReasonCode;
  readonly message: string;
}

function getDefinitionInvariantViolations(
  definition: WorkItemTypeDefinitionDto,
): UnsupportedReason[] {
  return definition.capabilities?.requiresParent === true &&
    definition.capabilities.showsInExplorerSidebar === true
    ? [
        reason(
          "REQUIRES_PARENT_CANNOT_SHOW_IN_EXPLORER_SIDEBAR",
          INCOMPATIBLE_EXPLORER_CAPABILITIES_MESSAGE,
        ),
      ]
    : [];
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

function difference(
  current: readonly string[],
  proposed: readonly string[],
): string[] {
  const proposedValues = new Set(proposed);
  return Array.from(new Set(current))
    .filter((value) => !proposedValues.has(value))
    .sort();
}
