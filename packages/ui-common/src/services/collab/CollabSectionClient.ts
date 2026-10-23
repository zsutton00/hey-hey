import { io, type Socket } from "socket.io-client";
import * as Y from "yjs";
import {
  messageYjsSyncStep1,
  messageYjsSyncStep2,
  messageYjsUpdate,
  readSyncMessage,
  writeUpdate,
} from "y-protocols/sync";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { TypedEventEmitter } from "../../utils/typedEventEmitter";
import type {
  CollabSectionError,
  CollabSectionEvents,
  CollabSectionStatusSnapshot,
} from "./collabTypes";
import { configService } from "../configService";
import { getAuthToken } from "../authService";
import { log } from "../../utils/logger";

type CollabServerToClientEvents = {
  sync(payload: ArrayBuffer | Uint8Array): void;
  "collab:error"(payload: { code: string; message: string }): void;
  "collab:ack"(payload: { seq: number }): void;
};

type CollabClientToServerEvents = {
  sync(payload: Uint8Array): void;
  authenticate(payload: { token: string }): void;
};

interface PendingUpdate {
  id: number;
  update: Uint8Array;
  retries: number;
  lastDelayMs: number;
  sentAt?: number;
  retryTimer?: ReturnType<typeof setTimeout>;
}

export interface CollabSectionClientOptions {
  sectionId: string;
  wsBaseUrl?: string;
  wsNamespace?: string;
  snapshotSeq?: number | null;
  doc?: Y.Doc;
  connectOnStart?: boolean;
  maxUpdatePayloadBytes?: number;
  rateLimitWindowMs?: number;
  rateLimitMaxUpdates?: number;
  resendTimeoutMs?: number;
}

const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024; // 64 KiB
const DEFAULT_RATE_LIMIT_WINDOW_MS = 10_000;
const DEFAULT_RATE_LIMIT_MAX_UPDATES = 40;
const DEFAULT_RESEND_TIMEOUT_MS = 5_000;

/**
 * Lightweight client responsible for managing a collaborative section session.
 * Encapsulates socket lifecycle, Yjs sync protocol, update queueing, acks, and
 * reconnection flows. Consumers should interact with it via the exposed
 * TypedEventEmitter to stay decoupled from socket.io specifics.
 */
export class CollabSectionClient {
  readonly sectionId: string;
  readonly doc: Y.Doc;

  private readonly text: Y.Text;
  private readonly metadataMap: Y.Map<unknown>;
  private readonly options: Required<
    Pick<
      CollabSectionClientOptions,
      | "maxUpdatePayloadBytes"
      | "rateLimitMaxUpdates"
      | "rateLimitWindowMs"
      | "resendTimeoutMs"
      | "wsBaseUrl"
      | "wsNamespace"
    >
  >;
  private readonly emitter = new TypedEventEmitter<CollabSectionEvents>();

  private socket: Socket<
    CollabServerToClientEvents,
    CollabClientToServerEvents
  > | null = null;
  private status: CollabSectionStatusSnapshot;
  private reconnectAttempt = 0;
  private handshakeCompleted = false;
  private applyingRemoteUpdate = false;
  private applyingSnapshot = false;
  private updateIdCounter = 0;
  private queuedUpdates: PendingUpdate[] = [];
  private inflightUpdates: PendingUpdate[] = [];
  private rateLimitTimestamps: number[] = [];
  private rateLimitTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private lastAckSeq: number | null;

  constructor({
    sectionId,
    wsBaseUrl = configService.getWsUrl(),
    wsNamespace = "/collab/sections",
    snapshotSeq = null,
    doc,
    connectOnStart = true,
    maxUpdatePayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
    rateLimitWindowMs = DEFAULT_RATE_LIMIT_WINDOW_MS,
    rateLimitMaxUpdates = DEFAULT_RATE_LIMIT_MAX_UPDATES,
    resendTimeoutMs = DEFAULT_RESEND_TIMEOUT_MS,
  }: CollabSectionClientOptions) {
    this.sectionId = sectionId;
    this.doc = doc ?? new Y.Doc();
    this.text = this.doc.getText("content");
    this.metadataMap = this.doc.getMap("metadata");
    this.options = {
      wsBaseUrl,
      wsNamespace,
      maxUpdatePayloadBytes,
      rateLimitWindowMs,
      rateLimitMaxUpdates,
      resendTimeoutMs,
    };

    this.status = {
      status: "idle",
      handshakeCompleted: false,
      connectedAt: null,
      reconnectAttempt: 0,
      pendingLocalChanges: 0,
      lastAckSeq: snapshotSeq ?? null,
      lastError: null,
    };

    this.lastAckSeq = snapshotSeq ?? null;

    log.info("collab", "[collab] client created", {
      sectionId,
      wsBaseUrl,
      snapshotSeq,
      connectOnStart,
    });

    this.doc.on("update", this.handleDocUpdate);

    if (connectOnStart) {
      this.connect();
    }
  }

