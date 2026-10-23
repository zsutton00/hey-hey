# Unused OpenAPI content: record and decisions

Produced by `npm run analyze:unused` (`scripts/find-unused-spec-content.js`); rerun it for current numbers. Removals were made with `scripts/remove-unused-spec-content.js`.

## What was removed

26 operations and 583 unused definitions were removed from the active specs (12 of the operations in the agents spec were kept because the API still generates models from them). Spec lines went from 44,851 to 42,326.

## Generation time (generator runs only, `npm run measure:generation`)

| Generation | Before (s) | After (s) |
|---|---|---|
| API service models (typescript-nestjs, API spec) | 565.1 | 468.1 |
| UI Common / CLI client (typescript-axios, API spec) | 398.7 | 242.1 |
| Graph Java events client | 54.5 | 34.6 |
| Embeddings Python events models | 47.2 | 25.0 |
| Embeddings own spec | 28.3 | 1.0 |
| Others (validation, agent-bridge, local, Graph Spring) | 40.7 | 29.6 |
| **Total** | **1134.5** | **800.4** |

The "before" run overlapped with other jobs on the machine, so the small entries are noisy.

## Still to evaluate: operations with a server handler and no caller

Listed below with the handler file. Some are called from outside the repos (webhooks, health, MCP, admin tools), so they may be needed. Nothing here was removed.

## Operations with a server handler but no caller (85)

- `api` GET /organizations/{organizationId}/projects/{projectId}/project-report-requests/{requestId}/context (getProjectReportContextPage) [ProjectReports] — specs/api/openapi.yaml:374
  handler: src/controllers/project-report-request.controller.ts
- `api` POST /payment-providers/{provider}/{environment}/webhook (receivePaymentProviderWebhook) [PaymentProviderWebhooks] — specs/api/openapi.yaml:931
  handler: src/controllers/payment-provider-webhook.controller.ts
- `api` POST /webhooks/github/{integrationId} (acceptGitHubWebhook) [Webhooks] — specs/api/openapi.yaml:986
  handler: src/controllers/webhook.controller.ts
- `api` POST /admin/private-beta-access/close (closePrivateBetaAccess) [PrivateBetaAccess] — specs/api/openapi.yaml:1325
  handler: src/controllers/private-beta-access-program.controller.ts
- `api` POST /organizations/{organizationId}/cancel (cancelOrganizationAccount) [Organizations] — specs/api/openapi.yaml:1930
  handler: src/controllers/organization.controller.ts
- `api` GET /organizations/{organizationId}/account-lifecycle (getOrganizationAccountLifecycle) [Organizations] — specs/api/openapi.yaml:1973
  handler: src/controllers/organization.controller.ts
- `api` POST /organizations/{organizationId}/reactivate (reactivateOrganizationAccount) [Organizations] — specs/api/openapi.yaml:2010
  handler: src/controllers/organization.controller.ts
- `api` POST /organizations/{organizationId}/members/bulk-invite (bulkInviteToOrganization) [Organizations] — specs/api/openapi.yaml:2146
  handler: src/controllers/organization.controller.ts
- `api` GET /organizations/{organizationId}/projects/{projectId}/features (listProjectFeatures) [EntityContext] — specs/api/openapi.yaml:2629
  handler: src/controllers/entity-context.controller.ts
- `api` GET /organizations/{organizationId}/projects/{projectId}/features/skeleton (getProjectFeaturesSkeleton) [EntityContext] — specs/api/openapi.yaml:2693
  handler: src/controllers/entity-context.controller.ts
- `api` GET /organizations/{organizationId}/projects/{projectId}/reports/file-history/by-work (listReportFileHistoryByWork) [Reports] — specs/api/openapi.yaml:3116
  handler: src/controllers/report.controller.ts
- `api` GET /organizations/{organizationId}/projects/{projectId}/entities/{entityType}/{entityId}/dependent-tasks (getDependentTasks) [EntityContext] — specs/api/openapi.yaml:3292
  handler: src/controllers/entity-context.controller.ts
- `api` POST /organizations/{organizationId}/projects/{projectId}/search/batch (unifiedSearchBatch) [Search] — specs/api/openapi.yaml:3434
  handler: src/controllers/unified-search.controller.ts
- `api` GET /organizations/{organizationId}/projects/{projectId}/topology/graph-topology (getTopologyGraphTopology) [Topology] — specs/api/openapi.yaml:3647
  handler: src/controllers/topology.controller.ts
- `api` GET /organizations/{organizationId}/projects/{projectId}/topology/audits/subfacet-summary (listTopologySubfacetSummaryAudits) [Topology] — specs/api/openapi.yaml:3848
  handler: src/controllers/topology.controller.ts
- `api` POST /organizations/{organizationId}/initiatives/{initiativeId}/projects/{projectId} (linkProjectToInitiative) [Initiatives] — specs/api/openapi.yaml:4143
  handler: src/controllers/initiative.controller.ts
- `api` DELETE /organizations/{organizationId}/initiatives/{initiativeId}/projects/{projectId} (unlinkProjectFromInitiative) [Initiatives] — specs/api/openapi.yaml:4143
  handler: src/controllers/initiative.controller.ts
- `api` GET /organizations/{organizationId}/initiatives/{initiativeId}/refinement/status (getInitiativeRefinementStatus) [Initiatives] — specs/api/openapi.yaml:4261
  handler: src/controllers/initiative.controller.ts
- `api` POST /organizations/{organizationId}/initiatives/{initiativeId}/refinement/complete (completeInitiativeRefinement) [Initiatives] — specs/api/openapi.yaml:4307
  handler: src/controllers/initiative.controller.ts
- `api` GET /organizations/{organizationId}/projects/{projectId}/work-items/{taskId}/dependencies (organizationsOrganizationIdProjectsProjectIdTasksTaskIdDependenciesGet) [Tasks] — specs/api/openapi.yaml:5850
  handler: src/controllers/task.controller.ts
- `api` POST /organizations/{organizationId}/projects/{projectId}/work-items/{taskId}/dependencies (organizationsOrganizationIdProjectsProjectIdTasksTaskIdDependenciesPost) [Tasks] — specs/api/openapi.yaml:5850
  handler: src/controllers/task.controller.ts
- `api` DELETE /organizations/{organizationId}/projects/{projectId}/work-items/{taskId}/dependencies/{dependencyId} (organizationsOrganizationIdProjectsProjectIdTasksTaskIdDependenciesDependencyIdDelete) [Tasks] — specs/api/openapi.yaml:5926
  handler: src/controllers/task.controller.ts
- `api` PATCH /organizations/{organizationId}/projects/{projectId}/work-items/{taskId}/dependencies/{dependencyId} (organizationsOrganizationIdProjectsProjectIdTasksTaskIdDependenciesDependencyIdPatch) [Tasks] — specs/api/openapi.yaml:5926
  handler: src/controllers/task.controller.ts
- `api` GET /organizations/{organizationId}/projects/{projectId}/user-settings/{settingsFamily} (getProjectUserSettings) [UserSettings] — specs/api/openapi.yaml:6965
  handler: src/controllers/user-settings.controller.ts
