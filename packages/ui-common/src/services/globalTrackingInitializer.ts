/**
 * Global Tracking Initializer
 *
 * Provides app-wide initialization and configuration for the user tracking system
 * with React integration and automatic context providers
 */

import * as React from "react";
import { userActionTracker } from "./userActionTracker";
import type {
  TrackingConfiguration,
  TrackingContext,
  UserId,
} from "../types/userTracking";

// Global tracking configuration with sensible defaults for the initiative management app
const INITIATIVE_APP_TRACKING_CONFIG: TrackingConfiguration = {
  categories: [
    "navigation",
    "initiative",
    "workflow",
    "ui_interaction",
    "form",
    "integration",
    "error",
    "performance",
  ],
  batchSize: 25,
  flushInterval: 15000, // 15 seconds - faster for initiative workflows
  enablePerformanceTracking: true,
  enableErrorTracking: true,
  enableFormTracking: true,
  apiEndpoint: "/api/analytics/events",
  debugMode: process.env.NODE_ENV === "development",
};

// Context providers for different parts of the app
export class GlobalTrackingInitializer {
  private static isInitialized = false;
  private static contextProviders = new Map<
    string,
    () => Partial<TrackingContext>
  >();
  private static contextProviderCleanups = new Map<string, () => void>();

  /**
   * Initialize global tracking system for the entire application
   */
  static initialize(config: Partial<TrackingConfiguration> = {}): void {
    if (this.isInitialized) {
      console.warn("Global tracking already initialized");
      return;
    }

    const finalConfig = { ...INITIATIVE_APP_TRACKING_CONFIG, ...config };

    // Configure and initialize the tracker
    userActionTracker.updateConfig(finalConfig);
    userActionTracker.initialize();

    // Register default context providers
    this.registerDefaultContextProviders();

    // Set up app-level event listeners
    this.setupAppLevelTracking();

    // Handle page visibility changes
    this.setupVisibilityTracking();

    // Handle navigation tracking
    this.setupNavigationTracking();

    this.isInitialized = true;

    if (finalConfig.debugMode) {
      console.log("🚀 Global tracking system initialized", {
        config: finalConfig,
        providers: Array.from(this.contextProviders.keys()),
      });
    }
  }

  /**
   * Shutdown tracking system (useful for cleanup)
   */
  static shutdown(): void {
    if (!this.isInitialized) return;

    userActionTracker.destroy();
    this.contextProviderCleanups.forEach((cleanup) => cleanup());
    this.contextProviderCleanups.clear();
    this.contextProviders.clear();
    this.isInitialized = false;

    console.log("🛑 Global tracking system shutdown");
  }

  /**
   * Register a context provider for app-wide context enrichment
   */
  static registerContextProvider(
    name: string,
    provider: () => Partial<TrackingContext>
  ): void {
    this.unregisterContextProvider(name);
    this.contextProviders.set(name, provider);
    this.contextProviderCleanups.set(
      name,
      userActionTracker.registerContextProvider(name, provider)
    );
  }

  /**
   * Update global tracking configuration
   */
  static updateConfig(config: Partial<TrackingConfiguration>): void {
    userActionTracker.updateConfig(config);
  }

