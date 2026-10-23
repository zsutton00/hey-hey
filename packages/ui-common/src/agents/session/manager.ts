import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CorruptedSessionError,
  LockTimeoutError,
  SessionIoError,
  SessionNotFoundError,
  SessionStoreError,
  SessionValidationError,
} from "./errors";
import type {
  PersistentSessionManager,
  SessionChangeEvent,
  SessionChangeEventType,
  SessionChangeListener,
  SessionIndexDocument,
  SessionIndexEntry,
  SessionInitResult,
  SessionLifecycleListener,
  SessionListItem,
  SessionManagerOptions,
  SessionMutator,
  SessionPaths,
} from "./types";

const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_LOCK_RETRY_DELAY_MS = 40;
const DEFAULT_STALE_LOCK_MS = 30_000;
const DEFAULT_WORKSPACE_ROOT = path.resolve(process.cwd());

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new SessionValidationError(`Invalid or missing "${fieldName}".`);
  }
  return value;
};

const normalizeIso = (value: string, fieldName: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new SessionValidationError(`Invalid date in "${fieldName}".`);
  }
  return date.toISOString();
};

const validateSessionIndex = (value: unknown): SessionIndexDocument => {
  if (!isObject(value)) {
    throw new SessionValidationError(
      "Session index payload is not a JSON object."
    );
  }

  const stateVersion = value["state_version"];
  if (
    typeof stateVersion !== "number" ||
    !Number.isInteger(stateVersion) ||
    stateVersion <= 0
  ) {
    throw new SessionValidationError(
      'Invalid or missing "state_version" in session index.'
    );
  }

  const activeSessionIdRaw = value["activeSessionId"];
  if (
    !(activeSessionIdRaw === null || typeof activeSessionIdRaw === "string")
  ) {
    throw new SessionValidationError(
      'Invalid "activeSessionId" in session index.'
    );
  }

  const sessionsRaw = value["sessions"];
  if (!Array.isArray(sessionsRaw)) {
    throw new SessionValidationError(
      'Invalid or missing "sessions" in session index.'
    );
  }

  const sessions: SessionIndexEntry[] = sessionsRaw.map((entry, index) => {
    if (!isObject(entry)) {
      throw new SessionValidationError(
        `Invalid session index entry at index ${String(index)}.`
      );
    }

    const item: SessionIndexEntry = {
      sessionId: readString(
        entry["sessionId"],
        `sessions[${String(index)}].sessionId`
      ),
      createdAt: normalizeIso(
        readString(entry["createdAt"], `sessions[${String(index)}].createdAt`),
        `sessions[${String(index)}].createdAt`
      ),
      updatedAt: normalizeIso(
        readString(entry["updatedAt"], `sessions[${String(index)}].updatedAt`),
        `sessions[${String(index)}].updatedAt`
      ),
    };

    if (entry["closedAt"] !== undefined) {
      item.closedAt = normalizeIso(
        readString(entry["closedAt"], `sessions[${String(index)}].closedAt`),
        `sessions[${String(index)}].closedAt`
      );
    }

    return item;
  });

  return {
    state_version: stateVersion,
    activeSessionId: activeSessionIdRaw,
    sessions,
  };
};

const resolveDefaultBaseDir = (): string =>
  process.env.HEYHEY_HOME_DIR ?? path.join(os.homedir(), ".heyhey");

export const resolveDefaultSessionPaths = (): SessionPaths => {
  const baseDir = resolveDefaultBaseDir();
  const sessionsDir = path.join(baseDir, "sessions");

  return {
    baseDir,
    sessionsDir,
    indexPath: path.join(sessionsDir, "index.json"),
    lockPath: path.join(baseDir, "session.lock"),
  };
};

