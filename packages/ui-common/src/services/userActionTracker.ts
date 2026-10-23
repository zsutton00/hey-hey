/**
 * User Action Tracker Service
 *
 * Provides automatic tracking of user interactions with global event delegation
 * and Event.isTrusted validation for distinguishing user vs programmatic actions
 */

import type {
  UserTrackingEvent,
  TrackingEventMetadata,
  TrackingContext,
  TrackingConfiguration,
  EventBatch,
  TrackingEventId,
  SessionId,
  UserId,
  EventDescriptionTemplate,
} from "../types/userTracking";
import { EVENT_DESCRIPTION_TEMPLATES } from "../types/userTracking";

interface NavigatorWithConnection extends Navigator {
  connection?: {
    effectiveType?: string;
  };
}

// Default configuration
const DEFAULT_CONFIG: TrackingConfiguration = {
  categories: [
    "navigation",
    "initiative",
    "workflow",
    "ui_interaction",
    "form",
    "error",
  ],
  batchSize: 50,
  flushInterval: 30000, // 30 seconds
  enablePerformanceTracking: true,
  enableErrorTracking: true,
  enableFormTracking: true,
  apiEndpoint: "/api/v1/analytics/events",
  debugMode: false,
};

// Event validation utilities
export class EventValidator {
  /**
   * Validates if an event is user-initiated using Event.isTrusted and additional checks
   */
  static isUserInitiated(event: Event): boolean {
    // Basic isTrusted check
    if (event.isTrusted === false) {
      return false;
    }

    // Additional validation for mouse events
    if (event instanceof MouseEvent) {
      // Check for actual mouse coordinates (programmatic clicks often have 0,0)
      if (
        event.pageX === 0 &&
        event.pageY === 0 &&
        event.clientX === 0 &&
        event.clientY === 0
      ) {
        return false;
      }

      // Check for realistic timing between mousedown and click
      if (event.type === "click") {
        const now = performance.now();
        const timeSinceMouseDown =
          now - (EventValidator.lastMouseDownTime || 0);
        if (timeSinceMouseDown < 10) {
          // Too fast to be human
          return false;
        }
      }
    }

    // Additional validation for keyboard events
    if (event instanceof KeyboardEvent) {
      // Check for realistic key patterns
      if (
        event.key &&
        event.key.length > 1 &&
        !["Enter", "Escape", "Tab", "Backspace"].includes(event.key)
      ) {
        // Special keys are typically user-initiated
        return true;
      }
    }

    return true;
  }

  private static lastMouseDownTime = 0;

  static recordMouseDown(): void {
    EventValidator.lastMouseDownTime = performance.now();
  }

  /**
   * Validates if an element should be tracked based on data attributes or classes
   */
  static shouldTrackElement(element: Element): boolean {
    // Skip tracking for elements with data-track="false"
    if (element.getAttribute("data-track") === "false") {
      return false;
    }

    // Skip tracking for system elements
    if (
      element.classList.contains("tracking-ignore") ||
      element.closest(".tracking-ignore")
    ) {
      return false;
    }

    return true;
  }
}

// Event context extraction utilities
export class ContextExtractor {
  /**
   * Extracts tracking context from the current DOM and application state
   */
  static extractContext(element?: Element): TrackingContext {
    const context: TrackingContext = {
      page: {
        name: this.getPageName(),
        path: window.location.pathname,
        section: this.getPageSection(element),
      },
    };

    // Extract component context from data attributes
    if (element) {
      const componentName =
        element.getAttribute("data-component") ||
        element.closest("[data-component]")?.getAttribute("data-component");

      if (componentName) {
        context.component = {
          name: componentName,
          props: this.extractComponentProps(element),
        };
      }
    }

    return context;
  }

  private static getPageName(): string {
    const pathname = window.location.pathname;
    const segments = pathname.split("/").filter(Boolean);

    if (segments.length === 0) return "home";
    if (segments[0] === "initiatives") return "initiatives";
    if (segments[0] === "workflows") return "workflows";
    if (segments[0] === "projects") return "projects";
    if (segments[0] === "integrations") return "integrations";

    return segments[0] || "unknown";
  }

  private static getPageSection(element?: Element): string | undefined {
    if (!element) return undefined;

    const section = element
      .closest("[data-section]")
      ?.getAttribute("data-section");
    return section || undefined;
  }

