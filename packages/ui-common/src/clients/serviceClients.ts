/**
 * Service-specific API clients for the new microservices architecture.
 * This module builds generated API clients using a supplied runtime and exposes
 * a unified interface for the rest of the application.
 */

import {
  ActivityCorrelationApi,
  AgentSessionsApi,
  DebugAdminApi,
  DemoSandboxesApi,
  DesignDocsApi,
  EntityPromptTemplatesApi,
  HelpApi,
  PrivateBetaAccessApi,
  ReportBugsApi,
  SecondaryActionsApi,
  TasksApi,
} from "../api";
import type {
  ArtifactsApi,
  AuthApi,
  ConversationsApi,
  DevelopmentApi,
  EntitiesApi,
  EventsApi,
  ImplementationHintsApi,
  InitiativesApi,
  IntegrationsApi,
  OrganizationsApi,
  ProjectsApi,
  ReportsApi,
  SearchApi,
  StarsApi,
  TagsApi,
  WorkflowsApi,
} from "../api";
import type {
  AttachToGoalDto,
  DetachFromGoalDto,
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  CreateAgentEdgeRequest,
  CreateTaskDto,
  UpdateTaskDto,
  WorkStatus,
  TaskSortBy,
  TaskSortDir,
  CreateSuggestedTaskRequestDto,
  WorkItemGraphParticipationType,
} from "../api";
import axios, { type AxiosRequestConfig } from "axios";
import {
  createApiRuntime,
  type ApiClientSet,
  type LegacyApiClient,
  type ApiRuntime,
} from "./createApiRuntime";

/**
 * The graph-backed edge contract permits an edge without an owning agent
 * session. The API facade's generated request type predates that nullable
 * field, so keep the browser-facing input aligned with the graph contract.
 */
export type CreateAgentEdgeInput = Omit<
  CreateAgentEdgeRequest,
  "createdBySessionId"
> & {
  createdBySessionId?: string | null;
};

const toGeneratedCreateAgentEdgeRequest = (
  request: CreateAgentEdgeInput,
): CreateAgentEdgeRequest => request as unknown as CreateAgentEdgeRequest;

const fallbackAxios = axios.create({
  baseURL: "/api/v1",
});

const fallbackRuntime = createApiRuntime({
  baseUrl: "/api/v1",
  transport: {
    axios: fallbackAxios,
    request: (config) => fallbackAxios.request(config),
    setAuthToken: () => {},
    onUnauthorized: () => () => {},
  },
});

let runtimeClients: ApiClientSet | null = null;

let runtimeUnifiedClient: UnifiedApiClient | null = null;

export const registerRuntimeClients = (clients: ApiClientSet): void => {
  runtimeClients = clients;
};

export const registerRuntimeUnifiedClient = (
  client: UnifiedApiClient,
): void => {
  runtimeUnifiedClient = client;
};

const getResolvedClients = (): ApiClientSet => {
  return runtimeClients ?? fallbackRuntime.clients;
};

const createClientProxy = <K extends keyof ApiClientSet>(
  clientKey: K,
): ApiClientSet[K] => {
  return new Proxy({} as ApiClientSet[K], {
    get: (_target, property, receiver) => {
      const resolvedClient = getResolvedClients()[clientKey];
      const value = (resolvedClient as unknown as Record<PropertyKey, unknown>)[
        property
      ];
      if (typeof value === "function") {
        return value.bind(resolvedClient);
      }
      return Reflect.get(resolvedClient as object, property, receiver);
    },
  });
};

export const defaultClient = createClientProxy("default");
export const identityClient = createClientProxy("identity");
export const platformClient = createClientProxy("platform");
export const knowledgeClient = createClientProxy("knowledge");
export const conversationsClient = createClientProxy("conversations");
export const workflowsClient = createClientProxy("workflows");
export const eventsClient = createClientProxy("events");
export const tasksClient = createClientProxy("tasks");
export const projectsClient = createClientProxy("projects");
export const workItemRefinementClient = createClientProxy("workItemRefinement");
export const suggestionsClient = createClientProxy("suggestions");
export const plansClient = createClientProxy("plans");
export const debugAdminClient = createClientProxy("debugAdmin");
export const stagedContentClient = createClientProxy("stagedContent");
export const designDocsClient = createClientProxy("designDocs");
export const agentSessionsClient = createClientProxy("agentSessions");
export const analyticsClient = createClientProxy("analytics");
export const reportsClient = createClientProxy("reports");
export const projectReportsClient = createClientProxy("projectReports");
export const evalRunsClient = createClientProxy("evalRuns");
export const notificationsClient = createClientProxy("notifications");
export const openItemsClient = createClientProxy("openItems");
export const privateBetaAccessClient = createClientProxy("privateBetaAccess");
export const activityCorrelationClient = createClientProxy(
  "activityCorrelation",
);
export const agentEdgesClient = createClientProxy("agentEdges");
export const secondaryActionsClient = createClientProxy("secondaryActions");
export const entityContextClient = createClientProxy("entityContext");
export const helpClient = createClientProxy("help");
export const entitiesClient = createClientProxy("entities");
export const entityPromptTemplatesClient = createClientProxy(
  "entityPromptTemplates",
);
export const proposalsClient = createClientProxy("proposals");
export const reportBugsClient = createClientProxy("reportBugs");
export const machinesClient = createClientProxy("machines");
export const starsClient = createClientProxy("stars");
export const controllerAuthorizationClient = createClientProxy(
  "controllerAuthorization",
);

