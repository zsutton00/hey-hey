import { OrganizationAccessBoundary } from "./components/OrganizationAccessBoundary";
import type { ComponentType, FC, ReactElement, ReactNode } from "react";
import { Suspense, lazy } from "react";
import { WebClientProvider } from "@hey-hey/ui-common/clients";
import { ActionsCapsuleProvider } from "@hey-hey/ui-common/components/ActionsCapsule";
import {
  CanonicalWalkthroughEvents,
  GuidedWalkthroughProvider,
} from "@hey-hey/ui-common/components/GuidedWalkthrough";
import { DndProvider } from "@hey-hey/ui-common/context";
import { ControllerAuthorizationPromptHost } from "@hey-hey/ui-common/data";
import {
  AuthProvider,
  CanonicalPageProvider,
  DebugProvider,
  EntityActivationProvider,
  ModalProvider,
  OpenItemLocatorProvider,
  OrganizationProvider,
  WebSocketProvider,
  useOrganization,
  useAuth,
} from "@hey-hey/ui-common/context";
import { GlobalStyles } from "@mui/material";
import { QueryClient } from "@tanstack/react-query";
import { QueryClientAtomProvider } from "jotai-tanstack-query/react";
import { LazyAnimatePresence } from "./components/LazyAnimatePresence";
import { NuqsAdapter } from "nuqs/adapters/react-router";
import {
  Navigate,
  Route,
  RouterProvider,
  createBrowserRouter,
  createRoutesFromElements,
  useLocation,
} from "react-router-dom";
import "./App.css";
import { getApiBaseUrl, getWsUrl } from "@hey-hey/ui-common/services";
import { AppProtectedRoute } from "./components/AppProtectedRoute";
import { HeyHeyModal } from "./components/HeyHeyModal";
import { Layout } from "./components/Layout";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { OpenItemsPreviewHost } from "./components/OpenItemsPreviewHost";
import { usePageMetadata } from "./hooks/usePageMetadata";
import { useTabLocationRegistry } from "./hooks/useTabLocationRegistry";
import { LEGAL_ROUTES } from "./pages/Legal/legalContent";
import {
  OpenItemsProvider,
  useOpenItemLocatorHandler,
  useOpenItemsActivationSink,
} from "./contexts/OpenItemsContext";

const queryClient = new QueryClient();
const apiBaseUrl = getApiBaseUrl();
const wsUrl = getWsUrl();

type RouteModule = Record<string, unknown>;

const lazyNamed = (loader: () => Promise<RouteModule>, exportName: string) =>
  lazy(async () => {
    const module = await loader();

    return {
      default: module[exportName] as ComponentType<unknown>,
    };
  });

const ActionsCapsule = lazy(() =>
  import("@hey-hey/ui-common/components/ActionsCapsule").then((m) => ({
    default: m.ActionsCapsule,
  })),
);

const Home = lazy(() => import("./pages/Home"));
const OrganizationHomePage = lazyNamed(
  () => import("./pages/OrganizationHome/OrganizationHomePage"),
  "OrganizationHomePage",
);
const Contact = lazy(() => import("./pages/Contact"));
const Login = lazy(() => import("./pages/Login"));
const RequestAccessPage = lazyNamed(
  () => import("./pages/RequestAccess/RequestAccessPage"),
  "RequestAccessPage",
);
const DemoStartPage = lazyNamed(
  () => import("./pages/Demo/DemoStartPage"),
  "DemoStartPage",
);
const TermsPage = lazyNamed(
  () => import("./pages/Legal/TermsPage"),
  "TermsPage",
);
const PrivacyPage = lazyNamed(
  () => import("./pages/Legal/PrivacyPage"),
  "PrivacyPage",
);
const SecurityBoundaryPage = lazyNamed(
  () => import("./pages/Legal/SecurityBoundaryPage"),
  "SecurityBoundaryPage",
);
const PrivateBetaDisclosurePage = lazyNamed(
  () => import("./pages/PrivateBetaDisclosure/PrivateBetaDisclosurePage"),
  "PrivateBetaDisclosurePage",
);
const Onboarding = lazy(() => import("./pages/Onboarding"));
const RepositoryImport = lazy(() => import("./pages/RepositoryImport"));
const NewOrgLandingPage = lazy(
  () => import("./pages/NewOrgLanding/NewOrgLandingPage"),
);
const OrganizationPage = lazyNamed(
  () => import("./pages/Organization/OrganizationPage"),
  "OrganizationPage",
);
const LLMDevTools = lazy(() => import("./pages/LLMDevTools"));
const ProjectDebugView = lazy(() => import("./pages/ProjectDebugView"));
const NotFound = lazy(() => import("./pages/NotFound"));

