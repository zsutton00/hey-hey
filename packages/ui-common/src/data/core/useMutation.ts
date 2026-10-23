import { useState, useCallback, useRef } from "react";

interface MutationState<TError = Error> {
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: TError | null;
}

export interface MutationOptions<TData> {
  onSuccess?: (data: TData) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

export interface MutationResult<TVariables, TData> extends MutationState {
  mutate: (variables: TVariables) => Promise<TData>;
}

export function useMutation<TVariables, TData>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: MutationOptions<TData> = {},
): MutationResult<TVariables, TData> {
  const [state, setState] = useState<MutationState>({
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  });

  // Use refs for callbacks to avoid stale closure issues
  // This ensures we always call the latest callback even if options object changes during async operation
  const onSuccessRef = useRef(options.onSuccess);
  const onErrorRef = useRef(options.onError);
  const onSettledRef = useRef(options.onSettled);

  // Keep refs updated with latest callbacks
  onSuccessRef.current = options.onSuccess;
  onErrorRef.current = options.onError;
  onSettledRef.current = options.onSettled;

  const mutate = useCallback(
    async (variables: TVariables): Promise<TData> => {
      setState({
        isPending: true,
        isSuccess: false,
        isError: false,
        error: null,
      });

      try {
        const result = await mutationFn(variables);

        setState({
          isPending: false,
          isSuccess: true,
          isError: false,
          error: null,
        });

        onSuccessRef.current?.(result);
        return result;
      } catch (error) {
        const errorObj = error as Error;

        setState({
          isPending: false,
          isSuccess: false,
          isError: true,
          error: errorObj,
        });

        onErrorRef.current?.(errorObj);
        throw error;
      } finally {
        onSettledRef.current?.();
      }
    },
    [mutationFn],
  );

  return {
    mutate,
    ...state,
  };
}
