import { useEffect, useState } from "react";
import type { DesignDocResponseDto } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import {
  failedProposalTargetRead,
  type ProposalTargetRead,
} from "./proposalTargetRead";

interface TargetReads {
  organizationId: string;
  reads: Record<string, ProposalTargetRead<DesignDocResponseDto>>;
}

/**
 * Loads each design-doc target on its own, so one that is slow or unreadable
 * leaves the others as they are.
 */
export function useProposalDesignDocTargets(
  organizationId: string,
  ids: readonly string[],
): Record<string, ProposalTargetRead<DesignDocResponseDto>> {
  const idsKey = JSON.stringify([...new Set(ids)].sort());
  const [result, setResult] = useState<TargetReads>();

  useEffect(() => {
    let cancelled = false;
    const publish = (
      id: string,
      read: ProposalTargetRead<DesignDocResponseDto>,
    ) => {
      if (cancelled) {
        return;
      }
      setResult((previous) => {
        const held =
          previous?.organizationId === organizationId ? previous.reads : {};
        return { organizationId, reads: { ...held, [id]: read } };
      });
    };

    const load = async (id: string): Promise<void> => {
      try {
        const response = await unifiedApiClient.getDesignDoc({
          organizationId,
          designDocId: id,
        });
        const item = response.data.data;
        if (!item) {
          throw new Error("The read returned no design doc");
        }
        publish(id, { state: "ready", item });
      } catch (error) {
        const retry = () => {
          publish(id, { state: "loading" });
          void load(id);
        };
        publish(id, failedProposalTargetRead("DESIGN_DOC", id, error, retry));
      }
    };

    const targetIds: string[] = JSON.parse(idsKey);
    for (const id of targetIds) {
      void load(id);
    }

    return () => {
      cancelled = true;
    };
  }, [idsKey, organizationId]);

  const held = result?.organizationId === organizationId ? result.reads : {};
  return Object.fromEntries(
    ids.map((id) => [id, held[id] ?? { state: "loading" }]),
  );
}