/**
 * Unified API Client
 *
 * Provides a single interface that routes calls to appropriate service clients
 * while maintaining backward compatibility with the existing API interface.
 *
 * Usage:
 * ```typescript
 * import { unifiedApiClient } from './clients/serviceClients';
 *
 * // These calls are automatically routed to the correct service
 * await unifiedApiClient.login(loginDto);           // -> identityClient
 * await unifiedApiClient.createProject(projectDto); // -> platformClient
 * await unifiedApiClient.searchArtifacts(query);   // -> knowledgeClient
 * ```
 */
export class UnifiedApiClient {
  readonly client: LegacyApiClient;

  constructor(private readonly clients: ApiClientSet) {
    // Backwards-compatible alias for legacy call sites that reach into internal client state.
    this.client = clients.default;
  }

  // Identity Service methods
  login(...args: Parameters<AuthApi["login"]>) {
    return this.clients.auth.login(...args);
  }

  getAccountDefaultOrganization(
    ...args: Parameters<AuthApi["getAccountDefaultOrganization"]>
  ) {
    return this.clients.auth.getAccountDefaultOrganization(...args);
  }

  setAccountDefaultOrganization(
    ...args: Parameters<AuthApi["setAccountDefaultOrganization"]>
  ) {
    return this.clients.auth.setAccountDefaultOrganization(...args);
  }

  register(...args: Parameters<AuthApi["register"]>) {
    return this.clients.auth.register(...args);
  }

  logout(...args: Parameters<AuthApi["logout"]>) {
    return this.clients.auth.logout(...args);
  }

  refreshToken(...args: Parameters<AuthApi["refreshToken"]>) {
    return this.clients.auth.refreshToken(...args);
  }

  initiatePasswordRecovery(
    ...args: Parameters<AuthApi["initiatePasswordRecovery"]>
  ) {
    return this.clients.auth.initiatePasswordRecovery(...args);
  }

  validateToken(...args: Parameters<AuthApi["validateToken"]>) {
    return this.clients.auth.validateToken(...args);
  }

  getJwks(...args: Parameters<AuthApi["getJwks"]>) {
    return this.clients.auth.getJwks(...args);
  }

  submitPrivateBetaAccessRequest(
    ...args: Parameters<PrivateBetaAccessApi["submitPrivateBetaAccessRequest"]>
  ) {
    return this.clients.privateBetaAccess.submitPrivateBetaAccessRequest(
      ...args,
    );
  }

  listPrivateBetaAccessRequestReviews(
    ...args: Parameters<
      PrivateBetaAccessApi["listPrivateBetaAccessRequestReviews"]
    >
  ) {
    return this.clients.privateBetaAccess.listPrivateBetaAccessRequestReviews(
      ...args,
    );
  }
  getPrivateBetaAccessRequestReview(
    ...args: Parameters<
      PrivateBetaAccessApi["getPrivateBetaAccessRequestReview"]
    >
  ) {
    return this.clients.privateBetaAccess.getPrivateBetaAccessRequestReview(
      ...args,
    );
  }

  decidePrivateBetaAccessRequest(
    ...args: Parameters<PrivateBetaAccessApi["decidePrivateBetaAccessRequest"]>
  ) {
    return this.clients.privateBetaAccess.decidePrivateBetaAccessRequest(
      ...args,
    );
  }

  getPublicPrivateBetaAdmissionMode(
    ...args: Parameters<
      PrivateBetaAccessApi["getPublicPrivateBetaAdmissionMode"]
    >
  ) {
    return this.clients.privateBetaAccess.getPublicPrivateBetaAdmissionMode(
      ...args,
    );
  }

  getPrivateBetaSelfServiceAdmissionMode(
    ...args: Parameters<
      PrivateBetaAccessApi["getPrivateBetaSelfServiceAdmissionMode"]
    >
  ) {
    return this.clients.privateBetaAccess.getPrivateBetaSelfServiceAdmissionMode(
      ...args,
    );
  }

  updatePrivateBetaSelfServiceAdmissionMode(
    ...args: Parameters<
      PrivateBetaAccessApi["updatePrivateBetaSelfServiceAdmissionMode"]
    >
  ) {
    return this.clients.privateBetaAccess.updatePrivateBetaSelfServiceAdmissionMode(
      ...args,
    );
  }

  getPrivateBetaDisclosureStatus(
    ...args: Parameters<PrivateBetaAccessApi["getPrivateBetaDisclosureStatus"]>
  ) {
    return this.clients.privateBetaAccess.getPrivateBetaDisclosureStatus(
      ...args,
    );
  }

  submitPrivateBetaDisclosureAcceptance(
    ...args: Parameters<
      PrivateBetaAccessApi["submitPrivateBetaDisclosureAcceptance"]
    >
  ) {
    return this.clients.privateBetaAccess.submitPrivateBetaDisclosureAcceptance(
      ...args,
    );
  }

  resumeDemoSandbox(
    ...args: Parameters<DemoSandboxesApi["resumeDemoSandbox"]>
  ) {
    return this.clients.demoSandboxes.resumeDemoSandbox(...args);
  }

  provisionDemoSandbox(
    ...args: Parameters<DemoSandboxesApi["provisionDemoSandbox"]>
  ) {
    return this.clients.demoSandboxes.provisionDemoSandbox(...args);
  }

  getCurrentDemoSandbox(
    ...args: Parameters<DemoSandboxesApi["getCurrentDemoSandbox"]>
  ) {
    return this.clients.demoSandboxes.getCurrentDemoSandbox(...args);
  }

