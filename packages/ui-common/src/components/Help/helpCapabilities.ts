import type { ProjectFeatureNextStepKind } from "../../api";
import type { HelpActionId, HelpScenarioId } from "./helpScenarioCatalog";

/**
 * A lightweight feature record supplied by the help data-access capability.
 * Enough to render a clickable feature link in help surfaces without pulling
 * in the full task graph.
 */
export interface HelpFeatureRecord {
  id: string;
  name: string;
  href: string;
  /** Short plain-text overview taken from the Feature's description, when it has one. */
  overview?: string;
}

/**
 * One onboarding-generated suggestion: a top-level Feature to open first and
 * the kind of artifact to create there after fleshing it out.
 */
export interface HelpFeatureNextStep {
  feature: HelpFeatureRecord;
  kind: ProjectFeatureNextStepKind;
  rationale: string;
  starterPrompt: string;
}

/**
 * Data-access capability: supplies live project data that help surfaces
 * interpolate into scenario copy (e.g. the feature list in "features-ready").
 */
export interface HelpDataCapability {
  features: readonly HelpFeatureRecord[];
  /**
   * Suggestions saved by feature-discovery onboarding, resolved to live
   * Features. Absent or empty when the project has none to show, which
   * leaves the invitation and walkthrough buttons out of the features step.
   */
  featureNextSteps?: readonly HelpFeatureNextStep[];
}

/**
 * Routing capability: resolves semantic destinations to concrete hrefs.
 * Seed scenarios don't carry CTAs yet, but the capability is wired so the
 * routing logic has a single home when they do.
 */
export interface HelpRoutingCapability {
  buildHref(intent: string): string;
}

/**
 * A renderable content block supplied by the platform for a given scenario.
 * The ui-common help views receive this opaquely and render it inline —
 * the concrete type (React element, string, etc.) is platform-determined.
 * Defined as `NonNullable<unknown>` so `undefined` is rejected and the only
 * way to say "no demo here" is the explicit `HELP_DEMO_FALLBACK` sentinel.
 */
export type PlatformDemo = NonNullable<unknown>;

/**
 * Sentinel value indicating the platform has no demo for a scenario.
 * Distinct from `undefined` so consumers can distinguish "not provided"
 * from "key missing" in a total map.
 */
export const HELP_DEMO_FALLBACK: unique symbol = Symbol("HELP_DEMO_FALLBACK");
export type HelpDemoFallback = typeof HELP_DEMO_FALLBACK;

/**
 * Maps every scenario id to either a platform-supplied demo or the fallback
 * sentinel. Because the type is `Record<HelpScenarioId, ...>`, adding a new
 * scenario to the union is a compile error until every platform fills it in.
 */
export type HelpDemoMap = Record<
  HelpScenarioId,
  PlatformDemo | HelpDemoFallback
>;

/**
 * Aggregate capabilities the host platform injects into the help provider.
 * All capabilities are required — a platform that mounts the help
 * surfaces must supply each one. Consumers that can tolerate the absence
 * of any help context altogether use `useOptionalHelp` instead.
 */
export interface HelpCapabilities {
  actions: HelpActionsCapability;
  data: HelpDataCapability;
  routing: HelpRoutingCapability;
  demos: HelpDemoMap;
}

export interface HelpActionCapability {
  status: "loading" | "ready" | "pending" | "error";
  error: string | null;
  execute: () => void;
  retry: () => void;
}
export type HelpActionsCapability = Record<HelpActionId, HelpActionCapability>;
