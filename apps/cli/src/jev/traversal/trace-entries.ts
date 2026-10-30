import type { EntityLabel, Judged, JevFailureTrace } from '../trace';
import type { ReadCheckResult } from './read-check';
import type { JevFailure, TitledRef } from './types';

export const labelOf = ({ id, kind, title }: TitledRef): EntityLabel => ({
  id,
  type: kind,
  title,
});

/** Looks an entity up by id; an id the caller never named is a bug, not something to paper over. */
export const labelLookup =
  (labels: ReadonlyMap<string, EntityLabel>) =>
  (id: string): EntityLabel => {
    const label = labels.get(id);
    if (!label) throw new Error(`Entity ${id} has no label in the trace.`);
    return label;
  };

export const jevFailureTrace = (
  step: JevFailureTrace['step'],
  entities: readonly EntityLabel[],
  failure: JevFailure,
  next: JevFailureTrace['next'],
): JevFailureTrace => ({
  step,
  entities: [...entities],
  code: failure.code,
  message: failure.message,
  ...(failure.providerStatus !== undefined ? { providerStatus: failure.providerStatus } : {}),
  ...(failure.providerDetail !== undefined ? { providerDetail: failure.providerDetail } : {}),
  ...(failure.errorDetail !== undefined ? { errorDetail: failure.errorDetail } : {}),
  next,
});

/** The keep or drop for each entity a read check judged, and each failed request with what followed. */
export const readCheckTrace = (
  check: ReadCheckResult,
  labels: ReadonlyMap<string, EntityLabel>,
): { judged: Judged[]; failures: JevFailureTrace[] } => {
  const label = labelLookup(labels);
  return {
    judged: check.judged.map(({ id, text, applies, kept, excerpt }) => ({
      text,
      decision: applies === null ? 'kept-on-failure' : kept ? 'keep' : 'drop',
      entity: label(id),
      applies,
      kept,
      ...(excerpt ? { excerpt } : {}),
    })),
    failures: check.failures.map(({ ids, failure }) =>
      jevFailureTrace('keep', ids.map(label), failure, 'kept-all'),
    ),
  };
};
