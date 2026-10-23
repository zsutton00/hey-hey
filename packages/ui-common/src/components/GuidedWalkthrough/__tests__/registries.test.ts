import { describe, expect, it, vi } from "vitest";
import { createCanonicalPageDescriptor } from "../../../contexts/CanonicalPageContext";
import {
  GUIDABLE_ACTIONS,
  defineWalkthrough,
  isStepAlreadyDone,
  isStepComplete,
  stepTarget,
  type WalkthroughActionState,
} from "../GuidableActionRegistry";
import { GuidableTargetRegistry } from "../GuidableTargetRegistry";
import { WalkthroughEventChannel } from "../WalkthroughEventChannel";
import {
  FIXED_TARGET_NAMES,
  createCreateServiceFormInstanceId,
  createDiscussModalInstanceId,
  guidableEntitiesEqual,
  serializeTargetAddress,
  toGuidableEntityFromCanonicalPage,
  toGuidableEntityFromExplorer,
  type GuidableEntity,
  type WalkthroughEvent,
  type WalkthroughStep,
} from "../types";

const FEATURE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const feature: GuidableEntity = { kind: "feature", id: FEATURE_ID };
const other: GuidableEntity = { kind: "feature", id: OTHER_ID };

function mounted(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return element;
}

const idle: WalkthroughActionState = {
  currentPage: null,
  discussModal: null,
  promptReady: false,
  sectionExpanded: () => null,
  createServiceForm: null,
};

describe("contract surface", () => {
  it("keeps the fixed target names and action keys", () => {
    expect(FIXED_TARGET_NAMES).toEqual([
      "explorer-section-toggle",
      "discuss-action",
      "discuss-prompt-editor",
      "discuss-start-conversation",
      "create-service-details",
      "create-service-submit",
    ]);
    expect(Object.keys(GUIDABLE_ACTIONS)).toEqual([
      "open-explorer-section",
      "open-entity",
      "open-discuss",
      "compose-and-start",
      "describe-service",
      "create-service",
    ]);
  });

  it("rejects unregistered actions and mismatched inputs at compile time", () => {
    // @ts-expect-error unknown action key
    const unknown: WalkthroughStep = {
      actionKey: "open-goal",
      inputs: { entity: feature },
    };
    // @ts-expect-error compose-and-start requires suggestedPrompt
    const missing: WalkthroughStep = {
      actionKey: "compose-and-start",
      inputs: { entity: feature },
    };
    expect([unknown, missing]).toHaveLength(2);
  });

  it("builds an immutable walkthrough", () => {
    const walkthrough = defineWalkthrough("Start", [
      {
        actionKey: "open-entity",
        inputs: { entity: feature, entityName: "Billing" },
      },
    ]);
    expect(Object.isFrozen(walkthrough)).toBe(true);
    expect(Object.isFrozen(walkthrough.steps)).toBe(true);
    expect(Object.isFrozen(walkthrough.steps[0].inputs)).toBe(true);
  });
});