  getPlatformAdminAccess(
    ...args: Parameters<DebugAdminApi["getPlatformAdminAccess"]>
  ) {
    return this.clients.debugAdmin.getPlatformAdminAccess(...args);
  }

  getDemoSandboxAdminOverview(
    ...args: Parameters<DebugAdminApi["getDemoSandboxAdminOverview"]>
  ) {
    return this.clients.debugAdmin.getDemoSandboxAdminOverview(...args);
  }

  setDemoSandboxProgram(
    ...args: Parameters<DebugAdminApi["setDemoSandboxProgram"]>
  ) {
    return this.clients.debugAdmin.setDemoSandboxProgram(...args);
  }

  setDemoSandboxTemplate(
    ...args: Parameters<DebugAdminApi["setDemoSandboxTemplate"]>
  ) {
    return this.clients.debugAdmin.setDemoSandboxTemplate(...args);
  }

  getMyOrganizations(
    ...args: Parameters<OrganizationsApi["getMyOrganizations"]>
  ) {
    return this.clients.organizations.getMyOrganizations(...args);
  }

  listOrganizationDirectory(
    ...args: Parameters<OrganizationsApi["listOrganizationDirectory"]>
  ) {
    return this.clients.organizations.listOrganizationDirectory(...args);
  }

  getAdminOrganizationDetail(
    ...args: Parameters<OrganizationsApi["getAdminOrganizationDetail"]>
  ) {
    return this.clients.organizations.getAdminOrganizationDetail(...args);
  }

  makeOrganizationBetaAccessOpenEnded(
    ...args: Parameters<OrganizationsApi["makeOrganizationBetaAccessOpenEnded"]>
  ) {
    return this.clients.organizations.makeOrganizationBetaAccessOpenEnded(
      ...args,
    );
  }

  listAdminOrganizationMembers(
    ...args: Parameters<OrganizationsApi["listAdminOrganizationMembers"]>
  ) {
    return this.clients.organizations.listAdminOrganizationMembers(...args);
  }
  createOrganization(
    ...args: Parameters<OrganizationsApi["createOrganization"]>
  ) {
    return this.clients.organizations.createOrganization(...args);
  }

  getOrganization(...args: Parameters<OrganizationsApi["getOrganization"]>) {
    return this.clients.organizations.getOrganization(...args);
  }

  updateOrganization(
    ...args: Parameters<OrganizationsApi["updateOrganization"]>
  ) {
    return this.clients.organizations.updateOrganization(...args);
  }

  getOrganizationMembers(
    ...args: Parameters<OrganizationsApi["getOrganizationMembers"]>
  ) {
    return this.clients.organizations.getOrganizationMembers(...args);
  }

  inviteToOrganization(
    ...args: Parameters<OrganizationsApi["inviteToOrganization"]>
  ) {
    return this.clients.organizations.inviteToOrganization(...args);
  }

  listProjectMembers(...args: Parameters<ProjectsApi["listProjectMembers"]>) {
    return this.clients.projects.listProjectMembers(...args);
  }

  addProjectMember(...args: Parameters<ProjectsApi["addProjectMember"]>) {
    return this.clients.projects.addProjectMember(...args);
  }

  removeProjectMember(...args: Parameters<ProjectsApi["removeProjectMember"]>) {
    return this.clients.projects.removeProjectMember(...args);
  }

  removeOrganizationMember(
    ...args: Parameters<OrganizationsApi["removeOrganizationMember"]>
  ) {
    return this.clients.organizations.removeOrganizationMember(...args);
  }

  changePassword(...args: Parameters<AuthApi["changePassword"]>) {
    return this.clients.auth.changePassword(...args);
  }

  changeCurrentPassword(...args: Parameters<AuthApi["changeCurrentPassword"]>) {
    return this.clients.auth.changeCurrentPassword(...args);
  }

  onboardBetaUser(...args: Parameters<DebugAdminApi["onboardBetaUser"]>) {
    return this.clients.debugAdmin.onboardBetaUser(...args);
  }

  // Platform Service methods
  findAllProjects(...args: Parameters<ProjectsApi["findAllProjects"]>) {
    return this.clients.projects.findAllProjects(...args);
  }

  createProject(...args: Parameters<ProjectsApi["createProject"]>) {
    return this.clients.projects.createProject(...args);
  }

  getOrganizationProjectEntitlement(
    ...args: Parameters<OrganizationsApi["getOrganizationProjectEntitlement"]>
  ) {
    return this.clients.organizations.getOrganizationProjectEntitlement(
      ...args,
    );
  }

  updateOrganizationProjectEntitlement(
    ...args: Parameters<
      OrganizationsApi["updateOrganizationProjectEntitlement"]
    >
  ) {
    return this.clients.organizations.updateOrganizationProjectEntitlement(
      ...args,
    );
  }

  findOneProject(...args: Parameters<ProjectsApi["findOneProject"]>) {
    return this.clients.projects.findOneProject(...args);
  }

  updateProject(...args: Parameters<ProjectsApi["updateProject"]>) {
    return this.clients.projects.updateProject(...args);
  }

  removeProject(...args: Parameters<ProjectsApi["removeProject"]>) {
    return this.clients.projects.removeProject(...args);
  }

  // Stars methods
  listStars(...args: Parameters<StarsApi["listStars"]>) {
    return this.clients.stars.listStars(...args);
  }

