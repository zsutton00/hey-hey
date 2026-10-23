import axios, {
  AxiosHeaders,
  type AxiosHeaderValue,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import {
  captureRequestOptions,
  installRequestInitiatorTracking,
} from "../data/core/requestInitiator";
import {
  ActivityCorrelationApi,
  AgentEdgesApi,
  AnalyticsApi,
  ArtifactsApi,
  AuthApi,
  ControllerAuthorizationApi,
  AgentSessionsApi,
  ConversationsApi,
  CodingPromptsApi,
  Configuration,
  DebugAdminApi,
  DemoSandboxesApi,
  DesignDocsApi,
  DevelopmentApi,
  EntitiesApi,
  EntityContextApi,
  EntityPromptTemplatesApi,
  EvalRunsApi,
  EventsApi,
  ExecutionsApi,
  HelpApi,
  ImplementationHintsApi,
  InitiativesApi,
  IntegrationsApi,
  MachinesApi,
  McpApi,
  NotificationsApi,
  OpenItemsApi,
  OrganizationsApi,
  PaymentProviderWebhooksApi,
  PlansApi,
  PrivateBetaAccessApi,
  ProjectReportsApi,
  ProjectsApi,
  ProposalsApi,
  ReportBugsApi,
  ReportsApi,
  SearchApi,
  SecondaryActionsApi,
  ServicesApi,
  StagedContentApi,
  StarsApi,
  SuggestionsApi,
  TagsApi,
  TasksApi,
  TopologyApi,
  UserSettingsApi,
  ValidationSessionsApi,
  WebhooksApi,
  WorkItemRefinementApi,
  WorkItemTypesApi,
  WorkflowsApi,
} from "../api";

export interface ApiTransport {
  axios: AxiosInstance;
  request<T = unknown, R = AxiosResponse<T>>(
    config: AxiosRequestConfig,
  ): Promise<R>;
  setAuthToken(token: string | null): void;
  onUnauthorized?(listener: () => void): () => void;
}

declare const ACCESS_TOKEN_BRAND: unique symbol;
export type AccessToken = string & { readonly [ACCESS_TOKEN_BRAND]: true };

export const createAccessToken = (token: string): AccessToken =>
  token as AccessToken;

export interface ApiAuthAdapter {
  getAccessToken(): AccessToken | null;
  refreshAccessToken(): Promise<AccessToken | null>;
  onAuthChanged(listener: (token: AccessToken | null) => void): () => void;
  onUnauthorized(): void;
}

type GeneratedApiClient =
  | ActivityCorrelationApi
  | AgentEdgesApi
  | AgentSessionsApi
  | AnalyticsApi
  | ArtifactsApi
  | AuthApi
  | CodingPromptsApi
  | ControllerAuthorizationApi
  | ConversationsApi
  | DebugAdminApi
  | DemoSandboxesApi
  | DesignDocsApi
  | DevelopmentApi
  | EntitiesApi
  | EntityContextApi
  | EntityPromptTemplatesApi
  | EvalRunsApi
  | EventsApi
  | ExecutionsApi
  | HelpApi
  | ImplementationHintsApi
  | InitiativesApi
  | IntegrationsApi
  | MachinesApi
  | McpApi
  | NotificationsApi
  | OpenItemsApi
  | OrganizationsApi
  | PaymentProviderWebhooksApi
  | PlansApi
  | PrivateBetaAccessApi
  | ProjectReportsApi
  | ProjectsApi
  | ProposalsApi
  | ReportBugsApi
  | ReportsApi
  | SearchApi
  | SecondaryActionsApi
  | ServicesApi
  | StagedContentApi
  | StarsApi
  | SuggestionsApi
  | TagsApi
  | TasksApi
  | TopologyApi
  | UserSettingsApi
  | ValidationSessionsApi
  | WebhooksApi
  | WorkItemRefinementApi
  | WorkItemTypesApi
  | WorkflowsApi;

/**
 * The former generated DefaultApi was an aggregate of all tagged API
 * operations. Keep that aggregate at the runtime boundary while routing each
 * operation to the regenerated tagged client that owns it.
 */
export type LegacyApiClient = ActivityCorrelationApi &
  AgentEdgesApi &
  AgentSessionsApi &
  AnalyticsApi &
  ArtifactsApi &
  AuthApi &
  CodingPromptsApi &
  ControllerAuthorizationApi &
  ConversationsApi &
  DebugAdminApi &
  DesignDocsApi &
  DevelopmentApi &
  EntitiesApi &
  EntityContextApi &
  EvalRunsApi &
  EventsApi &
  ExecutionsApi &
  HelpApi &
  ImplementationHintsApi &
  InitiativesApi &
  IntegrationsApi &
  MachinesApi &
  McpApi &
  NotificationsApi &
  OpenItemsApi &
  OrganizationsApi &
  PaymentProviderWebhooksApi &
  PlansApi &
  PrivateBetaAccessApi &
  ProjectsApi &
  ProposalsApi &
  ReportBugsApi &
  ReportsApi &
  SearchApi &
  SecondaryActionsApi &
  ServicesApi &
  StagedContentApi &
  StarsApi &
  SuggestionsApi &
  TagsApi &
  TasksApi &
  TopologyApi &
  UserSettingsApi &
  ValidationSessionsApi &
  WebhooksApi &
  WorkItemRefinementApi &
  WorkItemTypesApi &
  WorkflowsApi;

export interface ApiClientSet {
  transport: ApiTransport;
  default: LegacyApiClient;
  identity: LegacyApiClient;
  platform: LegacyApiClient;
  knowledge: LegacyApiClient;
  conversations: LegacyApiClient;
  workflows: WorkflowsApi;
  events: LegacyApiClient;
  tasks: TasksApi;
  projects: ProjectsApi;
  workItemRefinement: WorkItemRefinementApi;
  workItemTypes: WorkItemTypesApi;
  suggestions: SuggestionsApi;
  plans: PlansApi;
  debugAdmin: DebugAdminApi;
  stagedContent: StagedContentApi;
  designDocs: DesignDocsApi;
  agentSessions: AgentSessionsApi;
  analytics: AnalyticsApi;
  reports: ReportsApi;
  projectReports: ProjectReportsApi;
  evalRuns: EvalRunsApi;
  notifications: NotificationsApi;
  openItems: OpenItemsApi;
  privateBetaAccess: PrivateBetaAccessApi;
  demoSandboxes: DemoSandboxesApi;
  activityCorrelation: ActivityCorrelationApi;
  agentEdges: AgentEdgesApi;
  secondaryActions: SecondaryActionsApi;
  entityContext: EntityContextApi;
  help: HelpApi;
  entities: EntitiesApi;
  entityPromptTemplates: EntityPromptTemplatesApi;
  proposals: ProposalsApi;
  reportBugs: ReportBugsApi;
  machines: MachinesApi;
  controllerAuthorization: ControllerAuthorizationApi;
  auth: AuthApi;
  organizations: OrganizationsApi;
  artifacts: ArtifactsApi;
  search: SearchApi;
  initiatives: InitiativesApi;
  integrations: IntegrationsApi;
  development: DevelopmentApi;
  implementationHints: ImplementationHintsApi;
  services: ServicesApi;
  stars: StarsApi;
  tags: TagsApi;
  topology: TopologyApi;
  conversationsApi: ConversationsApi;
  eventsApi: EventsApi;
}

export interface ApiRuntime {
  baseUrl: string;
  transport: ApiTransport;
  clients: ApiClientSet;
}

export interface CreateApiRuntimeOptions {
  baseUrl: string;
  transport: ApiTransport;
}

const ensureAxiosHeaders = (
  headers?: AxiosRequestConfig["headers"],
): AxiosHeaders => {
  if (!headers) {
    return new AxiosHeaders();
  }

  if (headers instanceof AxiosHeaders) {
    return headers;
  }

  return AxiosHeaders.from(
    headers as AxiosHeaders | string | Record<string, AxiosHeaderValue>,
  );
};

const getRequestPath = (
  url: string | undefined,
  baseUrl: string | undefined,
): string | null => {
  if (!url) {
    return null;
  }

  try {
    return new URL(url, baseUrl ?? "http://api.invalid").pathname;
  } catch {
    return url.split("?", 1)[0]!;
  }
};

const coerceAccessToken = (token: string | null): AccessToken | null =>
  token === null ? null : createAccessToken(token);

type ApiClientConstructor<T extends GeneratedApiClient> = new (
  configuration?: Configuration,
  basePath?: string,
  axios?: AxiosInstance,
) => T;

const createApiClient = <T extends GeneratedApiClient>(
  ApiClient: ApiClientConstructor<T>,
  configuration: Configuration,
  transport: ApiTransport,
): T => new ApiClient(configuration, undefined, transport.axios);

const createRoutedApiClient = <T extends object>(
  clients: readonly GeneratedApiClient[],
): T =>
  new Proxy({} as T, {
    get: (_target, property) => {
      if (property === "constructor") {
        return undefined;
      }

      for (const client of clients) {
        const value = Reflect.get(client, property, client);
        if (value !== undefined) {
          return typeof value === "function" ? value.bind(client) : value;
        }
      }

      return undefined;
    },
  });

const createLegacyAuthAdapter = (
  refreshAuthToken?: () => Promise<string | null>,
  onUnauthorized?: () => void,
): ApiAuthAdapter | null => {
  if (!refreshAuthToken && !onUnauthorized) {
    return null;
  }

  return {
    getAccessToken: () => null,
    refreshAccessToken: async () => {
      if (!refreshAuthToken) {
        return null;
      }

      const nextToken = await refreshAuthToken();
      return coerceAccessToken(nextToken);
    },
    onAuthChanged: () => () => {},
    onUnauthorized: () => {
      onUnauthorized?.();
    },
  };
};

const createClientSet = (
  configuration: Configuration,
  transport: ApiTransport,
): ApiClientSet => {
  const generatedClients = {
    activityCorrelation: createApiClient(
      ActivityCorrelationApi,
      configuration,
      transport,
    ),
    agentEdges: createApiClient(AgentEdgesApi, configuration, transport),
    agentSessions: createApiClient(AgentSessionsApi, configuration, transport),
    analytics: createApiClient(AnalyticsApi, configuration, transport),
    artifacts: createApiClient(ArtifactsApi, configuration, transport),
    auth: createApiClient(AuthApi, configuration, transport),
    codingPrompts: createApiClient(CodingPromptsApi, configuration, transport),
    controllerAuthorization: createApiClient(
      ControllerAuthorizationApi,
      configuration,
      transport,
    ),
    conversations: createApiClient(ConversationsApi, configuration, transport),
    debugAdmin: createApiClient(DebugAdminApi, configuration, transport),
    demoSandboxes: createApiClient(DemoSandboxesApi, configuration, transport),
    designDocs: createApiClient(DesignDocsApi, configuration, transport),
    development: createApiClient(DevelopmentApi, configuration, transport),
    entities: createApiClient(EntitiesApi, configuration, transport),
    entityContext: createApiClient(EntityContextApi, configuration, transport),
    entityPromptTemplates: createApiClient(
      EntityPromptTemplatesApi,
      configuration,
      transport,
    ),
    evalRuns: createApiClient(EvalRunsApi, configuration, transport),
    events: createApiClient(EventsApi, configuration, transport),
    executions: createApiClient(ExecutionsApi, configuration, transport),
    help: createApiClient(HelpApi, configuration, transport),
    implementationHints: createApiClient(
      ImplementationHintsApi,
      configuration,
      transport,
    ),
    initiatives: createApiClient(InitiativesApi, configuration, transport),
    integrations: createApiClient(IntegrationsApi, configuration, transport),
    machines: createApiClient(MachinesApi, configuration, transport),
    mcp: createApiClient(McpApi, configuration, transport),
    notifications: createApiClient(NotificationsApi, configuration, transport),
    openItems: createApiClient(OpenItemsApi, configuration, transport),
    organizations: createApiClient(OrganizationsApi, configuration, transport),
    paymentProviderWebhooks: createApiClient(
      PaymentProviderWebhooksApi,
      configuration,
      transport,
    ),
    plans: createApiClient(PlansApi, configuration, transport),
    privateBetaAccess: createApiClient(
      PrivateBetaAccessApi,
      configuration,
      transport,
    ),
    projects: createApiClient(ProjectsApi, configuration, transport),
    proposals: createApiClient(ProposalsApi, configuration, transport),
    reportBugs: createApiClient(ReportBugsApi, configuration, transport),
    reports: createApiClient(ReportsApi, configuration, transport),
    projectReports: createApiClient(
      ProjectReportsApi,
      configuration,
      transport,
    ),
    search: createApiClient(SearchApi, configuration, transport),
    secondaryActions: createApiClient(
      SecondaryActionsApi,
      configuration,
      transport,
    ),
    services: createApiClient(ServicesApi, configuration, transport),
    stagedContent: createApiClient(StagedContentApi, configuration, transport),
    stars: createApiClient(StarsApi, configuration, transport),
    suggestions: createApiClient(SuggestionsApi, configuration, transport),
    tags: createApiClient(TagsApi, configuration, transport),
    tasks: createApiClient(TasksApi, configuration, transport),
    topology: createApiClient(TopologyApi, configuration, transport),
    userSettings: createApiClient(UserSettingsApi, configuration, transport),
    validationSessions: createApiClient(
      ValidationSessionsApi,
      configuration,
      transport,
    ),
    webhooks: createApiClient(WebhooksApi, configuration, transport),
    workItemRefinement: createApiClient(
      WorkItemRefinementApi,
      configuration,
      transport,
    ),
    workItemTypes: createApiClient(WorkItemTypesApi, configuration, transport),
    workflows: createApiClient(WorkflowsApi, configuration, transport),
  } satisfies Record<string, GeneratedApiClient>;

  const defaultClient = createRoutedApiClient<LegacyApiClient>(
    Object.values(generatedClients),
  );

  return {
    transport,
    default: defaultClient,
    identity: defaultClient,
    platform: defaultClient,
    knowledge: defaultClient,
    conversations: defaultClient,
    workflows: generatedClients.workflows,
    events: defaultClient,
    tasks: generatedClients.tasks,
    projects: generatedClients.projects,
    workItemRefinement: generatedClients.workItemRefinement,
    workItemTypes: generatedClients.workItemTypes,
    suggestions: generatedClients.suggestions,
    plans: generatedClients.plans,
    debugAdmin: generatedClients.debugAdmin,
    stagedContent: generatedClients.stagedContent,
    designDocs: generatedClients.designDocs,
    agentSessions: generatedClients.agentSessions,
    analytics: generatedClients.analytics,
    reports: generatedClients.reports,
    projectReports: generatedClients.projectReports,
    evalRuns: generatedClients.evalRuns,
    notifications: generatedClients.notifications,
    openItems: generatedClients.openItems,
    privateBetaAccess: generatedClients.privateBetaAccess,
    demoSandboxes: generatedClients.demoSandboxes,
    activityCorrelation: generatedClients.activityCorrelation,
    agentEdges: generatedClients.agentEdges,
    secondaryActions: generatedClients.secondaryActions,
    entityContext: generatedClients.entityContext,
    help: generatedClients.help,
    entities: generatedClients.entities,
    entityPromptTemplates: generatedClients.entityPromptTemplates,
    proposals: generatedClients.proposals,
    reportBugs: generatedClients.reportBugs,
    machines: generatedClients.machines,
    controllerAuthorization: generatedClients.controllerAuthorization,
    auth: generatedClients.auth,
    organizations: generatedClients.organizations,
    artifacts: generatedClients.artifacts,
    search: generatedClients.search,
    initiatives: generatedClients.initiatives,
    integrations: generatedClients.integrations,
    development: generatedClients.development,
    implementationHints: generatedClients.implementationHints,
    services: generatedClients.services,
    stars: generatedClients.stars,
    tags: generatedClients.tags,
    topology: generatedClients.topology,
    conversationsApi: generatedClients.conversations,
    eventsApi: generatedClients.events,
  };
};

const attachAuthInterceptors = ({
  axiosInstance,
  authAdapter,
  includeBrowserCredentials,
}: {
  axiosInstance: AxiosInstance;
  authAdapter: ApiAuthAdapter | null;
  includeBrowserCredentials: boolean;
}): {
  setAuthToken: (token: string | null) => void;
  onUnauthorized: (listener: () => void) => () => void;
} => {
  let authToken: AccessToken | null = authAdapter?.getAccessToken() ?? null;
  let refreshPromise: Promise<AccessToken | null> | null = null;
  let hasNotifiedUnauthorized = false;
  const unauthorizedListeners = new Set<() => void>();

  if (authAdapter) {
    unauthorizedListeners.add(() => authAdapter.onUnauthorized());
    authAdapter.onAuthChanged((token) => {
      authToken = token;
      if (token) {
        hasNotifiedUnauthorized = false;
      }
    });
  }

  const notifyUnauthorized = () => {
    if (hasNotifiedUnauthorized) {
      return;
    }

    hasNotifiedUnauthorized = true;
    unauthorizedListeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.error("Unhandled onUnauthorized listener error", error);
      }
    });
  };

  const refreshAuthToken = async (): Promise<AccessToken | null> => {
    if (!authAdapter) {
      return null;
    }

    if (!refreshPromise) {
      refreshPromise = authAdapter
        .refreshAccessToken()
        .then((token) => {
          authToken = token;
          if (token) {
            hasNotifiedUnauthorized = false;
          } else {
            notifyUnauthorized();
          }
          return token;
        })
        .catch((error: unknown) => {
          notifyUnauthorized();
          throw error;
        })
        .finally(() => {
          refreshPromise = null;
        });
    }

    return refreshPromise;
  };

  axiosInstance.interceptors.request.use((config) => {
    const headers = ensureAxiosHeaders(config.headers);

    if (authToken) {
      headers.set("Authorization", `Bearer ${authToken}`);
    }

    if (includeBrowserCredentials) {
      config.withCredentials = true;
    }

    config.headers = headers;

    return config;
  });

  axiosInstance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const { response, config } = error;
      const requestConfig = config as AxiosRequestConfig & { _retry?: boolean };

      const requestPath = getRequestPath(
        requestConfig.url,
        axiosInstance.defaults.baseURL,
      );
      const isRefreshRequest =
        requestPath === "/auth/refresh" ||
        requestPath?.endsWith("/auth/refresh") === true;
      const handlesOwnUnauthorizedResponse =
        requestPath === "/auth/login" ||
        requestPath === "/auth/change-current-password" ||
        requestPath?.endsWith("/auth/login") === true ||
        requestPath?.endsWith("/auth/change-current-password") === true;

      if (response?.status === 401 && isRefreshRequest) {
        notifyUnauthorized();
        return Promise.reject(error);
      }

      if (response?.status === 401 && handlesOwnUnauthorizedResponse) {
        return Promise.reject(error);
      }

      if (response?.status === 401 && requestConfig._retry) {
        notifyUnauthorized();
        return Promise.reject(error);
      }

      if (response?.status === 401) {
        requestConfig._retry = true;

        try {
          const refreshedToken = await refreshAuthToken();
          if (refreshedToken) {
            const headers = ensureAxiosHeaders(requestConfig.headers);
            headers.set("Authorization", `Bearer ${refreshedToken}`);
            requestConfig.headers = headers;
            return axiosInstance(requestConfig);
          }
        } catch (refreshError) {
          return Promise.reject(refreshError);
        }
      }

      return Promise.reject(error);
    },
  );

  return {
    setAuthToken: (token) => {
      authToken = coerceAccessToken(token);
      if (authToken) {
        hasNotifiedUnauthorized = false;
      }
    },
    onUnauthorized: (listener) => {
      unauthorizedListeners.add(listener);
      return () => unauthorizedListeners.delete(listener);
    },
  };
};

