import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildGuidedFirstStepsWalkthrough } from "../../Help/buildGuidedFirstStepsWalkthrough";
import { defineWalkthrough } from "../GuidableActionRegistry";
import type {
  DiscussModalSession,
  DiscussSuggestionView,
} from "../DiscussModalSessionStore";
import {
  ENDED_MESSAGE_DURATION_MS,
  GuidedWalkthroughRunner,
  TARGET_RESOLUTION_TIMEOUT_MS,
  type GuidedWalkthroughView,
} from "../GuidedWalkthroughRunner";
import {
  createGuidedWalkthroughRuntime,
  type GuidedWalkthroughRuntime,
} from "../guidedWalkthroughRuntime";
import {
  createCreateServiceFormInstanceId,
  createDiscussModalInstanceId,
  type DiscussModalInstanceId,
  type GuidableEntity,
  type GuidableTargetAddress,
  type Walkthrough,
} from "../types";

const feature: GuidableEntity = {
  kind: "feature",
  id: "11111111-1111-4111-8111-111111111111",
};
const other: GuidableEntity = {
  kind: "feature",
  id: "22222222-2222-4222-8222-222222222222",
};
const PROMPT = "Draft the first tasks for Billing.";

function threeActionWalkthrough(entity = feature): Walkthrough {
  return defineWalkthrough("Start on Billing", [
    { actionKey: "open-entity", inputs: { entity, entityName: "Billing" } },
    { actionKey: "open-discuss", inputs: { entity } },
    {
      actionKey: "compose-and-start",
      inputs: { entity, suggestedPrompt: PROMPT },
    },
  ]);
}

function mountTarget(
  runtime: GuidedWalkthroughRuntime,
  address: GuidableTargetAddress,
): { element: HTMLElement; unmount: () => void } {
  const element = document.createElement("button");
  element.scrollIntoView = vi.fn();
  element.getBoundingClientRect = () => new DOMRect(20, 20, 100, 30);
  document.body.appendChild(element);
  const dispose = runtime.targets.register(address, () => element);
  return {
    element,
    unmount: () => {
      dispose();
      element.remove();
    },
  };
}

/** A DiscussModal stand-in publishing sessions the way the real modal does. */
function openModal(
  runtime: GuidedWalkthroughRuntime,
  entity: GuidableEntity,
): {
  modalInstanceId: DiscussModalInstanceId;
  editor: HTMLElement;
  start: HTMLElement;
  type: (text: string) => void;
  close: () => void;
  offerSuggestion: ReturnType<typeof vi.fn>;
} {
  const modalInstanceId = createDiscussModalInstanceId();
  const token = Symbol("modal");
  const editor = mountTarget(runtime, {
    name: "discuss-prompt-editor",
    entity,
    modalInstanceId,
  });
  const start = mountTarget(runtime, {
    name: "discuss-start-conversation",
    entity,
    modalInstanceId,
  });
  const guidanceContainer = document.createElement("div");
  let prompt = "";
  let suggestion: DiscussSuggestionView = { status: "none" };
  let disposeSession = () => {};
  const offerSuggestion = vi.fn((text: string) => {
    suggestion = { status: "available", text };
    publish();
  });
  const acceptSuggestion = () => {
    if (suggestion.status !== "available") return false;
    suggestion = { status: "accepted", text: suggestion.text };
    prompt = suggestion.text;
    publish();
    return true;
  };
  function publish() {
    const session: DiscussModalSession = {
      entity,
      modalInstanceId,
      promptReady: suggestion.status === "accepted" || prompt.trim() !== "",
      suggestion,
      guidanceContainer,
      offerSuggestion,
      acceptSuggestion,
    };
    disposeSession = runtime.discussSessions.publish(token, session);
  }
  publish();
  runtime.events.emit({
    type: "discuss-modal-opened",
    entity,
    modalInstanceId,
  });
  return {
    modalInstanceId,
    editor: editor.element,
    start: start.element,
    type: (text) => {
      prompt = text;
      if (suggestion.status === "available") {
        suggestion = { status: "protected", text: suggestion.text };
      }
      publish();
    },
    close: () => {
      disposeSession();
      editor.unmount();
      start.unmount();
    },
    offerSuggestion,
  };
}

