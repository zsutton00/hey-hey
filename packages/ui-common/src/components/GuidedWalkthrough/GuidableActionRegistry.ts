import type { CreateServiceFormSession } from "./CreateServiceFormSessionStore";
import {
  guidableEntitiesEqual,
  type DiscussModalInstanceId,
  type GuidableEntity,
  type GuidableEntityKind,
  type GuidableTargetAddress,
  type Walkthrough,
  type WalkthroughActionInputs,
  type WalkthroughActionKey,
  type WalkthroughEvent,
  type WalkthroughStep,
} from "./types";

/**
 * Live UI state an action reads to pick its target and judge completion. The
 * runner owns it; predicates here stay pure.
 */
export interface WalkthroughActionState {
  /** Entity whose canonical page is showing, if any. */
  currentPage: GuidableEntity | null;
  /** The DiscussModal instance the walkthrough is following, if open. */
  discussModal: {
    entity: GuidableEntity;
    modalInstanceId: DiscussModalInstanceId;
  } | null;
  /**
   * A suggestion was accepted or the user typed a non-empty prompt. Moves
   * compose-and-start to its start subtarget; never completes the action.
   */
  promptReady: boolean;
  sectionExpanded: (sectionKey: string) => boolean | null;
  /** The CreateServiceForm instance currently mounted, if any. */
  createServiceForm: CreateServiceFormSession | null;
}

export interface GuidableActionDefinition<K extends WalkthroughActionKey> {
  key: K;
  copy: (
    inputs: WalkthroughActionInputs[K],
    state: WalkthroughActionState,
  ) => string;
  target: (
    inputs: WalkthroughActionInputs[K],
    state: WalkthroughActionState,
  ) => GuidableTargetAddress | null;
  isComplete: (
    inputs: WalkthroughActionInputs[K],
    event: WalkthroughEvent,
    state: WalkthroughActionState,
  ) => boolean;
  isAlreadyDone: (
    inputs: WalkthroughActionInputs[K],
    state: WalkthroughActionState,
  ) => boolean;
}

function followedModalFor(
  entity: GuidableEntity,
  state: WalkthroughActionState,
): DiscussModalInstanceId | null {
  const modal = state.discussModal;
  return modal && guidableEntitiesEqual(modal.entity, entity)
    ? modal.modalInstanceId
    : null;
}

const KIND_LABELS: Record<GuidableEntityKind, string> = {
  feature: "Feature",
  task: "task",
  design_doc: "design doc",
};

function defineAction<K extends WalkthroughActionKey>(
  definition: GuidableActionDefinition<K>,
): GuidableActionDefinition<K> {
  return Object.freeze(definition);
}

const openExplorerSection = defineAction<"open-explorer-section">({
  key: "open-explorer-section",
  copy: ({ sectionName }) => `Open ${sectionName} in the Explorer.`,
  target: ({ sectionKey }) => ({ name: "explorer-section-toggle", sectionKey }),
  isComplete: ({ sectionKey }, event) =>
    event.type === "explorer-section-expanded" &&
    event.sectionKey === sectionKey,
  isAlreadyDone: ({ entity }, state) =>
    state.currentPage !== null &&
    guidableEntitiesEqual(state.currentPage, entity),
});

/** Null means the owner has not published state yet; use bounded target waiting. */
export function stepCondition(
  step: WalkthroughStep,
  state: WalkthroughActionState,
): boolean | null {
  if (!step.condition) return true;
  const expanded = state.sectionExpanded(step.condition.sectionKey);
  return expanded === null ? null : !expanded;
}

const openEntity: GuidableActionDefinition<"open-entity"> = defineAction({
  key: "open-entity",
  copy: ({ entity, entityName }) =>
    entity.kind === "feature"
      ? `Your features live in the Explorer. Open ${entityName}.`
      : `Open ${entityName} from the Explorer.`,
  target: ({ entity }) => ({ surface: "explorer-row", entity }),
  isComplete: ({ entity }, event) =>
    event.type === "canonical-page-shown" &&
    guidableEntitiesEqual(event.entity, entity),
  isAlreadyDone: ({ entity }, state) =>
    state.currentPage !== null &&
    guidableEntitiesEqual(state.currentPage, entity),
});