export const createApiRuntime = ({
  baseUrl,
  transport,
}: CreateApiRuntimeOptions): ApiRuntime => {
  const configuration = new Configuration({
    basePath: baseUrl,
  });

  attachInitiatorBaseOptions(configuration);
  installRequestInitiatorTracking(transport.axios);

  return {
    baseUrl,
    transport,
    clients: createClientSet(configuration, transport),
  };
};

const attachInitiatorBaseOptions = (configuration: Configuration) => {
  Object.defineProperty(configuration, "baseOptions", {
    configurable: true,
    enumerable: true,
    get: captureRequestOptions,
  });
};

export interface BrowserRuntimeOptions {
  baseUrl: string;
  authAdapter?: ApiAuthAdapter;
  refreshAuthToken?: () => Promise<string | null>;
  onUnauthorized?: () => void;
}

export const createBrowserApiRuntime = (
  options: BrowserRuntimeOptions,
): ApiRuntime => {
  const axiosInstance = axios.create({
    baseURL: options.baseUrl,
  });

  const authAdapter =
    options.authAdapter ??
    createLegacyAuthAdapter(options.refreshAuthToken, options.onUnauthorized);

  const authControls = attachAuthInterceptors({
    axiosInstance,
    authAdapter,
    includeBrowserCredentials: true,
  });

  if (options.onUnauthorized && options.authAdapter) {
    authControls.onUnauthorized(options.onUnauthorized);
  }

  const transport: ApiTransport = {
    axios: axiosInstance,
    request: (config) => axiosInstance.request(config),
    setAuthToken: authControls.setAuthToken,
    onUnauthorized: authControls.onUnauthorized,
  };

  return createApiRuntime({
    baseUrl: options.baseUrl,
    transport,
  });
};

