/**
 * Auto-tracking Hooks and HOCs
 *
 * Provides zero-configuration tracking for React components with automatic
 * event detection and context-aware semantic descriptions
 */

import { useEffect, useCallback, useRef } from "react";
import { useUserAction } from "../contexts/TrackingContext";
import type { UITrackingData } from "../contexts/TrackingContext";

// Configuration for automatic tracking behavior
interface AutoTrackingConfig {
  trackMount?: boolean;
  trackUnmount?: boolean;
  trackClicks?: boolean;
  trackForms?: boolean;
  trackVisibility?: boolean;
  trackProps?: string[]; // Props to track changes for
  trackingEnabled?: boolean;
  componentName?: string;
  debounceMs?: number;
}

// Default configuration
const DEFAULT_AUTO_TRACKING_CONFIG: AutoTrackingConfig = {
  trackMount: true,
  trackUnmount: false,
  trackClicks: true,
  trackForms: true,
  trackVisibility: false,
  trackProps: [],
  trackingEnabled: true,
  debounceMs: 500,
};

/**
 * Hook for automatic component lifecycle tracking
 */
const useComponentTracking = (
  componentName: string,
  config: Partial<AutoTrackingConfig> = {},
): void => {
  const { track, isEnabled } = useUserAction();
  const finalConfig = { ...DEFAULT_AUTO_TRACKING_CONFIG, ...config };
  const mountTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!isEnabled || !finalConfig.trackingEnabled) return;

    mountTimeRef.current = Date.now();

    if (finalConfig.trackMount) {
      track({
        category: "ui_interaction",
        action: "component_mount",
        data: {
          elementType: "component",
          componentName,
        },
      });
    }

    return () => {
      if (finalConfig.trackUnmount) {
        const timeVisible = Date.now() - mountTimeRef.current;
        track({
          category: "ui_interaction",
          action: "component_unmount",
          data: {
            elementType: "component",
            componentName,
            timeVisible,
          },
        });
      }
    };
  }, [
    componentName,
    track,
    isEnabled,
    finalConfig.trackMount,
    finalConfig.trackUnmount,
  ]);
};

/**
 * Hook for tracking element visibility changes
 */
const useVisibilityTracking = (
  elementRef: React.RefObject<HTMLElement>,
  componentName: string,
  config: { threshold?: number; trackDuration?: boolean } = {},
): void => {
  const { track, isEnabled } = useUserAction();
  const { threshold = 0.5, trackDuration = true } = config;
  const visibilityStartRef = useRef<number | null>(null);
  const isVisibleRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isEnabled || !elementRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const isVisible =
            entry.isIntersecting && entry.intersectionRatio >= threshold;

          if (isVisible && !isVisibleRef.current) {
            // Element became visible
            visibilityStartRef.current = Date.now();
            isVisibleRef.current = true;

            track({
              category: "ui_interaction",
              action: "component_visible",
              data: {
                elementType: "component",
                componentName,
                intersectionRatio: entry.intersectionRatio,
              },
            });
          } else if (!isVisible && isVisibleRef.current) {
            // Element became hidden
            const viewDuration =
              trackDuration && visibilityStartRef.current
                ? Date.now() - visibilityStartRef.current
                : undefined;

            isVisibleRef.current = false;
            visibilityStartRef.current = null;

            track({
              category: "ui_interaction",
              action: "component_hidden",
              data: {
                elementType: "component",
                componentName,
                viewDuration,
              },
            });
          }
        });
      },
      { threshold },
    );

    observer.observe(elementRef.current);

    return () => {
      observer.disconnect();

      // Track final view duration if element was visible when unmounting
      if (isVisibleRef.current && trackDuration && visibilityStartRef.current) {
        const viewDuration = Date.now() - visibilityStartRef.current;
        track({
          category: "ui_interaction",
          action: "component_hidden",
          data: {
            elementType: "component",
            componentName,
            viewDuration,
            reason: "unmount",
          },
        });
      }
    };
  }, [elementRef, componentName, track, isEnabled, threshold, trackDuration]);
};

