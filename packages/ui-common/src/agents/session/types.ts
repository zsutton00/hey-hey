export interface SessionPaths {
  baseDir: string;
  sessionsDir: string;
  indexPath: string;
  lockPath: string;
}

export interface SessionIndexEntry {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface SessionIndexDocument {
  state_version: number;
  activeSessionId: string | null;
  sessions: SessionIndexEntry[];
}

export interface SessionInitContext {
  sessionId: string;
  timestamp: string;
  workspaceRoot: string | null;
  stateVersion: number;
}

export interface SessionModel<TSession> {
  stateVersion: number;
  createInitialSession: (context: SessionInitContext) => TSession;
  validateSession: (value: unknown) => TSession;
  getSessionId: (session: TSession) => string;
  getCreatedAt: (session: TSession) => string;
  getUpdatedAt: (session: TSession) => string;
  getClosedAt: (session: TSession) => string | undefined;
  setUpdatedAt: (session: TSession, value: string) => void;
  setClosedAt: (session: TSession, value: string) => void;
  clearClosedAt?: (session: TSession) => void;
  getLatestActivityIso?: (session: TSession) => string;
  cloneSession?: (session: TSession) => TSession;
}

export interface SessionLockOptions {
  timeoutMs?: number;
  retryDelayMs?: number;
  staleLockMs?: number;
}

export interface SessionManagerOptions<TSession> extends SessionLockOptions {
  model: SessionModel<TSession>;
  paths?: SessionPaths;
  now?: () => Date;
  randomId?: () => string;
  workspaceRoot?: string | null;
  authValidator?: () => Promise<boolean>;
}

export type SessionChangeEventType =
  | "created"
  | "activated"
  | "updated"
  | "closed";

export interface SessionChangeEvent<TSession> {
  type: SessionChangeEventType;
  session: TSession;
  previousActiveSessionId?: string | null;
  occurredAt: string;
}

export type SessionChangeListener<TSession> = (
  event: SessionChangeEvent<TSession>
) => void;

export type SessionLifecycleListener<TSession> = (session: TSession) => void;

export interface SessionInitResult<TSession> {
  session: TSession;
  authValid: boolean;
  recoveredFromCorruption: boolean;
}

export interface SessionListItem {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  isActive: boolean;
}

export type SessionMutator<TSession> = (session: TSession) => void | TSession;

export interface PersistentSessionManager<TSession> {
  initialize(): Promise<SessionInitResult<TSession>>;
  createSession(): Promise<TSession>;
  getActiveSession(): Promise<TSession>;
  load(): Promise<TSession>;
  loadSession(sessionId: string): Promise<TSession>;
  listSessions(): Promise<SessionListItem[]>;
  setActiveSession(sessionId: string): Promise<TSession>;
  updateActiveSession(mutator: SessionMutator<TSession>): Promise<TSession>;
  closeSession(): Promise<TSession>;
  archiveIfInactive(
    inactivityMs: number
  ): Promise<{ archived: boolean; session: TSession }>;
  onSessionChange(listener: SessionChangeListener<TSession>): () => void;
  onSessionStart(listener: SessionLifecycleListener<TSession>): () => void;
  onSessionStateChange(
    listener: SessionLifecycleListener<TSession>
  ): () => void;
  onSessionEnd(listener: SessionLifecycleListener<TSession>): () => void;
}