- `api` PUT /organizations/{organizationId}/projects/{projectId}/user-settings/{settingsFamily} (replaceProjectUserSettings) [UserSettings] — specs/api/openapi.yaml:6965
  handler: src/controllers/user-settings.controller.ts
- `api` POST /organizations/{organizationId}/projects/{projectId}/work-tracker-import/conversations/{conversationId}/replies (submitWorkTrackerImportReply) [Conversations] — specs/api/openapi.yaml:9577
  handler: src/controllers/work-tracker-import-reply.controller.ts
- `api` GET /organizations/{organizationId}/projects/{projectId}/conversations/{conversationId}/available-skip-nodes (getAvailableSkipNodes) [Conversations] — specs/api/openapi.yaml:10497
  handler: src/controllers/conversation.controller.ts
- `api` GET /organizations/{organizationId}/projects/{projectId}/initiative-refinement/initiatives/{initiativeId} (getOrCreateInitiativeRefinementSession) [Initiatives] — specs/api/openapi.yaml:10937
  handler: src/controllers/initiative-refinement.controller.ts
- `api` POST /organizations/{organizationId}/projects/{projectId}/initiative-refinement/conversations/{conversationId}/initiatives/{initiativeId}/refine (refineInitiativeByConversation) [Conversations] — specs/api/openapi.yaml:11012
  handler: src/controllers/initiative-refinement.controller.ts
- `api` POST /organizations/{organizationId}/projects/{projectId}/initiative-refinement/conversations/{conversationId}/initiatives/{initiativeId}/finalize (finalizeInitiativeByConversation) [Conversations] — specs/api/openapi.yaml:11258
  handler: src/controllers/initiative-refinement.controller.ts
- `api` POST /organizations/{organizationId}/projects/{projectId}/work-items/{entityType}/{entityId}/refinement/advance (advanceWorkItemLevel) [WorkItemRefinement] — specs/api/openapi.yaml:11513
  handler: src/controllers/work-item-refinement.controller.ts
- `api` POST /organizations/{organizationId}/projects/{projectId}/work-items/{entityType}/{entityId}/refinement/finalize (finalizeWorkItemRefinement) [WorkItemRefinement] — specs/api/openapi.yaml:11602
  handler: src/controllers/work-item-refinement.controller.ts
- `api` GET /organizations/{organizationId}/projects/{projectId}/work-items/{entityType}/{entityId}/refinement/status (getWorkItemRefinementStatus) [WorkItemRefinement] — specs/api/openapi.yaml:11688
  handler: src/controllers/work-item-refinement.controller.ts
- `api` POST /organizations/{organizationId}/projects/{projectId}/staged-content/{contentType}/{entityId}/finalize (finalizeStagedContent) [StagedContent] — specs/api/openapi.yaml:11894
  handler: src/controllers/staged-content-refinement.controller.ts
- `api` POST /organizations/{organizationId}/tags/sync/artifacts (syncAllArtifactTags) [Artifacts] — specs/api/openapi.yaml:12704
  handler: src/controllers/tag.controller.ts
- `api` GET /organizations/{organizationId}/artifacts/{artifactId}/tags (getArtifactTags) [Artifacts] — specs/api/openapi.yaml:12735
  handler: src/controllers/tag.controller.ts
- `api` POST /organizations/{organizationId}/artifacts/{artifactId}/tags (assignTagToArtifact) [Artifacts] — specs/api/openapi.yaml:12735
  handler: src/controllers/tag.controller.ts
- `api` POST /organizations/{organizationId}/artifacts/{artifactId}/tags/sync (syncArtifactTagsFromStringArray) [Artifacts] — specs/api/openapi.yaml:12815
  handler: src/controllers/tag.controller.ts
- `api` DELETE /organizations/{organizationId}/artifacts/{artifactId}/tags/{tagId} (removeTagFromArtifact) [Artifacts] — specs/api/openapi.yaml:12846
  handler: src/controllers/tag.controller.ts
- `api` GET /organizations/{organizationId}/projects/{projectId}/tags (getProjectTags) [Tags] — specs/api/openapi.yaml:12885
  handler: src/controllers/tag.controller.ts
- `api` POST /organizations/{organizationId}/projects/{projectId}/tags (assignTagToProject) [Tags] — specs/api/openapi.yaml:12885
  handler: src/controllers/tag.controller.ts
- `api` DELETE /organizations/{organizationId}/projects/{projectId}/tags/{tagId} (removeTagFromProject) [Tags] — specs/api/openapi.yaml:12965
  handler: src/controllers/tag.controller.ts
- `api` POST /jev/evaluate-choice (evaluateJevChoice) [Jev] — specs/api/openapi.yaml:14509
  handler: src/controllers/typesafe-jev.controller.ts
- `api` GET /debug/topology/schedule (getDebugTopologySchedule) [DebugAdmin] — specs/api/openapi.yaml:15291
  handler: src/controllers/topology.controller.ts
- `api` POST /debug/topology/schedule (upsertDebugTopologySchedule) [DebugAdmin] — specs/api/openapi.yaml:15291
  handler: src/controllers/topology.controller.ts
- `api` PATCH /debug/topology/schedule (patchDebugTopologySchedule) [DebugAdmin] — specs/api/openapi.yaml:15291
  handler: src/controllers/topology.controller.ts
- `api` GET /debug/topology/schedule/runs (listDebugTopologyScheduleRuns) [DebugAdmin] — specs/api/openapi.yaml:15383
  handler: src/controllers/topology.controller.ts
- `api` POST /debug/topology/schedule/run-now (triggerDebugTopologyScheduleNow) [DebugAdmin] — specs/api/openapi.yaml:15426
  handler: src/controllers/topology.controller.ts
- `api` GET /debug/topology/subfacet-candidates (listDebugTopologySubfacetCandidates) [DebugAdmin] — specs/api/openapi.yaml:15457
  handler: src/controllers/topology.controller.ts
- `api` GET /debug/topology/lifecycle-summary (getDebugTopologyLifecycleSummary) [DebugAdmin] — specs/api/openapi.yaml:15511
  handler: src/controllers/topology.controller.ts
- `api` GET /debug/projects/conversations (getProjectConversationsDebug) [DebugAdmin] — specs/api/openapi.yaml:15597
  handler: src/controllers/debug.controller.ts
- `api` GET /debug/projects/artifacts (getProjectArtifactsDebug) [DebugAdmin] — specs/api/openapi.yaml:15639
  handler: src/controllers/debug.controller.ts
- `api` GET /debug/projects/messages (getProjectMessagesDebug) [DebugAdmin] — specs/api/openapi.yaml:15681
  handler: src/controllers/debug.controller.ts
- `api` POST /debug/events/{eventId}/retrigger (retriggerDebugEvent) [DebugAdmin] — specs/api/openapi.yaml:15881
  handler: src/controllers/debug.controller.ts
- `api` GET /debug/websocket/subscriptions (getWebSocketSubscriptions) [DebugAdmin] — specs/api/openapi.yaml:16056
  handler: src/controllers/debug.controller.ts
- `api` GET /debug/websocket/channels (getWebSocketChannels) [DebugAdmin] — specs/api/openapi.yaml:16070
  handler: src/controllers/debug.controller.ts
