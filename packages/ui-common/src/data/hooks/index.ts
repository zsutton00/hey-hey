// Core conversation hooks
export { useConversation } from "./useConversation";
export {
  useConversationPhase,
  useConversationPhases,
} from "./useConversationPhase";
export type { UseConversationPhaseReturn } from "./useConversationPhase";
export { useConversationByWorkflow } from "./useConversationByWorkflow";
export { useConversationCliStatus } from "./useConversationCliStatus";
export type { UseConversationCliStatusReturn } from "./useConversationCliStatus";
export {
  useAgentSessionCurrentState,
  useAgentSessionCurrentStates,
} from "./useAgentSessionCurrentState";
export type {
  AgentSessionWithCurrentState,
  UseAgentSessionCurrentStateReturn,
  UseAgentSessionCurrentStatesReturn,
} from "./useAgentSessionCurrentState";
export {
  useAcknowledgeAgentSessionOutputAttention,
  useAgentSessionOutputAttentions,
} from "./useAgentSessionOutputAttention";
export { useMachineRepoBindings } from "./useMachineRepoBindings";
export { useLocalRepoBindings } from "./useLocalRepoBindings";
export { useConversations } from "./useConversations";

// Conversation mutation hooks
export { useCreateConversation } from "./useCreateConversation";
export { useDeleteConversation } from "./useDeleteConversation";
export { useInvalidateConversation } from "./useInvalidateConversation";
export { useSuggestionDecision } from "./useSuggestionDecision";
export { useStartConversation } from "./useStartConversation";
export { useRetryConversationOpenTrigger } from "./useRetryConversationOpenTrigger";
export type { RetryConversationOpenTriggerVariables } from "./useRetryConversationOpenTrigger";
export type {
  StartConversationVariables,
  UseStartConversationOptions,
} from "./useStartConversation";
export { useUpdateConversation } from "./useUpdateConversation";
export {
  useSubmitOnboardingReply,
  type SubmitOnboardingReplyVariables,
  type UseSubmitOnboardingReplyOptions,
} from "./useSubmitOnboardingReply";
export {
  useSubmitRepositoryImportReply,
  type SubmitRepositoryImportReplyVariables,
} from "./useSubmitRepositoryImportReply";

// Initiative hooks
export { useInitiative } from "./useInitiative";
export { useInitiativeEditHistory } from "./useInitiativeEditHistory";
export { useInitiativeRefinementData } from "./useInitiativeRefinementData";
export { useInitiativeReveal } from "./useInitiativeReveal";
export { useInitiatives } from "./useInitiatives";
export { useUpdateInitiativeContentByConversation } from "./useUpdateInitiativeContentByConversation";

// Project hooks
export { useProject } from "./useProject";
export { useProjectAutosave } from "./useProjectAutosave";
export { useProjectCounts } from "./useProjectCounts";
export { useProjectMetrics } from "./useProjectMetrics";
export type { UseProjectMetricsReturn } from "./useProjectMetrics";
export { useProjectSessionCosts } from "./useProjectSessionCosts";
export { useProviderUsage } from "./useProviderUsage";
export type {
  UseProviderUsageOptions,
  UseProviderUsageReturn,
} from "./useProviderUsage";
export type {
  ProjectSessionCostsCollectionResult,
  UseProjectSessionCostsOptions,
  UseProjectSessionCostsReturn,
} from "./useProjectSessionCosts";
export { useProjects } from "./useProjects";
export { useOrganizationProjectEntitlement } from "./useOrganizationProjectEntitlement";
export {
  useOrganizationsDirectory,
  OrganizationDirectorySortBy,
  OrganizationDirectorySortOrder,
} from "./useOrganizationsDirectory";
export { useAdminOrganizationDetail } from "./useAdminOrganizationDetail";
export {
  useMakeOrganizationBetaAccessOpenEnded,
  OrganizationEntitlementMutationError,
  type MakeOrganizationBetaAccessOpenEndedVariables,
  type OrganizationEntitlementMutationFailure,
  type UseMakeOrganizationBetaAccessOpenEndedOptions,
} from "./useMakeOrganizationBetaAccessOpenEnded";
export { useAdminOrganizationMembers } from "./useAdminOrganizationMembers";
export type {
  UseOrganizationsDirectoryOptions,
  UseOrganizationsDirectoryReturn,
  OrganizationsDirectoryKey,
  OrganizationsDirectoryQuery,
} from "./useOrganizationsDirectory";
export {
  useEntityStar,
  useEntityStars,
  type UseEntityStarReturn,
  type UseEntityStarsOptions,
  type UseEntityStarsReturn,
} from "./useEntityStars";
export { usePlanFromDesignDocConversation } from "./usePlanFromDesignDocConversation";
export type { UsePlanFromDesignDocConversationReturn } from "./usePlanFromDesignDocConversation";
export { useProjectPlans } from "./useProjectPlans";

