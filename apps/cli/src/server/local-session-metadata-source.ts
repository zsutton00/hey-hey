/**
 * LocalSessionMetadataSource — display metadata joined onto the Runs listed by
 * LocalSessionReadSource: the conversation title and the focal entity with its
 * feature ancestry.
 *
 * Title and focal context carry independent availability so one can fail
 * while the other renders. The title is read only through the authorized
 * platform conversation client and is never substituted with an entity name.
 * Focal context comes from the typed context the Run already loaded, so it
 * needs no extra read.
 *
 * Titles load only for Runs a display has declared interest in, and refresh
 * on a bounded interval while displayed; a refresh requested while one is in
 * flight is coalesced into a single follow-up. Responses are dropped when the
 * Run they were issued for was removed or replaced. Losing authorization
 * removes every account-derived value; it never widens what is read.
 */

import type {
  FeatureHierarchyEntryDto,
  FeatureHierarchyEntryDtoRelationshipEnum,
} from '../shared/api/generated/api';
import type { CurrentEntityDto } from '../agents/entity-context/types';
import type { RunEntityReference } from '../shared/agent-bridge-contract/generated/api';
import type {
  LocalSessionReadSource,
  LocalSessionSnapshot,
  LocalSessionUpdate,
} from './local-session-read-source';
import type { ServerLogger } from './logger';

export type LocalSessionMetadataUnavailableReason =
  | 'no_focal_entity'
  /** The Run's focal entity type has no entity Context to load. */
  | 'context_not_loaded'
  | 'signed_out'
  | 'unauthorized'
  | 'read_failed';

type LocalSessionMetadataValue<T> =
  | { readonly status: 'unloaded' }
  | { readonly status: 'loading' }
  | { readonly status: 'available'; readonly value: T; readonly fetchedAt: string }
  | {
      readonly status: 'stale';
      readonly value: T;
      readonly fetchedAt: string;
      readonly reason: LocalSessionMetadataUnavailableReason;
    }
  | { readonly status: 'unavailable'; readonly reason: LocalSessionMetadataUnavailableReason };

interface LocalSessionFocalContext {
  readonly focalEntity: RunEntityReference;
  readonly entity: CurrentEntityDto;
  /** Ancestor features ordered nearest first. */
  readonly featureAncestry: readonly FeatureHierarchyEntryDto[];
}

export interface LocalSessionMetadata {
  readonly runId: string;
  readonly runInstanceId: number;
  readonly conversationId: string;
  /** The conversation's own title; null when the conversation has none. */
  readonly title: LocalSessionMetadataValue<string | null>;
  readonly focalContext: LocalSessionMetadataValue<LocalSessionFocalContext>;
}

export interface LocalSessionsMetadataSnapshot {
  readonly revision: number;
  readonly sessions: readonly LocalSessionMetadata[];
}

export interface LocalSessionMetadataUpdate {
  readonly revision: number;
  readonly runId: string;
  readonly runInstanceId: number;
  /** Null when the Run left the list. */
  readonly metadata: LocalSessionMetadata | null;
}

export type LocalSessionMetadataObserver = (update: LocalSessionMetadataUpdate) => void;

/** Reads a conversation title; rejects with `ConversationTitleReadError` on failure. */
export type ConversationTitleReader = (input: {
  organizationId: string;
  projectId: string;
  conversationId: string;
}) => Promise<string | null>;

export class ConversationTitleReadError extends Error {
  public constructor(
    message: string,
    public readonly unauthorized: boolean,
  ) {
    super(message);
    this.name = 'ConversationTitleReadError';
  }
}

export interface LocalSessionMetadataSourceDependencies {
  readSource: Pick<LocalSessionReadSource, 'observe'>;
  readConversationTitle: ConversationTitleReader;
  logger: ServerLogger;
  /** Minimum age before a displayed title is re-read. */
  refreshIntervalMs: number;
  now?: () => Date;
}

interface Entry {
  session: LocalSessionSnapshot;
  metadata: LocalSessionMetadata;
  /** Identifies the title read whose response may still be applied. */
  titleRequest: object | null;
  titleRefreshQueued: boolean;
  titleFetchedAtMs: number | null;
}

const ANCESTOR: FeatureHierarchyEntryDtoRelationshipEnum = 'ancestor';

export class LocalSessionMetadataSource {
  private readonly entries = new Map<string, Entry>();
  private readonly observers = new Set<LocalSessionMetadataObserver>();
  private displayed = new Set<string>();
  private signedIn = true;
  private revision = 0;
  private disposed = false;
  private readonly unsubscribeReadSource: () => void;
  private readonly refreshTimer: ReturnType<typeof setInterval>;
  private readonly now: () => Date;