- `api` GET /debug/websocket/connections/{connectionId} (getWebSocketConnection) [DebugAdmin] — specs/api/openapi.yaml:16115
  handler: src/controllers/debug.controller.ts
- `api` GET /llm-tracking/stats (getLlmTrackingStats) [DebugAdmin] — specs/api/openapi.yaml:16449
  handler: src/controllers/llm-tracking.controller.ts
- `api` POST /organizations/{organizationId}/projects/{projectId}/agent-interactions (admitAgentInteraction) [AgentSessions] — specs/api/openapi.yaml:18310
  handler: src/controllers/agent-interaction.controller.ts
- `api` POST /organizations/{organizationId}/projects/{projectId}/agent-sessions/{agentSessionId}/turn-admissions/{admissionId}/settled-turns (settleAgentSessionTurnAdmission) [AgentSessions] — specs/api/openapi.yaml:18571
  handler: src/controllers/agent-interaction.controller.ts
- `api` POST /organizations/{organizationId}/projects/{projectId}/agent-sessions/current-state:batch (batchReadAgentSessionCurrentState) [AgentSessions] — specs/api/openapi.yaml:18717
  handler: src/controllers/agent-session-current-state.controller.ts
- `api` POST /organizations/{organizationId}/projects/{projectId}/agent-sessions/output-attention:batch (batchReadAgentSessionOutputAttention) [AgentSessions] — specs/api/openapi.yaml:18767
  handler: src/controllers/agent-session-output-attention.controller.ts
- `api` POST /organizations/{organizationId}/projects/{projectId}/agent-sessions/{agentSessionId}/service-grants (grantAgentSessionServices) [AgentSessions] — specs/api/openapi.yaml:19176
  handler: src/controllers/agent-session.controller.ts
- `api` POST /organizations/{organizationId}/projects/{projectId}/agent-sessions/{agentSessionId}/compact (compactAgentSessionRun) [AgentSessions] — specs/api/openapi.yaml:19487
  handler: src/controllers/agent-session.controller.ts
- `api` GET /organizations/{organizationId}/validation-sessions (listValidationSessions) [ValidationSessions] — specs/api/openapi.yaml:19696
  handler: src/controllers/validation-session.controller.ts
- `api` POST /organizations/{organizationId}/validation-sessions (createValidationSession) [ValidationSessions] — specs/api/openapi.yaml:19696
  handler: src/controllers/validation-session.controller.ts
- `api` GET /organizations/{organizationId}/validation-sessions/{id} (getValidationSession) [ValidationSessions] — specs/api/openapi.yaml:19772
  handler: src/controllers/validation-session.controller.ts
- `api` PATCH /organizations/{organizationId}/validation-sessions/{id} (updateValidationSession) [ValidationSessions] — specs/api/openapi.yaml:19772
  handler: src/controllers/validation-session.controller.ts
- `api` POST /organizations/{organizationId}/projects/{projectId}/proposal-groups/{groupId}/members (addProposalGroupMember) [Proposals] — specs/api/openapi.yaml:21341
  handler: src/controllers/proposal-group-authoring.controller.ts
- `api` PUT /organizations/{organizationId}/projects/{projectId}/proposal-groups/{groupId}/members/{memberId} (updateProposalGroupMember) [Proposals] — specs/api/openapi.yaml:21384
  handler: src/controllers/proposal-group-authoring.controller.ts
- `api` PUT /organizations/{organizationId}/projects/{projectId}/proposal-groups/{groupId}/members/{memberId}/prerequisites (replaceProposalGroupMemberPrerequisites) [Proposals] — specs/api/openapi.yaml:21459
  handler: src/controllers/proposal-group-authoring.controller.ts
- `api` GET /mcp/health (getMcpHealth) [Mcp] — specs/api/openapi.yaml:21958
  handler: src/mcp/mcp-health.controller.ts
- `api` GET /mcp/tools (getMcpToolCatalog) [Mcp] — specs/api/openapi.yaml:21979
  handler: src/mcp/mcp-catalog.controller.ts
- `api` GET /machines/{machineId}/security-events (listMachineSecurityEvents) [Machines] — specs/api/openapi.yaml:23129
  handler: src/controllers/machine.controller.ts
- `api` POST /machines/{machineId}/security-events (reportMachineSecurityEvents) [Machines] — specs/api/openapi.yaml:23129
  handler: src/controllers/machine.controller.ts
- `embeddings` POST /embeddings (createEmbedding) [Embeddings] — specs/embeddings/openapi.yaml:105
  handler: debug/jwks_example.py, embedding_service/api/embeddings.py, embedding_service/integrations/github_service.py
- `embeddings` POST /orgs/{organizationId}/projects/{projectId}/embeddings/search/structured (structuredSearchEmbeddings) [Search] — specs/embeddings/openapi.yaml:333
  handler: embedding_service/api/search.py, tests/test_api.py
- `embeddings` POST /orgs/{organizationId}/projects/{projectId}/embeddings/search/batch (searchEmbeddingsOrgBatch) [Search] — specs/embeddings/openapi.yaml:581
  handler: embedding_service/api/search.py, tests/test_api.py
- `graphs` GET /nodes (listNodes) [Nodes] — specs/graphs/openapi.yaml:90
  handler: listNodes
- `graphs` GET /relationships (listRelationships) [Relationships] — specs/graphs/openapi.yaml:204
  handler: listRelationships
- `graphs` POST /relationships/batch (createRelationshipsBatch) [Relationships] — specs/graphs/openapi.yaml:253
  handler: createRelationshipsBatch
- `graphs` GET /relationships/{relationshipId} (getRelationship) [Relationships] — specs/graphs/openapi.yaml:279
  handler: getRelationship
- `graphs` POST /organizations/{organizationId}/projects/{projectId}/query (executeQuery) [Queries] — specs/graphs/openapi.yaml:314
  handler: executeQuery
- `graphs` GET /organizations/{organizationId}/projects/{projectId}/entities/{entityId}/provenance (getProvenanceLineage) [Queries] — specs/graphs/openapi.yaml:483
  handler: getProvenanceLineage
- `graphs` POST /admin/backup (createBackup) [Admin] — specs/graphs/openapi.yaml:766
  handler: createBackup

## Operations kept because they are the only path to a model a consumer imports (11)

- `agents` POST /coding-prompts-planning (runCodingPromptsPlanning) [CodingPrompts] — specs/agents/openapi.yaml:287
  models: specs/agents/openapi.yaml#/components/schemas/CodingPromptsPlanningResponseWrapper, specs/agents/openapi.yaml#/components/schemas/CodingPromptPlanningResponse, specs/schemas/agent-coordination.yaml#/CodingPromptPlanningResponse, specs/schemas/agent-coordination.yaml#/EvidenceItem, specs/schemas/agent-coordination.yaml#/CodingPromptPlanningRetrievalSummary
- `agents` POST /plans-scope (runPlanScope) [Plans] — specs/agents/openapi.yaml:391
  models: specs/schemas/agent-coordination.yaml#/PlanSize
