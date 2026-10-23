// Project hooks
export { useProjectDeletion } from "./useProjectDeletion";
export { useProjectFilter } from "./useProjectFilter";

// User hooks
export { useUserIdentity } from "./useUserIdentity";

// Editor context hooks
export { useProjectIds } from "./useEditorContext";
export type { EditorContextData } from "./useEditorContext";

// UI hooks
export { useDoubleSpaceModal } from "./useDoubleSpaceModal";
export { useReducedMotion, useAnimationConfig } from "./useReducedMotion";
export { useCanHover } from "./useCanHover";
export { useAnimationCleanup } from "./useAnimationCleanup";
export { useTypingAnimation } from "./useTypingAnimation";
export { useAppDimensions } from "./useAppDimensions";
export { useColumnScroll } from "./useColumnScroll";
export { useScrollPerformance } from "./useScrollPerformance";
export { usePositionPersistence } from "./usePositionPersistence";
export { useWalkthrough } from "./useWalkthrough";

// Workflow hooks
export { useWorkflowStatus } from "./useWorkflowStatus";
export { useWorkflowStatusMonitoring } from "./useWorkflowStatusMonitoring";
// Re-export all workflow data hooks
export {
  workflowKeys,
  useWorkflowTemplates,
  useWorkflowTemplate,
  useWorkflowTemplateStructure,
  useWorkflowTemplateMetrics,
  useWorkflowMetrics,
  useWorkflowAnalytics,
  useWorkflowExecutions,
  useValidateWorkflowTemplate,
  useSimulateWorkflow,
  useExecuteWorkflow,
  useDebugWorkflow,
  usePrefetchWorkflow,
  useWorkflowCache,
  useWorkflowNodeDetail,
  useTestWorkflowNode,
  useWorkflowMonitoring,
  useWorkflowHealth,
  useWorkflowAlerts,
  useContextVersions,
  useCreateContextSnapshot,
  useRollbackContextVersion,
  useAgentCoordination,
  useCoordinationEvents,
} from "./useWorkflowData";

// Utility hooks
export { useActionGuard } from "./useActionGuard";
export { useAutoSave } from "./useAutoSave";
export { useAutoTracking } from "./useAutoTracking";
export { useMessageRetry } from "./useMessageRetry";
export { useRetryWithBackoff } from "./useRetryWithBackoff";
export { useSearchCommand } from "./useSearchCommand";
export { useTrackingIntegration } from "./useTrackingIntegration";

// Attention tracking hooks
export { useAttention } from "./useAttention";
export { useNavigationAttention } from "./useNavigationAttention";
export { useAttentionHeartbeat } from "./useAttentionHeartbeat";

// Code analysis hooks
export {
  useCodebaseContext,
  getTechStackSuggestions,
  getIntegrationSuggestions,
} from "./useCodebaseContext";

// Integration hooks
export { useIntegrationService } from "./useIntegrationService";

// Debug hooks
export { useDebugContext } from "./useDebugContext";
export { useUnifiedDebug } from "./useUnifiedDebug";

// Authentication hooks
export {
  useRole,
  usePermissions,
  useOrganizationOwner,
  useProjectCapabilities,
  projectCapabilitiesForRole,
} from "./auth";
export type {
  UserRole,
  Permissions,
  Permission,
  OrganizationOwnerStatus,
  ProjectCapabilities,
} from "./auth";

// Runtime hooks

// Re-export types
export type {
  CodebaseContext,
  UseCodebaseContextReturn,
} from "./useCodebaseContext";