const ensureDirs = async (paths: SessionPaths): Promise<void> => {
  try {
    await fs.mkdir(paths.baseDir, { recursive: true, mode: 0o700 });
    await fs.mkdir(paths.sessionsDir, { recursive: true, mode: 0o700 });
    await fs.chmod(paths.baseDir, 0o700);
    await fs.chmod(paths.sessionsDir, 0o700);
  } catch (error) {
    throw new SessionIoError(
      `Failed to create session directory: ${paths.baseDir}`,
      error
    );
  }
};

const nowIso = (now: () => Date): string => now().toISOString();

const toSessionFilePath = (paths: SessionPaths, sessionId: string): string =>
  path.join(paths.sessionsDir, `${sessionId}.json`);

const createInitialIndex = (stateVersion: number): SessionIndexDocument => ({
  state_version: stateVersion,
  activeSessionId: null,
  sessions: [],
});

export const createPersistentSessionManager = <TSession>(
  options: SessionManagerOptions<TSession>
): PersistentSessionManager<TSession> => {
  const model = options.model;
  const paths = options.paths ?? resolveDefaultSessionPaths();
  const now = options.now ?? (() => new Date());
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const workspaceRoot =
    options.workspaceRoot === null
      ? null
      : options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT;
  const lockTimeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const lockRetryDelayMs = options.retryDelayMs ?? DEFAULT_LOCK_RETRY_DELAY_MS;
  const staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
  const authValidator = options.authValidator ?? (async () => true);
  const listeners = new Set<SessionChangeListener<TSession>>();

  if (model.stateVersion <= 0 || !Number.isInteger(model.stateVersion)) {
    throw new SessionValidationError("Invalid session state version.");
  }

  const cloneSession =
    model.cloneSession ??
    ((session: TSession): TSession => {
      return structuredClone(session);
    });

  const emitSessionChange = (event: SessionChangeEvent<TSession>): void => {
    listeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // Listener failures should not block session persistence.
      }
    });
  };

  const writeAtomic = async (
    filePath: string,
    payload: string
  ): Promise<void> => {
    const tempPath = `${filePath}.tmp-${randomId()}`;

    try {
      await fs.writeFile(tempPath, payload, { encoding: "utf8", mode: 0o600 });
      await fs.rename(tempPath, filePath);
      await fs.chmod(filePath, 0o600);
    } catch (error) {
      throw new SessionIoError(`Failed writing file ${filePath}`, error);
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  };

  const writeSession = async (session: TSession): Promise<void> => {
    const sessionPath = toSessionFilePath(paths, model.getSessionId(session));
    await writeAtomic(sessionPath, JSON.stringify(session, null, 2));
  };

  const writeIndex = async (index: SessionIndexDocument): Promise<void> => {
    await writeAtomic(paths.indexPath, JSON.stringify(index, null, 2));
  };

  const readSessionUnsafe = async (sessionId: string): Promise<TSession> => {
    const sessionPath = toSessionFilePath(paths, sessionId);
    let text: string;

    try {
      text = await fs.readFile(sessionPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new SessionNotFoundError(`No session found at ${sessionPath}`);
      }
      throw new SessionIoError(
        `Failed reading session file ${sessionPath}`,
        error
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error) {
      throw new CorruptedSessionError(
        `Session file ${sessionPath} is not valid JSON.`,
        error
      );
    }

    try {
      return model.validateSession(parsed);
    } catch (error) {
      if (error instanceof SessionValidationError) {
        throw new CorruptedSessionError(
          `Session file ${sessionPath} is structurally invalid.`,
          error
        );
      }
      throw new CorruptedSessionError(
        `Session file ${sessionPath} failed validation.`,
        error
      );
    }
  };

  const readIndexUnsafe = async (): Promise<SessionIndexDocument> => {
    let text: string;

    try {
      text = await fs.readFile(paths.indexPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return createInitialIndex(model.stateVersion);
      }
      throw new SessionIoError(
        `Failed reading session index file ${paths.indexPath}`,
        error
      );
    }

    try {
      const parsed = JSON.parse(text) as unknown;
      return validateSessionIndex(parsed);
    } catch (error) {
      if (error instanceof SessionValidationError) {
        throw new CorruptedSessionError(
          "Session index file is structurally invalid.",
          error
        );
      }
      throw new CorruptedSessionError(
        "Session index file is not valid JSON.",
        error
      );
    }
  };

  const backupFile = async (filePath: string): Promise<void> => {
    const backupPath = `${filePath}.corrupt.${String(now().getTime())}.json`;
    try {
      await fs.copyFile(filePath, backupPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw new SessionIoError(
        `Failed to backup corrupted file ${filePath}`,
        error
      );
    }
  };

  const touchIndexEntry = (
    index: SessionIndexDocument,
    session: TSession
  ): void => {
    const sessionId = model.getSessionId(session);
    const existing = index.sessions.find(
      (entry) => entry.sessionId === sessionId
    );
    const createdAt = model.getCreatedAt(session);
    const updatedAt = model.getUpdatedAt(session);
    const closedAt = model.getClosedAt(session);

    if (existing) {
      existing.updatedAt = updatedAt;
      existing.createdAt = createdAt;
      if (closedAt !== undefined) {
        existing.closedAt = closedAt;
      } else {
        delete existing.closedAt;
      }
      return;
    }

    const entry: SessionIndexEntry = {
      sessionId,
      createdAt,
      updatedAt,
    };
    if (closedAt !== undefined) {
      entry.closedAt = closedAt;
    }
    index.sessions.push(entry);
  };

  const withLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    await ensureDirs(paths);

    const deadline = Date.now() + lockTimeoutMs;

    while (true) {
      let lockHandle: fs.FileHandle | null = null;
      try {
        lockHandle = await fs.open(paths.lockPath, "wx", 0o600);
        const lockPayload = JSON.stringify({
          pid: process.pid,
          createdAt: nowIso(now),
        });
        await lockHandle.writeFile(lockPayload, { encoding: "utf8" });
        const result = await operation();
        await lockHandle.close();
        lockHandle = null;
        await fs.unlink(paths.lockPath).catch(() => undefined);
        return result;
      } catch (error) {
        if (lockHandle) {
          await lockHandle.close().catch(() => undefined);
          await fs.unlink(paths.lockPath).catch(() => undefined);
        }

        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EEXIST") {
          try {
            const stat = await fs.stat(paths.lockPath);
            if (Date.now() - stat.mtimeMs > staleLockMs) {
              await fs.unlink(paths.lockPath).catch(() => undefined);
              continue;
            }

            // Check if the owning process is still alive.
            const lockContent = await fs
              .readFile(paths.lockPath, "utf8")
              .catch(() => null);
            if (lockContent) {
              try {
                const parsed = JSON.parse(lockContent) as { pid?: number };
                if (
                  typeof parsed.pid === "number" &&
                  parsed.pid !== process.pid
                ) {
                  try {
                    process.kill(parsed.pid, 0);
                  } catch {
                    // Process is dead — lock is orphaned.
                    await fs.unlink(paths.lockPath).catch(() => undefined);
                    continue;
                  }
                }
              } catch {
                // Malformed lock file — remove it.
                await fs.unlink(paths.lockPath).catch(() => undefined);
                continue;
              }
            }
          } catch {
            // Another writer may have released lock; continue retry loop.
          }

          if (Date.now() >= deadline) {
            throw new LockTimeoutError(
              `Timed out waiting for lock ${paths.lockPath}`
            );
          }
          await sleep(lockRetryDelayMs);
          continue;
        }

        if (
          error instanceof LockTimeoutError ||
          error instanceof SessionIoError ||
          error instanceof SessionStoreError
        ) {
          throw error;
        }

        throw new SessionIoError(
          `Failed while updating session with lock ${paths.lockPath}`,
          error
        );
      }
    }
  };

  const createAndActivateSession = async (
    index: SessionIndexDocument
  ): Promise<TSession> => {
    const timestamp = nowIso(now);
    const session = model.createInitialSession({
      stateVersion: model.stateVersion,
      workspaceRoot,
      timestamp,
      sessionId: randomId(),
    });
    touchIndexEntry(index, session);
    index.activeSessionId = model.getSessionId(session);
    await writeSession(session);
    await writeIndex(index);
    return session;
  };

  const loadActiveSessionWithRecovery = async (
    index: SessionIndexDocument
  ): Promise<{ session: TSession; recoveredFromCorruption: boolean }> => {
    const activeId = index.activeSessionId;
    if (!activeId) {
      return {
        session: await createAndActivateSession(index),
        recoveredFromCorruption: false,
      };
    }

    try {
      const session = await readSessionUnsafe(activeId);
      touchIndexEntry(index, session);
      await writeIndex(index);
      return {
        session,
        recoveredFromCorruption: false,
      };
    } catch (error) {
      if (
        error instanceof CorruptedSessionError ||
        error instanceof SessionNotFoundError
      ) {
        await backupFile(toSessionFilePath(paths, activeId));
        return {
          session: await createAndActivateSession(index),
          recoveredFromCorruption: true,
        };
      }
      throw error;
    }
  };

  const initialize = async (): Promise<SessionInitResult<TSession>> => {
    const { session, recoveredFromCorruption } = await withLock(async () => {
      let recovered = false;
      let index: SessionIndexDocument;

      try {
        index = await readIndexUnsafe();
      } catch (error) {
        if (error instanceof CorruptedSessionError) {
          recovered = true;
          await backupFile(paths.indexPath);
          index = createInitialIndex(model.stateVersion);
          await writeIndex(index);
        } else {
          throw error;
        }
      }

      const recoveredLoad = await loadActiveSessionWithRecovery(index);
      return {
        session: recoveredLoad.session,
        recoveredFromCorruption:
          recovered || recoveredLoad.recoveredFromCorruption,
      };
    });

    let authValid = true;
    try {
      authValid = await authValidator();
    } catch {
      authValid = false;
    }

    return {
      session,
      authValid,
      recoveredFromCorruption,
    };
  };

  const createSession = async (): Promise<TSession> => {
    const createdSession = await withLock(async () => {
      const index = await readIndexUnsafe();
      return createAndActivateSession(index);
    });

    emitSessionChange({
      type: "created",
      session: cloneSession(createdSession),
      occurredAt: nowIso(now),
    });
    return createdSession;
  };

  const load = async (): Promise<TSession> => {
    return withLock(async () => {
      const index = await readIndexUnsafe();
      const recoveredLoad = await loadActiveSessionWithRecovery(index);
      return recoveredLoad.session;
    });
  };

  const getActiveSession = async (): Promise<TSession> => load();

  const loadSession = async (sessionId: string): Promise<TSession> => {
    return readSessionUnsafe(sessionId);
  };

  const listSessions = async (): Promise<SessionListItem[]> => {
    const index = await withLock(async () => readIndexUnsafe());

    return [...index.sessions]
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      .map((entry) => ({
        sessionId: entry.sessionId,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        ...(entry.closedAt ? { closedAt: entry.closedAt } : {}),
        isActive: entry.sessionId === index.activeSessionId,
      }));
  };

  const setActiveSession = async (sessionId: string): Promise<TSession> => {
    const { session, previousActiveSessionId } = await withLock(async () => {
      const index = await readIndexUnsafe();
      const previousActiveSessionId = index.activeSessionId;
      const existsInIndex = index.sessions.some(
        (entry) => entry.sessionId === sessionId
      );
      if (!existsInIndex) {
        throw new SessionNotFoundError(
          `Cannot set active session. Unknown id: ${sessionId}`
        );
      }

      const session = await readSessionUnsafe(sessionId);
      index.activeSessionId = sessionId;
      touchIndexEntry(index, session);
      await writeIndex(index);
      return { session, previousActiveSessionId };
    });

    emitSessionChange({
      type: "activated",
      session: cloneSession(session),
      previousActiveSessionId,
      occurredAt: nowIso(now),
    });
    return session;
  };

  const updateActiveSession = async (
    mutator: SessionMutator<TSession>
  ): Promise<TSession> => {
    const session = await withLock(async () => {
      const index = await readIndexUnsafe();
      const recoveredLoad = await loadActiveSessionWithRecovery(index);
      const current = recoveredLoad.session;
      model.clearClosedAt?.(current);
      const maybeNext = mutator(current);
      const next = maybeNext === undefined ? current : maybeNext;

      const currentSessionId = model.getSessionId(current);
      const nextSessionId = model.getSessionId(next);
      if (currentSessionId !== nextSessionId) {
        throw new SessionValidationError(
          "Session mutator cannot change the active session id."
        );
      }

      model.setUpdatedAt(next, nowIso(now));
      touchIndexEntry(index, next);
      await writeSession(next);
      await writeIndex(index);
      return next;
    });

    emitSessionChange({
      type: "updated",
      session: cloneSession(session),
      occurredAt: nowIso(now),
    });
    return session;
  };

  const closeSession = async (): Promise<TSession> => {
    const session = await withLock(async () => {
      const index = await readIndexUnsafe();
      const activeId = index.activeSessionId;
      if (!activeId) {
        throw new SessionNotFoundError(
          "Cannot close session because there is no active session."
        );
      }

      const session = await readSessionUnsafe(activeId);
      const ts = nowIso(now);
      model.setClosedAt(session, ts);
      model.setUpdatedAt(session, ts);
      touchIndexEntry(index, session);
      await writeSession(session);
      await writeIndex(index);
      return session;
    });

    emitSessionChange({
      type: "closed",
      session: cloneSession(session),
      occurredAt: nowIso(now),
    });
    return session;
  };

  const archiveIfInactive = async (
    inactivityMs: number
  ): Promise<{ archived: boolean; session: TSession }> => {
    return withLock(async () => {
      const index = await readIndexUnsafe();
      const activeId = index.activeSessionId;
      if (!activeId) {
        const replacement = await createAndActivateSession(index);
        return { archived: false, session: replacement };
      }

      const session = await readSessionUnsafe(activeId);
      const latestIso =
        model.getLatestActivityIso?.(session) ?? model.getUpdatedAt(session);
      const latestActivityMs = new Date(latestIso).getTime();
      if (Number.isNaN(latestActivityMs)) {
        throw new SessionValidationError(
          "Invalid latest session activity timestamp."
        );
      }
      const inactiveMs = Date.now() - latestActivityMs;

      if (inactiveMs < inactivityMs) {
        return { archived: false, session };
      }

      const archivePath = path.join(
        paths.sessionsDir,
        `${activeId}.archive.${String(now().getTime())}.${randomId()}.json`
      );
      await fs.rename(toSessionFilePath(paths, activeId), archivePath);
      index.sessions = index.sessions.filter(
        (entry) => entry.sessionId !== activeId
      );
      index.activeSessionId = null;

      const replacement = await createAndActivateSession(index);
      return { archived: true, session: replacement };
    });
  };

  const onSessionChange = (
    listener: SessionChangeListener<TSession>
  ): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const onSessionLifecycle = (
    eventTypes: SessionChangeEventType[],
    listener: SessionLifecycleListener<TSession>
  ): (() => void) => {
    return onSessionChange((event) => {
      if (!eventTypes.includes(event.type)) {
        return;
      }
      listener(event.session);
    });
  };

  return {
    initialize,
    createSession,
    getActiveSession,
    load,
    loadSession,
    listSessions,
    setActiveSession,
    updateActiveSession,
    closeSession,
    archiveIfInactive,
    onSessionChange,
    onSessionStart: (listener) =>
      onSessionLifecycle(["created", "activated"], listener),
    onSessionStateChange: (listener) =>
      onSessionLifecycle(["updated"], listener),
    onSessionEnd: (listener) => onSessionLifecycle(["closed"], listener),
  };
};
