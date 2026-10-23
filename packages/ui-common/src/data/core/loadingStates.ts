import logger from "../../utils/logger";

// Pure function - easily testable
export const shouldSetLoading = (
  _queryKey: string,
  currentLoadingState: boolean,
  willActuallyFetch: boolean
): boolean => {
  // If we're going to fetch and not already loading, set to true
  if (willActuallyFetch && !currentLoadingState) {
    return true;
  }

  // If we're NOT going to fetch, always set to false (cleanup)
  if (!willActuallyFetch) {
    return false;
  }

  // Otherwise maintain current state (already loading and will fetch)
  return currentLoadingState;
};

// Centralized loading state logic
interface LoadingAction {
  type: "SET_LOADING";
  queryKey: string;
  isLoading: boolean;
}

export const manageLoadingState = (
  queryKey: string,
  currentLoadingState: boolean,
  willFetch: boolean,
  dispatch: (action: LoadingAction) => void
): void => {
  const shouldLoad = shouldSetLoading(queryKey, currentLoadingState, willFetch);

  // Only log in development mode and when there's an actual state change
  const willDispatch = shouldLoad !== currentLoadingState;

  if (willDispatch) {
    logger.debug("data_core", "[manageLoadingState] DEBUG_RERENDER", {
      queryKey,
      currentLoadingState,
      willFetch,
      shouldLoad,
      willDispatch,
    });

    logger.debug(
      "data_core",
      "[manageLoadingState] DEBUG_RERENDER dispatching SET_LOADING",
      {
        queryKey,
        isLoading: shouldLoad,
      }
    );

    dispatch({
      type: "SET_LOADING",
      queryKey,
      isLoading: shouldLoad,
    });
  }
};
