import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedEntityPromptContext } from '../agents/entity-context/types';
import { NOOP_LOGGER } from './logger';
import {
  ConversationTitleReadError,
  LocalSessionMetadataSource,
  type ConversationTitleReader,
  type LocalSessionMetadata,
} from './local-session-metadata-source';
import type {
  LocalSessionObserver,
  LocalSessionSnapshot,
  LocalSessionUpdate,
} from './local-session-read-source';

type UpdateWithoutRevision = LocalSessionUpdate extends infer U
  ? U extends LocalSessionUpdate
    ? Omit<U, 'revision'>
    : never
  : never;

const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected value');
  return value;
};

const session = (
  runId: string,
  overrides: Partial<LocalSessionSnapshot> = {},
): LocalSessionSnapshot => ({
  runId,
  runInstanceId: 1,
  agentSessionId: `agent-session-${runId}`,
  conversationId: `conversation-${runId}`,
  organizationId: 'org-1',
  projectId: 'project-1',
  provider: 'claude',
  providerSessionId: null,
  providerConversationId: null,
  entity: { entityType: 'TASK', entityId: '00000000-0000-4000-8000-000000000001' },
  effectiveState: null,
  hasActiveWork: false,
  createdAt: '2026-10-04T00:00:00.000Z',
  activeSince: '2026-10-04T00:00:00.000Z',
  loadedEntityContext: null,
  entityContextLoadStatus: 'pending',
  ...overrides,
});

const loadedContext = {
  kind: 'entity',
  focalEntity: { entityType: 'TASK', entityId: '00000000-0000-4000-8000-000000000001' },
  entity: { id: 'task', title: 'Task title' },
  context: {
    featureHierarchy: [
      { id: 'grandparent', name: 'Root', relationship: 'ancestor', distance: 2 },
      { id: 'child', name: 'Child', relationship: 'descendant', distance: 1 },
      { id: 'parent', name: 'Parent', relationship: 'ancestor', distance: 1 },
    ],
  },
} as unknown as LoadedEntityPromptContext;

interface Deferred {
  resolve: (title: string | null) => void;
  reject: (error: unknown) => void;
}