- `agents` POST /plans-approval (runPlanApproval) [Plans] — specs/agents/openapi.yaml:442
  models: specs/agents/openapi.yaml#/components/schemas/PlanProposalResponse, specs/schemas/agent-coordination.yaml#/PlanProposalResponse
- `agents` POST /plans-gap-discovery (runPlanGapDiscovery) [Plans] — specs/agents/openapi.yaml:493
  models: specs/schemas/agent-coordination.yaml#/PlanGapItem, specs/schemas/agent-coordination.yaml#/PlanGapCategory, specs/schemas/agent-coordination.yaml#/PlanGapDiscoveryUserFeedback, specs/schemas/agent-coordination.yaml#/PlanGapClarifyingAnswer, specs/schemas/agent-coordination.yaml#/PlanGapAddedEntity
- `agents` POST /task-refiner (runTaskRefiner) [TaskRefiner] — specs/agents/openapi.yaml:544
  models: specs/agents/openapi.yaml#/components/schemas/TaskRefinerResponse, specs/schemas/agent-coordination.yaml#/TaskRefinerResponse, specs/agents/openapi.yaml#/components/schemas/TaskRefinerRequest, specs/schemas/agent-coordination.yaml#/TaskRefinerRequest, specs/schemas/agent-coordination.yaml#/TaskActiveSectionEnum
- `agents` POST /adr-refiner (runAdrRefiner) [Adr] — specs/agents/openapi.yaml:595
  models: specs/agents/openapi.yaml#/components/schemas/AdrRefinerResponse, specs/schemas/agent-coordination.yaml#/AdrRefinerResponse, specs/agents/openapi.yaml#/components/schemas/AdrRefinerRequest, specs/schemas/agent-coordination.yaml#/AdrRefinerRequest, specs/schemas/agent-coordination.yaml#/AdrActiveSectionEnum
- `agents` POST /brainstorm-refiner (runBrainstormRefiner) [BrainstormRefiner] — specs/agents/openapi.yaml:646
  models: specs/agents/openapi.yaml#/components/schemas/BrainstormRefinerResponse, specs/schemas/agent-coordination.yaml#/BrainstormRefinerResponse, specs/schemas/agent-coordination.yaml#/BrainstormRefinerSuspendedResponse, specs/schemas/agent-coordination.yaml#/BrainstormRefinerCompletedResponse, specs/agents/openapi.yaml#/components/schemas/BrainstormRefinerRequest
- `agents` POST /decision-refiner (runDecisionRefiner) [DecisionRefiner] — specs/agents/openapi.yaml:697
  models: specs/agents/openapi.yaml#/components/schemas/DecisionRefinerResponse, specs/schemas/agent-coordination.yaml#/DecisionRefinerResponse, specs/agents/openapi.yaml#/components/schemas/DecisionRefinerRequest, specs/schemas/agent-coordination.yaml#/DecisionRefinerRequest
- `agents` POST /entity-conversation (runEntityConversation) [EntityConversation] — specs/agents/openapi.yaml:748
  models: specs/agents/openapi.yaml#/components/schemas/EntityConversationResponse, specs/schemas/agent-coordination.yaml#/EntityConversationResponse, specs/schemas/artifacts.yaml#/Influence, specs/schemas/agent-coordination.yaml#/EntityConversationSuggestedAction, specs/agents/openapi.yaml#/components/schemas/EntityConversationRequest
- `agents` POST /daily-session (runDailySession) [DailySession] — specs/agents/openapi.yaml:800
  models: specs/schemas/agent-coordination.yaml#/DailySessionSuggestedAction, specs/agents/openapi.yaml#/components/schemas/DailySessionRequest, specs/schemas/agent-coordination.yaml#/DailySessionRequest, specs/schemas/common.yaml#/ConversationId, specs/schemas/agent-coordination.yaml#/ActivityDelta
- `agents` POST /project-conversation (runProjectConversation) [ProjectConversation] — specs/agents/openapi.yaml:854
  models: specs/schemas/agent-coordination.yaml#/ProjectConversationResponse, specs/schemas/agent-coordination.yaml#/ProjectConversationSuggestedAction, specs/agents/openapi.yaml#/components/schemas/ProjectConversationRequest, specs/schemas/agent-coordination.yaml#/ProjectConversationRequest

## Operations referenced only by tests (5)

- `api` GET /organizations/{organizationId}/projects/{projectId}/reports/file-touches/by-file (listReportFileTouchesByFile) [Reports] — specs/api/openapi.yaml:2906
- `api` GET /organizations/{organizationId}/projects/{projectId}/work-item-types/{typeKey}/guidance (getWorkItemTypeGuidance) [WorkItemTypes] — specs/api/openapi.yaml:6101
- `agents` POST /initiative-refiner (runInitiativeRefiner) [InitiativeRefiner] — specs/agents/openapi.yaml:340
- `local` GET /repos (listLocalRepoBindings) [RepositoryBindings] — specs/local/openapi.yaml:27
- `local` PUT /repos/{serviceId} (setLocalRepoBinding) [RepositoryBindings] — specs/local/openapi.yaml:106

## Operations held by a pinned consumer (0)


## Operations with unknown status (0)


## Unused definitions (23)

- specs/openapi.yaml#/components/schemas/InviteProjectAssignmentDto (schemas) — specs/openapi.yaml:248
- specs/openapi.yaml#/components/schemas/InteractionFlow (schemas) — specs/openapi.yaml:270
- specs/openapi.yaml#/components/schemas/CreateStepDto (schemas) — specs/openapi.yaml:274
- specs/openapi.yaml#/components/schemas/UpdateStepDto (schemas) — specs/openapi.yaml:276
- specs/openapi.yaml#/components/schemas/DebugEmbeddingsEntityResponseDto (schemas) — specs/openapi.yaml:296
- specs/openapi.yaml#/components/schemas/DebugEmbeddingsDocumentDto (schemas) — specs/openapi.yaml:298
- specs/openapi.yaml#/components/schemas/TriggerLLMRequestDto (schemas) — specs/openapi.yaml:320
- specs/openapi.yaml#/components/schemas/TriggerLLMProgressDto (schemas) — specs/openapi.yaml:322
- specs/openapi.yaml#/components/schemas/TriggerLLMCompleteDto (schemas) — specs/openapi.yaml:324
- specs/openapi.yaml#/components/schemas/LLMUsageDto (schemas) — specs/openapi.yaml:326
- specs/openapi.yaml#/components/schemas/EntityLookupItem (schemas) — specs/openapi.yaml:340
- specs/openapi.yaml#/components/schemas/WorkItemGraphLayoutNodePosition (schemas) — specs/openapi.yaml:367
- specs/openapi.yaml#/components/schemas/PersistedWorkItemGraphLayoutNodeRef (schemas) — specs/openapi.yaml:371
- specs/openapi.yaml#/components/schemas/TemporaryWorkItemGraphLayoutNodeRef (schemas) — specs/openapi.yaml:373
- specs/openapi.yaml#/components/schemas/WorkItemGraphLogicalPosition (schemas) — specs/openapi.yaml:375
- specs/openapi.yaml#/components/schemas/WorkItemGraphLogicalCoordinate (schemas) — specs/openapi.yaml:377
- specs/openapi.yaml#/components/schemas/WorkItemTypeGraphGroupsDeclaration (schemas) — specs/openapi.yaml:381
- specs/openapi.yaml#/components/schemas/DiagramGroupId (schemas) — specs/openapi.yaml:385
- clients/web-ui/openapi.yaml#/components/schemas/ArtifactSearchRequest (schemas) — clients/web-ui/openapi.yaml:215
- clients/web-ui/openapi.yaml#/components/schemas/ArtifactSearchResponse (schemas) — clients/web-ui/openapi.yaml:217
- clients/web-ui/openapi.yaml#/components/schemas/InteractionTypeResponseDto (schemas) — clients/web-ui/openapi.yaml:237
- clients/web-ui/openapi.yaml#/components/schemas/CreateInteractionTypeDto (schemas) — clients/web-ui/openapi.yaml:239
- clients/web-ui/openapi.yaml#/components/schemas/CreateStepDto (schemas) — clients/web-ui/openapi.yaml:247