// Design doc hooks
export { useAgentSession } from "./useAgentSession";
export { useAgentSessions } from "./useAgentSessions";
export { usePaginatedAgentSessions } from "./usePaginatedAgentSessions";
export { useCreateAgentSession } from "./useCreateAgentSession";
export { useCreateAgentSessionConversation } from "./useCreateAgentSessionConversation";
export { useResolveWorkItemCoordinator } from "./useResolveWorkItemCoordinator";
export { useSubmitTaskMonitorCommand } from "./useSubmitTaskMonitorCommand";
export { useControllerAuthorizedAction } from "./useControllerAuthorizedAction";
export { useSubmitControllerAuthorizedPermissionDecision } from "./useSubmitControllerAuthorizedPermissionDecision";
export type { BrowserPermissionDecisionRequest } from "./useSubmitControllerAuthorizedPermissionDecision";
export { useSubmitControllerAuthorizedQuestionAnswer } from "./useSubmitControllerAuthorizedQuestionAnswer";
export type { BrowserQuestionAnswerRequest } from "./useSubmitControllerAuthorizedQuestionAnswer";
export type {
  ControllerAuthorizedActionResult,
  ControllerAuthorizedActionSubmission,
  ControllerAuthorizedActionVariables,
  UseControllerAuthorizedActionOptions,
} from "./useControllerAuthorizedAction";
export { useUpdateCachedAgentSession } from "./useUpdateCachedAgentSession";
export { useCollabSectionClient } from "./useCollabSectionClient";
export { useCreateDesignDoc } from "./useCreateDesignDoc";
export { useDeleteDesignDoc } from "./useDeleteDesignDoc";
export { useDesignDoc } from "./useDesignDoc";
export { useDesignDocs } from "./useDesignDocs";
export { useGenerateSuggestedDesignDoc } from "./useGenerateSuggestedDesignDoc";
export { useProjectLibrary } from "./useProjectLibrary";
export {
  useCreateEntityPromptTemplateChangeProposal,
  useCreateEntityPromptTemplateRetirementProposal,
  useEffectiveEntityPromptTemplate,
  useEntityPromptTemplateCatalog,
  useEntityPromptTemplateEffective,
  useEntityPromptTemplateProposal,
  useEntityPromptTemplates,
} from "./useEntityPromptTemplates";
export type {
  CreateEntityPromptTemplateChangeProposalVariables,
  CreateEntityPromptTemplateRetirementProposalVariables,
  UseCreateEntityPromptTemplateChangeProposalOptions,
  UseCreateEntityPromptTemplateRetirementProposalOptions,
  UseEntityPromptTemplateCatalogOptions,
  UseEntityPromptTemplateCatalogReturn,
  UseEntityPromptTemplateEffectiveOptions,
  UseEntityPromptTemplateEffectiveReturn,
  UseEntityPromptTemplateProposalReturn,
} from "./useEntityPromptTemplates";
export {
  useReparentDesignDoc,
  DesignDocReparentValidationError,
} from "./useReparentDesignDoc";
export {
  useUpdateDesignDoc,
  UpdateDesignDocResultStatus,
} from "./useUpdateDesignDoc";

