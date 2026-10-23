import type { CanonicalPageDescriptor } from "../../contexts/CanonicalPageContext";
import type { LineageContext } from "../InteractionComponent/types";

/**
 * Semantic identity of an entity a walkthrough can point at. A Feature is its
 * own kind here even though it is persisted (and routed) as a task whose
 * taskType is FEATURE; `toGuidableEntity*` adapters own that translation.
 */
export type GuidableEntityKind = "feature" | "task" | "design_doc";

export interface GuidableEntity {
  kind: GuidableEntityKind;
  id: string;
}

const FEATURE_TASK_TYPE = "FEATURE";

/**
 * Storage family used for identity comparison. Features and tasks share one
 * id space, so a canonical page that has not yet resolved its taskType still
 * matches the Feature the walkthrough names.
 */
function storageFamily(kind: GuidableEntityKind): "task" | "design_doc" {
  return kind === "design_doc" ? "design_doc" : "task";
}

export function guidableEntitiesEqual(
  left: GuidableEntity,
  right: GuidableEntity,
): boolean {
  return (
    left.id === right.id &&
    storageFamily(left.kind) === storageFamily(right.kind)
  );
}

export function guidableEntityKey(entity: GuidableEntity): string {
  return `${storageFamily(entity.kind)}:${entity.id}`;
}

export function toGuidableEntityFromCanonicalPage(
  descriptor: CanonicalPageDescriptor,
): GuidableEntity | null {
  switch (descriptor.entityType) {
    case "task": {
      const presentation = descriptor.presentation;
      const taskType =
        presentation?.kind === "task" ? presentation.taskType : undefined;
      return {
        kind: taskType === FEATURE_TASK_TYPE ? "feature" : "task",
        id: descriptor.entityId,
      };
    }
    case "design_doc":
      return { kind: "design_doc", id: descriptor.entityId };
    default:
      return null;
  }
}

export function toGuidableEntityFromExplorer(
  identity: Pick<LineageContext, "entityId" | "entityType" | "entitySubtype">,
): GuidableEntity | null {
  switch (identity.entityType) {
    case "TASK":
      return {
        kind: identity.entitySubtype === FEATURE_TASK_TYPE ? "feature" : "task",
        id: identity.entityId,
      };
    case "DESIGN_DOC":
      return { kind: "design_doc", id: identity.entityId };
    default:
      return null;
  }
}

/** Identity of one mounted DiscussModal instance. */
export type DiscussModalInstanceId = string & {
  readonly __brand: "DiscussModalInstanceId";
};

let nextDiscussModalInstance = 0;

export function createDiscussModalInstanceId(): DiscussModalInstanceId {
  nextDiscussModalInstance += 1;
  return `discuss-modal-${nextDiscussModalInstance}` as DiscussModalInstanceId;
}

/** Identity of one mounted CreateServiceForm instance. */
export type CreateServiceFormInstanceId = string & {
  readonly __brand: "CreateServiceFormInstanceId";
};

let nextCreateServiceFormInstance = 0;

export function createCreateServiceFormInstanceId(): CreateServiceFormInstanceId {
  nextCreateServiceFormInstance += 1;
  return `create-service-form-${nextCreateServiceFormInstance}` as CreateServiceFormInstanceId;
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

/**
 * Fixed target names. Renaming one silently breaks every walkthrough that
 * points at it; `__tests__/registries.test.ts` guards the set.
 */
export const FIXED_TARGET_NAMES = [
  "explorer-section-toggle",
  "discuss-action",
  "discuss-prompt-editor",
  "discuss-start-conversation",
  "create-service-details",
  "create-service-submit",
] as const;

export type FixedTargetName = (typeof FIXED_TARGET_NAMES)[number];

export type GuidableTargetAddress =
  | { name: "explorer-section-toggle"; sectionKey: string }
  | { name: "discuss-action"; entity: GuidableEntity }
  | {
      name: "discuss-prompt-editor" | "discuss-start-conversation";
      entity: GuidableEntity;
      modalInstanceId: DiscussModalInstanceId;
    }
  | {
      name: "create-service-details" | "create-service-submit";
      formInstanceId: CreateServiceFormInstanceId;
    }
  | { surface: GuidableSurface; entity: GuidableEntity };

/** Entity surfaces an Interaction Component can declare for guidance. */
export type GuidableSurface = "explorer-row";

export function serializeTargetAddress(address: GuidableTargetAddress): string {
  if ("surface" in address) {
    return `${address.surface}|${guidableEntityKey(address.entity)}`;
  }
  switch (address.name) {
    case "explorer-section-toggle":
      return `${address.name}|${address.sectionKey}`;
    case "discuss-action":
      return `${address.name}|${guidableEntityKey(address.entity)}`;
    case "discuss-prompt-editor":
    case "discuss-start-conversation":
      return `${address.name}|${guidableEntityKey(address.entity)}|${
        address.modalInstanceId
      }`;
    case "create-service-details":
    case "create-service-submit":
      return `${address.name}|${address.formInstanceId}`;
  }
}

// ---------------------------------------------------------------------------
// Walkthrough definition
// ---------------------------------------------------------------------------

export interface WalkthroughActionInputs {
  "open-explorer-section": {
    entity: GuidableEntity;
    sectionKey: string;
    sectionName: string;
  };
  /** `entityName` is the user-facing title the callout names. */
  "open-entity": { entity: GuidableEntity; entityName: string };
  "open-discuss": { entity: GuidableEntity };
  "compose-and-start": { entity: GuidableEntity; suggestedPrompt: string };
  "describe-service": Record<string, never>;
  "create-service": Record<string, never>;
}

export type WalkthroughActionKey = keyof WalkthroughActionInputs;

export type WalkthroughStep = {
  [K in WalkthroughActionKey]: {
    condition?: { kind: "explorer-section-collapsed"; sectionKey: string };
    actionKey: K;
    inputs: WalkthroughActionInputs[K];
  };
}[WalkthroughActionKey];

export interface Walkthrough {
  title: string;
  steps: readonly WalkthroughStep[];
}

// ---------------------------------------------------------------------------
// Completion events
// ---------------------------------------------------------------------------

export type WalkthroughEvent =
  | { type: "explorer-section-expanded"; sectionKey: string }
  | { type: "canonical-page-shown"; entity: GuidableEntity }
  | {
      type: "discuss-modal-opened";
      entity: GuidableEntity;
      modalInstanceId: DiscussModalInstanceId;
    }
  | {
      /** Raised only after a Start Conversation launch succeeds. */
      type: "discuss-conversation-launched";
      entity: GuidableEntity;
      modalInstanceId: DiscussModalInstanceId;
    }
  | {
      /** Raised once the form holds a name and a chosen type. */
      type: "create-service-details-ready";
      formInstanceId: CreateServiceFormInstanceId;
    }
  | {
      /** Raised from the form's completion callback after a Service is created. */
      type: "service-created";
      formInstanceId: CreateServiceFormInstanceId;
    };

export type WalkthroughEventType = WalkthroughEvent["type"];