const openDiscuss: GuidableActionDefinition<"open-discuss"> = defineAction({
  key: "open-discuss",
  copy: ({ entity }) =>
    `Discuss starts a conversation with an agent about this ${
      KIND_LABELS[entity.kind]
    }.`,
  target: ({ entity }) => ({ name: "discuss-action", entity }),
  isComplete: ({ entity }, event) =>
    event.type === "discuss-modal-opened" &&
    guidableEntitiesEqual(event.entity, entity),
  isAlreadyDone: ({ entity }, state) =>
    followedModalFor(entity, state) !== null,
});

const composeAndStart: GuidableActionDefinition<"compose-and-start"> =
  defineAction({
    key: "compose-and-start",
    copy: ({ entity }, state) =>
      state.promptReady
        ? "Start Conversation lets the agent research the project first. Quick Question skips that for fast questions."
        : `Say what you want produced and for which ${
            KIND_LABELS[entity.kind]
          }, or use our suggestion.`,
    target: ({ entity }, state) => {
      const modalInstanceId = followedModalFor(entity, state);
      if (modalInstanceId === null) return null;
      return {
        name: state.promptReady
          ? "discuss-start-conversation"
          : "discuss-prompt-editor",
        entity,
        modalInstanceId,
      };
    },
    isComplete: ({ entity }, event, state) => {
      if (event.type !== "discuss-conversation-launched") return false;
      const modalInstanceId = followedModalFor(entity, state);
      return (
        modalInstanceId !== null &&
        event.modalInstanceId === modalInstanceId &&
        guidableEntitiesEqual(event.entity, entity)
      );
    },
    isAlreadyDone: () => false,
  });

const describeService: GuidableActionDefinition<"describe-service"> =
  defineAction({
    key: "describe-service",
    copy: () =>
      "Give your Service a name and pick what kind of code base it is. You can change this later.",
    target: (_, state) =>
      state.createServiceForm === null
        ? null
        : {
            name: "create-service-details",
            formInstanceId: state.createServiceForm.formInstanceId,
          },
    isComplete: (_, event, state) =>
      event.type === "create-service-details-ready" &&
      state.createServiceForm !== null &&
      event.formInstanceId === state.createServiceForm.formInstanceId,
    isAlreadyDone: (_, state) => state.createServiceForm?.detailsReady === true,
  });

const createService: GuidableActionDefinition<"create-service"> = defineAction({
  key: "create-service",
  copy: () =>
    "Create the Service. Linking a directory is optional and local to one CLI machine; skip it and link any time later.",
  target: (_, state) =>
    state.createServiceForm === null
      ? null
      : {
          name: "create-service-submit",
          formInstanceId: state.createServiceForm.formInstanceId,
        },
  isComplete: (_, event, state) =>
    event.type === "service-created" &&
    state.createServiceForm !== null &&
    event.formInstanceId === state.createServiceForm.formInstanceId,
  isAlreadyDone: () => false,
});

type ActionRegistry = {
  readonly [K in WalkthroughActionKey]: GuidableActionDefinition<K>;
};

export const GUIDABLE_ACTIONS: ActionRegistry = Object.freeze({
  "open-explorer-section": openExplorerSection,
  "open-entity": openEntity,
  "open-discuss": openDiscuss,
  "compose-and-start": composeAndStart,
  "describe-service": describeService,
  "create-service": createService,
});