const ChangePasswordPage = lazyNamed(
  () => import("./pages/ChangePassword/ChangePasswordPage"),
  "ChangePasswordPage",
);

const SettingsPage = lazyNamed(
  () => import("./pages/Settings/SettingsPage"),
  "SettingsPage",
);
const PairingPage = lazy(() =>
  import("./pages/Settings/PairingPage").then((module) => ({
    default: module.PairingPage,
  })),
);

const BetaOnboardingPage = lazyNamed(
  () => import("./pages/Admin/BetaOnboardingPage"),
  "BetaOnboardingPage",
);
const PrivateBetaAccessPage = lazyNamed(
  () => import("./pages/Admin/PrivateBetaAccessPage"),
  "PrivateBetaAccessPage",
);
const AdminLayout = lazyNamed(
  () => import("./pages/Admin/AdminLayout"),
  "AdminLayout",
);
const DemoAdminPage = lazyNamed(
  () => import("./pages/Admin/DemoAdminPage"),
  "DemoAdminPage",
);
const OrganizationsDirectoryPage = lazyNamed(
  () => import("./pages/Admin/OrganizationsDirectoryPage"),
  "OrganizationsDirectoryPage",
);
const AdminOrganizationDetailPage = lazyNamed(
  () => import("./pages/Admin/AdminOrganizationDetailPage"),
  "AdminOrganizationDetailPage",
);

