import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  DesignDocParentEntityType,
  type DesignDocResponseDto,
} from "../../api";
import {
  findDesignDoc,
  writeDesignDoc,
  snapshotDesignDocs,
} from "../collections/designDocs";
import { useUpdateDesignDoc } from "./useUpdateDesignDoc";

export interface UseReparentDesignDocReturn {
  reparent: (
    designDocId: string,
    parentEntityId: string,
    parentEntityType: DesignDocParentEntityType
  ) => Promise<void>;
}

export class DesignDocReparentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignDocReparentValidationError";
  }
}

function isAncestor(
  candidateId: string,
  startId: string,
  lookup: (id: string) => DesignDocResponseDto | undefined
): boolean {
  const visited = new Set<string>();
  let cursor: string | undefined = startId;
  while (cursor && !visited.has(cursor)) {
    if (cursor === candidateId) return true;
    visited.add(cursor);
    const doc = lookup(cursor);
    cursor =
      doc?.parentEntityType === DesignDocParentEntityType.DesignDoc
        ? doc.parentEntityId ?? undefined
        : undefined;
  }
  return false;
}

function validateParent(
  designDocId: string,
  parentEntityId: string,
  parentEntityType: DesignDocParentEntityType,
  lookup: (id: string) => DesignDocResponseDto | undefined
): void {
  if (parentEntityType !== DesignDocParentEntityType.DesignDoc) return;
  if (parentEntityId === designDocId) {
    throw new DesignDocReparentValidationError(
      "Cannot drop a design doc onto itself"
    );
  }
  if (isAncestor(designDocId, parentEntityId, lookup)) {
    throw new DesignDocReparentValidationError(
      "Cannot drop a design doc into one of its descendants"
    );
  }
}

export function useReparentDesignDoc(
  organizationId: string | undefined
): UseReparentDesignDocReturn {
  const queryClient = useQueryClient();
  const { mutate } = useUpdateDesignDoc();
  const reparent = useCallback(
    async (
      designDocId: string,
      parentEntityId: string,
      parentEntityType: DesignDocParentEntityType
    ) => {
      if (!organizationId)
        throw new DesignDocReparentValidationError(
          "organizationId is required to reparent a design doc"
        );
      const lookup = (id: string) =>
        findDesignDoc(queryClient, organizationId, id);
      const dragged = lookup(designDocId);
      if (!dragged)
        throw new DesignDocReparentValidationError(
          `Design doc ${designDocId} not found in cache`
        );
      validateParent(designDocId, parentEntityId, parentEntityType, lookup);
      if (
        dragged.parentEntityId === parentEntityId &&
        dragged.parentEntityType === parentEntityType
      )
        return;
      const moved = { ...dragged, parentEntityId, parentEntityType };
      const restore = await snapshotDesignDocs(
        queryClient,
        organizationId,
        designDocId,
        moved
      );
      writeDesignDoc(queryClient, organizationId, moved);
      try {
        const result = await mutate({
          organizationId,
          designDocId,
          updates: { parentEntityId, parentEntityType },
        });
        if (result.status === "PENDING") {
          restore();
          writeDesignDoc(queryClient, organizationId, result.designDoc);
        }
      } catch (error) {
        restore();
        throw error;
      }
    },
    [organizationId, queryClient, mutate]
  );
  return { reparent };
}
