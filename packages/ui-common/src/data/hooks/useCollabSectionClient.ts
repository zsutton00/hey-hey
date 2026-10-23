import { useEffect, useRef, useState } from "react";
import type { MaterializedDesignDocSection } from "../../api";
import {
  CollabSectionClient,
  type CollabSectionClientOptions,
  type CollabSectionStatusSnapshot,
} from "../../services/collab";

export interface UseCollabSectionClientParams {
  section: Pick<MaterializedDesignDocSection, "id" | "crdtSnapshotSeq">;
  wsBaseUrl?: CollabSectionClientOptions["wsBaseUrl"];
  wsNamespace?: CollabSectionClientOptions["wsNamespace"];
  enabled?: boolean;
  connectOnStart?: boolean;
}

export interface UseCollabSectionClientReturn {
  client: CollabSectionClient | null;
  status: CollabSectionStatusSnapshot;
  connect: () => void;
  disconnect: () => void;
}

const DEFAULT_STATUS: CollabSectionStatusSnapshot = {
  status: "idle",
  handshakeCompleted: false,
  connectedAt: null,
  reconnectAttempt: 0,
  pendingLocalChanges: 0,
  lastAckSeq: null,
  lastError: null,
};

/**
 * React hook to manage the lifecycle of a {@link CollabSectionClient}.
 * Keeps the client instance stable across renders, updates snapshots when the
 * REST payload changes, and exposes connection status for UI badges.
 */
export const useCollabSectionClient = (
  params: UseCollabSectionClientParams
): UseCollabSectionClientReturn => {
  const {
    section,
    enabled = true,
    wsBaseUrl,
    wsNamespace,
    connectOnStart = true,
  } = params;

  const clientRef = useRef<CollabSectionClient | null>(null);
  const [status, setStatus] =
    useState<CollabSectionStatusSnapshot>(DEFAULT_STATUS);

  const sectionId = section.id;

  useEffect(() => {
    if (!enabled || !sectionId) {
      clientRef.current?.destroy();
      clientRef.current = null;
      setStatus(DEFAULT_STATUS);
      return;
    }

    const client = new CollabSectionClient({
      sectionId,
      wsBaseUrl,
      wsNamespace,
      snapshotSeq: section.crdtSnapshotSeq ?? null,
      connectOnStart,
    });

    clientRef.current = client;
    setStatus(client.getStatus());

    const unsubscribeStatus = client.on("status", (nextStatus) => {
      setStatus(nextStatus);
    });

    return () => {
      unsubscribeStatus();
      client.destroy();
      clientRef.current = null;
    };
  }, [sectionId, wsBaseUrl, wsNamespace, enabled, connectOnStart]);

  return {
    client: clientRef.current,
    status,
    connect: () => clientRef.current?.connect(),
    disconnect: () => clientRef.current?.disconnect(),
  };
};
