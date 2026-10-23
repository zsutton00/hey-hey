import { z } from 'zod';
import type {
  ImplementationReadinessDisposition,
  ImplementationReadinessEvidence,
  ImplementationReadinessFinding,
  ImplementationReadinessResolution,
  ImplementationReadinessSourceSnapshot,
} from '../../shared/api/generated/api';

const evidenceCategories = [
  'behavior',
  'ownership',
  'data_lifecycle',
  'authority',
  'security',
  'isolation',
  'integration',
] as const;

const readinessEvidenceSchema = z
  .object({
    category: z.enum(evidenceCategories),
    statement: z.string().min(1),
    sourceRef: z.string().min(1).optional(),
  })
  .strict()
  .transform(
    (value): ImplementationReadinessEvidence =>
      value.sourceRef === undefined
        ? { category: value.category, statement: value.statement }
        : {
            category: value.category,
            statement: value.statement,
            sourceRef: value.sourceRef,
          },
  );

const readinessFindingSchema = z
  .object({
    affectedSourceContext: z.string().min(1),
    unresolvedDecision: z.string().min(1),
    consequentialInventionRisk: z.string().min(1),
    boundedEvidence: z.array(readinessEvidenceSchema).min(1).max(8),
    answerKind: z.string().min(1),
  })
  .strict()
  .transform(
    (value): ImplementationReadinessFinding => ({
      affectedSourceContext: value.affectedSourceContext,
      unresolvedDecision: value.unresolvedDecision,
      consequentialInventionRisk: value.consequentialInventionRisk,
      boundedEvidence: value.boundedEvidence,
      answerKind: value.answerKind,
    }),
  );

const readinessSourceSnapshotSchema = z
  .object({
    runId: z.string().min(1),
    focalEntityId: z.string().min(1),
    focalEntityType: z.enum(['TASK', 'FEATURE', 'DESIGN_DOC', 'PLAN']),
    sourceRevision: z.string().min(1),
    capturedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .transform(
    (value): ImplementationReadinessSourceSnapshot => ({
      runId: value.runId,
      focalEntityId: value.focalEntityId,
      focalEntityType: value.focalEntityType,
      sourceRevision: value.sourceRevision,
      capturedAt: value.capturedAt,
    }),
  );

const readinessResolutionSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('NONE') }).strict(),
    z
      .object({
        kind: z.literal('DISMISSED'),
        runId: z.string().min(1),
        sourceRevision: z.string().min(1),
        resolvedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  ])
  .transform((value): ImplementationReadinessResolution => value);

const normalizeLegacyImplementationReadinessDisposition = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;

  const disposition = value as Record<string, unknown>;
  if (disposition['state'] === 'STALE') {
    return {
      ...disposition,
      state: 'CLEAR',
      finding: null,
      resolution: { kind: 'NONE' },
    };
  }

  if (disposition['state'] !== 'WAIVED') return value;
  const resolution = disposition['resolution'];
  if (typeof resolution !== 'object' || resolution === null || Array.isArray(resolution)) {
    return value;
  }

  const resolutionRecord = resolution as Record<string, unknown>;
  if (resolutionRecord['kind'] !== 'WAIVED') return value;
  return {
    ...disposition,
    state: 'DISMISSED',
    resolution: { ...resolutionRecord, kind: 'DISMISSED' },
  };
};

export const implementationReadinessDispositionSchema = z.preprocess(
  normalizeLegacyImplementationReadinessDisposition,
  z
    .object({
      state: z.enum(['CLEAR', 'REVIEW_REQUIRED', 'DISMISSED']),
      sourceSnapshot: readinessSourceSnapshotSchema,
      finding: readinessFindingSchema.nullable(),
      resolution: readinessResolutionSchema,
    })
    .strict()
    .transform(
      (value): ImplementationReadinessDisposition => ({
        state: value.state,
        sourceSnapshot: value.sourceSnapshot,
        finding: value.finding,
        resolution: value.resolution,
      }),
    ),
);

const IMPLEMENTATION_READINESS_SESSION_CONTEXT_KEY = 'implementationReadiness';

export const parseImplementationReadinessFromSessionContext = (
  sessionContext: Readonly<Record<string, unknown>> | undefined,
): ImplementationReadinessDisposition | null => {
  const raw = sessionContext?.[IMPLEMENTATION_READINESS_SESSION_CONTEXT_KEY];
  if (raw === undefined) return null;
  const parsed = implementationReadinessDispositionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid persisted implementation-readiness disposition: ${parsed.error.message}`,
    );
  }
  return parsed.data;
};

export const serializeImplementationReadinessToSessionContext = (
  disposition: ImplementationReadinessDisposition,
): Record<string, unknown> => ({
  [IMPLEMENTATION_READINESS_SESSION_CONTEXT_KEY]: disposition,
});

const implementationReadinessSessionContextSchema = z
  .object({
    [IMPLEMENTATION_READINESS_SESSION_CONTEXT_KEY]: implementationReadinessDispositionSchema,
  })
  .strict();