// Work item hooks (tasks and initiatives)
export { useFeatures } from "./useFeatures";
export type { UseFeaturesReturn } from "./useFeatures";
export { useFeatureTree } from "./useFeatureTree";
export {
  useFeatureHierarchy,
  useFeatureLookup,
  useFeatureTreePageData,
} from "./useFeatureHierarchy";
export { useFeatureDocumentContent } from "./useFeatureDocumentContent";
export type {
  FeatureAncestry,
  FeatureHierarchyNode,
  FeatureLookupEntry,
} from "./useFeatureHierarchy";
export type { UseFeatureTreeReturn, FeatureTreeNode } from "./useFeatureTree";
export { useHelpSearch } from "./useHelpSearch";
export type { UseHelpSearchReturn } from "./useHelpSearch";
export { useHelpNode } from "./useHelpNode";
export type { UseHelpNodeReturn } from "./useHelpNode";
export { useHelpTree } from "./useHelpTree";
export type { UseHelpTreeReturn } from "./useHelpTree";
export { useDeleteTask } from "./useDeleteTask";
export { useCanonicalPlanMutations } from "./useCanonicalPlanMutations";
export {
  useCanonicalPlanAggregate,
  type CanonicalPlanAggregate,
  type UseCanonicalPlanAggregateReturn,
} from "./useCanonicalPlanAggregate";
export { useSupersedeTask } from "./useSupersedeTask";
export { useTaskAllowedStatuses } from "./useTaskAllowedStatuses";
export { useTaskHierarchy } from "./useTaskHierarchy";
export { useWorkItem } from "./useWorkItem";
export { useWorkItemEditHistory } from "./useWorkItemEditHistory";
export { useWorkItemRefinementData } from "./useWorkItemRefinementData";
export { useWorkItemReveal } from "./useWorkItemReveal";
export { useWorkItems } from "./useWorkItems";
export {
  useProjectModeCatalog,
  type UseProjectModeCatalogInput,
  type UseProjectModeCatalogReturn,
} from "./useProjectModeCatalog";
export { useWorkItemUpdateMethods } from "./useWorkItemUpdateMethods";
export {
  useWorkItemGraphDraft,
  type UseWorkItemGraphDraftReturn,
} from "./useWorkItemGraphDraft";
export {
  SubmitWorkItemGraphProposalError,
  useSubmitWorkItemGraphProposal,
  type SubmitWorkItemGraphProposalErrorCode,
  type SubmitWorkItemGraphProposalInput,
  type UseSubmitWorkItemGraphProposalReturn,
  type WorkItemGraphProposalDraft,
} from "./useSubmitWorkItemGraphProposal";
export {
  useWorkItemGraphMetaLinkSearch,
  type UseWorkItemGraphMetaLinkSearchInput,
  type WorkItemGraphMetaLinkSearchIdleReason,
  type WorkItemGraphMetaLinkSearchState,
  type WorkItemGraphMetaLinkTarget,
} from "./useWorkItemGraphMetaLinkSearch";

// Staged content hooks (generic)
export { useStagedContentRefine } from "./useStagedContentRefine";
export { useStagedContentReveal } from "./useStagedContentReveal";

// ADR hooks
export { useAdrEditHistory } from "./useAdrEditHistory";
export { useAdrReveal } from "./useAdrReveal";
export { useCreateAdr } from "./useCreateAdr";
export { useUpdateAdr } from "./useUpdateAdr";

// Workflow hooks
export {
  useCorrelatedActivity,
  useCrossProjectActivity,
} from "./useCorrelatedActivity";
export { useSleepActivityCorrelation } from "./useSleepActivityCorrelation";
export { useLlmRequestStatus } from "./useLlmRequestStatus";
export {
  getReadStatusLabel,
  useNotificationPreferences,
  useNotifications,
} from "./useNotifications";
export { useOutboxEvents } from "./useOutboxEvents";
export { useDebugEventReplay } from "./useDebugEventReplay";
export { useUserWorkflows } from "./useUserWorkflows";
export { useWorkflowTimeline } from "./useWorkflowTimeline";

// Artifacts hooks
export { useArtifact } from "./useArtifact";
export { useArtifacts } from "./useArtifacts";

// Proposals hooks
export { useProposal } from "./useProposal";
export { useProposalGroup } from "./useProposalGroup";
export { useProposalGroupDecisions } from "./useProposalGroupDecisions";
export { useProposals } from "./useProposals";

// Message hooks
export { useConversationMessages } from "./useConversationMessages";
export type {
  UseConversationMessagesOptions,
  UseConversationMessagesReturn,
} from "./useConversationMessages";
export { useLatestMessage } from "./useLatestMessage";
export { useMessage } from "./useMessage";

// Topology hooks
export { useTopologyCategorySummaries } from "./useTopologyCategorySummaries";
export { useTopologyEntityRecord } from "./useTopologyEntityRecord";
export { useTopologyEntityGraph } from "./useTopologyEntityGraph";
export { useTopologyEntitySummaries } from "./useTopologyEntitySummaries";
export { useTopologyGraph } from "./useTopologyGraph";
export { useTopologySubfacets } from "./useTopologySubfacets";

