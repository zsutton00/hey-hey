import { isGuidableTargetVisible } from "./targetVisibility";
import {
  stepCondition,
  isStepAlreadyDone,
  isStepComplete,
  stepCopy,
  stepTarget,
  type WalkthroughActionState,
} from "./GuidableActionRegistry";
import type { DiscussModalSession } from "./DiscussModalSessionStore";
import type { GuidedWalkthroughRuntime } from "./guidedWalkthroughRuntime";
import {
  guidableEntitiesEqual,
  serializeTargetAddress,
  type GuidableEntity,
  type GuidableTargetAddress,
  type Walkthrough,
  type WalkthroughEvent,
  type WalkthroughStep,
} from "./types";

/** How long a step's target may stay unmounted (route/React mounting). */
export const TARGET_RESOLUTION_TIMEOUT_MS = 5000;
const TARGET_POLL_INTERVAL_MS = 100;
/** How long the missing-target message stays before clearing itself. */
export const ENDED_MESSAGE_DURATION_MS = 6000;

export type CalloutPlacement = "right" | "top" | "bottom";

export interface SuggestionHelperView {
  text: string;
  accept: () => boolean;
}

export type GuidedWalkthroughView =
  | { status: "idle" }
  | {
      status: "active";
      title: string;
      stepNumber: number;
      stepCount: number;
      copy: string;
      /** Null while the target is still resolving. */
      target: HTMLElement | null;
      placement: CalloutPlacement;
      /**
       * In-modal guidance slot of the followed DiscussModal. Guidance renders
       * there so it stays inside the Dialog's keyboard boundary.
       */
      modalContainer: HTMLElement | null;
      suggestion: SuggestionHelperView | null;
    }
  | { status: "ended"; message: string };

const IDLE: GuidedWalkthroughView = Object.freeze({ status: "idle" });

type FollowedModal = WalkthroughActionState["discussModal"];

interface Run {
  walkthrough: Walkthrough;
  stepIndex: number;
  selectedStepIndex: number | null;
  /**
   * Tracked by the runner itself: the launched event arrives after the modal
   * has begun closing, when its session may already be gone.
   */
  followedModal: FollowedModal;
  disposers: Array<() => void>;
  watched: { key: string; dispose: () => void } | null;
  revealedKey: string | null;
  deadline: ReturnType<typeof setTimeout> | null;
}

type ViewListener = () => void;

const NO_TARGET_KEY = "<no-target>";

/**
 * Owns the single client-memory walkthrough: step progression on correlated
 * completion events, already-done skipping, bounded target resolution,
 * reveal, and the missing-target ending. Every subscription, timer and wait
 * belongs to one run, so exit, success, missing target and restart dispose
 * it and late callbacks from a previous run are ignored.
 */
export class GuidedWalkthroughRunner {
  private run: Run | null = null;
  private view: GuidedWalkthroughView = IDLE;
  private endedTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<ViewListener>();

  constructor(private readonly runtime: GuidedWalkthroughRuntime) {}

  getView = (): GuidedWalkthroughView => this.view;