/** Correlated dispatch: each step uses its own action's typed inputs. */
export function stepTarget(
  step: WalkthroughStep,
  state: WalkthroughActionState,
): GuidableTargetAddress | null {
  switch (step.actionKey) {
    case "open-explorer-section":
      return GUIDABLE_ACTIONS[step.actionKey].target(step.inputs, state);
    case "open-entity":
      return GUIDABLE_ACTIONS[step.actionKey].target(step.inputs, state);
    case "open-discuss":
      return GUIDABLE_ACTIONS[step.actionKey].target(step.inputs, state);
    case "compose-and-start":
      return GUIDABLE_ACTIONS[step.actionKey].target(step.inputs, state);
    case "describe-service":
      return GUIDABLE_ACTIONS[step.actionKey].target(step.inputs, state);
    case "create-service":
      return GUIDABLE_ACTIONS[step.actionKey].target(step.inputs, state);
  }
}

export function stepCopy(
  step: WalkthroughStep,
  state: WalkthroughActionState,
): string {
  switch (step.actionKey) {
    case "open-explorer-section":
      return GUIDABLE_ACTIONS[step.actionKey].copy(step.inputs, state);
    case "open-entity":
      return GUIDABLE_ACTIONS[step.actionKey].copy(step.inputs, state);
    case "open-discuss":
      return GUIDABLE_ACTIONS[step.actionKey].copy(step.inputs, state);
    case "compose-and-start":
      return GUIDABLE_ACTIONS[step.actionKey].copy(step.inputs, state);
    case "describe-service":
      return GUIDABLE_ACTIONS[step.actionKey].copy(step.inputs, state);
    case "create-service":
      return GUIDABLE_ACTIONS[step.actionKey].copy(step.inputs, state);
  }
}

export function isStepComplete(
  step: WalkthroughStep,
  event: WalkthroughEvent,
  state: WalkthroughActionState,
): boolean {
  switch (step.actionKey) {
    case "open-explorer-section":
      return GUIDABLE_ACTIONS[step.actionKey].isComplete(
        step.inputs,
        event,
        state,
      );
    case "open-entity":
      return GUIDABLE_ACTIONS[step.actionKey].isComplete(
        step.inputs,
        event,
        state,
      );
    case "open-discuss":
      return GUIDABLE_ACTIONS[step.actionKey].isComplete(
        step.inputs,
        event,
        state,
      );
    case "compose-and-start":
      return GUIDABLE_ACTIONS[step.actionKey].isComplete(
        step.inputs,
        event,
        state,
      );
    case "describe-service":
      return GUIDABLE_ACTIONS[step.actionKey].isComplete(
        step.inputs,
        event,
        state,
      );
    case "create-service":
      return GUIDABLE_ACTIONS[step.actionKey].isComplete(
        step.inputs,
        event,
        state,
      );
  }
}

export function isStepAlreadyDone(
  step: WalkthroughStep,
  state: WalkthroughActionState,
): boolean {
  switch (step.actionKey) {
    case "open-explorer-section":
      return GUIDABLE_ACTIONS[step.actionKey].isAlreadyDone(step.inputs, state);
    case "open-entity":
      return GUIDABLE_ACTIONS[step.actionKey].isAlreadyDone(step.inputs, state);
    case "open-discuss":
      return GUIDABLE_ACTIONS[step.actionKey].isAlreadyDone(step.inputs, state);
    case "compose-and-start":
      return GUIDABLE_ACTIONS[step.actionKey].isAlreadyDone(step.inputs, state);
    case "describe-service":
      return GUIDABLE_ACTIONS[step.actionKey].isAlreadyDone(step.inputs, state);
    case "create-service":
      return GUIDABLE_ACTIONS[step.actionKey].isAlreadyDone(step.inputs, state);
  }
}

/** Builds an immutable walkthrough from registered steps. */
export function defineWalkthrough(
  title: string,
  steps: readonly WalkthroughStep[],
): Walkthrough {
  return Object.freeze({
    title,
    steps: Object.freeze(
      steps.map((step) =>
        Object.freeze({
          ...step,
          inputs: Object.freeze({ ...step.inputs }),
          ...(step.condition
            ? { condition: Object.freeze({ ...step.condition }) }
            : {}),
        }),
      ),
    ) as readonly WalkthroughStep[],
  });
}