const setup = (initial: LocalSessionSnapshot[] = []) => {
  let readObserver: LocalSessionObserver | null = null;
  let revision = 0;
  const pending: Deferred[] = [];
  const readConversationTitle = vi.fn<ConversationTitleReader>(
    () =>
      new Promise<string | null>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  const source = new LocalSessionMetadataSource({
    readSource: {
      observe: (observer) => {
        readObserver = observer;
        return {
          snapshot: { revision: 0, sessions: initial },
          unsubscribe: vi.fn(),
        };
      },
    },
    readConversationTitle,
    logger: NOOP_LOGGER,
    refreshIntervalMs: 1_000,
  });
  const emit = (update: UpdateWithoutRevision) =>
    required(readObserver ?? undefined)({ ...update, revision: ++revision });
  const metadata = (runId: string): LocalSessionMetadata | undefined =>
    source.snapshot().sessions.find((entry) => entry.runId === runId);
  return { source, emit, pending, readConversationTitle, metadata };
};

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('LocalSessionMetadataSource', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('projects focal context and ordered ancestry independently from the title', () => {
    const { emit, metadata, readConversationTitle } = setup();
    emit({ kind: 'registered', session: session('a') });
    expect(metadata('a')).toMatchObject({
      title: { status: 'unloaded' },
      focalContext: { status: 'loading' },
    });

    emit({ kind: 'updated', session: session('a', { loadedEntityContext: loadedContext }) });
    const focal = required(metadata('a')).focalContext;
    expect(focal.status).toBe('available');
    if (focal.status !== 'available') return;
    expect(focal.value.featureAncestry.map((feature) => feature.id)).toEqual([
      'parent',
      'grandparent',
    ]);
    expect(readConversationTitle).not.toHaveBeenCalled();
  });

  it('marks context unavailable when the Run has no focal entity', () => {
    const { emit, metadata } = setup();
    emit({ kind: 'registered', session: session('a', { entity: null }) });
    expect(required(metadata('a')).focalContext).toEqual({
      status: 'unavailable',
      reason: 'no_focal_entity',
    });
  });

  it('loads titles for displayed Runs and keeps a null title rather than an entity name', async () => {
    const { source, emit, pending, metadata, readConversationTitle } = setup();
    emit({ kind: 'registered', session: session('a', { loadedEntityContext: loadedContext }) });
    source.setDisplayInterest(['a']);
    expect(readConversationTitle).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: 'conversation-a',
    });
    expect(required(metadata('a')).title).toEqual({ status: 'loading' });

    required(pending[0]).resolve(null);
    await flush();
    expect(required(metadata('a')).title).toMatchObject({ status: 'available', value: null });
  });

  it('coalesces refreshes and refreshes displayed titles on an interval', async () => {
    const { source, emit, pending, readConversationTitle } = setup();
    emit({ kind: 'registered', session: session('a') });
    source.setDisplayInterest(['a']);
    source.connectivityRestored();
    source.connectivityRestored();
    expect(readConversationTitle).toHaveBeenCalledTimes(1);

    required(pending[0]).resolve('First');
    await flush();
    expect(readConversationTitle).toHaveBeenCalledTimes(2);
    required(pending[1]).resolve('Second');
    await flush();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(readConversationTitle).toHaveBeenCalledTimes(3);
    source.setDisplayInterest([]);
    required(pending[2]).resolve('Third');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(readConversationTitle).toHaveBeenCalledTimes(3);
  });

  it('keeps a stale title after a failed refresh and recovers on reconnect', async () => {
    const { source, emit, pending, metadata } = setup();
    emit({ kind: 'registered', session: session('a') });
    source.setDisplayInterest(['a']);
    required(pending[0]).resolve('Title');
    await flush();

    source.connectivityRestored();
    required(pending[1]).reject(new ConversationTitleReadError('offline', false));
    await flush();
    expect(required(metadata('a')).title).toMatchObject({
      status: 'stale',
      value: 'Title',
      reason: 'read_failed',
    });

    source.connectivityRestored();
    required(pending[2]).resolve('Renamed');
    await flush();
    expect(required(metadata('a')).title).toMatchObject({ status: 'available', value: 'Renamed' });
  });

  it('drops the title value on an unauthorized read', async () => {
    const { source, emit, pending, metadata } = setup();
    emit({ kind: 'registered', session: session('a') });
    source.setDisplayInterest(['a']);
    required(pending[0]).reject(new ConversationTitleReadError('forbidden', true));
    await flush();
    expect(required(metadata('a')).title).toEqual({
      status: 'unavailable',
      reason: 'unauthorized',
    });
  });

  it('discards late title responses for removed or replaced Runs', async () => {
    const { source, emit, pending, metadata } = setup();
    emit({ kind: 'registered', session: session('a') });
    source.setDisplayInterest(['a']);
    emit({ kind: 'removed', runId: 'a', runInstanceId: 1 });
    emit({ kind: 'registered', session: session('a', { runInstanceId: 2 }) });

    required(pending[0]).resolve('Old instance title');
    await flush();
    expect(metadata('a')).toMatchObject({ runInstanceId: 2, title: { status: 'loading' } });

    required(pending[1]).resolve('New instance title');
    await flush();
    expect(required(metadata('a')).title).toMatchObject({
      status: 'available',
      value: 'New instance title',
    });
  });

  it('applies locally known title updates to matching conversations', () => {
    const { source, emit, metadata } = setup();
    emit({ kind: 'registered', session: session('a') });
    source.noteConversationTitle('conversation-a', 'Pushed title');
    expect(required(metadata('a')).title).toMatchObject({
      status: 'available',
      value: 'Pushed title',
    });
  });

  it('removes account-derived values on logout without hiding sessions, and restores them', async () => {
    const { source, emit, pending, metadata, readConversationTitle } = setup();
    emit({ kind: 'registered', session: session('a', { loadedEntityContext: loadedContext }) });
    source.setDisplayInterest(['a']);
    required(pending[0]).resolve('Title');
    await flush();

    source.authorizationLost();
    expect(metadata('a')).toMatchObject({
      title: { status: 'unavailable', reason: 'signed_out' },
      focalContext: { status: 'unavailable', reason: 'signed_out' },
    });
    source.connectivityRestored();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(readConversationTitle).toHaveBeenCalledTimes(1);

    source.authorizationRestored();
    expect(required(metadata('a')).focalContext.status).toBe('available');
    required(pending[1]).resolve('Title again');
    await flush();
    expect(required(metadata('a')).title).toMatchObject({
      status: 'available',
      value: 'Title again',
    });
  });

  it('isolates a failing observer and a failing read from healthy sessions', async () => {
    const { source, emit, pending, metadata } = setup();
    source.observe(() => {
      throw new Error('broken observer');
    });
    const healthy = vi.fn();
    source.observe(healthy);
    emit({ kind: 'registered', session: session('a') });
    emit({ kind: 'registered', session: session('b') });
    source.setDisplayInterest(['a', 'b']);
    required(pending[0]).reject(new Error('boom'));
    required(pending[1]).resolve('B');
    await flush();

    expect(required(metadata('a')).title).toEqual({ status: 'unavailable', reason: 'read_failed' });
    expect(required(metadata('b')).title).toMatchObject({ status: 'available', value: 'B' });
    expect(healthy).toHaveBeenCalled();
  });

  it('stops refresh work on dispose', async () => {
    const { source, emit, readConversationTitle } = setup();
    emit({ kind: 'registered', session: session('a') });
    source.setDisplayInterest(['a']);
    source.dispose();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(readConversationTitle).toHaveBeenCalledTimes(1);
  });

  it('settles focal context as unavailable when the Run cannot or will not load it', () => {
    const { emit, metadata } = setup();
    emit({ kind: 'registered', session: session('a') });
    expect(required(metadata('a')).focalContext).toEqual({ status: 'loading' });

    emit({ kind: 'updated', session: session('a', { entityContextLoadStatus: 'failed' }) });
    expect(required(metadata('a')).focalContext).toEqual({
      status: 'unavailable',
      reason: 'read_failed',
    });

    emit({
      kind: 'updated',
      session: session('a', {
        entityContextLoadStatus: 'loaded',
        loadedEntityContext: loadedContext,
      }),
    });
    expect(required(metadata('a')).focalContext.status).toBe('available');

    emit({ kind: 'registered', session: session('b', { entityContextLoadStatus: 'not_loaded' }) });
    expect(required(metadata('b')).focalContext).toEqual({
      status: 'unavailable',
      reason: 'context_not_loaded',
    });
  });

  it('drops a queued title refresh when its Run leaves display interest', async () => {
    const { source, emit, pending, readConversationTitle } = setup();
    emit({ kind: 'registered', session: session('a') });
    source.setDisplayInterest(['a']);
    source.connectivityRestored();
    source.setDisplayInterest([]);
    source.setDisplayInterest(['a']);
    required(pending[0]).resolve('Title');
    await flush();
    expect(readConversationTitle).toHaveBeenCalledTimes(1);
  });

  it('keeps sessions listed after logout and stops timed title reads until restored', async () => {
    const { source, emit, pending, metadata, readConversationTitle } = setup();
    emit({ kind: 'registered', session: session('a', { loadedEntityContext: loadedContext }) });
    emit({ kind: 'registered', session: session('b') });
    source.setDisplayInterest(['a', 'b']);
    required(pending[0]).resolve('A');
    required(pending[1]).resolve('B');
    await flush();
    expect(readConversationTitle).toHaveBeenCalledTimes(2);

    source.authorizationLost();
    expect(source.snapshot().sessions.map((entry) => entry.runId)).toEqual(['a', 'b']);
    for (const runId of ['a', 'b']) {
      expect(metadata(runId)).toMatchObject({
        title: { status: 'unavailable', reason: 'signed_out' },
        focalContext: { status: 'unavailable', reason: 'signed_out' },
      });
    }
    source.noteConversationTitle('conversation-a', 'Leaked');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(readConversationTitle).toHaveBeenCalledTimes(2);
    expect(required(metadata('a')).title.status).toBe('unavailable');

    source.authorizationRestored();
    expect(readConversationTitle).toHaveBeenCalledTimes(4);
    required(pending[2]).resolve('A');
    required(pending[3]).resolve('B');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(readConversationTitle).toHaveBeenCalledTimes(6);
  });
});