  subscribe = (listener: ViewListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Starts `walkthrough`, replacing any active or ended one. */
  start(walkthrough: Walkthrough): void {
    this.clear();
    const run: Run = {
      walkthrough,
      stepIndex: 0,
      selectedStepIndex: null,
      followedModal: followableModal(
        walkthrough,
        this.runtime.discussSessions.current(),
      ),
      disposers: [],
      watched: null,
      revealedKey: null,
      deadline: null,
    };
    this.run = run;
    run.disposers.push(
      this.runtime.events.subscribe((event) => this.handleEvent(run, event)),
      this.runtime.discussSessions.subscribe(() => this.sync(run)),
      this.runtime.createServiceForms.subscribe(() => this.sync(run)),
      this.runtime.currentPage.subscribe(() => this.sync(run)),
      this.runtime.explorerSections.subscribe(() => this.sync(run)),
    );
    const poll = setInterval(() => this.sync(run), TARGET_POLL_INTERVAL_MS);
    run.disposers.push(() => clearInterval(poll));
    this.sync(run);
  }

  /** Ends the walkthrough and leaves the app where it is. */
  exit(): void {
    this.clear();
    this.setView(IDLE);
  }

  dismissMessage(): void {
    if (this.view.status !== "ended") return;
    this.exit();
  }

  dispose(): void {
    this.exit();
  }

  private handleEvent(run: Run, event: WalkthroughEvent): void {
    if (this.run !== run) return;
    if (
      event.type === "discuss-modal-opened" &&
      walkthroughNamesEntity(run.walkthrough, event.entity)
    ) {
      run.followedModal = {
        entity: event.entity,
        modalInstanceId: event.modalInstanceId,
      };
    }
    const step = run.walkthrough.steps[run.stepIndex];
    if (
      step &&
      run.selectedStepIndex === run.stepIndex &&
      isStepComplete(step, event, this.actionState(run))
    ) {
      run.stepIndex += 1;
    }
    this.sync(run);
  }

  private actionState(run: Run): WalkthroughActionState {
    const session = this.followedSession(run);
    return {
      currentPage: this.runtime.currentPage.current(),
      discussModal: run.followedModal,
      promptReady: session?.promptReady ?? false,
      sectionExpanded: this.runtime.explorerSections.current,
      createServiceForm: this.runtime.createServiceForms.current(),
    };
  }

  private followedSession(run: Run): DiscussModalSession | null {
    const session = this.runtime.discussSessions.current();
    const followed = run.followedModal;
    return session !== null &&
      followed !== null &&
      session.modalInstanceId === followed.modalInstanceId
      ? session
      : null;
  }

  /** Re-evaluates the current step against live state. */
  private sync(run: Run): void {
    if (this.run !== run) return;
    const { steps } = run.walkthrough;
    let state = this.actionState(run);
    while (
      run.stepIndex < steps.length &&
      (isStepAlreadyDone(steps[run.stepIndex], state) ||
        (run.selectedStepIndex !== run.stepIndex &&
          stepCondition(steps[run.stepIndex], state) === false))
    ) {
      run.stepIndex += 1;
    }
    const step = steps[run.stepIndex];
    if (step === undefined) {
      this.exit();
      return;
    }

    const conditionReady =
      run.selectedStepIndex === run.stepIndex ||
      stepCondition(step, state) === true;
    if (conditionReady) run.selectedStepIndex = run.stepIndex;

    let session = this.followedSession(run);
    if (step.actionKey === "compose-and-start" && session !== null) {
      offerSuggestionOnce(session, step.inputs.suggestedPrompt);
      // The offer may republish the session (and re-enter sync) synchronously.
      if (this.run !== run) return;
      session = this.followedSession(run);
      state = this.actionState(run);
    }

    const address = stepTarget(step, state);
    const target = this.resolveTarget(run, conditionReady ? address : null);
    if (this.run !== run) return;
    this.setView(
      activeView(run, step, state, address, target, session, this.view),
    );
  }

  private resolveTarget(
    run: Run,
    address: GuidableTargetAddress | null,
  ): HTMLElement | null {
    const key =
      address === null ? NO_TARGET_KEY : serializeTargetAddress(address);
    if (run.watched?.key !== key) {
      run.watched?.dispose();
      run.watched = {
        key,
        dispose:
          address === null
            ? () => {}
            : this.runtime.targets.subscribe(address, () => this.sync(run)),
      };
      run.revealedKey = null;
      stopWaiting(run);
    }
    if (address === null) {
      this.waitForTarget(run, address);
      return null;
    }

    const mounted = this.runtime.targets.lookup(address);
    const element =
      mounted !== null && isGuidableTargetVisible(mounted) ? mounted : null;
    if (element !== null && run.revealedKey !== key)
      this.runtime.targets.reveal(address);
    if (element === null) {
      run.revealedKey = null;
      this.waitForTarget(run, address);
      return null;
    }
    run.revealedKey = key;
    stopWaiting(run);
    return element;
  }

  private waitForTarget(run: Run, address: GuidableTargetAddress | null): void {
    if (run.deadline !== null) return;
    run.deadline = setTimeout(
      () => this.endWithMissingTarget(run, address),
      TARGET_RESOLUTION_TIMEOUT_MS,
    );
  }

  private endWithMissingTarget(
    run: Run,
    address: GuidableTargetAddress | null,
  ): void {
    if (this.run !== run) return;
    const step = run.walkthrough.steps[run.stepIndex];
    this.clear();
    this.setView({
      status: "ended",
      message: missingTargetMessage(step, address),
    });
    this.endedTimer = setTimeout(
      () => this.dismissMessage(),
      ENDED_MESSAGE_DURATION_MS,
    );
  }

  private clear(): void {
    const run = this.run;
    this.run = null;
    if (run !== null) {
      stopWaiting(run);
      run.watched?.dispose();
      run.watched = null;
      for (const dispose of run.disposers) dispose();
      run.disposers = [];
    }
    if (this.endedTimer !== null) {
      clearTimeout(this.endedTimer);
      this.endedTimer = null;
    }
  }

  private setView(next: GuidedWalkthroughView): void {
    if (viewsEqual(this.view, next)) return;
    this.view = next;
    for (const listener of [...this.listeners]) listener();
  }
}

function stopWaiting(run: Run): void {
  if (run.deadline !== null) clearTimeout(run.deadline);
  run.deadline = null;
}

function walkthroughNamesEntity(
  walkthrough: Walkthrough,
  entity: GuidableEntity,
): boolean {
  return walkthrough.steps.some(
    (step) =>
      "entity" in step.inputs &&
      guidableEntitiesEqual(step.inputs.entity, entity),
  );
}

function followableModal(
  walkthrough: Walkthrough,
  session: DiscussModalSession | null,
): FollowedModal {
  return session !== null && walkthroughNamesEntity(walkthrough, session.entity)
    ? { entity: session.entity, modalInstanceId: session.modalInstanceId }
    : null;
}

/** Offers the step's prompt unless one is offered, protected or accepted. */
function offerSuggestionOnce(session: DiscussModalSession, text: string): void {
  const suggestion = session.suggestion;
  if (
    suggestion.status === "none" ||
    (suggestion.status === "available" && suggestion.text !== text)
  ) {
    session.offerSuggestion(text);
  }
}

function calloutPlacement(
  address: GuidableTargetAddress | null,
): CalloutPlacement {
  if (address === null || "surface" in address) return "right";
  switch (address.name) {
    case "explorer-section-toggle":
      return "right";
    case "discuss-action":
      return "top";
    case "discuss-prompt-editor":
      return "right";
    case "discuss-start-conversation":
      return "bottom";
    case "create-service-details":
      return "right";
    case "create-service-submit":
      return "top";
  }
}

function activeView(
  run: Run,
  step: WalkthroughStep,
  state: WalkthroughActionState,
  address: GuidableTargetAddress | null,
  target: HTMLElement | null,
  session: DiscussModalSession | null,
  previous: GuidedWalkthroughView,
): GuidedWalkthroughView {
  const modalSession = step.actionKey === "compose-and-start" ? session : null;
  return {
    status: "active",
    title: run.walkthrough.title,
    stepNumber: run.stepIndex + 1,
    stepCount: run.walkthrough.steps.length,
    copy: stepCopy(step, state),
    target,
    placement: calloutPlacement(address),
    modalContainer: modalSession?.guidanceContainer ?? null,
    suggestion:
      modalSession === null || state.promptReady
        ? null
        : suggestionHelper(
            modalSession,
            previous.status === "active" ? previous.suggestion : null,
          ),
  };
}

/** The prompt helper while a suggestion can still fill the editor. */
function suggestionHelper(
  session: DiscussModalSession,
  previous: SuggestionHelperView | null,
): SuggestionHelperView | null {
  const { suggestion, acceptSuggestion } = session;
  if (suggestion.status !== "available") return null;
  return previous !== null &&
    previous.text === suggestion.text &&
    previous.accept === acceptSuggestion
    ? previous
    : { text: suggestion.text, accept: acceptSuggestion };
}

function missingTargetMessage(
  step: WalkthroughStep | undefined,
  address: GuidableTargetAddress | null,
): string {
  const what =
    step?.actionKey === "open-explorer-section"
      ? `${step.inputs.sectionName} in the Explorer`
      : step?.actionKey === "open-entity"
        ? `${step.inputs.entityName} in the Explorer`
        : step?.actionKey === "describe-service" ||
            step?.actionKey === "create-service"
          ? "the Create Service form"
          : address !== null &&
              "name" in address &&
              address.name === "discuss-action"
            ? "the Discuss action"
            : "the Discuss window";
  return `The walkthrough ended because ${what} could not be found.`;
}

function viewsEqual(
  left: GuidedWalkthroughView,
  right: GuidedWalkthroughView,
): boolean {
  if (left.status === "idle" || right.status === "idle") {
    return left.status === right.status;
  }
  if (left.status === "ended" || right.status === "ended") {
    return (
      left.status === right.status &&
      left.status === "ended" &&
      right.status === "ended" &&
      left.message === right.message
    );
  }
  return (
    left.title === right.title &&
    left.stepNumber === right.stepNumber &&
    left.stepCount === right.stepCount &&
    left.copy === right.copy &&
    left.target === right.target &&
    left.placement === right.placement &&
    left.modalContainer === right.modalContainer &&
    left.suggestion === right.suggestion
  );
}