  starEntity(...args: Parameters<StarsApi["starEntity"]>) {
    return this.clients.stars.starEntity(...args);
  }

  unstarEntity(...args: Parameters<StarsApi["unstarEntity"]>) {
    return this.clients.stars.unstarEntity(...args);
  }

  // Knowledge Service methods
  findManyArtifacts(...args: Parameters<ArtifactsApi["findManyArtifacts"]>) {
    return this.clients.artifacts.findManyArtifacts(...args);
  }

  createArtifact(...args: Parameters<ArtifactsApi["createArtifact"]>) {
    return this.clients.artifacts.createArtifact(...args);
  }

  getArtifact(...args: Parameters<ArtifactsApi["getArtifact"]>) {
    return this.clients.artifacts.getArtifact(...args);
  }

  updateArtifact(...args: Parameters<ArtifactsApi["updateArtifact"]>) {
    return this.clients.artifacts.updateArtifact(...args);
  }

  deleteArtifact(...args: Parameters<ArtifactsApi["deleteArtifact"]>) {
    return this.clients.artifacts.deleteArtifact(...args);
  }

  semanticSearchArtifacts(
    ...args: Parameters<SearchApi["semanticSearchArtifacts"]>
  ) {
    return this.clients.search.semanticSearchArtifacts(...args);
  }

  simpleSearchArtifacts(
    ...args: Parameters<SearchApi["simpleSearchArtifacts"]>
  ) {
    return this.clients.search.simpleSearchArtifacts(...args);
  }

  semanticSearch(...args: Parameters<EntitiesApi["semanticSearch"]>) {
    return this.clients.entities.semanticSearch(...args);
  }

  unifiedSearch(...args: Parameters<SearchApi["unifiedSearch"]>) {
    return this.clients.search.unifiedSearch(...args);
  }

  getProjectArtifactSummary(
    ...args: Parameters<ArtifactsApi["getProjectArtifactSummary"]>
  ) {
    return this.clients.artifacts.getProjectArtifactSummary(...args);
  }

  findSimilarArtifacts(
    ...args: Parameters<ArtifactsApi["findSimilarArtifacts"]>
  ) {
    return this.clients.artifacts.findSimilarArtifacts(...args);
  }

  // Design Docs methods
  updateDesignDoc(...args: Parameters<DesignDocsApi["updateDesignDoc"]>) {
    return this.clients.designDocs.updateDesignDoc(...args);
  }

  getDesignDoc(...args: Parameters<DesignDocsApi["getDesignDoc"]>) {
    return this.clients.designDocs.getDesignDoc(...args);
  }

  createDesignDoc(...args: Parameters<DesignDocsApi["createDesignDoc"]>) {
    return this.clients.designDocs.createDesignDoc(...args);
  }

  listDesignDocs(...args: Parameters<DesignDocsApi["listDesignDocs"]>) {
    return this.clients.designDocs.listDesignDocs(...args);
  }

  deleteDesignDoc(...args: Parameters<DesignDocsApi["archiveDesignDoc"]>) {
    return this.clients.designDocs.archiveDesignDoc(...args);
  }

  restoreDesignDoc(...args: Parameters<DesignDocsApi["restoreDesignDoc"]>) {
    return this.clients.designDocs.restoreDesignDoc(...args);
  }

  createDesignDocLinks(
    ...args: Parameters<DesignDocsApi["createDesignDocLink"]>
  ) {
    return this.clients.designDocs.createDesignDocLink(...args);
  }

  getDesignDocLinks(...args: Parameters<DesignDocsApi["listDesignDocLinks"]>) {
    return this.clients.designDocs.listDesignDocLinks(...args);
  }

  // Conversations Service methods
  getAllConversations(
    ...args: Parameters<ConversationsApi["getAllConversations"]>
  ) {
    return this.clients.conversationsApi.getAllConversations(...args);
  }

  getMessages(...args: Parameters<ConversationsApi["getMessages"]>) {
    return this.clients.conversationsApi.getMessages(...args);
  }

  postMessage(...args: Parameters<ConversationsApi["postMessage"]>) {
    return this.clients.conversationsApi.postMessage(...args);
  }

  submitWorkflowAnswer(
    ...args: Parameters<AgentSessionsApi["submitWorkflowAnswer"]>
  ) {
    return this.clients.agentSessions.submitWorkflowAnswer(...args);
  }

  submitOnboardingReply(
    ...args: Parameters<ConversationsApi["submitOnboardingReply"]>
  ) {
    return this.clients.conversationsApi.submitOnboardingReply(...args);
  }

  submitRepositoryImportReply(
    ...args: Parameters<ConversationsApi["submitRepositoryImportReply"]>
  ) {
    return this.clients.conversationsApi.submitRepositoryImportReply(...args);
  }

  stopAgentSessionRun(
    ...args: Parameters<AgentSessionsApi["stopAgentSessionRun"]>
  ) {
    return this.clients.agentSessions.stopAgentSessionRun(...args);
  }

  submitAgentSessionPermissionDecision(
    ...args: Parameters<
      AgentSessionsApi["submitAgentSessionPermissionDecision"]
    >
  ) {
    return this.clients.agentSessions.submitAgentSessionPermissionDecision(
      ...args,
    );
  }

  submitAgentSessionQuestionAnswer(
    ...args: Parameters<AgentSessionsApi["submitAgentSessionQuestionAnswer"]>
  ) {
    return this.clients.agentSessions.submitAgentSessionQuestionAnswer(...args);
  }