function active(view: GuidedWalkthroughView) {
  if (view.status !== "active") {
    throw new Error(`expected an active walkthrough, got ${view.status}`);
  }
  return view;
}

describe("GuidedWalkthroughRunner", () => {
  let runtime: GuidedWalkthroughRuntime;
  let runner: GuidedWalkthroughRunner;

  beforeEach(() => {
    vi.useFakeTimers();
    runtime = createGuidedWalkthroughRuntime();
    runner = new GuidedWalkthroughRunner(runtime);
  });

  afterEach(() => {
    runner.dispose();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  const sectionKey = "work-item:FEATURE";
  const guidedStart = () =>
    buildGuidedFirstStepsWalkthrough({
      feature: { id: feature.id, name: "Billing", href: "/features/billing" },
      kind: "TASKS",
      rationale: "Start here",
      starterPrompt: PROMPT,
    });

  it("guides collapsed Features, waits for owner completion and visible row, then waits for user navigation", () => {
    runtime.explorerSections.publish(sectionKey, Symbol(), false);
    const toggle = mountTarget(runtime, {
      name: "explorer-section-toggle",
      sectionKey,
    });
    const row = mountTarget(runtime, {
      surface: "explorer-row",
      entity: feature,
    });
    row.element.setAttribute("aria-hidden", "true");
    runner.start(guidedStart());
    expect(active(runner.getView())).toMatchObject({
      stepNumber: 1,
      target: toggle.element,
    });
    runtime.events.emit({
      type: "explorer-section-expanded",
      sectionKey: "services",
    });
    runtime.explorerSections.publish(sectionKey, Symbol(), true);
    expect(active(runner.getView()).stepNumber).toBe(1);
    runtime.events.emit({ type: "explorer-section-expanded", sectionKey });
    expect(active(runner.getView())).toMatchObject({
      stepNumber: 2,
      target: null,
    });
    row.element.removeAttribute("aria-hidden");
    vi.advanceTimersByTime(100);
    expect(active(runner.getView())).toMatchObject({
      stepNumber: 2,
      target: row.element,
    });
    runtime.events.emit({ type: "canonical-page-shown", entity: feature });
    expect(active(runner.getView()).stepNumber).toBe(3);
  });

  it("skips the authored expansion when already open, and skips navigation for the active page", () => {
    runtime.explorerSections.publish(sectionKey, Symbol(), true);
    const row = mountTarget(runtime, {
      surface: "explorer-row",
      entity: feature,
    });
    runner.start(guidedStart());
    expect(active(runner.getView())).toMatchObject({
      stepNumber: 2,
      target: row.element,
    });
    runtime.currentPage.publish(Symbol(), feature);
    runner.start(guidedStart());
    expect(active(runner.getView()).stepNumber).toBe(3);
  });

  it("evaluates a conditional step when reached rather than when the walkthrough starts", () => {
    runtime.explorerSections.publish(sectionKey, Symbol(), true);
    runner.start(
      defineWalkthrough("Later condition", [
        {
          actionKey: "open-entity",
          inputs: { entity: other, entityName: "Other" },
        },
        ...guidedStart().steps,
      ]),
    );
    runtime.explorerSections.publish(sectionKey, Symbol(), false);
    const toggle = mountTarget(runtime, {
      name: "explorer-section-toggle",
      sectionKey,
    });
    runtime.events.emit({ type: "canonical-page-shown", entity: other });
    expect(active(runner.getView())).toMatchObject({
      stepNumber: 2,
      target: toggle.element,
    });
    runner.exit();
    runtime.events.emit({ type: "explorer-section-expanded", sectionKey });
    vi.advanceTimersByTime(TARGET_RESOLUTION_TIMEOUT_MS);
    expect(runner.getView().status).toBe("idle");
  });

  it("skips expansion for the already active Feature even when its section is collapsed", () => {
    runtime.explorerSections.publish(sectionKey, Symbol(), false);
    runtime.currentPage.publish(Symbol(), feature);
    runner.start(guidedStart());
    expect(active(runner.getView()).stepNumber).toBe(3);
  });

  it.each(["state", "toggle", "row"])(
    "ends with a message for unavailable %s",
    (missing) => {
      if (missing !== "state")
        runtime.explorerSections.publish(
          sectionKey,
          Symbol(),
          missing === "row",
        );
      runner.start(guidedStart());
      expect(active(runner.getView()).target).toBeNull();
      vi.advanceTimersByTime(TARGET_RESOLUTION_TIMEOUT_MS);
      expect(runner.getView()).toMatchObject({
        status: "ended",
        message: expect.stringContaining("could not be found"),
      });
    },
  );

  it("removes hidden target geometry and bounds waiting after a visible row disappears", () => {
    runtime.explorerSections.publish(sectionKey, Symbol(), true);
    const row = mountTarget(runtime, {
      surface: "explorer-row",
      entity: feature,
    });
    runner.start(guidedStart());
    row.element.hidden = true;
    vi.advanceTimersByTime(100);
    expect(active(runner.getView()).target).toBeNull();
    vi.advanceTimersByTime(TARGET_RESOLUTION_TIMEOUT_MS);
    expect(runner.getView().status).toBe("ended");
  });

  it("runs the three actions across route and modal mounting on real events only", () => {
    const row = mountTarget(runtime, {
      surface: "explorer-row",
      entity: feature,
    });
    runner.start(threeActionWalkthrough());

    let view = active(runner.getView());
    expect(view).toMatchObject({ stepNumber: 1, stepCount: 3 });
    expect(view.copy).toBe("Your features live in the Explorer. Open Billing.");
    expect(view.target).toBe(row.element);
    expect(row.element.scrollIntoView).toHaveBeenCalledTimes(1);

    // Unrelated events do not advance.
    runtime.events.emit({ type: "canonical-page-shown", entity: other });
    runtime.events.emit({
      type: "discuss-modal-opened",
      entity: other,
      modalInstanceId: createDiscussModalInstanceId(),
    });
    expect(active(runner.getView()).stepNumber).toBe(1);

    // Navigating: the page shows before the Feature page's capsule mounts.
    const pageToken = Symbol("page");
    runtime.currentPage.publish(pageToken, feature);
    runtime.events.emit({ type: "canonical-page-shown", entity: feature });
    view = active(runner.getView());
    expect(view.stepNumber).toBe(2);
    expect(view.target).toBeNull();

    vi.advanceTimersByTime(TARGET_RESOLUTION_TIMEOUT_MS / 2);
    const discuss = mountTarget(runtime, {
      name: "discuss-action",
      entity: feature,
    });
    view = active(runner.getView());
    expect(view.target).toBe(discuss.element);
    expect(view.copy).toBe(
      "Discuss starts a conversation with an agent about this Feature.",
    );
    vi.advanceTimersByTime(TARGET_RESOLUTION_TIMEOUT_MS);
    expect(runner.getView().status).toBe("active");

    // Opening Discuss completes step 2; step 3 starts on the prompt subtarget.
    const modal = openModal(runtime, feature);
    view = active(runner.getView());
    expect(view.stepNumber).toBe(3);
    expect(view.target).toBe(modal.editor);
    expect(modal.offerSuggestion).toHaveBeenCalledWith(PROMPT);
    expect(view.suggestion?.text).toBe(PROMPT);
    expect(view.modalContainer).not.toBeNull();

    // Accepting moves to the start subtarget without leaving Step 3 of 3.
    expect(view.suggestion?.accept()).toBe(true);
    view = active(runner.getView());
    expect(view).toMatchObject({ stepNumber: 3, suggestion: null });
    expect(view.target).toBe(modal.start);
    expect(view.copy).toMatch(/^Start Conversation lets the agent research/);

    // A launch from another modal does not finish it; the followed one does,
    // even after that modal has started closing.
    runtime.events.emit({
      type: "discuss-conversation-launched",
      entity: feature,
      modalInstanceId: createDiscussModalInstanceId(),
    });
    expect(runner.getView().status).toBe("active");
    modal.close();
    runtime.events.emit({
      type: "discuss-conversation-launched",
      entity: feature,
      modalInstanceId: modal.modalInstanceId,
    });
    expect(runner.getView()).toEqual({ status: "idle" });

    // Everything was disposed: no late ending appears.
    vi.advanceTimersByTime(TARGET_RESOLUTION_TIMEOUT_MS * 2);
    expect(runner.getView()).toEqual({ status: "idle" });
  });

  it("skips open-entity when the Feature page is already showing", () => {
    runtime.currentPage.publish(Symbol("page"), {
      kind: "task",
      id: feature.id,
    });
    const discuss = mountTarget(runtime, {
      name: "discuss-action",
      entity: feature,
    });
    runner.start(threeActionWalkthrough());

    const view = active(runner.getView());
    expect(view.stepNumber).toBe(2);
    expect(view.target).toBe(discuss.element);
  });

  it("moves to the start subtarget when the user types and back when they clear", () => {
    runner.start(threeActionWalkthrough());
    runtime.currentPage.publish(Symbol("page"), feature);
    const modal = openModal(runtime, feature);

    modal.type("My own prompt");
    expect(active(runner.getView()).target).toBe(modal.start);
    modal.type("");
    expect(active(runner.getView()).target).toBe(modal.editor);
  });

  it("stays on step 3 when a launch fails or uses Quick Question", () => {
    runner.start(threeActionWalkthrough());
    runtime.currentPage.publish(Symbol("page"), feature);
    const modal = openModal(runtime, feature);
    modal.type("Prompt");

    // Neither emits a launched event, so nothing completes.
    vi.advanceTimersByTime(TARGET_RESOLUTION_TIMEOUT_MS * 2);
    const view = active(runner.getView());
    expect(view.stepNumber).toBe(3);
    expect(view.target).toBe(modal.start);
  });

  it("ends with a message when a target never mounts, then clears it", () => {
    runner.start(threeActionWalkthrough());
    expect(active(runner.getView()).target).toBeNull();

    vi.advanceTimersByTime(TARGET_RESOLUTION_TIMEOUT_MS - 1);
    expect(runner.getView().status).toBe("active");
    vi.advanceTimersByTime(1);
    expect(runner.getView()).toEqual({
      status: "ended",
      message:
        "The walkthrough ended because Billing in the Explorer could not be found.",
    });

    // The ended run no longer reacts.
    runtime.events.emit({ type: "canonical-page-shown", entity: feature });
    expect(runner.getView().status).toBe("ended");

    vi.advanceTimersByTime(ENDED_MESSAGE_DURATION_MS);
    expect(runner.getView()).toEqual({ status: "idle" });
  });

  it("ends when a resolved target is permanently lost", () => {
    const row = mountTarget(runtime, {
      surface: "explorer-row",
      entity: feature,
    });
    runner.start(threeActionWalkthrough());
    row.unmount();
    expect(active(runner.getView()).target).toBeNull();

    vi.advanceTimersByTime(TARGET_RESOLUTION_TIMEOUT_MS);
    expect(runner.getView().status).toBe("ended");
  });

  it("follows a target through a remount within the resolution interval", () => {
    const first = mountTarget(runtime, {
      surface: "explorer-row",
      entity: feature,
    });
    runner.start(threeActionWalkthrough());
    first.unmount();
    vi.advanceTimersByTime(TARGET_RESOLUTION_TIMEOUT_MS - 100);
    const second = mountTarget(runtime, {
      surface: "explorer-row",
      entity: feature,
    });

    expect(active(runner.getView()).target).toBe(second.element);
    expect(second.element.scrollIntoView).toHaveBeenCalled();
    vi.advanceTimersByTime(TARGET_RESOLUTION_TIMEOUT_MS);
    expect(runner.getView().status).toBe("active");
  });

  it("exit clears state and pending waits", () => {
    runner.start(threeActionWalkthrough());
    runner.exit();
    expect(runner.getView()).toEqual({ status: "idle" });

    vi.advanceTimersByTime(TARGET_RESOLUTION_TIMEOUT_MS * 2);
    expect(runner.getView()).toEqual({ status: "idle" });
    runtime.events.emit({ type: "canonical-page-shown", entity: feature });
    expect(runner.getView()).toEqual({ status: "idle" });
  });

  it("restart discards the previous run's followed modal and pending work", () => {
    runner.start(threeActionWalkthrough());
    runtime.currentPage.publish(Symbol("page"), feature);
    const modal = openModal(runtime, feature);
    modal.close();
    runtime.currentPage.publish(Symbol("page"), null);

    // Restart for another Feature while the old wait is pending.
    vi.advanceTimersByTime(TARGET_RESOLUTION_TIMEOUT_MS - 100);
    mountTarget(runtime, { surface: "explorer-row", entity: other });
    runner.start(threeActionWalkthrough(other));
    expect(active(runner.getView()).stepNumber).toBe(1);

    // The old run's deadline and its modal's launch cannot affect the new run.
    vi.advanceTimersByTime(200);
    runtime.events.emit({
      type: "discuss-conversation-launched",
      entity: feature,
      modalInstanceId: modal.modalInstanceId,
    });
    const view = active(runner.getView());
    expect(view.stepNumber).toBe(1);
    expect(view.title).toBe("Start on Billing");
  });

  it("restarting from the ended message starts fresh", () => {
    runner.start(threeActionWalkthrough());
    vi.advanceTimersByTime(TARGET_RESOLUTION_TIMEOUT_MS);
    expect(runner.getView().status).toBe("ended");

    mountTarget(runtime, { surface: "explorer-row", entity: feature });
    runner.start(threeActionWalkthrough());
    vi.advanceTimersByTime(ENDED_MESSAGE_DURATION_MS);
    expect(active(runner.getView()).stepNumber).toBe(1);
  });

  describe("Create Service form", () => {
    const addServiceWalkthrough = () =>
      defineWalkthrough("Add a service", [
        { actionKey: "describe-service", inputs: {} },
        { actionKey: "create-service", inputs: {} },
      ]);

    function mountForm(detailsReady = false) {
      const formInstanceId = createCreateServiceFormInstanceId();
      const token = Symbol("form");
      const details = mountTarget(runtime, {
        name: "create-service-details",
        formInstanceId,
      });
      const submit = mountTarget(runtime, {
        name: "create-service-submit",
        formInstanceId,
      });
      const publish = (ready: boolean) =>
        runtime.createServiceForms.publish(token, {
          formInstanceId,
          detailsReady: ready,
        });
      publish(detailsReady);
      return { formInstanceId, details, submit, publish };
    }

    it("advances each step only on its own form's event", () => {
      const form = mountForm();
      runner.start(addServiceWalkthrough());
      expect(active(runner.getView())).toMatchObject({
        stepNumber: 1,
        stepCount: 2,
        target: form.details.element,
      });

      runtime.events.emit({
        type: "service-created",
        formInstanceId: form.formInstanceId,
      });
      runtime.events.emit({
        type: "create-service-details-ready",
        formInstanceId: createCreateServiceFormInstanceId(),
      });
      expect(active(runner.getView()).stepNumber).toBe(1);

      form.publish(true);
      runtime.events.emit({
        type: "create-service-details-ready",
        formInstanceId: form.formInstanceId,
      });
      expect(active(runner.getView())).toMatchObject({
        stepNumber: 2,
        target: form.submit.element,
      });

      runtime.events.emit({
        type: "create-service-details-ready",
        formInstanceId: form.formInstanceId,
      });
      expect(active(runner.getView()).stepNumber).toBe(2);

      runtime.events.emit({
        type: "service-created",
        formInstanceId: form.formInstanceId,
      });
      expect(runner.getView().status).toBe("idle");
    });

    it("skips the details step when the form is already filled in", () => {
      const form = mountForm(true);
      runner.start(addServiceWalkthrough());
      expect(active(runner.getView())).toMatchObject({
        stepNumber: 2,
        target: form.submit.element,
      });
    });

    it("waits for a form that mounts after the walkthrough starts", () => {
      runner.start(addServiceWalkthrough());
      expect(active(runner.getView())).toMatchObject({
        stepNumber: 1,
        target: null,
      });
      const form = mountForm();
      expect(active(runner.getView())).toMatchObject({
        stepNumber: 1,
        target: form.details.element,
      });
    });

    it("exit ends the walkthrough without completing it", () => {
      const form = mountForm();
      runner.start(addServiceWalkthrough());
      runner.exit();
      runtime.events.emit({
        type: "create-service-details-ready",
        formInstanceId: form.formInstanceId,
      });
      expect(runner.getView().status).toBe("idle");
    });

    it("ends with a message when the form never mounts", () => {
      runner.start(addServiceWalkthrough());
      vi.advanceTimersByTime(TARGET_RESOLUTION_TIMEOUT_MS);
      expect(runner.getView()).toEqual({
        status: "ended",
        message:
          "The walkthrough ended because the Create Service form could not be found.",
      });
    });
  });
});