// Analytics hooks
export { useAttentionEvents } from "./useAttentionEvents";

// User hooks
export { useUsers } from "./useUsers";
export { useInviteByEmail, DuplicateEmailError } from "./useInviteByEmail";
export { useProjectMembers } from "./useProjectMembers";
export {
  useAddProjectMember,
  DuplicateMembershipError,
} from "./useAddProjectMember";
export {
  useRemoveProjectMember,
  LastProjectOwnerError,
} from "./useRemoveProjectMember";
export {
  useRemoveOrganizationMember,
  LastOrganizationOwnerError,
} from "./useRemoveOrganizationMember";

// Integration hooks
export { useGitHubRepositories } from "./useGitHubRepositories";
export { useIntegration } from "./useIntegration";
export { useIntegrations } from "./useIntegrations";

// Service hooks
export { useCreateService } from "./useCreateService";
export { useProjectReports } from "./useProjectReports";
export { useProjectReportPreview } from "./useProjectReportPreview";
export {
  useCreateProjectReportRequest,
  useRetryProjectReportRequest,
} from "./useCreateProjectReportRequest";
export {
  PROJECT_REPORT_STATUS_POLL_INTERVAL_MS,
  useProjectReportRequestStatus,
} from "./useProjectReportRequestStatus";
export { useReport } from "./useReport";
export { useReports } from "./useReports";
export {
  useEvalAttemptOutput,
  useEvalHumanReviews,
  useEvalRun,
  useEvalRuns,
  useLaunchEvalRun,
  useSaveEvalHumanReview,
} from "./useEvalRuns";
export type {
  LaunchEvalRunVariables,
  SaveEvalHumanReviewVariables,
  UseEvalAttemptOutputReturn,
  UseEvalRunReturn,
} from "./useEvalRuns";
export { useEvalRunSession } from "./useEvalRunSession";
export type {
  EvalRunStartResult,
  StartEvalRunInput,
  UseEvalRunSessionReturn,
} from "./useEvalRunSession";
export { useFileReferenceCandidates } from "./useFileReferenceCandidates";
export type {
  FileTouchReferenceCandidateDto,
  FileReferenceCandidatesInput,
  FileReferenceCandidatesState,
} from "./useFileReferenceCandidates";
export type { FileReferenceScope } from "../collections/fileReferenceCandidates";
export {
  useWorkItemReferencePage,
  useWorkItemReferences,
} from "./useWorkItemReferences";
export type {
  WorkItemReferenceDto,
  UseWorkItemReferencePageInput,
  UseWorkItemReferencesInput,
  WorkItemReferencePageState,
  WorkItemReferencesState,
} from "./useWorkItemReferences";
export {
  useFileTaskHistory,
  useServiceFileHistory,
  useFileTouchHistory,
  useWorkItemFileHistory,
} from "./useFileTouchHistory";
export type {
  FeatureFileSection,
  FileHistoryFile,
  FileTaskHistoryEntry,
  FileTaskHistoryInput,
  FileTaskHistoryKey,
  FileTaskHistoryState,
  ServiceFileHistoryEntry,
  ServiceFileHistoryInput,
  ServiceFileHistoryKey,
  ServiceFileHistoryPage,
  ServiceFileHistoryState,
  SupportedFilesTabType,
  WorkItemFileHistory,
  WorkItemFileHistoryInput,
  WorkItemFileHistoryScope,
} from "./useFileTouchHistory";
export {
  FileTouchServiceHistorySortBy,
  FileTouchServiceHistorySortOrder,
} from "./useFileTouchHistory";
export { useService } from "./useService";
export { useServices } from "./useServices";
export { useProjectRole, useServiceLifecycle } from "./useServiceLifecycle";

// Work item type hooks
export {
  useAllowedChildWorkItemTypes,
  useAllowedParentEntityTypes,
  useCanParentEntityType,
  useTrackingTargetWorkItemTypes,
  useWorkItemTypeByKey,
  useWorkItemTypeRelationshipIndex,
  useWorkItemTypes,
  useWorkItemTypeTrackingEligibility,
} from "./useWorkItemTypes";
export { useCreateWorkItemType } from "./useCreateWorkItemType";
export {
  useArchiveWorkItemType,
  useEditWorkItemType,
  getCascadeImpactConflict,
  useHardDeleteWorkItemType,
  useMarkHardDeletedWorkItemTypeDataStale,
  useMarkWorkItemTypeDataStale,
  useRefreshWorkItemType,
  useRestoreWorkItemType,
  useResetWorkItemType,
  useWorkItemTypeCascadeImpact,
  useWorkItemTypeSectionContentImpact,
  useWorkItemTypeTrackingLinkRevocationImpact,
} from "./useWorkItemTypeLifecycle";