  public constructor(private readonly dependencies: LocalSessionMetadataSourceDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    const observation = dependencies.readSource.observe((update) => this.applyReadUpdate(update));
    this.unsubscribeReadSource = observation.unsubscribe;
    for (const session of observation.snapshot.sessions) {
      this.entries.set(session.runId, this.createEntry(session));
    }
    this.refreshTimer = setInterval(() => this.refreshDueTitles(), dependencies.refreshIntervalMs);
    this.refreshTimer.unref();
  }

  public snapshot(): LocalSessionsMetadataSnapshot {
    return Object.freeze({
      revision: this.revision,
      sessions: Object.freeze([...this.entries.values()].map((entry) => entry.metadata)),
    });
  }

  public observe(observer: LocalSessionMetadataObserver): {
    snapshot: LocalSessionsMetadataSnapshot;
    unsubscribe: () => void;
  } {
    if (!this.disposed) this.observers.add(observer);
    return {
      snapshot: this.snapshot(),
      unsubscribe: () => {
        this.observers.delete(observer);
      },
    };
  }

  /** Declares which Runs are displayed; their titles load now and refresh while shown. */
  public setDisplayInterest(runIds: Iterable<string>): void {
    if (this.disposed) return;
    const previous = this.displayed;
    this.displayed = new Set(runIds);
    for (const runId of previous) {
      const entry = this.displayed.has(runId) ? undefined : this.entries.get(runId);
      if (entry) entry.titleRefreshQueued = false;
    }
    for (const runId of this.displayed) {
      const entry = this.entries.get(runId);
      if (entry?.metadata.title.status === 'unloaded') this.readTitle(entry);
    }
  }

  /** Applies a title the process already learned, e.g. from a platform conversation event. */
  public noteConversationTitle(conversationId: string, title: string | null): void {
    if (this.disposed || !this.signedIn) return;
    for (const entry of this.entries.values()) {
      if (entry.session.conversationId !== conversationId) continue;
      entry.titleRequest = null;
      entry.titleRefreshQueued = false;
      entry.titleFetchedAtMs = this.now().getTime();
      this.publish(entry, {
        title: { status: 'available', value: title, fetchedAt: this.now().toISOString() },
      });
    }
  }

  /** Platform connectivity returned: re-read every displayed title. */
  public connectivityRestored(): void {
    if (this.disposed || !this.signedIn) return;
    for (const runId of this.displayed) {
      const entry = this.entries.get(runId);
      if (entry) this.readTitle(entry);
    }
  }

  /** Account authorization ended: drop every account-derived value. */
  public authorizationLost(): void {
    if (this.disposed || !this.signedIn) return;
    this.signedIn = false;
    for (const entry of this.entries.values()) {
      entry.titleRequest = null;
      entry.titleRefreshQueued = false;
      entry.titleFetchedAtMs = null;
      this.publish(entry, {
        title: { status: 'unavailable', reason: 'signed_out' },
        focalContext: { status: 'unavailable', reason: 'signed_out' },
      });
    }
  }

  /** Account authorization returned: rebuild context and reload displayed titles. */
  public authorizationRestored(): void {
    if (this.disposed || this.signedIn) return;
    this.signedIn = true;
    for (const entry of this.entries.values()) {
      this.publish(entry, {
        title: { status: 'unloaded' },
        focalContext: projectFocalContext(entry.session, this.now()),
      });
      if (this.displayed.has(entry.session.runId)) this.readTitle(entry);
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.refreshTimer);
    this.unsubscribeReadSource();
    this.observers.clear();
    this.entries.clear();
  }

  private applyReadUpdate(update: LocalSessionUpdate): void {
    if (update.kind === 'removed') {
      const entry = this.entries.get(update.runId);
      if (entry?.metadata.runInstanceId !== update.runInstanceId) return;
      this.entries.delete(update.runId);
      this.deliver({
        revision: ++this.revision,
        runId: update.runId,
        runInstanceId: update.runInstanceId,
        metadata: null,
      });
      return;
    }

    const existing = this.entries.get(update.session.runId);
    if (existing?.metadata.runInstanceId !== update.session.runInstanceId) {
      const entry = this.createEntry(update.session);
      this.entries.set(update.session.runId, entry);
      this.deliver({
        revision: ++this.revision,
        runId: entry.session.runId,
        runInstanceId: entry.metadata.runInstanceId,
        metadata: entry.metadata,
      });
      if (this.displayed.has(entry.session.runId)) this.readTitle(entry);
      return;
    }

    const contextChanged =
      existing.session.loadedEntityContext !== update.session.loadedEntityContext ||
      existing.session.entity !== update.session.entity ||
      existing.session.entityContextLoadStatus !== update.session.entityContextLoadStatus;
    existing.session = update.session;
    if (contextChanged && this.signedIn) {
      this.publish(existing, { focalContext: projectFocalContext(update.session, this.now()) });
    }
  }

