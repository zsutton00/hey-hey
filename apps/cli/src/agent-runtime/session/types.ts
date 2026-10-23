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
  closedAt?: string | undefined;
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
  clearClosedAt?: ((session: TSession) => void) | undefined;
  getLatestActivityIso?: ((session: TSession) => string) | undefined;
  cloneSession?: ((session: TSession) => TSession) | undefined;
}

export interface SessionLockOptions {
  timeoutMs?: number | undefined;
  retryDelayMs?: number | undefined;
  staleLockMs?: number | undefined;
}

export interface SessionManagerOptions<TSession> extends SessionLockOptions {
  model: SessionModel<TSession>;
  paths?: SessionPaths | undefined;
  now?: (() => Date) | undefined;
  randomId?: (() => string) | undefined;
  workspaceRoot?: (string | null) | undefined;
  authValidator?: (() => Promise<boolean>) | undefined;
}

export type SessionChangeEventType = 'created' | 'activated' | 'updated' | 'closed';

export interface SessionChangeEvent<TSession> {
  type: SessionChangeEventType;
  session: TSession;
  previousActiveSessionId?: (string | null) | undefined;
  occurredAt: string;
}

export type SessionChangeListener<TSession> = (event: SessionChangeEvent<TSession>) => void;

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
  closedAt?: string | undefined;
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
  archiveIfInactive(inactivityMs: number): Promise<{ archived: boolean; session: TSession }>;
  onSessionChange(listener: SessionChangeListener<TSession>): () => void;
  onSessionStart(listener: SessionLifecycleListener<TSession>): () => void;
  onSessionStateChange(listener: SessionLifecycleListener<TSession>): () => void;
  onSessionEnd(listener: SessionLifecycleListener<TSession>): () => void;
}