const TopologyAdminPage = lazyNamed(
  () => import("./pages/Admin/TopologyAdminPage"),
  "TopologyAdminPage",
);
const UnifiedSearchAdminPage = lazyNamed(
  () => import("./pages/Admin/UnifiedSearchAdminPage"),
  "UnifiedSearchAdminPage",
);
const InternalReportsListPage = lazyNamed(
  () => import("./pages/Admin/InternalReportsListPage"),
  "InternalReportsListPage",
);
const InternalReportDetailPage = lazyNamed(
  () => import("./pages/Admin/InternalReportDetailPage"),
  "InternalReportDetailPage",
);
const WorkItemTypeFormPage = lazyNamed(
  () => import("./pages/Admin/WorkItemTypeFormPage"),
  "WorkItemTypeFormPage",
);
const ArtifactsPage = lazyNamed(
  () => import("./pages/Artifacts/ArtifactsPage"),
  "ArtifactsPage",
);
const ProposalsPage = lazyNamed(
  () => import("./pages/Proposals/ProposalsPage"),
  "ProposalsPage",
);
const ProposalDetailPage = lazyNamed(
  () => import("./pages/Proposals/ProposalDetailPage"),
  "ProposalDetailPage",
);
const ProposalGroupDetailPage = lazyNamed(
  () => import("./pages/Proposals/ProposalGroupDetailPage"),
  "ProposalGroupDetailPage",
);
const DocumentsListPage = lazyNamed(
  () => import("./pages/DesignDoc/DocumentsListPage"),
  "DocumentsListPage",
);
const DocumentPage = lazyNamed(
  () => import("./pages/DesignDoc/DocumentDetailPage"),
  "DocumentDetailPage",
);
const InitiativeDetailPage = lazyNamed(
  () => import("./pages/Initiative/InitiativeDetailPage"),
  "InitiativeDetailPage",
);
const FeaturesPage = lazyNamed(
  () => import("./pages/Features/FeaturesPage"),
  "FeaturesPage",
);
const GoalsPage = lazyNamed(
  () => import("./pages/Goals/GoalsPage"),
  "GoalsPage",
);
const WorkItemTypeCollectionPage = lazyNamed(
  () => import("./pages/Collections/WorkItemTypeCollectionPage"),
  "WorkItemTypeCollectionPage",
);
const InitiativesPage = lazyNamed(
  () => import("./pages/Initiatives/InitiativesPage"),
  "InitiativesPage",
);
const PlanDetailPage = lazyNamed(
  () => import("./pages/Plan/PlanDetailPage"),
  "PlanDetailPage",
);
const PlanTaskMonitorSetupPage = lazyNamed(
  () => import("./pages/Plan/PlanTaskMonitorSetupPage"),
  "PlanTaskMonitorSetupPage",
);
const PlanTaskMonitorPage = lazyNamed(
  () => import("./pages/Plan/PlanTaskMonitorPage"),
  "PlanTaskMonitorPage",
);
const PlanStepPage = lazyNamed(
  () => import("./pages/Plan/PlanStepPage"),
  "PlanStepPage",
);
const PlanAgentSessionPage = lazyNamed(
  () => import("./pages/Plan/PlanAgentSessionPage"),
  "PlanAgentSessionPage",
);
const PlanConversationPage = lazyNamed(
  () => import("./pages/Plan/PlanConversationPage"),
  "PlanConversationPage",
);
const PlanStepRedirectPage = lazyNamed(
  () => import("./pages/Plan/PlanStepRedirectPage"),
  "PlanStepRedirectPage",
);
const PlansPage = lazyNamed(
  () => import("./pages/Plans/PlansPage"),
  "PlansPage",
);
const LLMTrackingDetailPage = lazyNamed(
  () => import("./pages/LLMTracking/LLMTrackingDetailPage"),
  "LLMTrackingDetailPage",
);
const LLMTrackingListPage = lazyNamed(
  () => import("./pages/LLMTracking/LLMTrackingListPage"),
  "LLMTrackingListPage",
);
const ProjectActivityPage = lazyNamed(
  () => import("./pages/Activity/ProjectActivityPage"),
  "ProjectActivityPage",
);
const RecentlyViewedPage = lazyNamed(
  () => import("./pages/RecentlyViewed/RecentlyViewedPage"),
  "RecentlyViewedPage",
);
const AgentSessionPage = lazyNamed(
  () => import("./pages/AgentSession/AgentSessionPage"),
  "AgentSessionPage",
);
const EntityConversationPage = lazyNamed(
  () => import("./pages/AgentSession/EntityConversationPage"),
  "EntityConversationPage",
);
const AgentSessionResolver = lazyNamed(
  () => import("./pages/AgentSession/AgentSessionResolver"),
  "AgentSessionResolver",
);
const AgentSessionByIdResolver = lazyNamed(
  () => import("./pages/AgentSession/AgentSessionByIdResolver"),
  "AgentSessionByIdResolver",
);
const MessageByIdResolver = lazyNamed(
  () => import("./pages/Conversation/MessageByIdResolver"),
  "MessageByIdResolver",
);
const AgentSessionsPage = lazyNamed(
  () => import("./pages/AgentSessions/AgentSessionsPage"),
  "AgentSessionsPage",
);
const ProjectPage = lazyNamed(
  () => import("./pages/Project/ProjectPage"),
  "ProjectPage",
);
const ProjectConversationPage = lazyNamed(
  () => import("./pages/Project/ProjectConversationPage"),
  "ProjectConversationPage",
);
const ProjectReportRequestPage = lazyNamed(
  () => import("./pages/Reports/ProjectReportRequestPage"),
  "ProjectReportRequestPage",
);
const ProjectReportPage = lazyNamed(
  () => import("./pages/Reports/ProjectReportPage"),
  "ProjectReportPage",
);
const TaskRouter = lazyNamed(
  () => import("./pages/Task/TaskRouter"),
  "TaskRouter",
);
const EvalRunSetupPage = lazyNamed(
  () => import("./pages/EvalRun/EvalRunSetupPage"),
  "EvalRunSetupPage",
);
const EvalRunPage = lazyNamed(
  () => import("./pages/EvalRun/EvalRunPage"),
  "EvalRunPage",
);
const EvalResultsPage = lazyNamed(
  () => import("./pages/EvalRun/EvalResultsPage"),
  "EvalResultsPage",
);
const TaskRedirectPage = lazyNamed(
  () => import("./pages/Task/TaskRedirectPage"),
  "TaskRedirectPage",
);
const TaskAgentSessionPage = lazyNamed(
  () => import("./pages/Task/TaskAgentSessionPage"),
  "TaskAgentSessionPage",
);
const TasksPage = lazyNamed(
  () => import("./pages/Tasks/TasksPage"),
  "TasksPage",
);
const UserDetailPage = lazyNamed(
  () => import("./pages/Users/UserPage"),
  "UserDetailPage",
);
const ServicesPage = lazyNamed(
  () => import("./pages/Services/ServicesPage"),
  "ServicesPage",
);
const ServicePage = lazyNamed(
  () => import("./pages/Services/ServicePage"),
  "ServicePage",
);