  private static extractComponentProps(
    element: Element
  ): Record<string, unknown> {
    const props: Record<string, unknown> = {};

    // Extract data attributes that start with data-prop-
    Array.from(element.attributes).forEach((attr) => {
      if (attr.name.startsWith("data-prop-")) {
        const propName = attr.name.substring(10); // Remove 'data-prop-' prefix
        props[propName] = attr.value;
      }
    });

    return props;
  }
}

// Human-readable description generator
export class DescriptionGenerator {
  /**
   * Generates human-readable description for an event
   */
  static generateDescription(event: UserTrackingEvent): string {
    const eventKey = `${event.category}:${event.action}`;
    const template =
      EVENT_DESCRIPTION_TEMPLATES[eventKey] ||
      EVENT_DESCRIPTION_TEMPLATES.default;

    return this.populateTemplate(template, event);
  }

  private static populateTemplate(
    template: EventDescriptionTemplate,
    event: UserTrackingEvent
  ): string {
    let description = template.template;

    // Replace variables in the template with actual values
    template.variables.forEach((variable) => {
      const value = this.extractVariable(variable, event);
      description = description.replace(
        `{${variable}}`,
        String(value || "unknown")
      );
    });

    return description;
  }

  private static extractVariable(
    variable: string,
    event: UserTrackingEvent
  ): unknown {
    // Handle nested property access
    const parts = variable.split(".");
    let value: unknown = event;

    for (const part of parts) {
      if (value && typeof value === "object" && part in value) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return value;
  }
}

// Main UserActionTracker class
export class UserActionTracker {
  private config: TrackingConfiguration;
  private eventQueue: UserTrackingEvent[] = [];
  private sessionId: SessionId;
  private userId?: UserId;
  private isInitialized = false;
  private ownerCount = 0;
  private nextContextProviderId = 0;
  private flushTimer?: NodeJS.Timeout;
  private contextProviders: Map<string, () => Partial<TrackingContext>> =
    new Map();

  constructor(config: Partial<TrackingConfiguration> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionId = this.generateSessionId();
  }

  /**
   * Initialize the tracker and set up global event listeners
   */
  initialize(): void {
    this.ownerCount += 1;

    if (this.isInitialized) {
      return;
    }

    this.setupGlobalEventListeners();
    this.setupErrorTracking();
    this.setupPerformanceTracking();
    this.startFlushTimer();

    this.isInitialized = true;

    if (this.config.debugMode) {
      console.log("UserActionTracker initialized", {
        sessionId: this.sessionId,
        config: this.config,
      });
    }
  }

  /**
   * Cleanup tracker and remove event listeners
   */
  destroy(): void {
    if (this.ownerCount === 0) {
      return;
    }

    this.ownerCount -= 1;
    if (this.ownerCount > 0 || !this.isInitialized) {
      return;
    }

    document.removeEventListener("click", this.handleClick, true);
    document.removeEventListener("submit", this.handleSubmit, true);
    document.removeEventListener("input", this.handleInput, true);
    document.removeEventListener("focus", this.handleFocus, true);
    document.removeEventListener("blur", this.handleBlur, true);
    document.removeEventListener("mousedown", this.handleMouseDown, true);
    window.removeEventListener("error", this.handleWindowError);
    window.removeEventListener(
      "unhandledrejection",
      this.handleUnhandledRejection
    );
    window.removeEventListener("load", this.handleWindowLoad);

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }

    // Flush remaining events
    this.flush();

    this.isInitialized = false;
  }

  /**
   * Manually track an event
   */
  track(event: Partial<UserTrackingEvent>): void {
    const fullEvent = this.enrichEvent(event);
    if (!fullEvent) {
      return;
    }
    this.addToQueue(fullEvent);

    if (this.config.debugMode) {
      console.log("Event tracked:", {
        description: DescriptionGenerator.generateDescription(fullEvent),
        event: fullEvent,
      });
    }
  }

  /**
   * Register a context provider for enriching events
   */
  registerContextProvider(
    name: string,
    provider: () => Partial<TrackingContext>
  ): () => void {
    const registrationId = `${name}:${++this.nextContextProviderId}`;
    this.contextProviders.set(registrationId, provider);

    let unregistered = false;
    return () => {
      if (unregistered) {
        return;
      }

      unregistered = true;
      this.contextProviders.delete(registrationId);
    };
  }