// Entity context hooks
export { useEntityContext } from "./useEntityContext";
export { useFullEntityContext } from "./useFullEntityContext";
export { useEntityNames, entityNameKey } from "./useEntityNames";

// Goal hooks
export { useActiveGoals } from "./useActiveGoals";
export { useAttachToGoal } from "./useAttachToGoal";
export { useDetachFromGoal } from "./useDetachFromGoal";

// search hooks
export { useUnifiedSearch } from "./useUnifiedSearch";

// Implementation Hints hooks
export { useDeleteImplementationHint } from "./useDeleteImplementationHint";
export { useImplementationHint } from "./useImplementationHint";
export { useImplementationHints } from "./useImplementationHints";

// Machines hooks
export { useUserPairedMachines } from "./useUserPairedMachines";
export type {
  UseUserPairedMachinesOptions,
  UseUserPairedMachinesReturn,
} from "./useUserPairedMachines";
export { useRevokeMachine } from "./useRevokeMachine";
export type {
  RevokeMachineVariables,
  UseRevokeMachineOptions,
} from "./useRevokeMachine";
export {
  useControllerInventory,
  type UseControllerInventoryOptions,
  type UseControllerInventoryReturn,
} from "./useControllerInventory";
export {
  useRevokeController,
  type RevokeControllerVariables,
  type UseRevokeControllerOptions,
} from "./useRevokeController";
export {
  ControllerManagementDenialError,
  isControllerManagementErrorDto,
  toControllerManagementError,
} from "./controllerManagementError";
export {
  useAbandonMachineEnrollmentClaim,
  type AbandonMachineEnrollmentClaimVariables,
  type UseAbandonMachineEnrollmentClaimOptions,
} from "./useAbandonMachineEnrollmentClaim";
export {
  useBeginMachineEnrollmentClaim,
  type BeginMachineEnrollmentClaimVariables,
  type UseBeginMachineEnrollmentClaimOptions,
} from "./useBeginMachineEnrollmentClaim";
export {
  useCompleteMachineEnrollmentClaim,
  type CompleteMachineEnrollmentClaimVariables,
  type UseCompleteMachineEnrollmentClaimOptions,
} from "./useCompleteMachineEnrollmentClaim";
export {
  MachineEnrollmentClaimError,
  toMachineEnrollmentClaimError,
  type MachineEnrollmentClaimErrorDto,
} from "./machineEnrollmentClaimError";

// Re-export types
// Conversation types
export type { UseConversationReturn } from "./useConversation";
export type {
  UseConversationByCategoryOptions,
  UseConversationByCategoryReturn,
} from "./useConversationByWorkflow";
export type {
  UseConversationsOptions,
  UseConversationsReturn,
} from "./useConversations";
export type {
  CreateConversationVariables,
  UseCreateConversationOptions,
} from "./useCreateConversation";
export type {
  DeleteConversationVariables,
  UseDeleteConversationOptions,
} from "./useDeleteConversation";
export type {
  SuggestionDecisionVariables,
  UseSuggestionDecisionOptions,
} from "./useSuggestionDecision";
export type {
  UpdateConversationVariables,
  UseUpdateConversationOptions,
} from "./useUpdateConversation";

// Initiative types
export type {
  UpdateInitiativeContentByConversationOptions,
  UpdateInitiativeContentByConversationVariables,
} from "./useUpdateInitiativeContentByConversation";

