import { useState, useRef, useCallback, useEffect } from "react";
import { getRandomPrompt } from "../utils/statusUtils";

export interface UseTypingAnimationOptions {
  /** The full description text to animate */
  description: string;
  /** Unique identifier for localStorage animation tracking */
  itemId: string;
  /** Prefix for the animation key (e.g., "initiative", "workstream", "workitem") */
  keyPrefix: string;
  /** Whether the item has been reviewed (skips animation if true) */
  isReviewed?: boolean;
  /** Maximum character length before truncation */
  maxLength?: number;
  /** Delay before starting animation in milliseconds */
  startDelay?: number;
}

export interface UseTypingAnimationResult {
  /** The currently displayed (partially typed) description */
  displayedDescription: string;
  /** Whether the typing animation is currently running */
  isTyping: boolean;
  /** Random prompt phrase for this animation session */
  promptPhrase: string;
  /** Function to manually trigger the animation */
  startAnimation: () => void;
  /** Function to immediately show full text */
  showFullText: () => void;
}

/**
 * Custom hook for managing typing animation effects on text content.
 * Handles localStorage-based animation tracking, text truncation, and smooth typing animations.
 *
 * Supports streaming: when the description grows (new chunks appended), the animation
 * continues smoothly from the current position toward the new target without restarting.
 */
export const useTypingAnimation = ({
  description,
  itemId,
  keyPrefix,
  isReviewed = false,
  maxLength = 400,
  startDelay = 200,
}: UseTypingAnimationOptions): UseTypingAnimationResult => {
  const [displayedDescription, setDisplayedDescription] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const promptRef = useRef<string>("");
  const caretDelayRef = useRef<number>(0);

  // Buffer-based streaming refs
  const targetTextRef = useRef("");
  const renderedLengthRef = useRef(0);
  const isAnimatingRef = useRef(false);
  const lastFrameTimeRef = useRef(0);
  const startDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const animationKey = `${keyPrefix}-animated-${itemId}`;

  // Truncate description to specified length
  const truncatedDescription =
    description.length > maxLength
      ? `${description.substring(0, maxLength)}...`
      : description;

  const fullDescription = truncatedDescription;

  // Get a consistent prompt for this animation session and random caret delay
  useEffect(() => {
    if (!promptRef.current) {
      promptRef.current = getRandomPrompt();
    }
    if (caretDelayRef.current === 0) {
      caretDelayRef.current = Math.random() * 1000;
    }
  }, []);

  const cancelAnimation = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (startDelayTimerRef.current) {
      clearTimeout(startDelayTimerRef.current);
      startDelayTimerRef.current = null;
    }
    isAnimatingRef.current = false;
  }, []);

  // Core animation loop - types toward targetTextRef at a steady rate.
  // Reads the target from a ref so it automatically picks up streaming
  // extensions without needing to restart.
  const runAnimationLoop = useCallback(() => {
    if (isAnimatingRef.current) return;
    isAnimatingRef.current = true;
    setIsTyping(true);
    lastFrameTimeRef.current = performance.now();

    const step = (timestamp: number) => {
      const target = targetTextRef.current;
      const currentLen = renderedLengthRef.current;

      // Caught up to target - pause until more text arrives
      if (currentLen >= target.length) {
        setDisplayedDescription(target);
        renderedLengthRef.current = target.length;
        isAnimatingRef.current = false;
        setIsTyping(false);
        localStorage.setItem(animationKey, "true");
        return;
      }

      const elapsed = timestamp - lastFrameTimeRef.current;
      lastFrameTimeRef.current = timestamp;

      // Clamp elapsed to avoid huge jumps when tab is backgrounded
      const clampedElapsed = Math.min(elapsed, 100);

      // Dynamic speed based on how much text is buffered ahead.
      // Larger buffers type faster so we don't fall too far behind
      // during streaming; small buffers slow down for a natural finish.
      const remaining = target.length - currentLen;
      let charsPerMs: number;
      if (remaining > 150) {
        charsPerMs = 0.15;
      } else if (remaining > 40) {
        charsPerMs = 0.08;
      } else {
        charsPerMs = 0.04;
      }

      const charsToAdvance = Math.max(
        1,
        Math.round(clampedElapsed * charsPerMs)
      );
      const newLen = Math.min(currentLen + charsToAdvance, target.length);
      renderedLengthRef.current = newLen;
      setDisplayedDescription(target.slice(0, newLen));

      animationFrameRef.current = requestAnimationFrame(step);
    };

    animationFrameRef.current = requestAnimationFrame(step);
  }, [animationKey]);

  // Function to immediately show full text
  const showFullText = useCallback(() => {
    cancelAnimation();
    const target = targetTextRef.current || fullDescription;
    setDisplayedDescription(target);
    renderedLengthRef.current = target.length;
    setIsTyping(false);
    localStorage.setItem(animationKey, "true");
  }, [cancelAnimation, fullDescription, animationKey]);

  // Handle text changes - detects streaming continuations vs fresh text
  useEffect(() => {
    if (isReviewed) {
      cancelAnimation();
      targetTextRef.current = fullDescription;
      renderedLengthRef.current = fullDescription.length;
      setDisplayedDescription(fullDescription);
      setIsTyping(false);
      return;
    }

    if (!fullDescription) {
      cancelAnimation();
      targetTextRef.current = "";
      renderedLengthRef.current = 0;
      setDisplayedDescription("");
      setIsTyping(false);
      return;
    }

    const prevTarget = targetTextRef.current;
    targetTextRef.current = fullDescription;

    // Same text and fully rendered - nothing to do
    if (
      fullDescription === prevTarget &&
      renderedLengthRef.current >= fullDescription.length
    ) {
      return;
    }

    // Streaming continuation: new text extends what we were already typing toward.
    // The target ref is already updated above; the running animation loop will
    // read it on the next frame and keep typing. If the loop had paused
    // (caught up to the previous target), restart it.
    if (prevTarget.length > 0 && fullDescription.startsWith(prevTarget)) {
      if (!isAnimatingRef.current) {
        runAnimationLoop();
      }
      return;
    }

    // Completely different text - check if previously animated (static re-render)
    const hasBeenAnimated = localStorage.getItem(animationKey) === "true";
    if (hasBeenAnimated) {
      cancelAnimation();
      renderedLengthRef.current = fullDescription.length;
      setDisplayedDescription(fullDescription);
      setIsTyping(false);
      return;
    }

    // Fresh text - animate from the beginning after the start delay
    cancelAnimation();
    renderedLengthRef.current = 0;
    setDisplayedDescription("");

    startDelayTimerRef.current = setTimeout(() => {
      runAnimationLoop();
    }, startDelay);

    return () => {
      if (startDelayTimerRef.current) {
        clearTimeout(startDelayTimerRef.current);
        startDelayTimerRef.current = null;
      }
    };
  }, [
    fullDescription,
    isReviewed,
    cancelAnimation,
    runAnimationLoop,
    startDelay,
    animationKey,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => cancelAnimation();
  }, [cancelAnimation]);

  return {
    displayedDescription,
    isTyping,
    promptPhrase: promptRef.current,
    startAnimation: runAnimationLoop,
    showFullText,
  };
};