  on = this.emitter.on.bind(this.emitter);
  once = this.emitter.once.bind(this.emitter);
  off = this.emitter.off.bind(this.emitter);

  getStatus(): CollabSectionStatusSnapshot {
    return this.status;
  }

  connect(): void {
    if (this.disposed || this.socket?.connected) {
      log.warn(
        "collab",
        "[collab] connect called but already disposed or connected",
        {
          sectionId: this.sectionId,
          disposed: this.disposed,
          connected: this.socket?.connected,
        }
      );
      return;
    }
    log.info("collab", "[collab] initiating connection", {
      sectionId: this.sectionId,
    });
    this.ensureSocket();
  }

  disconnect(): void {
    if (this.disposed) return;
    log.info("collab", "[collab] disconnecting", {
      sectionId: this.sectionId,
      pendingUpdates: this.queuedUpdates.length + this.inflightUpdates.length,
    });
    this.socket?.disconnect();
  }

  destroy(): void {
    if (this.disposed) return;
    log.info("collab", "[collab] destroying client", {
      sectionId: this.sectionId,
      pendingUpdates: this.queuedUpdates.length + this.inflightUpdates.length,
    });
    this.disposed = true;
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.emitter.removeAllListeners();
    if (this.rateLimitTimer) {
      clearTimeout(this.rateLimitTimer);
    }
    this.clearPendingTimers();
    this.doc.off("update", this.handleDocUpdate);
  }

  /**
   * Reset the local Y.Doc to match a server-provided snapshot.
   * Useful when a legacy REST edit replaced the entire section.
   */
  applySnapshot({
    markdown,
    metadata,
    snapshotSeq,
  }: {
    markdown: string;
    metadata?: Record<string, unknown> | null;
    snapshotSeq?: number | null;
  }): void {
    if (this.disposed) return;

    log.info("collab", "calling client.doc.transact (1)", {
      sectionId: this.sectionId,
      content: markdown,
      markdownLength: markdown.length,
      snapshotSeq,
      previousSeq: this.lastAckSeq,
      pendingUpdates: this.queuedUpdates.length + this.inflightUpdates.length,
    });

    this.applyingSnapshot = true;
    try {
      this.doc.transact(() => {
        this.text.delete(0, this.text.length);
        if (markdown) {
          this.text.insert(0, markdown);
        }
        this.metadataMap.clear();
        if (metadata && typeof metadata === "object") {
          Object.entries(metadata).forEach(([key, value]) => {
            this.metadataMap.set(key, value as unknown);
          });
        }
      }, "snapshot");
    } finally {
      this.applyingSnapshot = false;
    }

    this.lastAckSeq = snapshotSeq ?? null;
    this.updateStatus({
      lastAckSeq: snapshotSeq ?? null,
      pendingLocalChanges:
        this.queuedUpdates.length + this.inflightUpdates.length,
    });

    // Clear pending updates – snapshot resets baseline.
    const clearedUpdates =
      this.queuedUpdates.length + this.inflightUpdates.length;
    this.clearPendingTimers();
    this.queuedUpdates = [];
    this.inflightUpdates = [];

    if (clearedUpdates > 0) {
      log.warn("collab", "[collab] cleared pending updates on snapshot", {
        sectionId: this.sectionId,
        clearedCount: clearedUpdates,
      });
    }

    // If we are connected, re-sync to ensure server acknowledges new snapshot state.
    if (this.socket?.connected) {
      log.info("collab", "[collab] resyncing after snapshot", {
        sectionId: this.sectionId,
      });
      this.handshakeCompleted = false;
      this.updateStatus({ status: "handshake", handshakeCompleted: false });
      // Force a state vector sync – the server will reconcile via handshake messages.
      this.socket.emit("sync", this.encodeStateAsUpdate());
    }
  }

  /**
   * Attempt to resend any pending updates immediately (e.g., when user requests).
   */
  flush(): void {
    log.info("collab", "[collab] manual flush requested", {
      sectionId: this.sectionId,
      queuedUpdates: this.queuedUpdates.length,
      inflightUpdates: this.inflightUpdates.length,
    });
    this.flushQueuedUpdates(true);
  }

