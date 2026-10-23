export {
  HELP_SCENARIO_CATALOG,
  getFeatureDiscoveryWelcomeCatalog,
  getHelpScenario,
} from "./helpScenarioCatalog";
export type {
  HelpActionId,
  HelpScenarioId,
  HelpScenarioEntry,
  HelpScenarioFeatureNextStepsCopy,
  HelpScenarioTemplatedCopy,
  HelpScenarioCta,
  HelpScenarioCheckpoint,
  HelpScenarioCheckpointSlot,
} from "./helpScenarioCatalog";
export type { HelpScenarioDisplayEntry } from "./helpContentTypes";

export { HELP_DEMO_FALLBACK } from "./helpCapabilities";
export type {
  HelpActionCapability,
  HelpActionsCapability,
  HelpFeatureNextStep,
  HelpFeatureRecord,
  HelpDataCapability,
  HelpRoutingCapability,
  PlatformDemo,
  HelpDemoFallback,
  HelpDemoMap,
  HelpCapabilities,
} from "./helpCapabilities";

export { HelpProvider, useHelp, useOptionalHelp } from "./HelpContext";
export type { HelpProviderProps } from "./HelpContext";

export { IntroHelpView } from "./IntroHelpView";
export { DeepHelpView } from "./DeepHelpView";
export type { DeepHelpViewProps } from "./DeepHelpView";
export { HelpScenarioCard } from "./HelpScenarioCard";
export type { HelpScenarioCardProps } from "./HelpScenarioCard";
export {
  mapHelpSearchResultsToTopicList,
  mapHelpTreeToTopicList,
  resolveProjectHelpRootIdentities,
  selectProjectHelpTree,
} from "./helpContentSource";
export type {
  HelpTopicListItem,
  ProjectHelpRootIdentities,
  ProjectHelpSection,
} from "./helpContentSource";
export { HelpTopicCard } from "./HelpTopicCard";
export type { HelpTopicCardProps } from "./HelpTopicCard";
export {
  HelpTableOfContents,
  getHelpTopicAnchorId,
} from "./HelpTableOfContents";
export type { HelpTableOfContentsProps } from "./HelpTableOfContents";