  restartPlanGeneration(
    ...args: Parameters<AgentSessionsApi["restartPlanGeneration"]>
  ) {
    return this.clients.agentSessions.restartPlanGeneration(...args);
  }

  listWorkspaceSkills(
    ...args: Parameters<AgentSessionsApi["listWorkspaceSkills"]>
  ) {
    return this.clients.agentSessions.listWorkspaceSkills(...args);
  }

  readAgentSessionCliState(
    ...args: Parameters<AgentSessionsApi["readAgentSessionCliState"]>
  ) {
    return this.clients.agentSessions.readAgentSessionCliState(...args);
  }

  prependMessage(...args: Parameters<ConversationsApi["prependMessage"]>) {
    return this.clients.conversationsApi.prependMessage(...args);
  }

  postRealtimeEvent(
    organizationId: string,
    projectId: string,
    body: {
      conversationId: string;
      messageId: string;
      requestId: string;
      sequence: number;
      kind: string;
      source: string;
      payload?: Record<string, unknown>;
    },
  ) {
    return this.clients.transport.axios.post(
      `/api/v1/organizations/${encodeURIComponent(
        organizationId,
      )}/projects/${encodeURIComponent(projectId)}/messages/realtime`,
      body,
    );
  }

  startConversationRun(
    ...args: Parameters<ConversationsApi["startConversationRun"]>
  ) {
    return this.clients.conversationsApi.startConversationRun(...args);
  }

  retryConversationOpenTrigger(
    ...args: Parameters<ConversationsApi["retryConversationOpenTrigger"]>
  ) {
    return this.clients.conversationsApi.retryConversationOpenTrigger(...args);
  }
  getAgentOperation(request: {
    organizationId: string;
    projectId: string;
    operationId: string;
  }) {
    return this.clients.projects.getAgentOperation(request);
  }

  prepareControllerAuthorization(
    ...args: Parameters<
      ApiClientSet["controllerAuthorization"]["prepareControllerAuthorization"]
    >
  ) {
    return this.clients.controllerAuthorization.prepareControllerAuthorization(
      ...args,
    );
  }

  submitControllerAuthorizedAction(
    ...args: Parameters<
      ApiClientSet["controllerAuthorization"]["submitControllerAuthorizedAction"]
    >
  ) {
    return this.clients.controllerAuthorization.submitControllerAuthorizedAction(
      ...args,
    );
  }

  cloneConversation(
    ...args: Parameters<ConversationsApi["cloneConversation"]>
  ) {
    return this.clients.conversationsApi.cloneConversation(...args);
  }

  getConversationCliStatus(
    ...args: Parameters<ConversationsApi["getConversationCliStatus"]>
  ) {
    return this.clients.conversationsApi.getConversationCliStatus(...args);
  }

  getConversationVersion(
    ...args: Parameters<ConversationsApi["getConversationVersion"]>
  ) {
    return this.clients.conversationsApi.getConversationVersion(...args);
  }

  skipToNode(...args: Parameters<ConversationsApi["skipToNode"]>) {
    return this.clients.conversationsApi.skipToNode(...args);
  }

  // Workflow Service methods
  listWorkflowTemplates(
    ...args: Parameters<WorkflowsApi["listWorkflowTemplates"]>
  ) {
    return this.clients.workflows.listWorkflowTemplates(...args);
  }

  getWorkflowTemplate(
    ...args: Parameters<WorkflowsApi["getWorkflowTemplate"]>
  ) {
    return this.clients.workflows.getWorkflowTemplate(...args);
  }

  // Events Service methods
  getConnectionStats(...args: Parameters<EventsApi["getConnectionStats"]>) {
    return this.clients.eventsApi.getConnectionStats(...args);
  }

  healthCheck(...args: Parameters<EventsApi["healthCheck"]>) {
    return this.clients.eventsApi.healthCheck(...args);
  }

  notifyProject(...args: Parameters<EventsApi["notifyProject"]>) {
    return this.clients.eventsApi.notifyProject(...args);
  }

  notifyConversation(...args: Parameters<EventsApi["notifyConversation"]>) {
    return this.clients.eventsApi.notifyConversation(...args);
  }

  notifyUser(...args: Parameters<EventsApi["notifyUser"]>) {
    return this.clients.eventsApi.notifyUser(...args);
  }

  notifyGlobal(...args: Parameters<EventsApi["notifyGlobal"]>) {
    return this.clients.eventsApi.notifyGlobal(...args);
  }

  // Integration Service methods
  createIntegration(...args: Parameters<IntegrationsApi["createIntegration"]>) {
    return this.clients.integrations.createIntegration(...args);
  }

  findAllIntegrations(
    ...args: Parameters<IntegrationsApi["findAllIntegrations"]>
  ) {
    return this.clients.integrations.findAllIntegrations(...args);
  }

  findOneIntegration(
    ...args: Parameters<IntegrationsApi["findOneIntegration"]>
  ) {
    return this.clients.integrations.findOneIntegration(...args);
  }

  updateIntegration(...args: Parameters<IntegrationsApi["updateIntegration"]>) {
    return this.clients.integrations.updateIntegration(...args);
  }

  removeIntegration(...args: Parameters<IntegrationsApi["removeIntegration"]>) {
    return this.clients.integrations.removeIntegration(...args);
  }

  testIntegrationConnection(
    ...args: Parameters<IntegrationsApi["testIntegrationConnection"]>
  ) {
    return this.clients.integrations.testIntegrationConnection(...args);
  }