// Design doc types
export type {
  UseAgentSessionOptions,
  UseAgentSessionReturn,
} from "./useAgentSession";
export type {
  UseAgentSessionsOptions,
  UseAgentSessionsReturn,
} from "./useAgentSessions";
export type {
  UsePaginatedAgentSessionsOptions,
  UsePaginatedAgentSessionsReturn,
} from "./usePaginatedAgentSessions";
export type {
  CreateAgentSessionVariables,
  UseCreateAgentSessionOptions,
} from "./useCreateAgentSession";
export type {
  SleepActivityCorrelationVariables,
  UseSleepActivityCorrelationOptions,
} from "./useSleepActivityCorrelation";
export type {
  UseCollabSectionClientParams,
  UseCollabSectionClientReturn,
} from "./useCollabSectionClient";
export type {
  CreateDesignDocVariables,
  UseCreateDesignDocOptions,
} from "./useCreateDesignDoc";
export type {
  DeleteDesignDocVariables,
  UseDeleteDesignDocOptions,
} from "./useDeleteDesignDoc";
export type { UseDesignDocReturn } from "./useDesignDoc";
export type {
  UseDesignDocsOptions,
  UseDesignDocsReturn,
} from "./useDesignDocs";
export type {
  GenerateSuggestedDesignDocVariables,
  UseGenerateSuggestedDesignDocOptions,
} from "./useGenerateSuggestedDesignDoc";
export type {
  UpdateDesignDocVariables,
  UpdateDesignDocRequest,
  UpdateDesignDocResponseDto,
  UseUpdateDesignDocOptions,
} from "./useUpdateDesignDoc";
export type { UseReparentDesignDocReturn } from "./useReparentDesignDoc";

// Work item types
export type {
  UseDeleteTaskOptions,
  UseDeleteTaskReturn,
} from "./useDeleteTask";
export type {
  CanonicalPlanUpdateResult,
  UseCanonicalPlanMutationsReturn,
} from "./useCanonicalPlanMutations";
export type {
  UseSupersedeTaskParams,
  UseSupersedeTaskReturn,
} from "./useSupersedeTask";
export type {
  UseTaskAllowedStatusesParams,
  UseTaskAllowedStatusesReturn,
} from "./useTaskAllowedStatuses";
export type {
  UseTaskHierarchyOptions,
  UseTaskHierarchyReturn,
} from "./useTaskHierarchy";
export type { UseWorkItemReturn } from "./useWorkItem";
export type {
  UseWorkItemEditHistoryParams,
  UseWorkItemEditHistoryReturn,
} from "./useWorkItemEditHistory";
export type {
  UseWorkItemRefinementDataParams,
  UseWorkItemRefinementDataReturn,
} from "./useWorkItemRefinementData";
export type {
  UseWorkItemRevealParams,
  UseWorkItemRevealReturn,
} from "./useWorkItemReveal";
export type { UseWorkItemsReturn, WorkItemHookOptions } from "./useWorkItems";

// Staged content types (generic)
export type {
  UseStagedContentRefineProps,
  UseStagedContentRefineReturn,
} from "./useStagedContentRefine";
export type {
  UseStagedContentRevealProps,
  UseStagedContentRevealReturn,
} from "./useStagedContentReveal";

// ADR types
export type {
  UseAdrEditHistoryParams,
  UseAdrEditHistoryReturn,
} from "./useAdrEditHistory";
export type { UseAdrRevealProps, UseAdrRevealReturn } from "./useAdrReveal";
export type { UseOutboxEventsReturn } from "./useOutboxEvents";
export type {
  DebugEventReplayVariables,
  UseDebugEventReplayOptions,
  UseDebugEventReplayParams,
  UseDebugEventReplayReturn,
} from "./useDebugEventReplay";

// Artifact types
export type { UseArtifactOptions } from "./useArtifact";
export type { UseArtifactsOptions } from "./useArtifacts";

// Proposals types
export type { UseProposalReturn } from "./useProposal";
export type { UseProposalGroupReturn } from "./useProposalGroup";
export type {
  ProposalGroupApprovalResult,
  ProposalGroupRejectionResult,
  UseProposalGroupDecisionsOptions,
  UseProposalGroupDecisionsReturn,
} from "./useProposalGroupDecisions";
export type { UseProposalsOptions, UseProposalsReturn } from "./useProposals";

