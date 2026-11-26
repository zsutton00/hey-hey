import { useEffect, useMemo, useState } from "react";
import {
  findUnusedBranchName,
  suggestedBranchBase,
} from "./branchNameSuggestion";
import { readServicePlaces } from "./readServicePlaces";
import { useServicePlacesMachine } from "./useServicePlacesMachine";

/** Offers a new branch name that is free in all of the given Services. */
export type SuggestBranchName = (
  serviceIds: readonly string[],
) => Promise<string>;

export interface UseBranchNameSuggesterOptions {
  organizationId: string;
  projectId: string;
  machineId: string | null;
  /** The work item the surface is about; null when there is none. */
  workItemName: string | null;
}

/** Null when there is nothing to make a name from. */
export const useBranchNameSuggester = ({
  organizationId,
  projectId,
  machineId,
  workItemName,
}: UseBranchNameSuggesterOptions): SuggestBranchName | null => {
  const base = suggestedBranchBase(workItemName ?? "");
  const { machine } = useServicePlacesMachine(machineId ?? "", base !== "");

  return useMemo(() => {
    if (base === "") {
      return null;
    }

    return (serviceIds) =>
      findUnusedBranchName(base, serviceIds, async (branchQuery) => {
        if (!machine) {
          throw new Error("The selected machine is unavailable.");
        }

        return readServicePlaces({
          organizationId,
          projectId,
          machine,
          serviceIds,
          branchQuery,
        });
      });
  }, [base, machine, organizationId, projectId]);
};

/**
 * The suggestion for one open name field. It is looked up again only when the
 * suggester or the Services change, and an outdated answer is dropped.
 */
export const useSuggestedBranchName = (
  suggestBranchName: SuggestBranchName | null,
  serviceIds: readonly string[],
): { checking: boolean; name: string } => {
  const serviceKey = serviceIds.join(",");
  const [answer, setAnswer] = useState<{
    suggestBranchName: SuggestBranchName;
    serviceKey: string;
    name: string;
  } | null>(null);

  useEffect(() => {
    if (suggestBranchName === null) {
      return;
    }

    let isCurrent = true;
    void suggestBranchName(serviceKey.split(",")).then((name) => {
      if (isCurrent) {
        setAnswer({ suggestBranchName, serviceKey, name });
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [suggestBranchName, serviceKey]);

  const isCurrentAnswer =
    answer?.suggestBranchName === suggestBranchName &&
    answer?.serviceKey === serviceKey;

  return {
    checking: suggestBranchName !== null && !isCurrentAnswer,
    name: isCurrentAnswer ? (answer?.name ?? "") : "",
  };
};