const ScratchpadDetailPage = lazyNamed(
  () => import("./pages/Scratchpad/ScratchpadDetailPage"),
  "ScratchpadDetailPage",
);

const withRouteSuspense = (element: ReactNode) => (
  <Suspense fallback={null}>{element}</Suspense>
);

const withProtectedRoute = (element: ReactElement) =>
  withRouteSuspense(<AppProtectedRoute>{element}</AppProtectedRoute>);

const OpenItemsActivationBridge: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const sink = useOpenItemsActivationSink();
  const locator = useOpenItemLocatorHandler();
  return (
    <EntityActivationProvider sink={sink}>
      <OpenItemLocatorProvider locator={locator}>
        {children}
      </OpenItemLocatorProvider>
    </EntityActivationProvider>
  );
};

export const AppRouteShell = () => {
  usePageMetadata();
  useTabLocationRegistry();
  const { currentOrganization } = useOrganization();
  const { user } = useAuth();
  const location = useLocation();
  // The action capsule is context-specific to project pages.
  const isActionsCapsuleRoute =
    location.pathname.startsWith("/projects/") ||
    location.pathname.startsWith("/tasks/") ||
    location.pathname.startsWith("/work-items/");
  const showActionsCapsule = isActionsCapsuleRoute;
  const projectId =
    location.pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null;
  return (
    <OpenItemsProvider
      key={`${user?.id}:${currentOrganization?.id}:${projectId}`}
      projectId={projectId}
      organizationId={currentOrganization?.id ?? null}
      userId={user?.id ?? null}
    >
      <OpenItemsActivationBridge>
        <CanonicalPageProvider>
          <CanonicalWalkthroughEvents />
          <NuqsAdapter>
            <OpenItemsPreviewHost
              organizationId={currentOrganization?.id ?? ""}
              projectId={projectId}
            >
              <LazyAnimatePresence mode="wait">
                <Layout />
                {showActionsCapsule && (
                  <Suspense fallback={null}>
                    <ActionsCapsule />
                  </Suspense>
                )}
              </LazyAnimatePresence>

              {/* Modal renderer */}
              <HeyHeyModal />
            </OpenItemsPreviewHost>
          </NuqsAdapter>
        </CanonicalPageProvider>
      </OpenItemsActivationBridge>
    </OpenItemsProvider>
  );
};