export interface VsCodeRuntimeOptions {
  baseUrl: string;
  fetchImplementation: typeof fetch;
  authAdapter?: ApiAuthAdapter;
  refreshAuthToken?: () => Promise<string | null>;
  onUnauthorized?: () => void;
}

export const createVsCodeApiRuntime = (
  options: VsCodeRuntimeOptions,
): ApiRuntime => {
  const axiosInstance = axios.create({
    baseURL: options.baseUrl,
  });

  // Placeholder: consumers should supply a fetch-backed adapter when wiring up
  // the VS Code extension runtime.
  console.warn(
    "createVsCodeApiRuntime currently uses axios defaults. Provide a custom adapter for the VS Code fetch implementation when integrating.",
  );

  // Suppress unused parameter warning until the adapter wiring is implemented.
  void options.fetchImplementation;

  const authAdapter =
    options.authAdapter ??
    createLegacyAuthAdapter(options.refreshAuthToken, options.onUnauthorized);

  const authControls = attachAuthInterceptors({
    axiosInstance,
    authAdapter,
    includeBrowserCredentials: false,
  });

  if (options.onUnauthorized && options.authAdapter) {
    authControls.onUnauthorized(options.onUnauthorized);
  }

  const transport: ApiTransport = {
    axios: axiosInstance,
    request: (config) => axiosInstance.request(config),
    setAuthToken: authControls.setAuthToken,
    onUnauthorized: authControls.onUnauthorized,
  };

  return createApiRuntime({
    baseUrl: options.baseUrl,
    transport,
  });
};