  // GitHub Integration Repository methods
  listGitHubRepositories(
    ...args: Parameters<IntegrationsApi["listGitHubRepositories"]>
  ) {
    return this.clients.integrations.listGitHubRepositories(...args);
  }

  updateGitHubPrimaryRepository(
    ...args: Parameters<IntegrationsApi["updateGitHubPrimaryRepository"]>
  ) {
    return this.clients.integrations.updateGitHubPrimaryRepository(...args);
  }

  authorizeGitHubIntegration(
    ...args: Parameters<IntegrationsApi["authorizeGitHubIntegration"]>
  ) {
    return this.clients.integrations.authorizeGitHubIntegration(...args);
  }

  githubOauthCallback(
    ...args: Parameters<IntegrationsApi["githubOauthCallback"]>
  ) {
    return this.clients.integrations.githubOauthCallback(...args);
  }

  // Initiative Service methods
  getOrganizationInitiatives(
    ...args: Parameters<InitiativesApi["getOrganizationInitiatives"]>
  ) {
    return this.clients.initiatives.getOrganizationInitiatives(...args);
  }

  getInitiative(...args: Parameters<InitiativesApi["getInitiative"]>) {
    return this.clients.initiatives.getInitiative(...args);
  }

  createInitiative(...args: Parameters<InitiativesApi["createInitiative"]>) {
    return this.clients.initiatives.createInitiative(...args);
  }

  updateInitiative(...args: Parameters<InitiativesApi["updateInitiative"]>) {
    return this.clients.initiatives.updateInitiative(...args);
  }

  removeInitiative(...args: Parameters<InitiativesApi["removeInitiative"]>) {
    return this.clients.initiatives.removeInitiative(...args);
  }

  async getTask(
    _params: {
      organizationId: string;
      projectId: string;
      taskId: string;
      includeServiceRelations?: boolean;
      includeEdges?: boolean;
      edgeTypes?: AgentEdgeType[];
    },
    options?: AxiosRequestConfig,
  ) {
    return this.clients.tasks.organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet(
      {
        organizationId: _params.organizationId,
        projectId: _params.projectId,
        taskId: _params.taskId,
        includeServiceRelations: _params.includeServiceRelations,
        includeEdges: _params.includeEdges,
        edgeTypes: _params.edgeTypes,
      },
      options,
    );
  }

  async getWorkItemGraph(
    params: {
      organizationId: string;
      projectId: string;
      workItemId: string;
      incidentRelationshipTypes?: Set<WorkItemGraphParticipationType>;
    },
    options?: AxiosRequestConfig,
  ) {
    return this.clients.tasks.organizationsOrganizationIdProjectsProjectIdWorkItemsWorkItemIdGraphGet(
      params,
      options,
    );
  }

  async createTask(params: {
    organizationId: string;
    projectId: string;
    createTaskDto: CreateTaskDto;
  }) {
    return this.clients.tasks.organizationsOrganizationIdProjectsProjectIdTasksPost(
      {
        organizationId: params.organizationId,
        projectId: params.projectId,
        createTaskDto: params.createTaskDto,
      },
    );
  }

  async getTasks(
    params: {
      organizationId: string;
      projectId: string;
      taskIds?: string[];
      status?: WorkStatus | WorkStatus[];
      /** @deprecated Still supported for initiative-scoped views during transition */
      initiativeId?: string;
      parentTaskId?: string | null;
      parentTaskIds?: string[];
      includeDesignDocCounts?: boolean;
      includeAgentSessionCounts?: boolean;
      includeServiceRelations?: boolean;
      includeEdges?: boolean;
      edgeTypes?: AgentEdgeType[];
      includeSectionKeys?: string[];
      includeDescendants?: boolean;
      includeTrackedEntities?: boolean;
      includeTrackedWorkSummary?: boolean;
      type?: string;
      relatedEntityId?: string;
      relatedEntityType?: AgentEdgeEndpointEntityType;
      page?: number;
      limit?: number;
      sortBy?: TaskSortBy;
      sortDir?: TaskSortDir;
    },
    options?: AxiosRequestConfig,
  ) {
    // Convert null to "null" string for API - this allows filtering for tasks with no parent
    const parentTaskIdParam =
      params.parentTaskId === null ? "null" : params.parentTaskId;

    const includeSectionKeysParam = params.includeSectionKeys?.length
      ? params.includeSectionKeys
      : undefined;
    const statusParam = params.status
      ? Array.isArray(params.status)
        ? params.status
        : [params.status]
      : undefined;

    return this.clients.tasks.organizationsOrganizationIdProjectsProjectIdTasksGet(
      {
        organizationId: params.organizationId,
        projectId: params.projectId,
        initiativeId: params.initiativeId,
        parentTaskId: parentTaskIdParam,
        parentTaskIds: params.parentTaskIds
          ? new Set(params.parentTaskIds)
          : undefined,
        includeDescendants: params.includeDescendants || undefined,
        includeTrackedEntities: params.includeTrackedEntities,
        includeTrackedWorkSummary: params.includeTrackedWorkSummary,
        taskIds: params.taskIds ? new Set(params.taskIds) : undefined,
        status: statusParam,
        includeDesignDocCounts: params.includeDesignDocCounts,
        includeAgentSessionCounts: params.includeAgentSessionCounts,
        includeServiceRelations: params.includeServiceRelations,
        includeEdges: params.includeEdges,
        edgeTypes: params.edgeTypes,
        includeSectionKeys: includeSectionKeysParam,
        type: params.type,
        relatedEntityId: params.relatedEntityId,
        relatedEntityType: params.relatedEntityType,
        page: params.page,
        limit: params.limit,
        sortBy: params.sortBy,
        sortDir: params.sortDir,
      },
      options,
    );
  }