export const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route
        path="/"
        element={<AppRouteShell />}
        errorElement={<RouteErrorBoundary />}
      >
        <Route index element={withRouteSuspense(<Home />)} />
        <Route path="contact" element={withRouteSuspense(<Contact />)} />
        <Route path="login" element={withRouteSuspense(<Login />)} />
        <Route
          path="home"
          element={withProtectedRoute(<OrganizationHomePage />)}
        />
        <Route
          path="organizations/:organizationId/activity"
          element={withProtectedRoute(<ProjectActivityPage />)}
        />
        <Route
          path="request-access"
          element={withRouteSuspense(<RequestAccessPage />)}
        />
        <Route path="demo" element={withRouteSuspense(<DemoStartPage />)} />
        <Route
          path={LEGAL_ROUTES.terms.slice(1)}
          element={withRouteSuspense(<TermsPage />)}
        />
        <Route
          path={LEGAL_ROUTES.privacy.slice(1)}
          element={withRouteSuspense(<PrivacyPage />)}
        />
        <Route
          path={LEGAL_ROUTES.security.slice(1)}
          element={withRouteSuspense(<SecurityBoundaryPage />)}
        />
        <Route
          path="change-password"
          element={withRouteSuspense(<ChangePasswordPage />)}
        />
        <Route
          path="private-beta/disclosure"
          element={withProtectedRoute(<PrivateBetaDisclosurePage />)}
        />
        <Route path="pairing" element={withProtectedRoute(<PairingPage />)} />
        <Route
          path="add-controller"
          element={withProtectedRoute(
            <PairingPage journey="existing-machine" />,
          )}
        />
        <Route
          path="projects/:projectId/settings"
          element={withProtectedRoute(<SettingsPage />)}
        />
        <Route
          path="welcome"
          element={withProtectedRoute(<NewOrgLandingPage />)}
        />
        <Route
          path="organizations"
          element={withProtectedRoute(<OrganizationPage />)}
        />
        <Route path="admin" element={withProtectedRoute(<AdminLayout />)}>
          <Route index element={<Navigate to="organizations" replace />} />
          <Route
            path="organizations"
            element={withRouteSuspense(<OrganizationsDirectoryPage />)}
          />
          <Route
            path="organizations/:organizationId"
            element={withRouteSuspense(<AdminOrganizationDetailPage />)}
          />
          <Route
            path="beta-access"
            element={withRouteSuspense(<PrivateBetaAccessPage />)}
          />
          <Route path="demo" element={withRouteSuspense(<DemoAdminPage />)} />
        </Route>
        <Route
          path="projects"
          element={withProtectedRoute(<OrganizationHomePage />)}
        />
        <Route
          path="projects/:projectId"
          element={withProtectedRoute(<ProjectPage />)}
        />
        <Route
          path="projects/:projectId/activity"
          element={withProtectedRoute(<ProjectActivityPage />)}
        />
        <Route
          path="projects/:projectId/recently-viewed"
          element={withProtectedRoute(<RecentlyViewedPage />)}
        />
        <Route
          path="projects/:projectId/activities/:activityEntityRef"
          element={withProtectedRoute(<ProjectActivityPage />)}
        />
        <Route
          path="projects/:projectId/reports/new"
          element={withProtectedRoute(<ProjectReportRequestPage />)}
        />
        <Route
          path="projects/:projectId/reports/:reportId"
          element={withProtectedRoute(<ProjectReportPage />)}
        />
        {/* legacy */}
        <Route
          path="projects/:projectId/landing"
          element={withProtectedRoute(<ProjectPage />)}
        />
        <Route
          path="projects/:projectId/onboarding"
          element={withProtectedRoute(<Onboarding />)}
        />
        <Route
          path="projects/:projectId/repository-import"
          element={withProtectedRoute(<RepositoryImport />)}
        />
        <Route
          path="projects/:projectId/features"
          element={withProtectedRoute(<FeaturesPage />)}
        />
        <Route
          path="projects/:projectId/features/:taskId"
          element={withProtectedRoute(<TaskRouter />)}
        />
        <Route
          path="projects/:projectId/evals/:evalId/runs/new"
          element={withProtectedRoute(<EvalRunSetupPage />)}
        />
        <Route
          path="projects/:projectId/evals/:evalId/runs/:runId"
          element={withProtectedRoute(<EvalRunPage />)}
        />
        <Route
          path="projects/:projectId/evals/:evalId/runs/:runId/results"
          element={withProtectedRoute(<EvalResultsPage />)}
        />
        <Route
          path="projects/:projectId/goals"
          element={withProtectedRoute(<GoalsPage />)}
        />
        <Route
          path="projects/:projectId/collections/:typeKey"
          element={withProtectedRoute(<WorkItemTypeCollectionPage />)}
        />
        <Route
          path="projects/:projectId/initiatives"
          element={withProtectedRoute(<InitiativesPage />)}
        />
        <Route
          path="projects/:projectId/initiatives/:initiativeId"
          element={withProtectedRoute(<InitiativeDetailPage />)}
        />
        <Route
          path="projects/:projectId/initiatives/:initiativeId/tasks"
          element={withProtectedRoute(<TasksPage />)}
        />
        <Route
          path="projects/:projectId/plans"
          element={withProtectedRoute(<PlansPage />)}
        />
        <Route
          path="projects/:projectId/plans/:planId"
          element={withProtectedRoute(<PlanDetailPage />)}
        />
        <Route
          path="projects/:projectId/plans/:planId/stages/:stageId"
          element={withProtectedRoute(<PlanDetailPage />)}
        />
        <Route
          path="projects/:projectId/plans/:planId/stages/:stageId/task-monitor/setup"
          element={withProtectedRoute(<PlanTaskMonitorSetupPage />)}
        />
        <Route
          path="projects/:projectId/plans/:planId/stages/:stageId/task-monitor/:monitorId"
          element={withProtectedRoute(<PlanTaskMonitorPage />)}
        />
        <Route
          path="projects/:projectId/plans/:planId/task-monitor/:monitorId"
          element={withProtectedRoute(<PlanTaskMonitorPage />)}
        />
        <Route
          path="projects/:projectId/plans/:planId/step-redirect"
          element={withProtectedRoute(<PlanStepRedirectPage />)}
        />
        <Route
          path="projects/:projectId/plans/:planId/stages/:stageId/steps/:stepId"
          element={withProtectedRoute(<PlanStepPage />)}
        />
        <Route
          path="projects/:projectId/plans/:planId/agent-sessions/:agentSessionId"
          element={withProtectedRoute(<PlanAgentSessionPage />)}
        />
        <Route
          path="projects/:projectId/plans/:planId/conversations/:conversationId"
          element={withProtectedRoute(<PlanConversationPage />)}
        />
        <Route
          path="projects/:projectId/plans/:planId/stages/:stageId/steps/:stepId/agent-sessions/:agentSessionId"
          element={withProtectedRoute(<PlanAgentSessionPage />)}
        />
        <Route
          path="projects/:projectId/plans/:planId/stages/:stageId/steps/:stepId/conversations/:conversationId"
          element={withProtectedRoute(<PlanConversationPage />)}
        />
        <Route
          path="projects/:projectId/resolve-agent-session/:conversationId"
          element={withProtectedRoute(<AgentSessionResolver />)}
        />
        <Route
          path="projects/:projectId/resolve-agent-session-by-id/:agentSessionId"
          element={withProtectedRoute(<AgentSessionByIdResolver />)}
        />
        <Route
          path="projects/:projectId/resolve-message/:messageId"
          element={withProtectedRoute(<MessageByIdResolver />)}
        />
        <Route
          path="projects/:projectId/agent-sessions"
          element={withProtectedRoute(<AgentSessionsPage />)}
        />
        <Route
          path="projects/:projectId/agent-sessions/:agentSessionId"
          element={withProtectedRoute(<AgentSessionPage />)}
        />
        <Route
          path="projects/:projectId/agent-sessions/:agentSessionId/conversations/:conversationId"
          element={withProtectedRoute(<AgentSessionResolver />)}
        />
        <Route
          path="projects/:projectId/agent-sessions/:agentSessionId/entity-conversations/:conversationId"
          element={withProtectedRoute(<EntityConversationPage />)}
        />
        <Route
          path="projects/:projectId/sessionless-conversations/:conversationId"
          element={withProtectedRoute(<ProjectConversationPage />)}
        />
        <Route
          path="projects/:projectId/conversations/:conversationId"
          element={withProtectedRoute(<AgentSessionResolver />)}
        />
        <Route
          path="projects/:projectId/initiatives/:initiativeId/conversations/:conversationId"
          element={withProtectedRoute(<AgentSessionResolver />)}
        />
        {/* Canonical task routes — TaskRouter renders FeaturePage or TaskPage based on type */}
        <Route
          path="projects/:projectId/tasks/:taskId"
          element={withProtectedRoute(<TaskRouter />)}
        />
        <Route
          path="projects/:projectId/tasks/:taskId/conversations/:conversationId"
          element={withProtectedRoute(<AgentSessionResolver />)}
        />
        <Route
          path="projects/:projectId/tasks/:taskId/agent-sessions/:agentSessionId"
          element={withProtectedRoute(<TaskAgentSessionPage />)}
        />
        {/* Legacy initiative-scoped task routes — redirect to canonical */}
        <Route
          path="projects/:projectId/initiatives/:initiativeId/tasks/:taskId"
          element={withProtectedRoute(<TaskRouter />)}
        />
        <Route
          path="projects/:projectId/initiatives/:initiativeId/tasks/:taskId/conversations/:conversationId"
          element={withProtectedRoute(<AgentSessionResolver />)}
        />
        <Route
          path="projects/:projectId/initiatives/:initiativeId/tasks/:taskId/agent-sessions/:agentSessionId"
          element={withProtectedRoute(<TaskAgentSessionPage />)}
        />
        {/* Bare task ID — resolves project then redirects */}
        <Route
          path="tasks/:taskId"
          element={withProtectedRoute(<TaskRedirectPage />)}
        />
        {/* Bare work-item ID — loads task to get projectId, then redirects to canonical */}
        <Route
          path="work-items/:id"
          element={withProtectedRoute(<TaskRouter />)}
        />
        {/* Work-item type definition form */}
        <Route
          path="projects/:projectId/work-item-types/new"
          element={withProtectedRoute(<WorkItemTypeFormPage />)}
        />
        <Route
          path="projects/:projectId/work-item-types/:typeKey/edit"
          element={withProtectedRoute(<WorkItemTypeFormPage />)}
        />
        {/* Proposals routes */}
        <Route
          path="projects/:projectId/proposals"
          element={withProtectedRoute(<ProposalsPage />)}
        />
        <Route
          path="projects/:projectId/proposals/:proposalId"
          element={withProtectedRoute(<ProposalDetailPage />)}
        />
        <Route
          path="projects/:projectId/proposal-groups/:groupId"
          element={withProtectedRoute(<ProposalGroupDetailPage />)}
        />
        {/* Scratchpad route */}
        <Route
          path="projects/:projectId/scratchpad"
          element={withProtectedRoute(<ScratchpadDetailPage />)}
        />
        {/* Artifacts routes (existing system) */}
        <Route
          path="projects/:projectId/artifacts"
          element={withProtectedRoute(<ArtifactsPage />)}
        />
        {/* Documents routes (new system using DesignDocs) */}
        <Route
          path="projects/:projectId/design-docs"
          element={withProtectedRoute(<DocumentsListPage />)}
        />
        <Route
          path="projects/:projectId/design-docs/:documentId"
          element={withProtectedRoute(<DocumentPage />)}
        />
        <Route
          path="projects/:projectId/design-docs/:documentId/conversations/:conversationId"
          element={withProtectedRoute(<AgentSessionResolver />)}
        />
        {/* User routes */}
        <Route
          path="projects/:projectId/users/:userId"
          element={withProtectedRoute(<UserDetailPage />)}
        />
        <Route
          path="organizations/:organizationId/users/:userId"
          element={withProtectedRoute(<UserDetailPage />)}
        />
        {/* Services routes */}
        <Route
          path="projects/:projectId/services"
          element={withProtectedRoute(<ServicesPage />)}
        />
        <Route
          path="projects/:projectId/services/:serviceId"
          element={withProtectedRoute(<ServicePage />)}
        />
        <Route
          path="projects/:projectId/services/:serviceId/conversations/:conversationId"
          element={withProtectedRoute(<AgentSessionResolver />)}
        />
        <Route
          path="debug/llm-dev"
          element={withProtectedRoute(<LLMDevTools />)}
        />
        <Route
          path="debug/project-view"
          element={withProtectedRoute(<ProjectDebugView />)}
        />
        <Route
          path="debug/beta-onboarding"
          element={withProtectedRoute(<BetaOnboardingPage />)}
        />
        <Route
          path="debug/topology-admin"
          element={withProtectedRoute(<TopologyAdminPage />)}
        />
        <Route
          path="debug/unified-search-admin"
          element={withProtectedRoute(<UnifiedSearchAdminPage />)}
        />
        <Route
          path="debug/internal-reports"
          element={withProtectedRoute(<InternalReportsListPage />)}
        />
        <Route
          path="debug/internal-reports/:reportId"
          element={withProtectedRoute(<InternalReportDetailPage />)}
        />
        <Route
          path="llm-tracking"
          element={withProtectedRoute(<LLMTrackingListPage />)}
        />
        <Route
          path="llm-tracking/:id"
          element={withProtectedRoute(<LLMTrackingDetailPage />)}
        />
        {/* 404 catch-all route */}
        <Route path="*" element={withRouteSuspense(<NotFound />)} />
      </Route>
    </>,
  ),
);

