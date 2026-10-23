import { describe, expect, it } from 'vitest';
import type { ImplementationReadinessDisposition } from '../../../shared/api/generated/api';
import {
  allowsImplementation,
  parseImplementationReadinessDisposition,
  resolveDispositionForRun,
} from '../readiness-disposition';
import { computeReadinessSourceRevision, createReadinessSourceSnapshot } from '../source-snapshot';
import {
  parseImplementationReadinessFromSessionContext,
  serializeImplementationReadinessToSessionContext,
} from '../session-context';

const capturedAt = '2026-09-17T20:00:00.000Z';

const makeSnapshot = (decision = 'store server-owned state') =>
  createReadinessSourceSnapshot({
    runId: 'run-1',
    focalEntityId: 'task-1',
    focalEntityType: 'TASK',
    capturedAt,
    sourceValues: {
      decision,
      context: 'task context',
      relatedEntities: ['feature-1', 'design-doc-1'],
    },
  });

const finding = {
  affectedSourceContext: 'The task description and API design doc',
  unresolvedDecision: 'Which persistence lifecycle should the implementation preserve?',
  consequentialInventionRisk: 'Implementation could lose or duplicate durable state.',
  boundedEvidence: [
    {
      category: 'data_lifecycle' as const,
      statement: 'The task leaves two candidate persistence lifecycles unresolved.',
      sourceRef: 'task.description',
    },
  ],
  answerKind: 'Choose the authoritative persistence lifecycle.',
};

const makeDisposition = (
  overrides: Partial<ImplementationReadinessDisposition> = {},
): ImplementationReadinessDisposition => ({
  state: 'REVIEW_REQUIRED',
  sourceSnapshot: makeSnapshot(),
  finding,
  resolution: { kind: 'NONE' },
  ...overrides,
});

describe('implementation-readiness disposition', () => {
  it('computes the same revision when source keys are reordered', () => {
    const first = computeReadinessSourceRevision({
      runId: 'run-1',
      focalEntityId: 'task-1',
      focalEntityType: 'TASK',
      capturedAt,
      sourceValues: { z: 'last', a: 'first' },
    });
    const second = computeReadinessSourceRevision({
      runId: 'run-1',
      focalEntityId: 'task-1',
      focalEntityType: 'TASK',
      capturedAt,
      sourceValues: { a: 'first', z: 'last' },
    });

    expect(first).toBe(second);
  });

  it('keeps clear and dismissed dispositions terminal when source context changes', () => {
    const snapshot = makeSnapshot();
    const clear = makeDisposition({
      state: 'CLEAR',
      finding: null,
    });
    expect(allowsImplementation(clear)).toBe(true);

    const dismissed = resolveDispositionForRun(
      makeDisposition(),
      'run-1',
      snapshot.sourceRevision,
      capturedAt,
    );
    expect(dismissed.state).toBe('DISMISSED');
    expect(allowsImplementation(dismissed)).toBe(true);
  });

  it('rejects malformed persisted values and preserves strict session serialization', () => {
    const disposition = makeDisposition();
    const persisted = serializeImplementationReadinessToSessionContext(disposition);
    expect(parseImplementationReadinessFromSessionContext(persisted)).toEqual(disposition);

    expect(() =>
      parseImplementationReadinessDisposition({
        ...disposition,
        unexpected: true,
      }),
    ).toThrow();
  });

  it('admits legacy terminal and invalidated dispositions without persisting legacy states', () => {
    const sourceSnapshot = makeSnapshot();
    const legacyStale = parseImplementationReadinessFromSessionContext({
      implementationReadiness: {
        state: 'STALE',
        sourceSnapshot,
        finding: null,
        resolution: { kind: 'NONE' },
      },
    });
    expect(legacyStale).toEqual({
      state: 'CLEAR',
      sourceSnapshot,
      finding: null,
      resolution: { kind: 'NONE' },
    });
    expect(allowsImplementation(legacyStale)).toBe(true);

    const legacyWaived = parseImplementationReadinessFromSessionContext({
      implementationReadiness: {
        state: 'WAIVED',
        sourceSnapshot,
        finding,
        resolution: {
          kind: 'WAIVED',
          runId: sourceSnapshot.runId,
          sourceRevision: sourceSnapshot.sourceRevision,
          resolvedAt: capturedAt,
        },
      },
    });
    expect(legacyWaived?.state).toBe('DISMISSED');
    expect(legacyWaived?.resolution.kind).toBe('DISMISSED');
    expect(allowsImplementation(legacyWaived)).toBe(true);
  });

  it('rejects a dismissal bound to another run or source revision', () => {
    expect(() =>
      resolveDispositionForRun(
        makeDisposition(),
        'different-run',
        makeSnapshot().sourceRevision,
        capturedAt,
      ),
    ).toThrow(/stale|awaiting review/i);
  });
});