## Definitions kept alive only by handler-only operations (111)

- specs/api/openapi.yaml#/components/schemas/TopologySubfacetSummarizationRunDto (schemas)
- specs/api/openapi.yaml#/components/schemas/TopologyConsolidationScheduleDto (schemas)
- specs/api/openapi.yaml#/components/schemas/TopologyConsolidationRunDto (schemas)
- specs/api/openapi.yaml#/components/schemas/TopologySubfacetCandidateDto (schemas)
- specs/api/openapi.yaml#/components/schemas/TopologySubfacetLifecycleSummaryDto (schemas)
- specs/api/openapi.yaml#/components/schemas/TopologyUpsertScheduleDto (schemas)
- specs/api/openapi.yaml#/components/schemas/TopologyPatchScheduleDto (schemas)
- specs/api/openapi.yaml#/components/schemas/TopologyTriggerScheduleNowDto (schemas)
- specs/api/openapi.yaml#/components/schemas/UserSettingsReplacementRequest (schemas)
- specs/api/openapi.yaml#/components/schemas/AgentSessionCurrentStateBatchRequestDto (schemas)
- specs/api/openapi.yaml#/components/schemas/AgentSessionOutputAttentionBatchRequestDto (schemas)
- specs/api/openapi.yaml#/components/schemas/AgentSessionOutputAttentionBatchResponseDto (schemas)
- specs/api/openapi.yaml#/components/schemas/CompactRunRequestDto (schemas)
- specs/api/openapi.yaml#/components/schemas/CodingPromptResearchExecutionTargetDto (schemas)
- specs/api/openapi.yaml#/components/schemas/PaymentProviderWebhookAcceptedResponseDto (schemas)
- specs/api/openapi.yaml#/components/schemas/AvailableSkipNodesResponseDto (schemas)
- specs/api/openapi.yaml#/components/schemas/McpHealthResponse (schemas)
- specs/api/openapi.yaml#/components/schemas/McpToolEntry (schemas)
- specs/api/openapi.yaml#/components/schemas/McpToolCatalogResponse (schemas)
- specs/api/openapi.yaml#/components/schemas/RegisterMachineResponseDto (schemas)
- specs/api/openapi.yaml#/components/schemas/ReportMachineSecurityEventEntryDto (schemas)
- specs/api/openapi.yaml#/components/schemas/ReportMachineSecurityEventsRequestDto (schemas)
- specs/api/openapi.yaml#/components/schemas/MachineSecurityEventListResponseDto (schemas)
- specs/api/openapi.yaml#/components/schemas/IssuePairingCodeResponseDto (schemas)
- specs/api/openapi.yaml#/components/schemas/PairingCodeStatusResponseDto (schemas)
- specs/api/openapi.yaml#/components/schemas/WebSocketConnectionDetailDto (schemas)
- specs/api/openapi.yaml#/components/schemas/WebSocketChannelStatsDto (schemas)
- specs/api/openapi.yaml#/components/schemas/WebSocketSubscriptionsDebugDto (schemas)
- specs/api/openapi.yaml#/components/schemas/WorkItemAdvanceRequestDto (schemas)
- specs/api/openapi.yaml#/components/schemas/RefineWorkItem200ResponseAllOfData (schemas)
- specs/api/openapi.yaml#/components/schemas/UpdateWorkItemContent200ResponseAllOfDataData (schemas)
- specs/api/openapi.yaml#/components/schemas/UpdateWorkItemContent200ResponseAllOfDataDataWorkItem (schemas)
- specs/api/openapi.yaml#/components/schemas/AdvanceWorkItemLevel200ResponseAllOfData (schemas)
- specs/api/openapi.yaml#/components/schemas/FinalizeWorkItemRefinement200ResponseAllOfData (schemas)
- specs/api/openapi.yaml#/components/schemas/ContextVersionDto (schemas)
- specs/api/openapi.yaml#/components/schemas/CreateContextVersionDto (schemas)
- specs/api/openapi.yaml#/components/schemas/ContextSnapshotDto (schemas)
- specs/api/openapi.yaml#/components/schemas/CreateContextSnapshotDto (schemas)
- specs/api/openapi.yaml#/components/schemas/SharedContextDto (schemas)
- specs/api/openapi.yaml#/components/schemas/CreateSharedContextDto (schemas)
- specs/api/openapi.yaml#/components/schemas/ContextAccessRequestDto (schemas)
- specs/api/openapi.yaml#/components/schemas/ContextAccessResultDto (schemas)
- specs/api/openapi.yaml#/components/schemas/UpdateSharedContextDto (schemas)
- specs/api/openapi.yaml#/components/schemas/UpdateSharedContextResponseDto (schemas)
- specs/api/openapi.yaml#/components/schemas/TransformationPipelineDto (schemas)
- specs/api/openapi.yaml#/components/schemas/CreateTransformationPipelineDto (schemas)
- specs/api/openapi.yaml#/components/schemas/ProcessContextThroughPipelineDto (schemas)
- specs/api/openapi.yaml#/components/schemas/WorkflowContextCleanupResponseDto (schemas)
- specs/api/openapi.yaml#/components/schemas/GitHubWebhookAcceptedResponseDto (schemas)
- specs/schemas/common.yaml#/AssignTagRequest (schema)
- specs/schemas/common.yaml#/AssignProjectTagRequest (schema)
- specs/schemas/work-items.yaml#/WorkItemAdvanceRequestDto (schema)
- specs/schemas/work-items.yaml#/RefineWorkItem200ResponseAllOfData (schema)
- specs/schemas/work-items.yaml#/UpdateWorkItemContent200ResponseAllOfDataData (schema)
- specs/schemas/work-items.yaml#/UpdateWorkItemContent200ResponseAllOfDataDataWorkItem (schema)
- specs/schemas/work-items.yaml#/AdvanceWorkItemLevel200ResponseAllOfData (schema)
- specs/schemas/work-items.yaml#/FinalizeWorkItemRefinement200ResponseAllOfData (schema)
- specs/schemas/conversations.yaml#/AvailableSkipNodesResponseDto (schema)
- specs/schemas/coding-sessions.yaml#/AgentSessionCurrentStateBatchRequestDto (schema)
- specs/schemas/coding-sessions.yaml#/AgentSessionOutputAttentionBatchRequestDto (schema)
- specs/schemas/coding-sessions.yaml#/AgentSessionOutputAttentionBatchResponseDto (schema)
- specs/schemas/coding-sessions.yaml#/CompactRunRequestDto (schema)
- specs/schemas/machine-security-events.yaml#/ReportMachineSecurityEventEntryDto (schema)
- specs/schemas/machine-security-events.yaml#/ReportMachineSecurityEventsRequestDto (schema)
- specs/schemas/machine-security-events.yaml#/MachineSecurityEventListResponseDto (schema)
- specs/schemas/user-settings.yaml#/UserSettingsReplacementRequest (schema)
- specs/schemas/topology.yaml#/TopologySubfacetSummarizationRunDto (schema)
- specs/schemas/topology.yaml#/TopologyConsolidationScheduleDto (schema)
- specs/schemas/topology.yaml#/TopologyConsolidationRunDto (schema)
- specs/schemas/topology.yaml#/TopologySubfacetCandidateDto (schema)
- specs/schemas/topology.yaml#/TopologySubfacetLifecycleStatusCountsDto (schema)
- specs/schemas/topology.yaml#/TopologyNearPromotionSubfacetDto (schema)
- specs/schemas/topology.yaml#/TopologyPromotableCandidateDto (schema)
- specs/schemas/topology.yaml#/TopologySubfacetLifecycleSummaryDto (schema)
- specs/schemas/topology.yaml#/TopologyUpsertScheduleDto (schema)
- specs/schemas/topology.yaml#/TopologyPatchScheduleDto (schema)
- specs/schemas/topology.yaml#/TopologyTriggerScheduleNowDto (schema)
- specs/schemas/payment-entitlement.yaml#/PaymentProviderWebhookAcceptedResponseDto (schema)
- specs/schemas/mcp.yaml#/McpToolEntry (schema)
- specs/schemas/mcp.yaml#/McpToolCatalogResponse (schema)
- specs/schemas/mcp.yaml#/McpHealthResponse (schema)
- specs/schemas/debug.yaml#/WebSocketConnectionDetailDto (schema)
- specs/schemas/debug.yaml#/WebSocketChannelStatsDto (schema)
- specs/schemas/debug.yaml#/WebSocketSubscriptionsDebugDto (schema)
- specs/schemas/workflow-context.yaml#/ContextVersionDto (schema)
- specs/schemas/workflow-context.yaml#/CreateContextVersionDto (schema)
- specs/schemas/workflow-context.yaml#/ContextSnapshotDto (schema)
- specs/schemas/workflow-context.yaml#/CreateContextSnapshotDto (schema)
- specs/schemas/workflow-context.yaml#/ShareTypeEnum (schema)
- specs/schemas/workflow-context.yaml#/ShareScopeEnum (schema)
- specs/schemas/workflow-context.yaml#/ShareModeEnum (schema)
- specs/schemas/workflow-context.yaml#/ContextShareConfigDto (schema)
- specs/schemas/workflow-context.yaml#/ContextPermissionsDto (schema)
- specs/schemas/workflow-context.yaml#/SharedContextDto (schema)
- specs/schemas/workflow-context.yaml#/CreateSharedContextDto (schema)
- specs/schemas/workflow-context.yaml#/ContextAccessRequestDto (schema)
- specs/schemas/workflow-context.yaml#/ContextAccessResultDto (schema)
- specs/schemas/workflow-context.yaml#/UpdateSharedContextDto (schema)
- specs/schemas/workflow-context.yaml#/UpdateSharedContextResponseDto (schema)
- specs/schemas/workflow-context.yaml#/TransformationStepDto (schema)
- specs/schemas/workflow-context.yaml#/TransformationPipelineDto (schema)
- specs/schemas/workflow-context.yaml#/CreateTransformationPipelineDto (schema)
- specs/schemas/workflow-context.yaml#/ProcessContextThroughPipelineDto (schema)
- specs/schemas/workflow-context.yaml#/WorkflowContextCleanupResponseDto (schema)
- specs/schemas/dev.yaml#/ProjectDebugViewDto (schema)
- specs/schemas/dev.yaml#/WorkflowStatusDebugDto (schema)
- specs/graphs/openapi.yaml#/components/responses/RequestTimeout (responses)
- specs/graphs/openapi.yaml#/components/responses/InternalServerError (responses)
- specs/openapi.yaml#/components/schemas/RefreshBrowserSessionDto (schemas)
- specs/openapi.yaml#/components/schemas/ProjectDebugViewDto (schemas)
- specs/openapi.yaml#/components/schemas/WorkflowStatusDebugDto (schemas)

