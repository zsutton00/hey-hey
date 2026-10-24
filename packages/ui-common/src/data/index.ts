// Export all data hooks
export {
  useApplyProposalFuture,
  type UseApplyProposalFutureReturn,
} from "./hooks/useApplyProposalFuture";
export * from "./hooks/useAccountDefaultOrganization";
export { isInitiative, isTask } from "./collections/workItems";
export type { WorkItemResponseDto } from "./collections/workItems";
export * from "./featureReferenceIndex";
export {
  fetchAllWorkItemReferences,
  fetchWorkItemReferencePage,
  isWorkItemReference,
  parseWorkItemReferencePage,
  workItemReferenceKeys,
  workItemReferencesQueryOptions,
  WORK_ITEM_REFERENCE_CACHE_AGE_MS,
  WORK_ITEM_REFERENCE_PAGE_LIMIT,
} from "./collections/workItemReferences";
export type {
  WorkItemReferenceDto,
  WorkItemReferenceScope,
} from "./collections/workItemReferences";
export {
  dataLayerQueryRoots,
  invalidateAllDataLayerQueries,
  invalidateProjectWorkItemQueries,
} from "./query/dataLayerInvalidation";
export { DataHooksProvider } from "./DataHooksProvider";
export {
  buildCrossProjectActivityRequest,
  activityKeys,
  correlatedActivityQueryOptions,
  crossProjectActivityQueryOptions,
  fetchCrossProjectActivityPage,
  mapCorrelatedActivityRecord,
  mapEntityCorrelatedActivityRecords,
} from "./collections/activityCorrelations";
export type {
  CrossProjectActivityFetchParams,
  CrossProjectActivityFilterParams,
  CrossProjectActivityMetricParams,
  CrossProjectActivityHistoryParams,
  CrossProjectActivityQueryParams,
  OrganizationActivityFilterParams,
  OrganizationActivityMetricParams,
  OrganizationActivityParams,
} from "./collections/activityCorrelations";
export {
  entityStarKeys,
  entityStarsQueryOptions,
  fetchEntityStars,
  filterEntityStars,
} from "./collections/entityStars";
export {
  buildRunEvalStartPayload,
  isEvalAttemptReport,
  isEvalHumanReviewReport,
  type EvalAttemptOutput,
  isEvalRunReport,
} from "./collections/evalRuns";
export type {
  EvalAttemptReport,
  EvalHumanReviewReport,
  EvalRunReport,
} from "./collections/evalRuns";
export * from "./collections/organizationsDirectory";
export * from "./collections/adminOrganizationDetail";
export * from "./collections/adminOrganizationMembers";
export * from "./collections/projectMetrics";
export type { ProjectMetricsQueryParams } from "./collections/projectMetrics";
export { ControllerAuthorizationPromptHost } from "./controllerAuthorization/controllerAuthorizationPrompt";
export {
  analyzeWorkItemTypeEdit,
  classifyWorkItemTypeEdit,
  resolveWorkItemTypeKey,
} from "./workItemTypeEditClassification";
export * from "./workItemTypeRelationshipIndex";
export * from "./projectWorkspaceNavigation";
export * from "./hooks";
export {
  privateBetaDisclosureKeys,
  privateBetaDisclosureQueryOptions,
} from "./collections/privateBetaDisclosure";
export * from "./collections/privateBetaAdmissionMode";
export {
  demoSandboxKeys,
  demoSandboxQueryOptions,
} from "./collections/demoSandbox";
export {
  adminProjectImplementationHintsKeys,
  adminProjectImplementationHintsQueryOptions,
} from "./collections/adminProjectImplementationHints";
export {
  platformAdminAccessKeys,
  platformAdminAccessQueryOptions,
} from "./collections/platformAdminAccess";
export {
  hasDemoSandboxSession,
  markDemoSandboxSession,
} from "./demoSandboxSession";
export * from "./controllerAuthorization/webauthnAssertion";
export * from "./controllerAuthorization/controllerAuthorizationPreference";
export {
  isEntityPromptTemplateCatalogEntry,
  isEntityPromptTemplateEffective,
  promptTemplateKeys,
  entityPromptTemplateCatalogQueryOptions,
  entityPromptTemplateEffectiveQueryOptions,
  refetchEntityPromptTemplateProjections,
  selectCanonicalEntityPromptTemplate,
  selectEffectiveEntityPromptTemplate,
  selectEntityPromptTemplateCanonical,
  selectEntityPromptTemplateEffective,
  selectEntityPromptTemplateProjectOverride,
  selectEntityPromptTemplateRevisionHistory,
  selectProjectOverrideEntityPromptTemplate,
  selectRevisionHistoryEntityPromptTemplate,
} from "./collections/entityPromptTemplates";
export type {
  EntityPromptTemplateCollectionItem,
  EntityPromptTemplateCatalogIdentity,
  EntityPromptTemplateProjectionIdentity,
} from "./collections/entityPromptTemplates";
export { getEntityPromptTemplateCompositionMetadata } from "./entityPromptTemplateComposition";
export type {
  EntityPromptTemplateCompositionLayerMetadata,
  EntityPromptTemplateCompositionMetadata,
} from "./entityPromptTemplateComposition";
export * from "./relationships";

// Keep the project-admin lifecycle surface explicit at the supported data
// entry point. The UI imports this public barrel, not the hook module directly.
export {
  getCascadeImpactConflict,
  useHardDeleteWorkItemType,
  useMarkHardDeletedWorkItemTypeDataStale,
  useRefreshWorkItemType,
  useRestoreWorkItemType,
  useWorkItemTypeCascadeImpact,
} from "./hooks/useWorkItemTypeLifecycle";

// Export WebSocket debug utilities
export { useWebSocketDebug, useWebSocketDebugger } from "./websockets/debug";
export type {
  WebSocketEvent,
  WebSocketDebugState,
  WebSocketEventFilter,
  EnhancedWebSocketEventFilter,
  CollectionDebugState,
} from "./websockets/debug";
export {
  PLAN_CONFIGURATION_SECTION_KEY,
  PLAN_STAGE_WORK_ITEM_TYPE,
  PLAN_WORK_ITEM_TYPE,
  STANDARD_WORK_ITEM_TYPE,
  buildCanonicalPlanTaskGraph,
  composeCanonicalPlanAggregate,
  isPlanStageStandardTask,
  isPlanStageWorkItem,
  isPlanWorkItem,
  parseCanonicalPlanStageSource,
  validateCanonicalPlanRegistry,
} from "./plans/canonicalPlan";
export type {
  CanonicalPlanSourceError,
  CanonicalPlanAggregateError,
  CanonicalPlanRecoveryContext,
  CanonicalPlanAggregate,
  CanonicalPlanAggregateResult,
  CanonicalPlanAggregateStage,
  CanonicalPlanStageSource,
  CanonicalPlanStageSourceResult,
  CanonicalPlanTaskGraph,
  PlanStageStandardTask,
  PlanStageWorkItem,
  PlanWorkItem,
} from "./plans/canonicalPlan";
export { useGoalPmRoutingDecision } from "./hooks/useGoalPmRoutingDecision";
export { useOpenItemsTriageSession } from "./hooks/useOpenItemsTriageSession";
export { useTriageApplication } from "./hooks/useTriageApplication";
export { useTriageApplicationPorts } from "./hooks/useTriageApplicationPorts";
export { TriageApplicationCoordinator } from "./triage/application";
export type {
  TriageApplicationPorts,
  TriageOutcome,
  TriageTarget,
  TriagePromotionIntent,
} from "./triage/application";

export { FutureOfferProvider } from "./futureOffers/FutureOfferProvider";