  /**
   * Set the current user ID for tracking
   */
  setUserId(userId?: UserId): void {
    this.userId = userId;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TrackingConfiguration>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Manually flush the event queue
   */
  async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const batch: EventBatch = {
      batchId: this.generateEventId(),
      events: [...this.eventQueue],
      timestamp: Date.now(),
      deviceInfo: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    };

    this.eventQueue = [];

    try {
      await this.sendBatch(batch);
    } catch (error) {
      if (this.config.debugMode) {
        console.error("Failed to send event batch:", error);
      }
      // Re-queue events on failure (with limit to prevent memory leaks)
      if (this.eventQueue.length < this.config.batchSize * 2) {
        this.eventQueue.unshift(...batch.events);
      }
    }
  }

  // Private methods
  private setupGlobalEventListeners(): void {
    // Use capture phase to ensure we catch events before they're handled
    document.addEventListener("click", this.handleClick, true);
    document.addEventListener("submit", this.handleSubmit, true);
    document.addEventListener("input", this.handleInput, true);
    document.addEventListener("focus", this.handleFocus, true);
    document.addEventListener("blur", this.handleBlur, true);
    document.addEventListener("mousedown", this.handleMouseDown, true);
  }

  private handleClick = (event: MouseEvent): void => {
    if (!EventValidator.isUserInitiated(event)) return;

    const target = event.target as HTMLElement;
    if (!EventValidator.shouldTrackElement(target)) return;

    const elementType = target.tagName.toLowerCase();
    const elementText =
      target.textContent?.trim().substring(0, 100) || undefined;
    const elementId = target.id || undefined;

    this.track({
      category: "ui_interaction",
      action: "button_click",
      data: {
        elementType,
        elementText,
        elementId,
        elementClass: target.className || undefined,
      },
    });
  };

  private handleSubmit = (event: SubmitEvent): void => {
    if (!EventValidator.isUserInitiated(event)) return;

    const form = event.target as HTMLFormElement;
    if (!EventValidator.shouldTrackElement(form)) return;

    const formName = form.name || form.id || "unnamed-form";
    const formElements = form.querySelectorAll("input, select, textarea");
    const fieldCount = formElements.length;

    this.track({
      category: "form",
      action: "submit_attempt",
      data: {
        formName,
        completionRate: fieldCount, // Using existing field from FormEvent data interface
      },
    });
  };

  private handleInput = (event: Event): void => {
    if (!EventValidator.isUserInitiated(event)) return;

    const target = event.target as HTMLInputElement;
    if (!EventValidator.shouldTrackElement(target)) return;

    // Debounce input events to avoid excessive tracking
    if (!this.shouldTrackInput(target)) return;

    const formName = target.form?.name || target.form?.id || "unnamed-form";
    const fieldName = target.name || target.id || "unnamed-field";
    const fieldType = target.type || "text";

    this.track({
      category: "form",
      action: "field_change",
      data: {
        formName,
        fieldName,
        fieldType,
      },
    });
  };

