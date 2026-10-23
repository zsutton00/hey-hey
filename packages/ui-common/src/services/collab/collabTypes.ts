import type { CollabSectionClient } from "./CollabSectionClient";

export type CollabSectionConnectionStatus =
  | "idle"
  | "connecting"
  | "handshake"
  | "ready"
  | "disconnected"
  | "error";

/**
 * Well-known error codes for collaboration errors.
 * Allows for type-safe error handling and user-friendly messaging.
 */
export type CollabErrorCode =
  | "socket_error"
  | "sync_failed"
  | "payload_too_large"
  | "rate_limit_exceeded"
  | "connection_failed"
  | "handshake_timeout"
  | "unknown";

export interface CollabSectionError {
  code: CollabErrorCode;
  message: string;
  recoverable?: boolean;
  timestamp: number;
}

export interface CollabSectionStatusSnapshot {
  status: CollabSectionConnectionStatus;
  handshakeCompleted: boolean;
  connectedAt: number | null;
  reconnectAttempt: number;
  pendingLocalChanges: number;
  lastAckSeq: number | null;
  lastError: CollabSectionError | null;
}

export interface CollabSectionEvents {
  status: CollabSectionStatusSnapshot;
  ack: { seq: number };
  error: CollabSectionError;
  disconnect: { reason: string; willReconnect: boolean };
  reconnecting: { attempt: number };
  sync: { isHandshake: boolean; update: Uint8Array };
}

export interface CollabSectionSnapshot {
  sectionId: string;
  client: CollabSectionClient;
  status: CollabSectionStatusSnapshot;
}
