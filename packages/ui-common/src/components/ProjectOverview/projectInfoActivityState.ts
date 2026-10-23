import {
  TargetEntityType,
  type ProposalResponseDto,
  type WorkItemTypeSummaryDto,
} from "../../api";
import type { WorkItemIconIdentity } from "../../utils/entityIcons";
import { useLayoutEffect, useRef } from "react";

interface ReadState {
  isLoading: boolean;
  isFetching: boolean;
  isReady: boolean;
  error: Error | null;
}

export const readSettled = (read: ReadState): boolean =>
  read.isReady && !read.isLoading && !read.isFetching && !read.error;

export const activityIdentity = (
  values: readonly (string | number | undefined)[]
): string => JSON.stringify(values);

/** Only committed successful aggregates may survive a same-query refresh. */
export function useIdentitySnapshot<T>(
  identity: string,
  value: T | undefined
): T | undefined {
  const previous = useRef<{ identity: string; value: T | undefined }>({
    identity,
    value,
  });
  useLayoutEffect(() => {
    previous.current = {
      identity,
      value:
        value ??
        (previous.current.identity === identity
          ? previous.current.value
          : undefined),
    };
  }, [identity, value]);
  return (
    value ??
    (previous.current.identity === identity
      ? previous.current.value
      : undefined)
  );
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getProposalTypeKey = (
  proposal: ProposalResponseDto,
  targetTypes: ReadonlyMap<string, string>
): string | undefined => {
  const updates = isRecord(proposal.updates) ? proposal.updates : null;
  const proposedType = updates?.type;
  if (typeof proposedType === "string" && proposedType.trim().length > 0) {
    return proposedType;
  }
  return targetTypes.get(proposal.targetEntityId);
};

export const getProjectInfoProposalIconType = (
  proposal: ProposalResponseDto,
  registryByKey: ReadonlyMap<string, WorkItemTypeSummaryDto>,
  targetTypes: ReadonlyMap<string, string>
): { iconType: string; workItemIcon?: WorkItemIconIdentity } => {
  if (proposal.targetEntityType === TargetEntityType.DesignDoc) {
    return { iconType: "design_doc" };
  }

  if (proposal.targetEntityType !== TargetEntityType.Task) {
    return { iconType: proposal.targetEntityType.toLowerCase() };
  }

  const typeKey = getProposalTypeKey(proposal, targetTypes);
  return {
    iconType: "task",
    workItemIcon: typeKey
      ? {
          typeKey,
          definition: registryByKey.get(typeKey)?.definition,
          effectiveSource: registryByKey.get(typeKey)?.effectiveSource,
        }
      : undefined,
  };
};
