import React from "react";
import type { Blocker } from "react-router-dom";
import {
  UNSAFE_DataRouterContext,
  useBeforeUnload,
  useBlocker,
  useInRouterContext,
} from "react-router-dom";

interface UseUnsavedChangesGuardParams {
  when: boolean;
  confirmMessage?: string;
  beforeUnloadMessage?: string;
}

const DEFAULT_CONFIRM_MESSAGE =
  "You have unsaved changes. Are you sure you want to leave this page?";

/**
 * Blocks in-app navigation and browser unload when unsaved changes are present.
 */
export const useUnsavedChangesGuard = ({
  when,
  confirmMessage = DEFAULT_CONFIRM_MESSAGE,
  beforeUnloadMessage = "",
}: UseUnsavedChangesGuardParams): void => {
  const isInRouter = useInRouterContext();
  const dataRouterContext = React.useContext(UNSAFE_DataRouterContext);
  const hasDataRouter = isInRouter && Boolean(dataRouterContext);
  const warnedMissingDataRouterRef = React.useRef(false);
  const blocker = useSafeBlocker(when && hasDataRouter);

  React.useEffect(() => {
    if (!when || hasDataRouter || warnedMissingDataRouterRef.current) {
      return;
    }

    warnedMissingDataRouterRef.current = true;
    console.warn(
      "Unsaved changes in-app navigation guard is disabled because a React Router data router is not configured."
    );
  }, [hasDataRouter, when]);

  React.useEffect(() => {
    if (!blocker || blocker.state !== "blocked") {
      return;
    }

    const shouldProceed = window.confirm(confirmMessage);
    if (shouldProceed) {
      blocker.proceed();
      return;
    }

    blocker.reset();
  }, [blocker, confirmMessage]);

  useBeforeUnload(
    React.useCallback(
      (event: BeforeUnloadEvent) => {
        if (!when) {
          return;
        }

        event.preventDefault();
        event.returnValue = beforeUnloadMessage;
      },
      [beforeUnloadMessage, when]
    ),
    { capture: true }
  );
};

const useSafeBlocker = (shouldBlock: boolean): Blocker | null => {
  try {
    return useBlocker(shouldBlock);
  } catch {
    return null;
  }
};
