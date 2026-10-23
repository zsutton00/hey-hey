import type {
  HelpScenarioCheckpoint,
  HelpScenarioCta,
  HelpScenarioFeatureNextStepsCopy,
  HelpScenarioTemplatedCopy,
} from "./helpScenarioCatalog";

/** Shared display shape for cards that render help topics. */
export interface HelpScenarioDisplayEntry {
  /** Stable identifier for the rendered topic. */
  id: string;
  /** Short heading shown on the help surface. */
  title: string;
  /** One-line description shown beneath the title when available. */
  summary?: string;
  /** Complete ordered procedure that remains readable without animation. */
  instructions?: readonly string[];
  /**
   * Present only on scenarios whose copy interpolates live project data.
   * Shallow API tree topics omit this.
   */
  templatedCopy?: HelpScenarioTemplatedCopy;
  /** Richer per-scenario explanation rendered when available. */
  deepContent?: string;
  /** Optional call-to-action for the scenario. */
  callToAction?: HelpScenarioCta;
  /** Ordered sub-flow rendered in place of deepContent when present. */
  checkpoints?: readonly HelpScenarioCheckpoint[];
  /** Copy framing the feature overview list and walkthrough buttons. */
  featureNextSteps?: HelpScenarioFeatureNextStepsCopy;
}