const leaveSelectedProject = async () => {
  if (/^\/projects\/[^/]+/.test(router.state.location.pathname)) {
    await router.navigate("/projects", { replace: true });
  }
};

const showOrganizationHome = async () => {
  await router.navigate("/home", { replace: true });
};

function App() {
  return (
    <WebClientProvider baseUrl={apiBaseUrl}>
      <QueryClientAtomProvider client={queryClient}>
        <ControllerAuthorizationPromptHost />
        <AuthProvider>
          <OrganizationAccessBoundary
            leaveProject={leaveSelectedProject}
            showHome={showOrganizationHome}
          >
            <OrganizationProvider>
              <WebSocketProvider serverUrl={wsUrl}>
                <DebugProvider>
                  <ModalProvider>
                    <DndProvider>
                      <ActionsCapsuleProvider>
                        <GlobalStyles
                          styles={`
                        @keyframes hh-drawStroke { to { stroke-dashoffset: 0; } }
                        @keyframes hh-fadeOut    { to { opacity: 0; } }
                      `}
                        />

                        <GuidedWalkthroughProvider>
                          <RouterProvider router={router} />
                        </GuidedWalkthroughProvider>
                      </ActionsCapsuleProvider>
                    </DndProvider>
                  </ModalProvider>
                </DebugProvider>
              </WebSocketProvider>
            </OrganizationProvider>
          </OrganizationAccessBoundary>
        </AuthProvider>
      </QueryClientAtomProvider>
    </WebClientProvider>
  );
}

export default App;