  private ensureSocket(): void {
    if (this.socket) {
      return;
    }

    const url = this.buildNamespaceUrl();
    this.socket = io(url, {
      transports: ["websocket"],
    }) as Socket<CollabServerToClientEvents, CollabClientToServerEvents>;

    this.registerSocketListeners(this.socket);
    this.updateStatus({ status: "connecting" });
  }

  private buildNamespaceUrl(): string {
    const base = this.options.wsBaseUrl.replace(/\/$/, "");
    const namespace = this.options.wsNamespace.replace(/\/$/, "");
    return `${base}${namespace}/${this.sectionId}`;
  }

  private registerSocketListeners(
    socket: Socket<CollabServerToClientEvents, CollabClientToServerEvents>
  ): void {
    socket.on("connect", () => {
      log.info("collab", "[collab] socket connected", {
        sectionId: this.sectionId,
        socketId: socket.id,
      });

      const token = getAuthToken();
      if (token) {
        socket.emit("authenticate", { token });
        log.debug("collab", "[collab] authenticate event emitted", {
          sectionId: this.sectionId,
        });
      }

      this.handshakeCompleted = false;
      this.reconnectAttempt = 0;
      this.updateStatus({
        status: "handshake",
        handshakeCompleted: false,
        connectedAt: Date.now(),
        reconnectAttempt: 0,
      });
      this.flushQueuedUpdates();
    });

    socket.on("disconnect", (reason) => {
      log.warn("collab", "[collab] socket disconnected", {
        sectionId: this.sectionId,
        reason,
      });
      this.handshakeCompleted = false;
      this.moveInflightToQueue();
      this.updateStatus({
        status: "disconnected",
        handshakeCompleted: false,
        connectedAt: null,
      });
      this.emitter.emit("disconnect", {
        reason,
        willReconnect: socket.io.reconnection(),
      });
    });

    socket.on("sync", (payload) => {
      const update = this.toUint8Array(payload);
      this.handleIncomingSync(update);
    });

    socket.on("collab:ack", ({ seq }) => {
      this.handleAck(seq);
    });

    socket.on("collab:error", ({ code, message }) => {
      const error: CollabSectionError = {
        code: code as CollabSectionError["code"],
        message,
        recoverable: true,
        timestamp: Date.now(),
      };
      this.updateStatus({ lastError: error });
      this.emitter.emit("error", error);
    });

    socket.io.on("reconnect_attempt", (attempt) => {
      this.reconnectAttempt = attempt;
      this.updateStatus({
        status: "connecting",
        reconnectAttempt: attempt,
      });
      this.emitter.emit("reconnecting", { attempt });
    });

    socket.io.on("error", (error) => {
      const collabError: CollabSectionError = {
        code: "socket_error",
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
        timestamp: Date.now(),
      };
      this.updateStatus({ status: "error", lastError: collabError });
      this.emitter.emit("error", collabError);
    });
  }

  private handleIncomingSync(updatePayload: Uint8Array): void {
    if (this.disposed) return;

    const decoder = decoding.createDecoder(updatePayload);
    const encoder = encoding.createEncoder();

    this.applyingRemoteUpdate = true;
    try {
      const messageType = readSyncMessage(decoder, encoder, this.doc, "remote");

      const reply = encoding.toUint8Array(encoder);
      if (reply.byteLength > 0 && this.socket?.connected) {
        this.socket.emit("sync", reply);
      }

      const isHandshakeMessage =
        messageType === messageYjsSyncStep1 ||
        messageType === messageYjsSyncStep2 ||
        (!this.handshakeCompleted && messageType === messageYjsUpdate);

      if (!this.handshakeCompleted && messageType === messageYjsUpdate) {
        this.handshakeCompleted = true;
        this.updateStatus({
          status: "ready",
          handshakeCompleted: true,
        });

        // Log reconnection with state info for debugging potential divergence
        if (this.reconnectAttempt > 0) {
          log.info("collab", "[collab] reconnected and resynced", {
            sectionId: this.sectionId,
            reconnectAttempt: this.reconnectAttempt,
            lastAckSeq: this.lastAckSeq,
            pendingUpdates:
              this.queuedUpdates.length + this.inflightUpdates.length,
            docLength: this.text.length,
          });
        }

        this.flushQueuedUpdates();
      }

      this.emitter.emit("sync", {
        isHandshake: isHandshakeMessage,
        update: updatePayload,
      });
    } catch (error) {
      const collabError: CollabSectionError = {
        code: "sync_failed",
        message:
          error instanceof Error
            ? error.message
            : "Failed to read sync message",
        recoverable: true,
        timestamp: Date.now(),
      };
      this.updateStatus({ lastError: collabError, status: "error" });
      this.emitter.emit("error", collabError);
    } finally {
      this.applyingRemoteUpdate = false;
    }
  }