  private handleFocus = (event: FocusEvent): void => {
    if (!EventValidator.isUserInitiated(event)) return;

    const target = event.target as HTMLElement;
    if (!EventValidator.shouldTrackElement(target)) return;

    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      const formName = target.form?.name || target.form?.id || "unnamed-form";
      const fieldName = target.name || target.id || "unnamed-field";
      const fieldType = target.type || "text";

      this.track({
        category: "form",
        action: "field_focus",
        data: {
          formName,
          fieldName,
          fieldType,
        },
      });
    }
  };

  private handleBlur = (event: FocusEvent): void => {
    if (!EventValidator.isUserInitiated(event)) return;

    const target = event.target as HTMLElement;
    if (!EventValidator.shouldTrackElement(target)) return;

    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      const formName = target.form?.name || target.form?.id || "unnamed-form";
      const fieldName = target.name || target.id || "unnamed-field";
      const fieldType = target.type || "text";

      this.track({
        category: "form",
        action: "field_blur",
        data: {
          formName,
          fieldName,
          fieldType,
        },
      });
    }
  };

  private handleMouseDown = (): void => {
    EventValidator.recordMouseDown();
  };

  private handleWindowError = (event: ErrorEvent): void => {
    this.track({
      category: "error",
      action: "javascript_error",
      data: {
        errorMessage: event.message,
        stack: event.error?.stack,
      },
    });
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    this.track({
      category: "error",
      action: "javascript_error",
      data: {
        errorMessage: String(event.reason),
        stack: event.reason?.stack,
      },
    });
  };

  private handleWindowLoad = (): void => {
    const navigation = performance.getEntriesByType(
      "navigation"
    )[0] as PerformanceNavigationTiming;
    if (!navigation) {
      return;
    }

    const connection = (navigator as NavigatorWithConnection).connection;
    this.track({
      category: "performance",
      action: "page_load",
      data: {
        duration: navigation.loadEventEnd - navigation.loadEventStart,
        networkType: connection?.effectiveType,
      },
    });
  };

  private setupErrorTracking(): void {
    if (!this.config.enableErrorTracking) return;

    window.addEventListener("error", this.handleWindowError);
    window.addEventListener(
      "unhandledrejection",
      this.handleUnhandledRejection
    );
  }

  private setupPerformanceTracking(): void {
    if (!this.config.enablePerformanceTracking) return;

    // Track page load performance
    window.addEventListener("load", this.handleWindowLoad);
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      if (this.eventQueue.length > 0) {
        this.flush();
      }
    }, this.config.flushInterval);
  }

  private enrichEvent(
    event: Partial<UserTrackingEvent>
  ): UserTrackingEvent | null {
    if (!event.category || !event.action) {
      if (this.config.debugMode) {
        console.warn("Skipping tracking event without category/action", {
          event,
        });
      }
      return null;
    }

    const baseMetadata: TrackingEventMetadata = {
      eventId: this.generateEventId(),
      sessionId: this.sessionId,
      userId: this.userId,
      timestamp: Date.now(),
      url: window.location.href,
      userAgent: navigator.userAgent,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      context: this.buildContext(),
    };

    return {
      ...baseMetadata,
      category: event.category,
      action: event.action,
      data: event.data || {},
    } as UserTrackingEvent;
  }

  private buildContext(): TrackingContext {
    let context = ContextExtractor.extractContext();

    // Merge context from registered providers
    this.contextProviders.forEach((provider) => {
      try {
        const additionalContext = provider();
        context = { ...context, ...additionalContext };
      } catch (error) {
        if (this.config.debugMode) {
          console.warn("Context provider failed:", error);
        }
      }
    });

    return context;
  }

  private addToQueue(event: UserTrackingEvent): void {
    this.eventQueue.push(event);

    // Flush if batch size reached
    if (this.eventQueue.length >= this.config.batchSize) {
      this.flush();
    }
  }

  private shouldTrackInput(element: HTMLInputElement): boolean {
    // Skip password fields for security
    if (element.type === "password") return false;

    // Debounce based on element ID to avoid excessive events
    const now = Date.now();
    const key = `input-${element.name || element.id || "anonymous"}`;
    const lastTime = this.lastInputTimes.get(key) || 0;

    if (now - lastTime < 500) {
      // 500ms debounce
      return false;
    }

    this.lastInputTimes.set(key, now);
    return true;
  }

  private lastInputTimes = new Map<string, number>();

  private async sendBatch(batch: EventBatch): Promise<void> {
    try {
      const response = await fetch(this.config.apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", // Include JWT cookie
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        // Handle authentication failures gracefully
        if (response.status === 401) {
          if (this.config.debugMode) {
            console.warn(
              "[ANALYTICS] User not authenticated, stopping tracker"
            );
          }
          // Stop tracking for unauthenticated users
          this.destroy();
          return;
        }

        // Handle rate limiting gracefully
        if (response.status === 429) {
          if (this.config.debugMode) {
            console.warn("[ANALYTICS] Rate limited, backing off");
          }
          // Don't re-queue, just drop this batch
          return;
        }

        // For other errors, throw to trigger re-queue logic
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (this.config.debugMode) {
        const result = await response.json();
        console.log("[ANALYTICS] Batch sent successfully:", {
          batchId: result.data?.batchId,
          eventsReceived: result.data?.eventsReceived,
        });
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error("[ANALYTICS] Failed to send batch:", error);
      }
      // Re-throw to trigger re-queue logic in flush() method
      throw error;
    }
  }

  private generateEventId(): TrackingEventId {
    return `evt_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}` as TrackingEventId;
  }

  private generateSessionId(): SessionId {
    return `sess_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}` as SessionId;
  }
}

// Singleton instance
export const userActionTracker = new UserActionTracker();