export type { UseLatestMessageReturn } from "./useLatestMessage";
export type { UseMessageReturn } from "./useMessage";
export type {
  UseProjectReportsOptions,
  UseProjectReportsReturn,
} from "./useProjectReports";
export type { UseProjectReportPreviewReturn } from "./useProjectReportPreview";
export type {
  CreateProjectReportRequestVariables,
  RetryProjectReportRequestVariables,
} from "./useCreateProjectReportRequest";
export type {
  UseProjectReportRequestStatusOptions,
  UseProjectReportRequestStatusReturn,
} from "./useProjectReportRequestStatus";
export type { UseReportReturn } from "./useReport";
export type {
  ReportsSortBy,
  ReportsSortDirection,
  UseReportsOptions,
  UseReportsReturn,
} from "./useReports";
export type {
  UseTopologyCategorySummariesOptions,
  UseTopologyCategorySummariesReturn,
} from "./useTopologyCategorySummaries";
export type {
  TopologyEntityRecordData,
  UseTopologyEntityRecordParams,
  UseTopologyEntityRecordReturn,
} from "./useTopologyEntityRecord";
export type {
  TopologyEntityGraphDirection,
  TopologyEntityGraphEdge,
  TopologyEntityGraphNode,
  UseTopologyEntityGraphOptions,
  UseTopologyEntityGraphReturn,
} from "./useTopologyEntityGraph";
export type {
  UseTopologyEntitySummariesOptions,
  UseTopologyEntitySummariesReturn,
} from "./useTopologyEntitySummaries";
export type {
  TopologyGraphEdge,
  TopologyGraphEdgeType,
  TopologyGraphNode,
  TopologyGraphNodeType,
  UseTopologyGraphOptions,
  UseTopologyGraphReturn,
} from "./useTopologyGraph";
export type {
  UseTopologySubfacetsOptions,
  UseTopologySubfacetsReturn,
} from "./useTopologySubfacets";

// Entity context types
export type {
  UseEntityContextParams,
  UseEntityContextReturn,
} from "./useEntityContext";
export type {
  UseActiveGoalsParams,
  UseActiveGoalsReturn,
} from "./useActiveGoals";
export type {
  AttachToGoalVariables,
  UseAttachToGoalParams,
  UseAttachToGoalReturn,
} from "./useAttachToGoal";
export type {
  DetachFromGoalVariables,
  UseDetachFromGoalParams,
  UseDetachFromGoalReturn,
} from "./useDetachFromGoal";
export type {
  UseFullEntityContextParams,
  UseFullEntityContextReturn,
} from "./useFullEntityContext";
export type {
  UseEntityNamesParams,
  UseEntityNamesReturn,
  EntityNameLookup,
} from "./useEntityNames";

// Analytics types
export type {
  UseAttentionEventsOptions,
  UseAttentionEventsReturn,
} from "./useAttentionEvents";

// User types
export type { UseUsersReturn } from "./useUsers";
export type {
  InviteByEmailVariables,
  UseInviteByEmailOptions,
} from "./useInviteByEmail";
export type { UseProjectMembersReturn } from "./useProjectMembers";
export type {
  AddProjectMemberVariables,
  UseAddProjectMemberOptions,
} from "./useAddProjectMember";
export type {
  RemoveProjectMemberVariables,
  UseRemoveProjectMemberOptions,
} from "./useRemoveProjectMember";
export type {
  RemoveOrganizationMemberVariables,
  UseRemoveOrganizationMemberOptions,
} from "./useRemoveOrganizationMember";

// Integration types
export type {
  UseGitHubRepositoriesOptions,
  UseGitHubRepositoriesReturn,
} from "./useGitHubRepositories";
export type { UseIntegrationOptions } from "./useIntegration";
export type { UseIntegrationsOptions } from "./useIntegrations";

// Workflow types
export type {
  CorrelatedActivityDisplayRecord,
  UseCrossProjectActivityInput,
  UseCrossProjectActivityOptions,
  UseCorrelatedActivityOptions,
  UseCorrelatedActivityReturn,
} from "./useCorrelatedActivity";
export type {
  UseNotificationPreferencesOptions,
  UseNotificationPreferencesReturn,
  UseNotificationsOptions,
  UseNotificationsReturn,
} from "./useNotifications";
export type { UseLlmRequestStatusReturn } from "./useLlmRequestStatus";

// Service types
export type { UseServiceReturn } from "./useService";
export type { UseServicesOptions, UseServicesReturn } from "./useServices";
export type { UseServiceLifecycleReturn } from "./useServiceLifecycle";