describe("GuidableTargetRegistry", () => {
  it("resolves and reveals a mounted target", () => {
    const registry = new GuidableTargetRegistry();
    const element = mounted();
    element.scrollIntoView = vi.fn();
    registry.register(
      { name: "discuss-action", entity: feature },
      () => element,
    );

    expect(registry.lookup({ name: "discuss-action", entity: feature })).toBe(
      element,
    );
    expect(registry.reveal({ name: "discuss-action", entity: feature })).toBe(
      element,
    );
    expect(element.scrollIntoView).toHaveBeenCalled();
  });

  it("returns null for detached elements", () => {
    const registry = new GuidableTargetRegistry();
    const detached = document.createElement("div");
    registry.register(
      { name: "discuss-action", entity: feature },
      () => detached,
    );
    expect(
      registry.lookup({ name: "discuss-action", entity: feature }),
    ).toBeNull();
  });

  it("stale disposal cannot remove a newer registration", () => {
    const registry = new GuidableTargetRegistry();
    const address = { surface: "explorer-row" as const, entity: feature };
    const first = mounted();
    const second = mounted();
    const disposeFirst = registry.register(address, () => first);
    const disposeSecond = registry.register(address, () => second);

    disposeFirst();
    expect(registry.lookup(address)).toBe(second);
    disposeSecond();
    expect(registry.lookup(address)).toBeNull();
  });

  it("one missing target does not affect independent registrations", () => {
    const registry = new GuidableTargetRegistry();
    const row = mounted();
    const button = mounted();
    registry.register({ surface: "explorer-row", entity: feature }, () => row);
    const disposeButton = registry.register(
      { name: "discuss-action", entity: feature },
      () => button,
    );
    disposeButton();

    expect(
      registry.lookup({ name: "discuss-action", entity: feature }),
    ).toBeNull();
    expect(registry.lookup({ surface: "explorer-row", entity: feature })).toBe(
      row,
    );
  });

  it("scopes modal targets to their modal instance", () => {
    const registry = new GuidableTargetRegistry();
    const live = createDiscussModalInstanceId();
    const stale = createDiscussModalInstanceId();
    const editor = mounted();
    registry.register(
      { name: "discuss-prompt-editor", entity: feature, modalInstanceId: live },
      () => editor,
    );
    expect(
      registry.lookup({
        name: "discuss-prompt-editor",
        entity: feature,
        modalInstanceId: stale,
      }),
    ).toBeNull();
    expect(
      registry.lookup({
        name: "discuss-prompt-editor",
        entity: feature,
        modalInstanceId: live,
      }),
    ).toBe(editor);
  });

  it("notifies subscribers until unsubscribed", () => {
    const registry = new GuidableTargetRegistry();
    const address = { name: "discuss-action" as const, entity: feature };
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(address, listener);
    const dispose = registry.register(address, mounted);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    dispose();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("WalkthroughEventChannel", () => {
  it("stops delivering after unsubscribe", () => {
    const channel = new WalkthroughEventChannel();
    const listener = vi.fn();
    const unsubscribe = channel.subscribe(listener);
    const event: WalkthroughEvent = {
      type: "canonical-page-shown",
      entity: feature,
    };
    channel.emit(event);
    unsubscribe();
    channel.emit(event);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(event);
  });
});

describe("identity adapter", () => {
  it("normalizes Feature identity across builder, Explorer and canonical page", () => {
    const fromExplorer = toGuidableEntityFromExplorer({
      entityType: "TASK",
      entityId: FEATURE_ID,
      entitySubtype: "FEATURE",
    });
    const fromPage = toGuidableEntityFromCanonicalPage(
      createCanonicalPageDescriptor("task", FEATURE_ID, null, {
        kind: "task",
        label: "Billing",
        taskType: "FEATURE",
      }),
    );
    expect(fromExplorer).toEqual(feature);
    expect(fromPage).toEqual(feature);

    const unresolvedPage = toGuidableEntityFromCanonicalPage(
      createCanonicalPageDescriptor("task", FEATURE_ID, null),
    );
    expect(
      unresolvedPage && guidableEntitiesEqual(unresolvedPage, feature),
    ).toBe(true);
    expect(guidableEntitiesEqual(feature, other)).toBe(false);
  });
});

describe("action completion", () => {
  const modal = createDiscussModalInstanceId();
  const otherModal = createDiscussModalInstanceId();
  const withModal: WalkthroughActionState = {
    ...idle,
    discussModal: { entity: feature, modalInstanceId: modal },
  };

  it("open-entity completes only for the matching page", () => {
    const step: WalkthroughStep = {
      actionKey: "open-entity",
      inputs: { entity: feature, entityName: "Billing" },
    };
    expect(
      isStepComplete(
        step,
        { type: "canonical-page-shown", entity: other },
        idle,
      ),
    ).toBe(false);
    expect(
      isStepComplete(
        step,
        { type: "canonical-page-shown", entity: feature },
        idle,
      ),
    ).toBe(true);
    expect(isStepAlreadyDone(step, { ...idle, currentPage: feature })).toBe(
      true,
    );
    expect(isStepAlreadyDone(step, { ...idle, currentPage: other })).toBe(
      false,
    );
  });

  it("open-discuss completes only for the matching entity's modal", () => {
    const step: WalkthroughStep = {
      actionKey: "open-discuss",
      inputs: { entity: feature },
    };
    expect(
      isStepComplete(
        step,
        { type: "discuss-modal-opened", entity: other, modalInstanceId: modal },
        idle,
      ),
    ).toBe(false);
    expect(
      isStepComplete(
        step,
        { type: "canonical-page-shown", entity: feature },
        idle,
      ),
    ).toBe(false);
    expect(
      isStepComplete(
        step,
        {
          type: "discuss-modal-opened",
          entity: feature,
          modalInstanceId: modal,
        },
        idle,
      ),
    ).toBe(true);
  });

  it("compose-and-start completes only on launch from the followed modal", () => {
    const step: WalkthroughStep = {
      actionKey: "compose-and-start",
      inputs: {
        entity: feature,
        suggestedPrompt: "What should we build first?",
      },
    };
    const launch = (
      modalInstanceId: typeof modal,
      entity = feature,
    ): WalkthroughEvent => ({
      type: "discuss-conversation-launched",
      entity,
      modalInstanceId,
    });
    expect(isStepComplete(step, launch(otherModal), withModal)).toBe(false);
    expect(isStepComplete(step, launch(modal, other), withModal)).toBe(false);
    expect(isStepComplete(step, launch(modal), idle)).toBe(false);
    expect(isStepComplete(step, launch(modal), withModal)).toBe(true);
    expect(isStepAlreadyDone(step, withModal)).toBe(false);
  });

  it("prompt/start subtarget changes keep a single incomplete action", () => {
    const step: WalkthroughStep = {
      actionKey: "compose-and-start",
      inputs: { entity: feature, suggestedPrompt: "Plan it" },
    };
    const ready = { ...withModal, promptReady: true };
    expect(stepTarget(step, withModal)).toEqual({
      name: "discuss-prompt-editor",
      entity: feature,
      modalInstanceId: modal,
    });
    expect(stepTarget(step, ready)).toEqual({
      name: "discuss-start-conversation",
      entity: feature,
      modalInstanceId: modal,
    });
    expect(stepTarget(step, idle)).toBeNull();
    expect(
      isStepComplete(
        step,
        {
          type: "discuss-modal-opened",
          entity: feature,
          modalInstanceId: modal,
        },
        ready,
      ),
    ).toBe(false);
    expect(isStepAlreadyDone(step, ready)).toBe(false);
  });
});

describe("Create Service actions", () => {
  const form = createCreateServiceFormInstanceId();
  const staleForm = createCreateServiceFormInstanceId();
  const empty: WalkthroughActionState = {
    ...idle,
    createServiceForm: { formInstanceId: form, detailsReady: false },
  };
  const filled: WalkthroughActionState = {
    ...idle,
    createServiceForm: { formInstanceId: form, detailsReady: true },
  };
  const describeStep: WalkthroughStep = {
    actionKey: "describe-service",
    inputs: {},
  };
  const createStep: WalkthroughStep = {
    actionKey: "create-service",
    inputs: {},
  };

  it("targets the live form instance and nothing without a form", () => {
    expect(stepTarget(describeStep, empty)).toEqual({
      name: "create-service-details",
      formInstanceId: form,
    });
    expect(stepTarget(createStep, empty)).toEqual({
      name: "create-service-submit",
      formInstanceId: form,
    });
    expect(stepTarget(describeStep, idle)).toBeNull();
    expect(stepTarget(createStep, idle)).toBeNull();
  });

  it("scopes target addresses to the form instance", () => {
    expect(
      serializeTargetAddress({
        name: "create-service-details",
        formInstanceId: form,
      }),
    ).not.toBe(
      serializeTargetAddress({
        name: "create-service-details",
        formInstanceId: staleForm,
      }),
    );
  });

  it("describe-service completes only on its own form's details-ready event", () => {
    expect(
      isStepComplete(
        describeStep,
        { type: "create-service-details-ready", formInstanceId: staleForm },
        empty,
      ),
    ).toBe(false);
    expect(
      isStepComplete(
        describeStep,
        { type: "service-created", formInstanceId: form },
        empty,
      ),
    ).toBe(false);
    expect(
      isStepComplete(
        describeStep,
        { type: "create-service-details-ready", formInstanceId: form },
        idle,
      ),
    ).toBe(false);
    expect(
      isStepComplete(
        describeStep,
        { type: "create-service-details-ready", formInstanceId: form },
        empty,
      ),
    ).toBe(true);
    expect(isStepAlreadyDone(describeStep, empty)).toBe(false);
    expect(isStepAlreadyDone(describeStep, filled)).toBe(true);
  });

  it("create-service completes only on its own form's service-created event", () => {
    expect(
      isStepComplete(
        createStep,
        { type: "service-created", formInstanceId: staleForm },
        filled,
      ),
    ).toBe(false);
    expect(
      isStepComplete(
        createStep,
        { type: "create-service-details-ready", formInstanceId: form },
        filled,
      ),
    ).toBe(false);
    expect(
      isStepComplete(
        createStep,
        { type: "service-created", formInstanceId: form },
        filled,
      ),
    ).toBe(true);
    expect(isStepAlreadyDone(createStep, filled)).toBe(false);
  });
});
