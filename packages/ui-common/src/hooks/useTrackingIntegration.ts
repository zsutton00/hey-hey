/**
 * Tracking Integration Hook
 *
 * Provides easy integration between the user tracking system and React components
 * with automatic context management and Initiative-specific tracking
 */

import { useEffect, useCallback } from "react";
import {
  useUserAction,
  useInitiativeTracking,
} from "../contexts/TrackingContext";
import { InitiativeTrackingService } from "../services/initiativeTrackingService";
import { GlobalTrackingInitializer } from "../services/globalTrackingInitializer";
import type { InitiativeResponseDto } from "../api";
import type { UserTrackingEvent } from "../types/userTracking";

// Hook for automatic tracking integration
export const useTrackingIntegration = (config?: {
  autoInitialize?: boolean;
  debugMode?: boolean;
}) => {
  const { autoInitialize = true, debugMode = false } = config || {};

  useEffect(() => {
    if (autoInitialize) {
      GlobalTrackingInitializer.initialize({
        debugMode,
      });
    }

    return () => {
      // Cleanup on unmount if needed
    };
  }, [autoInitialize, debugMode]);

  return {
    setUserContext: GlobalTrackingInitializer.setUserContext,
    setOrganizationContext: GlobalTrackingInitializer.setOrganizationContext,
    setProjectContext: GlobalTrackingInitializer.setProjectContext,
    setInitiativeContext: GlobalTrackingInitializer.setInitiativeContext,
    setWorkflowContext: GlobalTrackingInitializer.setWorkflowContext,
  };
};

// Hook for Initiative-specific tracking with convenience methods
export const useInitiativeAction = (initiative?: InitiativeResponseDto) => {
  const { trackInitiativeAction } = useInitiativeTracking(
    initiative?.id || "",
    initiative?.name || "",
    initiative?.status,
    initiative?.priority
  );

  const trackCreation = useCallback(
    (context?: {
      templateUsed?: string;
      collaborators?: string[];
      estimatedDuration?: number;
    }) => {
      if (!initiative) return;
      InitiativeTrackingService.trackInitiativeCreation(initiative, context);
    },
    [initiative]
  );

  const trackUpdate = useCallback(
    (
      field: keyof InitiativeResponseDto,
      previousValue: unknown,
      newValue: unknown,
      context?: {
        reason?: string;
        triggeredBy?: "user_input" | "system_update" | "workflow_step";
      }
    ) => {
      if (!initiative) return;
      InitiativeTrackingService.trackInitiativeUpdate(
        initiative,
        field,
        previousValue,
        newValue,
        context
      );
    },
    [initiative]
  );

  const trackConversation = useCallback(
    (conversationData: {
      id: string;
      messageCount: number;
      duration?: number;
      outcome?: "refined" | "clarified" | "approved" | "rejected" | "deferred";
    }) => {
      if (!initiative) return;
      InitiativeTrackingService.trackInitiativeConversation(
        initiative,
        conversationData
      );
    },
    [initiative]
  );

  const trackProjectLink = useCallback(
    (
      project: { id: string; name: string },
      action: "link" | "unlink",
      context?: { reason?: string; expectedImpact?: string }
    ) => {
      if (!initiative) return;
      InitiativeTrackingService.trackProjectLinking(
        initiative,
        project,
        action,
        context
      );
    },
    [initiative]
  );

  const trackExport = useCallback(
    (
      exportType: "pdf" | "word" | "markdown" | "json" | "csv",
      context?: {
        includeRequirements?: boolean;
        includeConversations?: boolean;
        recipient?: string;
        purpose?: string;
      }
    ) => {
      if (!initiative) return;
      InitiativeTrackingService.trackExportActivity(
        initiative,
        exportType,
        context
      );
    },
    [initiative]
  );

  return {
    trackCreation,
    trackUpdate,
    trackConversation,
    trackProjectLink,
    trackExport,
    trackInitiativeAction,
  };
};

// Hook for collecting analytics data
export const useAnalyticsData = (timeRange?: { start: Date; end: Date }) => {
  const { track } = useUserAction();

  // In a real implementation, this would fetch from your analytics API
  const fetchAnalyticsData = useCallback(async () => {
    // Mock implementation - in reality this would call your analytics API
    const mockEvents: UserTrackingEvent[] = [];
    const mockSummary = {
      totalEvents: 0,
      eventsByCategory: {},
      topActions: [],
      activeUsers: 0,
      sessionDuration: 0,
      timeRange: {
        start: timeRange?.start.getTime() || Date.now() - 86400000,
        end: timeRange?.end.getTime() || Date.now(),
      },
    };

    return {
      events: mockEvents,
      summary: mockSummary,
      insights: [],
    };
  }, [timeRange]);

  const exportData = useCallback(
    (format: "csv" | "json") => {
      track({
        category: "ui_interaction",
        action: "file_download",
        data: {
          elementType: "analytics_export",
          fileName: `analytics_export.${format}`,
        },
      });

      // Implementation would export the actual data
      console.log(`Exporting analytics data as ${format}`);
    },
    [track]
  );

  return {
    fetchAnalyticsData,
    exportData,
  };
};

