import { useEffect, useMemo, useRef, useState } from "react";
import type { EntityType } from "../../api";
import { entitiesClient } from "../../clients/serviceClients";

export interface EntityNameLookup {
  entityId: string;
  entityType: EntityType;
}

export interface UseEntityNamesParams {
  organizationId: string;
  entities: EntityNameLookup[];
}

export interface UseEntityNamesReturn {
  names: Map<string, string>;
  isLoading: boolean;
  error: string | null;
}

const lookupKey = (entityId: string, entityType: EntityType): string =>
  `${entityType}:${entityId}`;

/**
 * Batch-resolves display names for a set of (entityId, entityType) pairs via
 * the entities/names endpoint. Used to backfill stale or missing title
 * snapshots on stored entity references.
 */
export function useEntityNames({
  organizationId,
  entities,
}: UseEntityNamesParams): UseEntityNamesReturn {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const dedupedEntities = useMemo(() => {
    const seen = new Set<string>();
    const result: EntityNameLookup[] = [];
    for (const entry of entities) {
      const key = lookupKey(entry.entityId, entry.entityType);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(entry);
    }
    return result;
  }, [entities]);

  const requestKey = useMemo(
    () =>
      dedupedEntities
        .map((e) => lookupKey(e.entityId, e.entityType))
        .sort()
        .join("|"),
    [dedupedEntities]
  );

  useEffect(() => {
    if (!organizationId || dedupedEntities.length === 0) {
      setNames(new Map());
      setIsLoading(false);
      setError(null);
      return;
    }

    cancelledRef.current = false;
    setIsLoading(true);
    setError(null);

    entitiesClient
      .getEntityNames({
        organizationId: organizationId,
        getEntityNamesDto: { entities: dedupedEntities },
      })
      .then((response) => {
        if (cancelledRef.current) return;
        const map = new Map<string, string>();
        const rows = Array.isArray(response.data) ? response.data : [];
        for (const row of rows) {
          if (row.entityName) {
            map.set(lookupKey(row.entityId, row.entityType), row.entityName);
          }
        }
        setNames(map);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelledRef.current) return;
        setError(
          err instanceof Error ? err.message : "Failed to load entity names."
        );
        setIsLoading(false);
      });
    // requestKey captures the full identity of dedupedEntities; including
    // dedupedEntities itself would re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, requestKey]);

  return useMemo(
    () => ({ names, isLoading, error }),
    [names, isLoading, error]
  );
}

export const entityNameKey = lookupKey;