  private createEntry(session: LocalSessionSnapshot): Entry {
    const metadata: LocalSessionMetadata = {
      runId: session.runId,
      runInstanceId: session.runInstanceId,
      conversationId: session.conversationId,
      title: this.signedIn
        ? { status: 'unloaded' }
        : { status: 'unavailable', reason: 'signed_out' },
      focalContext: this.signedIn
        ? projectFocalContext(session, this.now())
        : { status: 'unavailable', reason: 'signed_out' },
    };
    return {
      session,
      metadata: Object.freeze(metadata),
      titleRequest: null,
      titleRefreshQueued: false,
      titleFetchedAtMs: null,
    };
  }

  private refreshDueTitles(): void {
    if (this.disposed || !this.signedIn) return;
    const dueBefore = this.now().getTime() - this.dependencies.refreshIntervalMs;
    for (const runId of this.displayed) {
      const entry = this.entries.get(runId);
      if (entry && (entry.titleFetchedAtMs === null || entry.titleFetchedAtMs <= dueBefore)) {
        this.readTitle(entry);
      }
    }
  }

  private readTitle(entry: Entry): void {
    if (this.disposed || !this.signedIn) return;
    if (entry.titleRequest !== null) {
      entry.titleRefreshQueued = true;
      return;
    }
    const request = {};
    entry.titleRequest = request;
    const title = entry.metadata.title;
    if (title.status === 'unloaded' || title.status === 'unavailable') {
      this.publish(entry, { title: { status: 'loading' } });
    }
    const { organizationId, projectId, conversationId, runId } = entry.session;
    void this.dependencies
      .readConversationTitle({ organizationId, projectId, conversationId })
      .then(
        (value) => {
          if (!this.isCurrentRequest(entry, request)) return;
          entry.titleFetchedAtMs = this.now().getTime();
          this.publish(entry, {
            title: { status: 'available', value, fetchedAt: this.now().toISOString() },
          });
        },
        (error: unknown) => {
          if (!this.isCurrentRequest(entry, request)) return;
          const unauthorized = error instanceof ConversationTitleReadError && error.unauthorized;
          this.dependencies.logger.warn('local_session_metadata.title_read_failed', {
            runId,
            conversationId,
            unauthorized,
            error: error instanceof Error ? error.message : String(error),
          });
          entry.titleFetchedAtMs = this.now().getTime();
          const previous = entry.metadata.title;
          this.publish(entry, {
            title: unauthorized
              ? { status: 'unavailable', reason: 'unauthorized' }
              : previous.status === 'available' || previous.status === 'stale'
                ? {
                    status: 'stale',
                    value: previous.value,
                    fetchedAt: previous.fetchedAt,
                    reason: 'read_failed',
                  }
                : { status: 'unavailable', reason: 'read_failed' },
          });
        },
      )
      .finally(() => {
        if (!this.isCurrentRequest(entry, request)) return;
        entry.titleRequest = null;
        const queued = entry.titleRefreshQueued;
        entry.titleRefreshQueued = false;
        if (queued && this.displayed.has(runId)) this.readTitle(entry);
      });
  }

  private isCurrentRequest(entry: Entry, request: object): boolean {
    return (
      !this.disposed &&
      this.entries.get(entry.session.runId) === entry &&
      entry.titleRequest === request
    );
  }

  private publish(
    entry: Entry,
    change: Partial<Pick<LocalSessionMetadata, 'title' | 'focalContext'>>,
  ): void {
    entry.metadata = Object.freeze({ ...entry.metadata, ...change });
    this.deliver({
      revision: ++this.revision,
      runId: entry.metadata.runId,
      runInstanceId: entry.metadata.runInstanceId,
      metadata: entry.metadata,
    });
  }

  private deliver(update: LocalSessionMetadataUpdate): void {
    for (const observer of [...this.observers]) {
      try {
        observer(update);
      } catch (error) {
        this.dependencies.logger.warn('local_session_metadata.observer_failed', {
          revision: update.revision,
          runId: update.runId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

const projectFocalContext = (
  session: LocalSessionSnapshot,
  observedAt: Date,
): LocalSessionMetadataValue<LocalSessionFocalContext> => {
  if (session.entity === null) return { status: 'unavailable', reason: 'no_focal_entity' };
  const loaded = session.loadedEntityContext;
  if (loaded === null) {
    switch (session.entityContextLoadStatus) {
      case 'failed':
        return { status: 'unavailable', reason: 'read_failed' };
      case 'not_loaded':
        return { status: 'unavailable', reason: 'context_not_loaded' };
      default:
        return { status: 'loading' };
    }
  }
  const featureAncestry = (loaded.context.featureHierarchy ?? [])
    .filter((feature) => feature.relationship === ANCESTOR)
    .sort((left, right) => (left.distance ?? 0) - (right.distance ?? 0));
  return {
    status: 'available',
    value: Object.freeze({
      focalEntity: loaded.focalEntity,
      entity: loaded.entity,
      featureAncestry: Object.freeze(featureAncestry),
    }),
    fetchedAt: observedAt.toISOString(),
  };
};