  /**
   * Set user context (call when user logs in/out)
   */
  static setUserContext(
    user: { id: string; name?: string; email?: string } | null
  ): void {
    if (user) {
      userActionTracker.setUserId(user.id as UserId);

      this.registerContextProvider("user", () => ({
        // Add user context to page metadata
        page: {
          name: this.getPageNameFromURL(),
          path: window.location.pathname,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
          },
        },
      }));
    } else {
      userActionTracker.setUserId(undefined);
      this.unregisterContextProvider("user");
    }
  }

  /**
   * Set organization context (call when organization changes)
   */
  static setOrganizationContext(
    organization: { id: string; name: string } | null
  ): void {
    if (organization) {
      this.registerContextProvider("organization", () => ({
        organization: {
          id: organization.id,
          name: organization.name,
        },
      }));
    } else {
      this.unregisterContextProvider("organization");
    }
  }

  /**
   * Set project context (call when project changes)
   */
  static setProjectContext(project: { id: string; name: string } | null): void {
    if (project) {
      this.registerContextProvider("project", () => ({
        project: {
          id: project.id,
          name: project.name,
        },
      }));
    } else {
      this.unregisterContextProvider("project");
    }
  }

  /**
   * Set initiative context (call when viewing/editing an initiative)
   */
  static setInitiativeContext(
    initiative: {
      id: string;
      name: string;
      status: string;
      priority: string;
    } | null
  ): void {
    if (initiative) {
      this.registerContextProvider("initiative", () => ({
        initiative: {
          id: initiative.id,
          name: initiative.name,
          status: initiative.status,
          priority: initiative.priority,
        },
      }));
    } else {
      this.unregisterContextProvider("initiative");
    }
  }

  /**
   * Set workflow context (call when working with workflows)
   */
  static setWorkflowContext(
    workflow: {
      id: string;
      name: string;
      currentStep?: string;
    } | null
  ): void {
    if (workflow) {
      this.registerContextProvider("workflow", () => ({
        workflow: {
          id: workflow.id,
          name: workflow.name,
          currentStep: workflow.currentStep,
        },
      }));
    } else {
      this.unregisterContextProvider("workflow");
    }
  }

  // Private helper methods

  private static unregisterContextProvider(name: string): void {
    this.contextProviderCleanups.get(name)?.();
    this.contextProviderCleanups.delete(name);
    this.contextProviders.delete(name);
  }

  private static registerDefaultContextProviders(): void {
    // Browser context provider
    this.registerContextProvider("browser", () => ({
      page: {
        name: this.getPageNameFromURL(),
        path: window.location.pathname,
        metadata: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          platform: navigator.platform,
        },
      },
    }));

    // Viewport context provider
    this.registerContextProvider("viewport", () => ({
      page: {
        name: this.getPageNameFromURL(),
        path: window.location.pathname,
        metadata: {
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
          },
        },
      },
    }));

    // URL context provider
    this.registerContextProvider("url", () => ({
      page: {
        name: this.getPageNameFromURL(),
        path: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
        referrer: document.referrer || undefined,
      },
    }));
  }

  private static setupAppLevelTracking(): void {
    // Track app startup
    userActionTracker.track({
      category: "navigation",
      action: "page_view",
      data: {
        toPage: "app_startup",
        fromPage: document.referrer || "direct",
      },
    });

    // Track window focus/blur for engagement metrics
    let focusStartTime = Date.now();

    window.addEventListener("focus", () => {
      focusStartTime = Date.now();
      userActionTracker.track({
        category: "ui_interaction",
        action: "button_click",
        data: {
          elementType: "window",
          elementText: "focus",
        },
      });
    });

    window.addEventListener("blur", () => {
      const focusDuration = Date.now() - focusStartTime;
      userActionTracker.track({
        category: "ui_interaction",
        action: "button_click",
        data: {
          elementType: "window",
          elementText: "blur",
          focusDuration,
        },
      });
    });

    // Track app errors globally
    window.addEventListener("unhandledrejection", (event) => {
      userActionTracker.track({
        category: "error",
        action: "javascript_error",
        data: {
          errorMessage: `Unhandled Promise Rejection: ${event.reason}`,
          stack: event.reason?.stack || undefined,
        },
      });
    });
  }

  private static setupVisibilityTracking(): void {
    let visibilityStartTime = Date.now();
    let wasVisible = !document.hidden;

    const handleVisibilityChange = () => {
      const isVisible = !document.hidden;
      const now = Date.now();

      if (isVisible && !wasVisible) {
        // Page became visible
        visibilityStartTime = now;
        userActionTracker.track({
          category: "navigation",
          action: "page_view",
          data: {
            toPage: this.getPageNameFromURL(),
          },
        });
      } else if (!isVisible && wasVisible) {
        // Page became hidden
        const visibleDuration = now - visibilityStartTime;
        userActionTracker.track({
          category: "navigation",
          action: "page_leave",
          data: {
            fromPage: this.getPageNameFromURL(),
            toPage: "hidden",
            timeOnPage: visibleDuration,
          },
        });
      }

      wasVisible = isVisible;
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  private static setupNavigationTracking(): void {
    // Track URL changes (for SPA navigation)
    let currentURL = window.location.href;

    const trackNavigation = () => {
      const newURL = window.location.href;
      if (newURL !== currentURL) {
        const previousPage = this.getPageNameFromURL(currentURL);
        const currentPage = this.getPageNameFromURL(newURL);

        userActionTracker.track({
          category: "navigation",
          action: "page_view",
          data: {
            fromPage: previousPage,
            toPage: currentPage,
          },
        });

        currentURL = newURL;
      }
    };

    // Listen for pushState/replaceState (React Router navigation)
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      setTimeout(trackNavigation, 0);
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      setTimeout(trackNavigation, 0);
    };

    // Listen for back/forward navigation
    window.addEventListener("popstate", trackNavigation);
  }

  private static getPageNameFromURL(
    url: string = window.location.href
  ): string {
    try {
      const urlObj = new URL(url);
      const pathSegments = urlObj.pathname.split("/").filter(Boolean);

      if (pathSegments.length === 0) return "home";

      // Map common routes to readable names
      const routeMap: Record<string, string> = {
        initiatives: "initiatives",
        workflows: "workflows",
        projects: "projects",
        integrations: "integrations",
        analytics: "analytics",
        settings: "settings",
        profile: "profile",
      };

      const firstSegment = pathSegments[0];
      return routeMap[firstSegment] || firstSegment;
    } catch {
      return "unknown";
    }
  }
}

// React hook for easy integration with components
export const useGlobalTracking = (config?: {
  enableAutoTracking?: boolean;
  trackComponentMount?: boolean;
}) => {
  const { enableAutoTracking = true, trackComponentMount = false } =
    config || {};

  React.useEffect(() => {
    if (!GlobalTrackingInitializer["isInitialized"] && enableAutoTracking) {
      GlobalTrackingInitializer.initialize();
    }
  }, [enableAutoTracking]);

  React.useEffect(() => {
    if (trackComponentMount) {
      userActionTracker.track({
        category: "ui_interaction",
        action: "button_click",
        data: {
          elementType: "app_component",
          elementText: "mount",
        },
      });
    }
  }, [trackComponentMount]);

  return {
    setUserContext: GlobalTrackingInitializer.setUserContext,
    setOrganizationContext: GlobalTrackingInitializer.setOrganizationContext,
    setProjectContext: GlobalTrackingInitializer.setProjectContext,
    setInitiativeContext: GlobalTrackingInitializer.setInitiativeContext,
    setWorkflowContext: GlobalTrackingInitializer.setWorkflowContext,
    updateConfig: GlobalTrackingInitializer.updateConfig,
  };
};

// Export for app initialization
export default GlobalTrackingInitializer;
