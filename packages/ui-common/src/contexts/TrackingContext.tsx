/**
 * Tracking Context
 *
 * Provides tracking capabilities throughout the React component tree
 * with hierarchical context inheritance and Initiative-aware tracking
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type {
  UserTrackingEvent,
  TrackingContext as TrackingContextType,
  TrackingConfiguration,
  InitiativeAction,
  WorkflowAction,
  NavigationAction,
  FormAction,
  UIAction,
  AttentionEvent,
  CliTelemetryEventInput,
  UserId,
} from "../types/userTracking";
import { mapCliTelemetryInputToTrackingEvent } from "../types/userTracking";
import { userActionTracker } from "../services/userActionTracker";
import { useOrganization } from "./OrganizationContext";
import { useAuth } from "./AuthContext";
import { analyticsClient } from "../clients/serviceClients";
import { useAttention } from "../hooks/useAttention";
import { useQueryClient } from "@tanstack/react-query";
import { prependAttentionEvent } from "../data/collections/attentionEvents";
import type { AttentionEventResponse, EntityType } from "../api";

// Context interface for tracking capabilities
interface TrackingContextValue {
  // Core tracking methods
  track: (event: Partial<UserTrackingEvent>) => void;
  trackInitiative: (
    action: InitiativeAction,
    data: InitiativeTrackingData,
  ) => void;
  trackWorkflow: (action: WorkflowAction, data: WorkflowTrackingData) => void;
  trackNavigation: (
    action: NavigationAction,
    data: NavigationTrackingData,
  ) => void;
  trackForm: (action: FormAction, data: FormTrackingData) => void;
  trackUI: (action: UIAction, data: UITrackingData) => void;
  trackCliTelemetry: (event: CliTelemetryEventInput) => void;
  trackAttention: (event: AttentionEvent) => void;

  // Context management
  setContext: (context: Partial<TrackingContextType>) => void;
  getContext: () => TrackingContextType;

  // Configuration
  isEnabled: boolean;
  updateConfig: (config: Partial<TrackingConfiguration>) => void;
}

// Tracking data interfaces for type-safe method calls
export interface InitiativeTrackingData {
  initiativeId: string;
  initiativeName: string;
  previousValue?: unknown;
  newValue?: unknown;
  field?: string;
  requirement?: {
    id: string;
    text: string;
  };
  project?: {
    id: string;
    name: string;
  };
  conversation?: {
    id: string;
    messageCount: number;
  };
}

export interface WorkflowTrackingData {
  workflowId: string;
  workflowName: string;
  nodeId?: string;
  nodeName?: string;
  executionId?: string;
  simulationStep?: number;
  validationResults?: {
    errors: number;
    warnings: number;
  };
}

export interface NavigationTrackingData {
  fromPage?: string;
  toPage: string;
  referrer?: string;
  timeOnPage?: number;
  scrollDepth?: number;
  exitIntent?: boolean;
  linkText?: string;
  linkHref?: string;
}

export interface FormTrackingData {
  formName: string;
  fieldName?: string;
  fieldType?: string;
  fieldValue?: string;
  validationErrors?: string[];
  completionRate?: number;
  timeToComplete?: number;
  submitAttempts?: number;
  componentName?: string;
}

export interface UITrackingData {
  elementType: string;
  elementText?: string;
  elementId?: string;
  elementClass?: string;
  componentName?: string;
  searchQuery?: string;
  filterCriteria?: Record<string, unknown>;
  sortField?: string;
  sortDirection?: "asc" | "desc";
  pageNumber?: number;
  fileType?: string;
  fileName?: string;
  fileSize?: number;
  resultCount?: number;
  searchTime?: number;
  timeVisible?: number;
  viewDuration?: number;
  intersectionRatio?: number;
  changes?: Array<{ prop: string; from: unknown; to: unknown }>;
  reason?: string;
  recoveryAction?: string;
  successful?: boolean;
  [key: string]: unknown;
}

const noopTrackingAction = (..._args: unknown[]): void => undefined;

const fallbackTrackingContext: TrackingContextValue = {
  track: noopTrackingAction,
  trackInitiative: noopTrackingAction,
  trackWorkflow: noopTrackingAction,
  trackNavigation: noopTrackingAction,
  trackForm: noopTrackingAction,
  trackUI: noopTrackingAction,
  trackCliTelemetry: noopTrackingAction,
  trackAttention: noopTrackingAction,
  setContext: noopTrackingAction,
  getContext: () => ({
    page: {
      name: "unknown",
      path: typeof window === "undefined" ? "" : window.location.pathname,
    },
  }),
  isEnabled: false,
  updateConfig: noopTrackingAction,
};

// Tracking is observability, not a rendering prerequisite. Consumers mounted
// in previews, embedded surfaces, or an incomplete route shell should remain
// usable when no provider is present.
const TrackingContext = createContext<TrackingContextValue>(
  fallbackTrackingContext,
);

// Hook for consuming the tracking context
export const useUserAction = (): TrackingContextValue =>
  useContext(TrackingContext);

// Tracking provider props
interface TrackingProviderProps {
  children: React.ReactNode;
  context?: Partial<TrackingContextType>;
  config?: Partial<TrackingConfiguration>;
  enabled?: boolean;
}

const EMPTY_TRACKING_CONTEXT: Partial<TrackingContextType> = {};
const EMPTY_TRACKING_CONFIGURATION: Partial<TrackingConfiguration> = {};

const AttentionTrackingHandler: React.FC<{
  attentionEntity?: TrackingContextType["attentionEntity"];
}> = ({ attentionEntity }) => {
  useAttention({
    entityType: attentionEntity?.type,
    entityId: attentionEntity?.id,
    tab: attentionEntity?.tab,
  });

  return null;
};

// Main tracking provider component
export const TrackingProvider: React.FC<TrackingProviderProps> = ({
  children,
  context: providedContext = EMPTY_TRACKING_CONTEXT,
  config = EMPTY_TRACKING_CONFIGURATION,
  enabled = true,
}) => {
  const { currentOrganization } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const contextRef = useRef<TrackingContextType>({
    page: {
      name: "unknown",
      path: window.location.pathname,
    },
  });
  const providedContextRef = useRef(providedContext);
  const currentOrganizationRef = useRef(currentOrganization);
  providedContextRef.current = providedContext;
  currentOrganizationRef.current = currentOrganization;

  const attentionEntity = providedContext.attentionEntity;

  useEffect(() => {
    userActionTracker.updateConfig(config);
  }, [config]);

  // Acquire shared tracker ownership for this provider lifecycle.
  useEffect(() => {
    userActionTracker.initialize();

    return () => {
      userActionTracker.destroy();
    };
  }, []);

  useEffect(() => {
    userActionTracker.setUserId(user?.id ? (user.id as UserId) : undefined);
  }, [user?.id]);

  // Register context provider with the tracker
  useEffect(() => {
    const contextProvider = (): Partial<TrackingContextType> => {
      const baseContext = {
        ...contextRef.current,
        ...providedContextRef.current,
      };

      // Add organization context if available
      if (currentOrganizationRef.current) {
        baseContext.organization = {
          id: currentOrganizationRef.current.id,
          name: currentOrganizationRef.current.name,
        };
      }

      return baseContext;
    };

    return userActionTracker.registerContextProvider(
      "react-context",
      contextProvider,
    );
  }, []);

  // Core tracking method
  const track = useCallback((event: Partial<UserTrackingEvent>): void => {
    userActionTracker.track(event);
  }, []);

  // Initiative-specific tracking
  const trackInitiative = useCallback(
    (action: InitiativeAction, data: InitiativeTrackingData): void => {
      track({
        category: "initiative",
        action,
        data,
      });
    },
    [track],
  );

  // Workflow-specific tracking
  const trackWorkflow = useCallback(
    (action: WorkflowAction, data: WorkflowTrackingData): void => {
      track({
        category: "workflow",
        action,
        data,
      });
    },
    [track],
  );

  // Navigation-specific tracking
  const trackNavigation = useCallback(
    (action: NavigationAction, data: NavigationTrackingData): void => {
      track({
        category: "navigation",
        action,
        data,
      });
    },
    [track],
  );

  // Form-specific tracking
  const trackForm = useCallback(
    (action: FormAction, data: FormTrackingData): void => {
      track({
        category: "form",
        action,
        data,
      });
    },
    [track],
  );

  // UI interaction tracking
  const trackUI = useCallback(
    (action: UIAction, data: UITrackingData): void => {
      track({
        category: "ui_interaction",
        action,
        data,
      });
    },
    [track],
  );

  const trackCliTelemetry = useCallback(
    (event: CliTelemetryEventInput): void => {
      track(mapCliTelemetryInputToTrackingEvent(event));
    },
    [track],
  );

  // Attention tracking (separate from main event stream)
  const trackAttention = useCallback(
    (event: AttentionEvent): void => {
      const { kind, ...payload } = event;
      void analyticsClient
        .trackAttentionEvents({
          trackAttentionEventsRequest: { events: [payload] },
        })
        .catch((error) => {
          if (config.debugMode) {
            console.warn(
              "[TRACKING_ATTENTION] Failed to send attention event",
              {
                error,
                event,
              },
            );
          }
        });

      if (kind === "navigation" && attentionEntity) {
        const focusIso = new Date(event.timestamp).toISOString();
        const synthesized: AttentionEventResponse = {
          id: `local-${event.entity.type}-${event.entity.id}-${event.timestamp}`,
          entityType: event.entity.type.toUpperCase() as EntityType,
          entityId: event.entity.id,
          entityName: attentionEntity.name ?? "",
          tab: event.tab ?? null,
          focusStart: focusIso,
          focusEnd: focusIso,
          durationMs: 0,
          entity: {
            status: attentionEntity.status,
            projectId: attentionEntity.projectId,
            originatingProjectId: attentionEntity.originatingProjectId,
            linkedProjectIds: attentionEntity.linkedProjectIds,
          },
        };
        prependAttentionEvent(queryClient, synthesized);
      }

      if (config.debugMode) {
        console.log("[TRACKING_ATTENTION]", event);
      }
    },
    [config.debugMode, attentionEntity, queryClient],
  );

  // Context management
  const setContext = useCallback(
    (newContext: Partial<TrackingContextType>): void => {
      contextRef.current = { ...contextRef.current, ...newContext };
    },
    [],
  );

  const getContext = useCallback((): TrackingContextType => {
    return { ...contextRef.current };
  }, []);

  // Configuration update
  const updateConfig = useCallback(
    (newConfig: Partial<TrackingConfiguration>): void => {
      userActionTracker.updateConfig(newConfig);
    },
    [],
  );

  const value: TrackingContextValue = {
    track,
    trackInitiative,
    trackWorkflow,
    trackNavigation,
    trackForm,
    trackUI,
    trackCliTelemetry,
    trackAttention,
    setContext,
    getContext,
    isEnabled: enabled,
    updateConfig,
  };

  return (
    <TrackingContext.Provider value={value}>
      <AttentionTrackingHandler attentionEntity={attentionEntity} />
      {children}
    </TrackingContext.Provider>
  );
};

// Higher-order component for adding tracking context
export interface WithTrackingProps {
  trackingContext?: Partial<TrackingContextType>;
  trackingEnabled?: boolean;
}

export function withTracking<P extends object>(
  Component: React.ComponentType<P>,
  defaultContext?: Partial<TrackingContextType>,
) {
  const TrackedComponent = React.forwardRef<unknown, P & WithTrackingProps>(
    ({ trackingContext, trackingEnabled = true, ...props }, ref) => {
      const mergedContext = { ...defaultContext, ...trackingContext };

      return (
        <TrackingProvider context={mergedContext}>
          <Component {...(props as P)} ref={ref} />
        </TrackingProvider>
      );
    },
  );

  TrackedComponent.displayName = `withTracking(${
    Component.displayName || Component.name
  })`;
  return TrackedComponent;
}

// Hook for tracking page views automatically
export const usePageTracking = (pageName: string, section?: string): void => {
  const { trackNavigation, setContext } = useUserAction();
  const hasTrackedRef = useRef(false);

  useEffect(() => {
    // Update context with page information
    setContext({
      page: {
        name: pageName,
        path: window.location.pathname,
        section,
      },
    });

    // Track page view only once per component mount
    if (!hasTrackedRef.current) {
      trackNavigation("page_view", {
        toPage: pageName,
        referrer: document.referrer || undefined,
      });
      hasTrackedRef.current = true;
    }
  }, [pageName, section, trackNavigation, setContext]);

  // Track page leave on unmount
  useEffect(() => {
    return () => {
      if (hasTrackedRef.current) {
        trackNavigation("page_leave", {
          fromPage: pageName,
          toPage: "unknown",
        });
      }
    };
  }, [pageName, trackNavigation]);
};

// Hook for tracking Initiative context
export const useInitiativeTracking = (
  initiativeId: string,
  initiativeName: string,
  status?: string,
  priority?: string,
) => {
  const { setContext, trackInitiative } = useUserAction();

  useEffect(() => {
    setContext({
      initiative: {
        id: initiativeId,
        name: initiativeName,
        status: status || "unknown",
        priority: priority || "unknown",
      },
    });
  }, [initiativeId, initiativeName, status, priority, setContext]);

  // Return tracking methods with Initiative context pre-filled
  const trackInitiativeAction = useCallback(
    (
      action: InitiativeAction,
      additionalData: Partial<InitiativeTrackingData> = {},
    ) => {
      trackInitiative(action, {
        initiativeId,
        initiativeName,
        ...additionalData,
      });
    },
    [initiativeId, initiativeName, trackInitiative],
  );

  return { trackInitiativeAction };
};

// Hook for tracking Workflow context
export const useWorkflowTracking = (
  workflowId: string,
  workflowName: string,
) => {
  const { setContext, trackWorkflow } = useUserAction();

  useEffect(() => {
    setContext({
      workflow: {
        id: workflowId,
        name: workflowName,
      },
    });
  }, [workflowId, workflowName, setContext]);

  // Return tracking methods with Workflow context pre-filled
  const trackWorkflowAction = useCallback(
    (
      action: WorkflowAction,
      additionalData: Partial<WorkflowTrackingData> = {},
    ) => {
      trackWorkflow(action, {
        workflowId,
        workflowName,
        ...additionalData,
      });
    },
    [workflowId, workflowName, trackWorkflow],
  );

  return { trackWorkflowAction };
};

// Hook for automatic form tracking
export const useFormTracking = (formName: string) => {
  const { trackForm } = useUserAction();
  const startTimeRef = useRef<number>(Date.now());

  const trackFormStart = useCallback(() => {
    startTimeRef.current = Date.now();
    trackForm("start_fill", { formName });
  }, [formName, trackForm]);

  const trackFieldChange = useCallback(
    (fieldName: string, fieldType: string) => {
      trackForm("field_change", { formName, fieldName, fieldType });
    },
    [formName, trackForm],
  );

  const trackSubmitSuccess = useCallback(
    (completionRate: number = 100) => {
      const timeToComplete = Date.now() - startTimeRef.current;
      trackForm("submit_success", { formName, completionRate, timeToComplete });
    },
    [formName, trackForm],
  );

  const trackSubmitError = useCallback(
    (validationErrors: string[]) => {
      trackForm("submit_error", { formName, validationErrors });
    },
    [formName, trackForm],
  );

  return {
    trackFormStart,
    trackFieldChange,
    trackSubmitSuccess,
    trackSubmitError,
  };
};

export default TrackingProvider;