// Hook for real-time tracking of user behavior patterns
export const useUserBehaviorTracking = () => {
  const { track } = useUserAction();

  const trackPageEngagement = useCallback(
    (
      pageName: string,
      engagementData: {
        timeSpent: number;
        scrollDepth: number;
        clicksCount: number;
        formsInteracted: number;
      }
    ) => {
      track({
        category: "ui_interaction",
        action: "button_click", // Using existing action
        data: {
          elementType: "page_engagement",
          elementText: pageName,
          metrics: engagementData,
        },
      });
    },
    [track]
  );

  const trackFeatureUsage = useCallback(
    (
      featureName: string,
      usageData: {
        frequency: number;
        duration: number;
        success: boolean;
        context?: Record<string, unknown>;
      }
    ) => {
      track({
        category: "ui_interaction",
        action: usageData.success ? "button_click" : "modal_close",
        data: {
          elementType: "feature_usage",
          elementText: featureName,
          metrics: usageData,
        },
      });
    },
    [track]
  );

  const trackUserJourney = useCallback(
    (
      journeyStep: string,
      stepData: {
        fromStep?: string;
        duration?: number;
        completed: boolean;
        dropped?: boolean;
      }
    ) => {
      track({
        category: "navigation",
        action: "page_view",
        data: {
          toPage: journeyStep,
          fromPage: stepData.fromStep,
          timeOnPage: stepData.duration,
        },
      });
    },
    [track]
  );

  return {
    trackPageEngagement,
    trackFeatureUsage,
    trackUserJourney,
  };
};

// Hook for A/B testing and experimentation tracking
export const useExperimentTracking = () => {
  const { track } = useUserAction();

  const trackExperimentExposure = useCallback(
    (
      experimentId: string,
      variant: string,
      context?: {
        userId?: string;
        sessionId?: string;
        metadata?: Record<string, unknown>;
      }
    ) => {
      track({
        category: "ui_interaction",
        action: "button_click",
        data: {
          elementType: "experiment_exposure",
          elementText: `${experimentId}:${variant}`,
          context,
        },
      });
    },
    [track]
  );

  const trackExperimentConversion = useCallback(
    (
      experimentId: string,
      variant: string,
      conversionType: string,
      value?: number
    ) => {
      track({
        category: "ui_interaction",
        action: "button_click",
        data: {
          elementType: "experiment_conversion",
          elementText: `${experimentId}:${variant}:${conversionType}`,
          value,
        },
      });
    },
    [track]
  );

  return {
    trackExperimentExposure,
    trackExperimentConversion,
  };
};

// Hook for performance monitoring
export const usePerformanceTracking = () => {
  const { track } = useUserAction();

  const trackComponentPerformance = useCallback(
    (
      componentName: string,
      metrics: {
        renderTime: number;
        mountTime: number;
        updateCount: number;
        memoryUsage?: number;
      }
    ) => {
      track({
        category: "performance",
        action: "component_render",
        data: {
          duration: metrics.renderTime,
          componentName,
        },
      });
    },
    [track]
  );

  const trackAPIPerformance = useCallback(
    (
      endpoint: string,
      metrics: {
        duration: number;
        statusCode: number;
        success: boolean;
        retryCount?: number;
      }
    ) => {
      track({
        category: "performance",
        action: "api_call",
        data: {
          duration: metrics.duration,
          endpoint,
        },
      });
    },
    [track]
  );

  return {
    trackComponentPerformance,
    trackAPIPerformance,
  };
};

// Main integration hook that combines all tracking capabilities
export const useComprehensiveTracking = (options?: {
  initiative?: InitiativeResponseDto;
  autoInitialize?: boolean;
  enableBehaviorTracking?: boolean;
  enablePerformanceTracking?: boolean;
}) => {
  const {
    initiative,
    autoInitialize = true,
    enableBehaviorTracking = true,
    enablePerformanceTracking = false,
  } = options || {};

  // Initialize tracking system
  const trackingIntegration = useTrackingIntegration({ autoInitialize });

  // Initiative-specific tracking
  const initiativeActions = useInitiativeAction(initiative);

  // Behavior tracking
  const behaviorTracking = useUserBehaviorTracking();

  // Performance tracking
  const performanceTracking = usePerformanceTracking();

  // Analytics data
  const analyticsData = useAnalyticsData();

  // Experiment tracking
  const experimentTracking = useExperimentTracking();

  // Set initiative context when it changes
  useEffect(() => {
    if (initiative) {
      trackingIntegration.setInitiativeContext({
        id: initiative.id,
        name: initiative.name,
        status: initiative.status,
        priority: initiative.priority,
      });
    }
  }, [initiative, trackingIntegration]);

  return {
    // Context management
    ...trackingIntegration,

    // Initiative tracking
    initiative: initiativeActions,

    // Behavior tracking
    behavior: enableBehaviorTracking ? behaviorTracking : undefined,

    // Performance tracking
    performance: enablePerformanceTracking ? performanceTracking : undefined,

    // Analytics
    analytics: analyticsData,

    // Experiments
    experiments: experimentTracking,
  };
};

export default useComprehensiveTracking;