/**
 * Hook for automatic click tracking within a component
 */
const useClickTracking = (
  containerRef: React.RefObject<HTMLElement>,
  componentName: string,
  config: {
    selector?: string;
    trackText?: boolean;
    trackDataAttributes?: boolean;
    debounceMs?: number;
  } = {},
): void => {
  const { track, isEnabled } = useUserAction();
  const {
    selector = 'button, a, [role="button"], [data-track-click]',
    trackText = true,
    trackDataAttributes = true,
    debounceMs = 200,
  } = config;

  const lastClickTimeRef = useRef<number>(0);

  const handleClick = useCallback(
    (event: Event) => {
      if (!isEnabled) return;

      const now = Date.now();
      if (now - lastClickTimeRef.current < debounceMs) return;
      lastClickTimeRef.current = now;

      const target = event.target as HTMLElement;
      const clickableElement = target.closest(selector) as HTMLElement;

      if (!clickableElement) return;

      const data: UITrackingData = {
        elementType: clickableElement.tagName.toLowerCase(),
        componentName,
      };

      if (trackText) {
        data.elementText = clickableElement.textContent
          ?.trim()
          .substring(0, 100);
      }

      if (trackDataAttributes) {
        // Extract data attributes for additional context
        Array.from(clickableElement.attributes).forEach((attr) => {
          if (
            attr.name.startsWith("data-") &&
            attr.name !== "data-track-click"
          ) {
            data[attr.name] = attr.value;
          }
        });
      }

      track({
        category: "ui_interaction",
        action: "button_click",
        data,
      });
    },
    [
      isEnabled,
      track,
      componentName,
      selector,
      trackText,
      trackDataAttributes,
      debounceMs,
    ],
  );

  useEffect(() => {
    if (!isEnabled || !containerRef.current) return;

    const container = containerRef.current;
    container.addEventListener("click", handleClick, true);

    return () => {
      container.removeEventListener("click", handleClick, true);
    };
  }, [handleClick, containerRef, isEnabled]);
};

/**
 * Hook for automatic form tracking within a component
 */
const useFormTracking = (
  containerRef: React.RefObject<HTMLElement>,
  componentName: string,
): void => {
  const { track, isEnabled } = useUserAction();

  useEffect(() => {
    if (!isEnabled || !containerRef.current) return;

    const container = containerRef.current;

    const handleSubmit = (event: Event) => {
      const form = event.target as HTMLFormElement;
      const formName = form.name || form.id || `${componentName}-form`;

      track({
        category: "form",
        action: "submit_attempt",
        data: {
          formName,
          componentName,
        },
      });
    };

    const handleInput = (event: Event) => {
      const target = event.target as HTMLInputElement;
      const form = target.form;
      const formName = form?.name || form?.id || `${componentName}-form`;

      track({
        category: "form",
        action: "field_change",
        data: {
          formName,
          fieldName: target.name || target.id || "unnamed",
          fieldType: target.type || "text",
          componentName,
        },
      });
    };

    container.addEventListener("submit", handleSubmit, true);
    container.addEventListener("input", handleInput, true);

    return () => {
      container.removeEventListener("submit", handleSubmit, true);
      container.removeEventListener("input", handleInput, true);
    };
  }, [containerRef, componentName, track, isEnabled]);
};

/**
 * Comprehensive auto-tracking hook that combines all tracking features
 */
export const useAutoTracking = (
  componentName: string,
  containerRef: React.RefObject<HTMLElement>,
  config: AutoTrackingConfig = {},
): void => {
  const finalConfig = { ...DEFAULT_AUTO_TRACKING_CONFIG, ...config };

  // Component lifecycle tracking
  useComponentTracking(componentName, finalConfig);

  // Click tracking
  useClickTracking(containerRef, componentName, {
    debounceMs: finalConfig.debounceMs,
  });

  // Form tracking
  useFormTracking(containerRef, componentName);

  // Visibility tracking
  useVisibilityTracking(containerRef, componentName, {
    trackDuration: true,
  });
};