## Definitions held by pinned consumers (6)

- specs/api/openapi.yaml#/components/schemas/TaskData (schemas): embeddings
- specs/schemas/common.yaml#/TopologyCategory (schema): graphs, embeddings
- specs/schemas/common.yaml#/TopologyFacet (schema): graphs
- specs/embeddings/openapi.yaml#/components/schemas/ProjectionDeletionRequest (schemas): embeddings
- specs/graphs/openapi.yaml#/components/schemas/InfluenceCategory (schemas): graphs
- specs/graphs/openapi.yaml#/components/schemas/ProjectionDeletionRequest (schemas): embeddings

## Spec files nothing reads (9)

- specs/openapi.yaml
- clients/internal/openapi.yaml
- clients/mobile/openapi.yaml
- clients/web-ui/openapi.yaml
- specs/paths/debug.yaml
- specs/paths/dev.yaml
- specs/paths/entities.yaml
- specs/paths/help.yaml
- specs/paths/report-bugs.yaml

## Operations referenced only by tests (5)

- `api` GET /organizations/{organizationId}/projects/{projectId}/reports/file-touches/by-file (listReportFileTouchesByFile) [Reports] — specs/api/openapi.yaml:2906
- `api` GET /organizations/{organizationId}/projects/{projectId}/work-item-types/{typeKey}/guidance (getWorkItemTypeGuidance) [WorkItemTypes] — specs/api/openapi.yaml:6101
- `agents` POST /initiative-refiner (runInitiativeRefiner) [InitiativeRefiner] — specs/agents/openapi.yaml:340
- `local` GET /repos (listLocalRepoBindings) [RepositoryBindings] — specs/local/openapi.yaml:27
- `local` PUT /repos/{serviceId} (setLocalRepoBinding) [RepositoryBindings] — specs/local/openapi.yaml:106

## Operations held by a pinned consumer (0)


## Operations with unknown status (0)


## Unused definitions (23)