  listWorkItemReferences(
    ...args: Parameters<
      TasksApi["organizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGet"]
    >
  ) {
    return this.clients.tasks.organizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGet(
      ...args,
    );
  }

  async updateTask(params: {
    organizationId: string;
    projectId: string;
    taskId: string;
    updateTaskDto: UpdateTaskDto;
  }) {
    return this.clients.tasks.organizationsOrganizationIdProjectsProjectIdTasksTaskIdPatch(
      {
        organizationId: params.organizationId,
        projectId: params.projectId,
        taskId: params.taskId,
        updateTaskDto: params.updateTaskDto,
      },
    );
  }

  async removeTask(params: {
    organizationId: string;
    projectId: string;
    taskId: string;
  }) {
    return this.clients.tasks.organizationsOrganizationIdProjectsProjectIdTasksTaskIdDelete(
      {
        organizationId: params.organizationId,
        projectId: params.projectId,
        taskId: params.taskId,
      },
    );
  }

  async attachToGoal(params: {
    organizationId: string;
    projectId: string;
    taskId: string;
    attachToGoalDto: AttachToGoalDto;
  }) {
    return this.clients.tasks.attachToGoal({
      organizationId: params.organizationId,
      projectId: params.projectId,
      taskId: params.taskId,
      attachToGoalDto: params.attachToGoalDto,
    });
  }

  async detachFromGoal(params: {
    organizationId: string;
    projectId: string;
    taskId: string;
    detachFromGoalDto: DetachFromGoalDto;
  }) {
    return this.clients.tasks.detachFromGoal({
      organizationId: params.organizationId,
      projectId: params.projectId,
      taskId: params.taskId,
      detachFromGoalDto: params.detachFromGoalDto,
    });
  }

  async generateSuggestedTask(params: {
    organizationId: string;
    createSuggestedTaskRequestDto: CreateSuggestedTaskRequestDto;
  }) {
    return this.clients.suggestions.generateTaskSuggestion({
      organizationId: params.organizationId,
      createSuggestedTaskRequestDto: params.createSuggestedTaskRequestDto,
    });
  }

  createAgentEdge(params: {
    organizationId: string;
    projectId: string;
    request: CreateAgentEdgeInput;
  }) {
    return this.clients.agentEdges.createAgentEdge({
      organizationId: params.organizationId,
      projectId: params.projectId,
      createAgentEdgeRequest: toGeneratedCreateAgentEdgeRequest(params.request),
    });
  }

  // Workflow Debug methods
  async getWorkflowStatusDebug(
    ...args: Parameters<DebugAdminApi["getWorkflowStatusDebug"]>
  ) {
    return this.clients.debugAdmin.getWorkflowStatusDebug(...args);
  }

  async getWorkflowStatusDebugWithLogs(
    workflowId: string,
    includeLogs = false,
  ) {
    // For now, we'll use the existing method with query parameters
    // This will need to be updated when the OpenAPI spec supports includeLogs
    const options = includeLogs
      ? {
          params: { includeLogs: "true" },
        }
      : {};

    return this.clients.debugAdmin.getWorkflowStatusDebug(
      { workflowId: workflowId },
      options,
    );
  }

  // Message Retry methods
  async retryMessage(
    organizationId: string,
    projectId: string,
    messageId: string,
  ) {
    return this.clients.conversationsApi.retryMessage({
      id: messageId,
      projectId: projectId,
      organizationId: organizationId,
    });
  }

  async getMessageRetryStatus(
    organizationId: string,
    projectId: string,
    messageId: string,
  ) {
    return this.clients.conversationsApi.getRetryStatus({
      id: messageId,
      projectId: projectId,
      organizationId: organizationId,
    });
  }

  // Tags Service methods
  async listTags(...args: Parameters<TagsApi["listTags"]>) {
    return this.clients.tags.listTags(...args);
  }

  async createTag(...args: Parameters<TagsApi["createTag"]>) {
    return this.clients.tags.createTag(...args);
  }

  async getTagById(...args: Parameters<TagsApi["getTagById"]>) {
    return this.clients.tags.getTagById(...args);
  }

  async updateTag(...args: Parameters<TagsApi["updateTag"]>) {
    return this.clients.tags.updateTag(...args);
  }

  async deleteTag(...args: Parameters<TagsApi["deleteTag"]>) {
    return this.clients.tags.deleteTag(...args);
  }

  // Agent Sessions Service methods
  listAgentSessions(
    ...args: Parameters<AgentSessionsApi["listAgentSessions"]>
  ) {
    return this.clients.agentSessions.listAgentSessions(...args);
  }

  createAgentSession(
    ...args: Parameters<AgentSessionsApi["createAgentSession"]>
  ) {
    return this.clients.agentSessions.createAgentSession(...args);
  }

  async deleteAgentSession(
    organizationId: string,
    projectId: string,
    agentSessionId: string,
  ) {
    return this.clients.agentSessions.deleteAgentSession({
      organizationId: organizationId,
      projectId: projectId,
      agentSessionId: agentSessionId,
    });
  }

  createReport(...args: Parameters<ReportsApi["createReport"]>) {
    return this.clients.reports.createReport(...args);
  }

  listReports(...args: Parameters<ReportsApi["listReports"]>) {
    return this.clients.reports.listReports(...args);
  }

