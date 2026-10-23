import React from "react";
import { useConversationEvents } from "../Conversation/hooks/useConversationEvents";
import { log } from "../../utils/logger";

interface UseLocalSubmissionStateParams {
  isSubmitted: boolean;
  conversationId: string;
}

interface UseLocalSubmissionStateReturn {
  hasLocallySubmitted: boolean;
  effectiveIsSubmitted: boolean;
  setHasLocallySubmitted: (value: boolean) => void;
}

/**
 * Manages local submission state for immediate UI feedback while parent state propagates.
 *
 * This hook provides:
 * - Instant visual feedback when user submits a form
 * - Automatic reset on submission errors (form becomes editable)
 * - Automatic sync when parent resets the form
 *
 * The effectiveIsSubmitted value combines both local and parent state:
 * - If either is true, the form appears submitted
 * - This ensures UI stays in submitted state even before parent prop updates
 *
 * On submission success the local state is intentionally NOT reset: it bridges
 * the submitted UI until the parent's isSubmitted prop catches up. Clearing it
 * early would re-show the buttons for a frame and cause a double exit animation.
 *
 * @param params.isSubmitted - Parent's submission state
 * @param params.conversationId - ID for logging context
 * @returns Object with local state, computed value, and setter
 */
export const useLocalSubmissionState = ({
  isSubmitted,
  conversationId,
}: UseLocalSubmissionStateParams): UseLocalSubmissionStateReturn => {
  const [hasLocallySubmitted, setHasLocallySubmitted] = React.useState(false);
  const effectiveIsSubmitted = isSubmitted || hasLocallySubmitted;
  const prevIsSubmittedRef = React.useRef(isSubmitted);

  // Reset local state on submission errors so the form becomes editable again
  const { on } = useConversationEvents(conversationId);

  React.useEffect(() => {
    const unsubscribeError = on("submission-error", () => {
      log.info("dynamic_form", "Resetting on submission error", {
        conversationId,
      });
      setHasLocallySubmitted(false);
    });

    return () => {
      unsubscribeError();
    };
  }, [on, conversationId]);

  // Sync local state when parent resets form
  React.useEffect(() => {
    if (prevIsSubmittedRef.current && !isSubmitted && hasLocallySubmitted) {
      log.info("dynamic_form", "Resetting on parent reset", {
        conversationId,
      });
      setHasLocallySubmitted(false);
    }
    prevIsSubmittedRef.current = isSubmitted;
  }, [isSubmitted, hasLocallySubmitted, conversationId]);

  return {
    hasLocallySubmitted,
    effectiveIsSubmitted,
    setHasLocallySubmitted,
  };
};