  private handleDocUpdate = (update: Uint8Array): void => {
    if (this.disposed) return;
    if (this.applyingRemoteUpdate || this.applyingSnapshot) {
      return;
    }

    if (update.byteLength === 0) {
      return;
    }

    const text = this.doc.getText("content").toString();
    console.log("Yjs document content after update:", {
      hasMarkdown: /[#*-]|\d\./.test(text),
      preview: text.substring(0, 500),
      fullLength: text.length,
    });

    if (update.byteLength > this.options.maxUpdatePayloadBytes) {
      const collabError: CollabSectionError = {
        code: "payload_too_large",
        message: `Change too large (${update.byteLength} bytes, max ${this.options.maxUpdatePayloadBytes}). Try making smaller edits or pasting less content at once.`,
        recoverable: false,
        timestamp: Date.now(),
      };
      this.updateStatus({ lastError: collabError });
      this.emitter.emit("error", collabError);
      // Don't enqueue oversized updates - they will be rejected by the server anyway
      return;
    }

    this.enqueueLocalUpdate(update);
  };

  private enqueueLocalUpdate(update: Uint8Array): void {
    const pending: PendingUpdate = {
      id: ++this.updateIdCounter,
      update,
      retries: 0,
      lastDelayMs: this.options.resendTimeoutMs,
    };
    this.queuedUpdates.push(pending);

    log.debug("collab", "[collab] update enqueued", {
      sectionId: this.sectionId,
      updateId: pending.id,
      updateSize: update.byteLength,
      queueLength: this.queuedUpdates.length,
    });

    this.updateStatus({
      pendingLocalChanges:
        this.queuedUpdates.length + this.inflightUpdates.length,
    });
    this.flushQueuedUpdates();
  }

  private flushQueuedUpdates(force = false): void {
    if (this.disposed) return;
    if (!this.socket || !this.socket.connected || !this.handshakeCompleted) {
      if (this.queuedUpdates.length > 0) {
        log.debug("collab", "[collab] cannot flush - not ready", {
          sectionId: this.sectionId,
          disposed: this.disposed,
          connected: this.socket?.connected,
          handshakeCompleted: this.handshakeCompleted,
          queuedUpdates: this.queuedUpdates.length,
        });
      }
      return;
    }

    if (!force && !this.canSendMoreUpdates()) {
      log.debug("collab", "[collab] rate limited, deferring flush", {
        sectionId: this.sectionId,
        queuedUpdates: this.queuedUpdates.length,
      });
      return;
    }

    let sentCount = 0;

    while (this.queuedUpdates.length > 0 && this.canSendMoreUpdates()) {
      const next = this.queuedUpdates.shift();
      if (!next) {
        break;
      }
      this.sendPendingUpdate(next);
      sentCount++;
    }

    if (sentCount > 0) {
      log.debug("collab", "[collab] flushed updates", {
        sectionId: this.sectionId,
        sentCount,
        remainingQueued: this.queuedUpdates.length,
        inflightCount: this.inflightUpdates.length,
      });
    }

    this.updateStatus({
      pendingLocalChanges:
        this.queuedUpdates.length + this.inflightUpdates.length,
    });
  }

  private sendPendingUpdate(pending: PendingUpdate): void {
    if (!this.socket?.connected) {
      this.queuedUpdates.unshift(pending);
      return;
    }

    const encoder = encoding.createEncoder();
    writeUpdate(encoder, pending.update);
    const payload = encoding.toUint8Array(encoder);

    if (payload.byteLength > this.options.maxUpdatePayloadBytes) {
      // Payload is too large even after encoding - discard it and notify user
      const collabError: CollabSectionError = {
        code: "payload_too_large",
        message: `Change too large (${payload.byteLength} bytes encoded, max ${this.options.maxUpdatePayloadBytes}). Change discarded.`,
        recoverable: false,
        timestamp: Date.now(),
      };
      this.updateStatus({
        lastError: collabError,
        pendingLocalChanges:
          this.queuedUpdates.length + this.inflightUpdates.length,
      });
      this.emitter.emit("error", collabError);
      // Don't retry or re-queue - the update is permanently too large
      return;
    }

    try {
      this.socket.emit("sync", payload);
      pending.sentAt = Date.now();
      pending.retries += 1;
      this.inflightUpdates.push(pending);
      this.rateLimitTimestamps.push(Date.now());
      this.scheduleRetry(pending);

      log.debug("collab", "[collab] update sent", {
        sectionId: this.sectionId,
        updateId: pending.id,
        payloadSize: payload.byteLength,
        retryAttempt: pending.retries,
        inflightCount: this.inflightUpdates.length,
      });
    } catch (error) {
      log.error("collab", "[collab] failed to emit sync", error);
      this.queuedUpdates.unshift(pending);
    }
  }

  private handleAck(seq: number): void {
    if (this.disposed) return;

    this.lastAckSeq = seq;
    this.updateStatus({
      lastAckSeq: seq,
      lastError: null,
    });
    this.emitter.emit("ack", { seq });

    const acknowledged: PendingUpdate[] = [];
    while (this.inflightUpdates.length > 0) {
      const candidate = this.inflightUpdates[0];
      if (!candidate.sentAt) {
        break;
      }

      acknowledged.push(candidate);
      this.inflightUpdates.shift();
    }

    acknowledged.forEach((pending) => {
      if (pending.retryTimer) {
        clearTimeout(pending.retryTimer);
      }
    });

    if (acknowledged.length > 0) {
      log.info("collab", "[collab] updates acknowledged", {
        sectionId: this.sectionId,
        seq,
        acknowledgedCount: acknowledged.length,
        remainingInflight: this.inflightUpdates.length,
        queuedUpdates: this.queuedUpdates.length,
      });
    }

    this.updateStatus({
      pendingLocalChanges:
        this.queuedUpdates.length + this.inflightUpdates.length,
    });
    this.flushQueuedUpdates();
  }

  private moveInflightToQueue(): void {
    if (!this.inflightUpdates.length) return;

    log.warn("collab", "[collab] moving inflight updates back to queue", {
      sectionId: this.sectionId,
      inflightCount: this.inflightUpdates.length,
    });

    this.inflightUpdates.forEach((pending) => {
      if (pending.retryTimer) {
        clearTimeout(pending.retryTimer);
        pending.retryTimer = undefined;
      }
    });
    this.queuedUpdates.unshift(...this.inflightUpdates);
    this.inflightUpdates = [];
  }

  private canSendMoreUpdates(): boolean {
    this.rateLimitTimestamps = this.rateLimitTimestamps.filter(
      (timestamp) => Date.now() - timestamp < this.options.rateLimitWindowMs
    );

    if (this.rateLimitTimestamps.length >= this.options.rateLimitMaxUpdates) {
      if (!this.rateLimitTimer) {
        const nextAvailable =
          this.rateLimitTimestamps[0] + this.options.rateLimitWindowMs;
        const delay = Math.max(nextAvailable - Date.now(), 50);

        log.warn("collab", "[collab] rate limit reached, scheduling retry", {
          sectionId: this.sectionId,
          currentCount: this.rateLimitTimestamps.length,
          maxAllowed: this.options.rateLimitMaxUpdates,
          retryDelayMs: delay,
        });

        this.rateLimitTimer = setTimeout(() => {
          this.rateLimitTimer = null;
          this.flushQueuedUpdates();
        }, delay);
      }
      return false;
    }

    return true;
  }

  private scheduleRetry(pending: PendingUpdate): void {
    if (this.disposed) return;
    if (pending.retryTimer) {
      clearTimeout(pending.retryTimer);
    }

    const delay = Math.min(pending.lastDelayMs, 60_000);

    log.debug("collab", "[collab] scheduling update retry", {
      sectionId: this.sectionId,
      updateId: pending.id,
      retryDelayMs: delay,
      retryAttempt: pending.retries,
    });

    pending.retryTimer = setTimeout(() => {
      pending.retryTimer = undefined;
      this.queuedUpdates.unshift(pending);
      this.updateStatus({
        pendingLocalChanges:
          this.queuedUpdates.length + this.inflightUpdates.length,
      });
      this.flushQueuedUpdates();
    }, delay);
  }

  private clearPendingTimers(): void {
    this.inflightUpdates.forEach((pending) => {
      if (pending.retryTimer) {
        clearTimeout(pending.retryTimer);
      }
    });
    this.queuedUpdates.forEach((pending) => {
      if (pending.retryTimer) {
        clearTimeout(pending.retryTimer);
      }
    });
    this.inflightUpdates = [];
    this.queuedUpdates = [];
  }

  private encodeStateAsUpdate(): Uint8Array {
    const encoder = encoding.createEncoder();
    writeUpdate(encoder, Y.encodeStateAsUpdate(this.doc));
    return encoding.toUint8Array(encoder);
  }

  private updateStatus(partial: Partial<CollabSectionStatusSnapshot>): void {
    this.status = {
      ...this.status,
      ...partial,
    };
    this.emitter.emit("status", this.status);
  }

  private toUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
    if (input instanceof Uint8Array) {
      return input;
    }
    return new Uint8Array(input);
  }
}