  listProjectReports(...args: Parameters<ReportsApi["listProjectReports"]>) {
    return this.clients.reports.listProjectReports(...args);
  }

  deleteReport(...args: Parameters<ReportsApi["deleteReport"]>) {
    return this.clients.reports.deleteReport(...args);
  }

  getReport(...args: Parameters<ReportsApi["getReport"]>) {
    return this.clients.reports.getReport(...args);
  }

  updateReport(...args: Parameters<ReportsApi["updateReport"]>) {
    return this.clients.reports.updateReport(...args);
  }

  getLLMRequestStatus(
    ...args: Parameters<DevelopmentApi["getLLMRequestStatus"]>
  ) {
    return this.clients.development.getLLMRequestStatus(...args);
  }

  getCorrelatedActivity(
    ...args: Parameters<ActivityCorrelationApi["getCorrelatedActivity"]>
  ) {
    return this.clients.activityCorrelation.getCorrelatedActivity(...args);
  }

  getCorrelatedActivityByEntity(
    ...args: Parameters<ActivityCorrelationApi["getCorrelatedActivityByEntity"]>
  ) {
    return this.clients.activityCorrelation.getCorrelatedActivityByEntity(
      ...args,
    );
  }

  queryActivity(...args: Parameters<ActivityCorrelationApi["queryActivity"]>) {
    return this.clients.activityCorrelation.queryActivity(...args);
  }

  // Implementation Hints Service methods
  listImplementationHints(
    ...args: Parameters<ImplementationHintsApi["listImplementationHints"]>
  ) {
    return this.clients.implementationHints.listImplementationHints(...args);
  }

  getImplementationHint(
    ...args: Parameters<ImplementationHintsApi["getImplementationHint"]>
  ) {
    return this.clients.implementationHints.getImplementationHint(...args);
  }

  createImplementationHint(
    ...args: Parameters<ImplementationHintsApi["createImplementationHint"]>
  ) {
    return this.clients.implementationHints.createImplementationHint(...args);
  }

  updateImplementationHint(
    ...args: Parameters<ImplementationHintsApi["updateImplementationHint"]>
  ) {
    return this.clients.implementationHints.updateImplementationHint(...args);
  }

  deleteImplementationHint(
    ...args: Parameters<ImplementationHintsApi["deleteImplementationHint"]>
  ) {
    return this.clients.implementationHints.deleteImplementationHint(...args);
  }

  // Secondary Actions Service methods
  getSecondaryActions(
    ...args: Parameters<SecondaryActionsApi["listSecondaryActions"]>
  ) {
    return this.clients.secondaryActions.listSecondaryActions(...args);
  }

  // Debug Admin Service methods
  getLlmTrackingRecord(
    ...args: Parameters<DebugAdminApi["getLlmTrackingRecord"]>
  ) {
    return this.clients.debugAdmin.getLlmTrackingRecord(...args);
  }

  getLlmTrackingRecords(
    ...args: Parameters<DebugAdminApi["getLlmTrackingRecords"]>
  ) {
    return this.clients.debugAdmin.getLlmTrackingRecords(...args);
  }

  getDebugEmbeddingsEntity(
    ...args: Parameters<DebugAdminApi["getDebugEmbeddingsEntity"]>
  ) {
    return this.clients.debugAdmin.getDebugEmbeddingsEntity(...args);
  }

  // Help Service methods
  getHelpNode(...args: Parameters<HelpApi["getHelpNode"]>) {
    return this.clients.help.getHelpNode(...args);
  }

  getHelpTree(...args: Parameters<HelpApi["getHelpTree"]>) {
    return this.clients.help.getHelpTree(...args);
  }

  searchHelp(...args: Parameters<HelpApi["searchHelp"]>) {
    return this.clients.help.searchHelp(...args);
  }

  reportBug(...args: Parameters<ReportBugsApi["reportBug"]>) {
    return this.clients.reportBugs.reportBug(...args);
  }

  // Entity Prompt Templates Service methods
  getProjectEntityPromptTemplateCatalog(
    ...args: Parameters<
      EntityPromptTemplatesApi["getProjectEntityPromptTemplateCatalog"]
    >
  ) {
    return this.clients.entityPromptTemplates.getProjectEntityPromptTemplateCatalog(
      ...args,
    );
  }

  getEffectiveEntityPromptTemplate(
    ...args: Parameters<
      EntityPromptTemplatesApi["getEffectiveEntityPromptTemplate"]
    >
  ) {
    return this.clients.entityPromptTemplates.getEffectiveEntityPromptTemplate(
      ...args,
    );
  }
}

// Provide a default unified client instance for legacy consumers that import the
// client directly from this module. This mirrors the behaviour of the runtime
// proxy while still allowing tests to mock the client easily.
const fallbackUnifiedApiClient = new UnifiedApiClient(getResolvedClients());

export const unifiedApiClient: UnifiedApiClient = new Proxy(
  {} as UnifiedApiClient,
  {
    get(_target, property, receiver) {
      const client = runtimeUnifiedClient ?? fallbackUnifiedApiClient;
      const value = (client as unknown as Record<PropertyKey, unknown>)[
        property
      ];
      if (typeof value === "function") {
        return value.bind(client);
      }
      return Reflect.get(client as object, property, receiver);
    },
  },
);

export const createUnifiedApiClient = (
  runtime: ApiRuntime,
): UnifiedApiClient => {
  return new UnifiedApiClient(runtime.clients);
};