// Work item type types
export type {
  UseAllowedChildWorkItemTypesReturn,
  UseAllowedParentEntityTypesReturn,
  UseCanParentEntityTypeReturn,
  UseTrackingTargetWorkItemTypesReturn,
  UseWorkItemTypeRelationshipIndexReturn,
  UseWorkItemTypeTrackingEligibilityReturn,
  UseWorkItemTypesOptions,
  UseWorkItemTypesReturn,
  UseWorkItemTypeByKeyReturn,
} from "./useWorkItemTypes";
export type {
  CreateWorkItemTypeVariables,
  UseCreateWorkItemTypeOptions,
} from "./useCreateWorkItemType";
export type {
  ArchiveWorkItemTypeVariables,
  EditWorkItemTypeVariables,
  HardDeleteWorkItemTypeVariables,
  RefreshWorkItemTypeVariables,
  RestoreWorkItemTypeVariables,
  ResetWorkItemTypeVariables,
  UseArchiveWorkItemTypeOptions,
  UseEditWorkItemTypeOptions,
  UseHardDeleteWorkItemTypeOptions,
  UseRefreshWorkItemTypeOptions,
  UseRestoreWorkItemTypeOptions,
  UseResetWorkItemTypeOptions,
} from "./useWorkItemTypeLifecycle";
export type {
  UseProjectPlansOptions,
  UseProjectPlansReturn,
} from "./useProjectPlans";

// Implementation Hints types
export type {
  UseDeleteImplementationHintOptions,
  UseDeleteImplementationHintReturn,
} from "./useDeleteImplementationHint";
export type { UseImplementationHintReturn } from "./useImplementationHint";
export type {
  UseImplementationHintsOptions,
  UseImplementationHintsReturn,
} from "./useImplementationHints";

export { useWebSocketProvider } from "./useWebSocketProvider";
export { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";
export {
  usePrivateBetaAccessRequests,
  type UsePrivateBetaAccessRequestsReturn,
} from "./usePrivateBetaAccessRequests";
export {
  usePrivateBetaAccessRequest,
  type UsePrivateBetaAccessRequestReturn,
} from "./usePrivateBetaAccessRequest";
export {
  DEMO_SANDBOX_REFETCH_INTERVAL_MS,
  DemoSandboxProvisionError,
  useDemoSandbox,
  useDemoSandboxAdmission,
  type DemoSandboxProvisionFailure,
  type DemoSandboxStatusResult,
  type UseDemoSandboxAdmissionReturn,
  type UseDemoSandboxOptions,
  type UseDemoSandboxReturn,
} from "./useDemoSandbox";
export {
  usePrivateBetaDisclosure,
  type UsePrivateBetaDisclosureReturn,
} from "./usePrivateBetaDisclosure";
export {
  usePrivateBetaAccessRequestDecision,
  type PrivateBetaAccessRequestDecisionVariables,
  type UsePrivateBetaAccessRequestDecisionOptions,
  type UsePrivateBetaAccessRequestDecisionReturn,
} from "./usePrivateBetaAccessRequestDecision";
export {
  usePrivateBetaAdmissionMode,
  type UsePrivateBetaAdmissionModeReturn,
} from "./usePrivateBetaAdmissionMode";
export {
  useDemoSandboxAdmin,
  type UseDemoSandboxAdminReturn,
} from "./useDemoSandboxAdmin";
export { useAdminProjectHints } from "./useAdminProjectHints";
export { useAdminProjectImplementationHints } from "./useAdminProjectImplementationHints";
export {
  usePlatformAdminAccess,
  type UsePlatformAdminAccessReturn,
} from "./usePlatformAdminAccess";
export {
  useWorkItemGraph,
  type UseWorkItemGraphReturn,
} from "./useWorkItemGraph";
export * from "./useEntityPromptTemplateDraftValidation";

export { useGoalPmRoutingEnactment } from "./useGoalPmRoutingEnactment";
export type { GoalPmRoutingEnactmentVariables } from "./useGoalPmRoutingEnactment";
export { useOpenItems, type OpenItemsSnapshot } from "./useOpenItems";
export type { OpenItemsScope, OpenItemsOperation } from "../openItemsAdapter";
export type {
  OpenItemsBrowserRecord,
  OpenItemsRow,
  OpenItemsGroupRow,
} from "../openItemsModel";
export { readOpenItemsBrowserRecord } from "../openItemsBrowserRecord";
export { useOpenItemGoalWork } from "./useOpenItemGoalWork";
export { useOpenItemsTriageSession } from "./useOpenItemsTriageSession";
export { useTriageApplication } from "./useTriageApplication";
export { useTriageApplicationPorts } from "./useTriageApplicationPorts";
export { useInvalidateProposalReview } from "./useInvalidateProposalReview";
export {
  useApplyProposalFuture,
  type UseApplyProposalFutureReturn,
} from "./useApplyProposalFuture";