- specs/openapi.yaml#/components/schemas/InviteProjectAssignmentDto (schemas) — specs/openapi.yaml:248
- specs/openapi.yaml#/components/schemas/InteractionFlow (schemas) — specs/openapi.yaml:270
- specs/openapi.yaml#/components/schemas/CreateStepDto (schemas) — specs/openapi.yaml:274
- specs/openapi.yaml#/components/schemas/UpdateStepDto (schemas) — specs/openapi.yaml:276
- specs/openapi.yaml#/components/schemas/DebugEmbeddingsEntityResponseDto (schemas) — specs/openapi.yaml:296
- specs/openapi.yaml#/components/schemas/DebugEmbeddingsDocumentDto (schemas) — specs/openapi.yaml:298
- specs/openapi.yaml#/components/schemas/TriggerLLMRequestDto (schemas) — specs/openapi.yaml:320
- specs/openapi.yaml#/components/schemas/TriggerLLMProgressDto (schemas) — specs/openapi.yaml:322
- specs/openapi.yaml#/components/schemas/TriggerLLMCompleteDto (schemas) — specs/openapi.yaml:324
- specs/openapi.yaml#/components/schemas/LLMUsageDto (schemas) — specs/openapi.yaml:326
- specs/openapi.yaml#/components/schemas/EntityLookupItem (schemas) — specs/openapi.yaml:340
- specs/openapi.yaml#/components/schemas/WorkItemGraphLayoutNodePosition (schemas) — specs/openapi.yaml:367
- specs/openapi.yaml#/components/schemas/PersistedWorkItemGraphLayoutNodeRef (schemas) — specs/openapi.yaml:371
- specs/openapi.yaml#/components/schemas/TemporaryWorkItemGraphLayoutNodeRef (schemas) — specs/openapi.yaml:373
- specs/openapi.yaml#/components/schemas/WorkItemGraphLogicalPosition (schemas) — specs/openapi.yaml:375
- specs/openapi.yaml#/components/schemas/WorkItemGraphLogicalCoordinate (schemas) — specs/openapi.yaml:377
- specs/openapi.yaml#/components/schemas/WorkItemTypeGraphGroupsDeclaration (schemas) — specs/openapi.yaml:381
- specs/openapi.yaml#/components/schemas/DiagramGroupId (schemas) — specs/openapi.yaml:385
- clients/web-ui/openapi.yaml#/components/schemas/ArtifactSearchRequest (schemas) — clients/web-ui/openapi.yaml:215
- clients/web-ui/openapi.yaml#/components/schemas/ArtifactSearchResponse (schemas) — clients/web-ui/openapi.yaml:217
- clients/web-ui/openapi.yaml#/components/schemas/InteractionTypeResponseDto (schemas) — clients/web-ui/openapi.yaml:237
- clients/web-ui/openapi.yaml#/components/schemas/CreateInteractionTypeDto (schemas) — clients/web-ui/openapi.yaml:239
- clients/web-ui/openapi.yaml#/components/schemas/CreateStepDto (schemas) — clients/web-ui/openapi.yaml:247

## Definitions kept alive only by handler-only operations (111)

