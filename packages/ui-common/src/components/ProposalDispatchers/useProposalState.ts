import { invalidateProposalReconciliation } from "../ProposalReconciliation/reconciliationInvalidation";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { ProposalStatus } from "../../api";
import type {
  OnApplyProposal,
  OnAppliedProposal,
  ProposalItemState,
  ProposalItemStatus,
} from "./types";
import { getProposalMaterializationStatus } from "./types";
import {
  getEntry,
  setLifecycle,
  subscribe,
} from "./proposalSelectedStateCache";
import {
  extractProposalApprovalFailureDiagnostic,
  toProposalApprovalFailureError,
} from "./ProposalFailureDiagnostic";

type StateMap = Record<string, ProposalItemStatus>;

type ProposalLike = { id: string; status: ProposalStatus };

type Action =
  | { type: "RESET"; proposals: ProposalLike[] }
  | { type: "SET_APPLYING"; id: string }
  | { type: "SET_APPLIED"; id: string }
  | { type: "SET_REJECTED"; id: string }
  | {
      type: "SET_FAILED";
      id: string;
      error?: string;
      diagnostic?: ProposalItemStatus["diagnostic"];
    };

function reducer(state: StateMap, action: Action): StateMap {
  switch (action.type) {
    case "RESET":
      return buildInitialState(action.proposals);
    case "SET_APPLYING":
      return {
        ...state,
        [action.id]: { state: "applying" },
      };
    case "SET_APPLIED":
      return {
        ...state,
        [action.id]: { state: "applied" },
      };
    case "SET_REJECTED":
      return {
        ...state,
        [action.id]: { state: "rejected" },
      };
    case "SET_FAILED":
      return {
        ...state,
        [action.id]: {
          state: "failed",
          ...(action.error ? { error: action.error } : {}),
          ...(action.diagnostic ? { diagnostic: action.diagnostic } : {}),
        },
      };
    default:
      return state;
  }
}

function seedFromProposal(proposal: ProposalLike): ProposalItemStatus {
  const cached = getEntry(proposal.id);
  if (cached?.lifecycle === "applied") {
    return { state: "applied" };
  }
  if (cached?.lifecycle === "rejected") {
    return { state: "rejected" };
  }
  if (proposal.status === ProposalStatus.Approved) {
    return { state: "applied" };
  }
  if (proposal.status === ProposalStatus.Rejected) {
    return { state: "rejected" };
  }
  return { state: "pending" };
}

function buildInitialState(proposals: ProposalLike[]): StateMap {
  const state: StateMap = {};
  for (const proposal of proposals) {
    state[proposal.id] = seedFromProposal(proposal);
  }
  return state;
}

/**
 * Hook that manages per-item proposal application state.
 * Each item tracks independently: pending → applying → applied | rejected | failed.
 * Initialises from a module-level cache first (so a proposal that was
 * applied or rejected earlier in the session stays in that terminal
 * state even if the server payload still reads PENDING/DRAFT), then
 * falls back to the proposal's backend status. Resets when the set of
 * tracked IDs changes, and subscribes to cache updates so writes from
 * sibling components rendering the same id propagate live.
 */
export function useProposalState(proposals: ProposalLike[]) {
  const applyingIdsRef = useRef(new Set<string>());
  const [stateMap, dispatch] = useReducer(
    reducer,
    proposals,
    buildInitialState,
  );

  const idsKey = proposals.map((p) => p.id).join(",");
  useEffect(() => {
    dispatch({ type: "RESET", proposals });
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const unsubs = proposals.map((proposal) =>
      subscribe(proposal.id, () => {
        const cached = getEntry(proposal.id);
        if (cached?.lifecycle === "applied") {
          dispatch({ type: "SET_APPLIED", id: proposal.id });
        } else if (cached?.lifecycle === "rejected") {
          dispatch({ type: "SET_REJECTED", id: proposal.id });
        }
      }),
    );
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const getState = useCallback(
    (id: string): ProposalItemStatus =>
      stateMap[id] ?? { state: "pending" as ProposalItemState },
    [stateMap],
  );

  const applyItem = useCallback(
    async (
      id: string,
      onApply: OnApplyProposal,
      onApplied?: OnAppliedProposal,
    ) => {
      if (applyingIdsRef.current.has(id)) return;
      applyingIdsRef.current.add(id);
      dispatch({ type: "SET_APPLYING", id });
      try {
        const result = await onApply(id);
        const materializationStatus = result
          ? getProposalMaterializationStatus(result)
          : undefined;
        if (materializationStatus?.state === "failed") {
          dispatch({
            type: "SET_FAILED",
            id,
            error: materializationStatus.error,
            diagnostic: materializationStatus.diagnostic,
          });
          return;
        }
        if (materializationStatus?.state === "applying") {
          dispatch({ type: "SET_APPLYING", id });
          return;
        }
        dispatch({ type: "SET_APPLIED", id });
        setLifecycle(id, "applied");
      } catch (err) {
        invalidateProposalReconciliation(id);
        const failure = toProposalApprovalFailureError(err, "Failed to apply");
        dispatch({
          type: "SET_FAILED",
          id,
          error: failure.message,
          diagnostic: extractProposalApprovalFailureDiagnostic(failure),
        });
        return;
      } finally {
        applyingIdsRef.current.delete(id);
      }
      if (onApplied) {
        try {
          await onApplied(id);
        } catch {
          // The server mutation is already durable. Completion-side effects
          // must not turn it back into a retryable proposal failure.
        }
      }
    },
    [],
  );

  const rejectItem = useCallback(
    async (
      id: string,
      onReject: (id: string, reason: string) => Promise<void>,
      reason: string,
    ) => {
      try {
        await onReject(id, reason);
        dispatch({ type: "SET_REJECTED", id });
        setLifecycle(id, "rejected");
      } catch (err) {
        const failure = toProposalApprovalFailureError(err, "Failed to reject");
        dispatch({
          type: "SET_FAILED",
          id,
          error: failure.message,
          diagnostic: extractProposalApprovalFailureDiagnostic(failure),
        });
      }
    },
    [],
  );

  return { stateMap, getState, applyItem, rejectItem };
}
