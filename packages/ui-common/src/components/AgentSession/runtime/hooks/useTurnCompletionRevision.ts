import { useEffect, useRef, useState } from "react";
import { AgentSessionCurrentState } from "../../../../api";

export const useTurnCompletionRevision = (
  currentState: AgentSessionCurrentState | undefined,
  onCompletion: () => void,
): number => {
  const previousStateRef = useRef(currentState);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const previousState = previousStateRef.current;
    previousStateRef.current = currentState;
    if (
      currentState === AgentSessionCurrentState.Idle &&
      previousState !== undefined &&
      previousState !== AgentSessionCurrentState.Idle
    ) {
      onCompletion();
      setRevision((value) => value + 1);
    }
  }, [currentState, onCompletion]);

  return revision;
};