- specs/api/openapi.yaml#/components/schemas/TopologySubfacetSummarizationRunDto (schemas)
- specs/api/openapi.yaml#/components/schemas/TopologyConsolidationScheduleDto (schemas)
- specs/api/openapi.yaml#/components/schemas/TopologyConsolidationRunDto (schemas)
- specs/api/openapi.yaml#/components/schemas/TopologySubfacetCandidateDto (schemas)
- specs/api/openapi.yaml#/components/schemas/TopologySubfacetLifecycleSummaryDto (schemas)
- specs/api/openapi.yaml#/components/schemas/TopologyUpsertScheduleDto (schemas)
- specs/api/openapi.yaml#/components/schemas/TopologyPatchScheduleDto (schemas)
- specs/api/openapi.yaml#/components/schemas/TopologyTriggerScheduleNowDto (schemas)
- specs/api/openapi.yaml#/components/schemas/UserSettingsReplacementRequest (schemas)
- specs/api/openapi.yaml#/components/schemas/AgentSessionCurrentStateBatchRequestDto (schemas)
- specs/api/openapi.yaml#/components/schemas/AgentSessionOutputAttentionBatchRequestDto (schemas)
- specs/api/openapi.yaml#/components/schemas/AgentSessionOutputAttentionBatchResponseDto (schemas)
- specs/api/openapi.yaml#/components/schemas/CompactRunRequestDto (schemas)
- specs/api/openapi.yaml#/components/schemas/CodingPromptResearchExecutionTargetDto (schemas)
- specs/api/openapi.yaml#/components/schemas/PaymentProviderWebhookAcceptedResponseDto (schemas)
- specs/api/openapi.yaml#/components/schemas/AvailableSkipNodesResponseDto (schemas)
- specs/api/openapi.yaml#/components/schemas/McpHealthResponse (schemas)
- specs/api/openapi.yaml#/components/schemas/McpToolEntry (schemas)
- specs/api/openapi.yaml#/components/schemas/McpToolCatalogResponse (schemas)
- specs/api/openapi.yaml#/components/schemas/RegisterMachineResponseDto (schemas)
- specs/api/openapi.yaml#/components/schemas/ReportMachineSecurityEventEntryDto (schemas)
- specs/api/openapi.yaml#/components/schemas/ReportMachineSecurityEventsRequestDto (schemas)
- specs/api/openapi.yaml#/components/schemas/MachineSecurityEventListResponseDto (schemas)
- specs/api/openapi.yaml#/components/schemas/IssuePairingCodeResponseDto (schemas)
- specs/api/openapi.yaml#/components/schemas/PairingCodeStatusResponseDto (schemas)
- specs/api/openapi.yaml#/components/schemas/WebSocketConnectionDetailDto (schemas)
- specs/api/openapi.yaml#/components/schemas/WebSocketChannelStatsDto (schemas)
- specs/api/openapi.yaml#/components/schemas/WebSocketSubscriptionsDebugDto (schemas)
- specs/api/openapi.yaml#/components/schemas/WorkItemAdvanceRequestDto (schemas)
- specs/api/openapi.yaml#/components/schemas/RefineWorkItem200ResponseAllOfData (schemas)
- specs/api/openapi.yaml#/components/schemas/UpdateWorkItemContent200ResponseAllOfDataData (schemas)
- specs/api/openapi.yaml#/components/schemas/UpdateWorkItemContent200ResponseAllOfDataDataWorkItem (schemas)
- specs/api/openapi.yaml#/components/schemas/AdvanceWorkItemLevel200ResponseAllOfData (schemas)
- specs/api/openapi.yaml#/components/schemas/FinalizeWorkItemRefinement200ResponseAllOfData (schemas)
- specs/api/openapi.yaml#/components/schemas/ContextVersionDto (schemas)
- specs/api/openapi.yaml#/components/schemas/CreateContextVersionDto (schemas)
- specs/api/openapi.yaml#/components/schemas/ContextSnapshotDto (schemas)
- specs/api/openapi.yaml#/components/schemas/CreateContextSnapshotDto (schemas)
- specs/api/openapi.yaml#/components/schemas/SharedContextDto (schemas)
- specs/api/openapi.yaml#/components/schemas/CreateSharedContextDto (schemas)
- specs/api/openapi.yaml#/components/schemas/ContextAccessRequestDto (schemas)
- specs/api/openapi.yaml#/components/schemas/ContextAccessResultDto (schemas)
- specs/api/openapi.yaml#/components/schemas/UpdateSharedContextDto (schemas)
- specs/api/openapi.yaml#/components/schemas/UpdateSharedContextResponseDto (schemas)
- specs/api/openapi.yaml#/components/schemas/TransformationPipelineDto (schemas)
- specs/api/openapi.yaml#/components/schemas/CreateTransformationPipelineDto (schemas)
- specs/api/openapi.yaml#/components/schemas/ProcessContextThroughPipelineDto (schemas)
- specs/api/openapi.yaml#/components/schemas/WorkflowContextCleanupResponseDto (schemas)
- specs/api/openapi.yaml#/components/schemas/GitHubWebhookAcceptedResponseDto (schemas)
- specs/schemas/common.yaml#/AssignTagRequest (schema)
- specs/schemas/common.yaml#/AssignProjectTagRequest (schema)
- specs/schemas/work-items.yaml#/WorkItemAdvanceRequestDto (schema)
- specs/schemas/work-items.yaml#/RefineWorkItem200ResponseAllOfData (schema)
- specs/schemas/work-items.yaml#/UpdateWorkItemContent200ResponseAllOfDataData (schema)
- specs/schemas/work-items.yaml#/UpdateWorkItemContent200ResponseAllOfDataDataWorkItem (schema)
- specs/schemas/work-items.yaml#/AdvanceWorkItemLevel200ResponseAllOfData (schema)
- specs/schemas/work-items.yaml#/FinalizeWorkItemRefinement200ResponseAllOfData (schema)
- specs/schemas/conversations.yaml#/AvailableSkipNodesResponseDto (schema)
- specs/schemas/coding-sessions.yaml#/AgentSessionCurrentStateBatchRequestDto (schema)
- specs/schemas/coding-sessions.yaml#/AgentSessionOutputAttentionBatchRequestDto (schema)
- specs/schemas/coding-sessions.yaml#/AgentSessionOutputAttentionBatchResponseDto (schema)
- specs/schemas/coding-sessions.yaml#/CompactRunRequestDto (schema)
- specs/schemas/machine-security-events.yaml#/ReportMachineSecurityEventEntryDto (schema)
- specs/schemas/machine-security-events.yaml#/ReportMachineSecurityEventsRequestDto (schema)
- specs/schemas/machine-security-events.yaml#/MachineSecurityEventListResponseDto (schema)
- specs/schemas/user-settings.yaml#/UserSettingsReplacementRequest (schema)
- specs/schemas/topology.yaml#/TopologySubfacetSummarizationRunDto (schema)
- specs/schemas/topology.yaml#/TopologyConsolidationScheduleDto (schema)
- specs/schemas/topology.yaml#/TopologyConsolidationRunDto (schema)
- specs/schemas/topology.yaml#/TopologySubfacetCandidateDto (schema)
- specs/schemas/topology.yaml#/TopologySubfacetLifecycleStatusCountsDto (schema)
- specs/schemas/topology.yaml#/TopologyNearPromotionSubfacetDto (schema)
- specs/schemas/topology.yaml#/TopologyPromotableCandidateDto (schema)
- specs/schemas/topology.yaml#/TopologySubfacetLifecycleSummaryDto (schema)
- specs/schemas/topology.yaml#/TopologyUpsertScheduleDto (schema)
- specs/schemas/topology.yaml#/TopologyPatchScheduleDto (schema)
- specs/schemas/topology.yaml#/TopologyTriggerScheduleNowDto (schema)
- specs/schemas/payment-entitlement.yaml#/PaymentProviderWebhookAcceptedResponseDto (schema)
- specs/schemas/mcp.yaml#/McpToolEntry (schema)
- specs/schemas/mcp.yaml#/McpToolCatalogResponse (schema)
- specs/schemas/mcp.yaml#/McpHealthResponse (schema)
- specs/schemas/debug.yaml#/WebSocketConnectionDetailDto (schema)
- specs/schemas/debug.yaml#/WebSocketChannelStatsDto (schema)
- specs/schemas/debug.yaml#/WebSocketSubscriptionsDebugDto (schema)
- specs/schemas/workflow-context.yaml#/ContextVersionDto (schema)
- specs/schemas/workflow-context.yaml#/CreateContextVersionDto (schema)
- specs/schemas/workflow-context.yaml#/ContextSnapshotDto (schema)
- specs/schemas/workflow-context.yaml#/CreateContextSnapshotDto (schema)
- specs/schemas/workflow-context.yaml#/ShareTypeEnum (schema)
- specs/schemas/workflow-context.yaml#/ShareScopeEnum (schema)
- specs/schemas/workflow-context.yaml#/ShareModeEnum (schema)
- specs/schemas/workflow-context.yaml#/ContextShareConfigDto (schema)
- specs/schemas/workflow-context.yaml#/ContextPermissionsDto (schema)
- specs/schemas/workflow-context.yaml#/SharedContextDto (schema)
- specs/schemas/workflow-context.yaml#/CreateSharedContextDto (schema)
- specs/schemas/workflow-context.yaml#/ContextAccessRequestDto (schema)
- specs/schemas/workflow-context.yaml#/ContextAccessResultDto (schema)
- specs/schemas/workflow-context.yaml#/UpdateSharedContextDto (schema)
- specs/schemas/workflow-context.yaml#/UpdateSharedContextResponseDto (schema)
- specs/schemas/workflow-context.yaml#/TransformationStepDto (schema)
- specs/schemas/workflow-context.yaml#/TransformationPipelineDto (schema)
- specs/schemas/workflow-context.yaml#/CreateTransformationPipelineDto (schema)
- specs/schemas/workflow-context.yaml#/ProcessContextThroughPipelineDto (schema)
- specs/schemas/workflow-context.yaml#/WorkflowContextCleanupResponseDto (schema)
- specs/schemas/dev.yaml#/ProjectDebugViewDto (schema)
- specs/schemas/dev.yaml#/WorkflowStatusDebugDto (schema)
- specs/graphs/openapi.yaml#/components/responses/RequestTimeout (responses)
- specs/graphs/openapi.yaml#/components/responses/InternalServerError (responses)
- specs/openapi.yaml#/components/schemas/RefreshBrowserSessionDto (schemas)
- specs/openapi.yaml#/components/schemas/ProjectDebugViewDto (schemas)
- specs/openapi.yaml#/components/schemas/WorkflowStatusDebugDto (schemas)

## Definitions held by pinned consumers (6)

- specs/api/openapi.yaml#/components/schemas/TaskData (schemas): embeddings
- specs/schemas/common.yaml#/TopologyCategory (schema): graphs, embeddings
- specs/schemas/common.yaml#/TopologyFacet (schema): graphs
- specs/embeddings/openapi.yaml#/components/schemas/ProjectionDeletionRequest (schemas): embeddings
- specs/graphs/openapi.yaml#/components/schemas/InfluenceCategory (schemas): graphs
- specs/graphs/openapi.yaml#/components/schemas/ProjectionDeletionRequest (schemas): embeddings

## Spec files nothing reads (9)

- specs/openapi.yaml
- clients/internal/openapi.yaml
- clients/mobile/openapi.yaml
- clients/web-ui/openapi.yaml
- specs/paths/debug.yaml
- specs/paths/dev.yaml
- specs/paths/entities.yaml
- specs/paths/help.yaml
- specs/paths/report-bugs.yaml

