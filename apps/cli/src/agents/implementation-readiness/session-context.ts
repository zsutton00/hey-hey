import { z } from 'zod';
import type {
  ImplementationReadinessDisposition,
  ImplementationReadinessStoredFinding,
  ImplementationReadinessEvidence,
  ImplementationReadinessFinding,
  ImplementationReadinessFixStep,
  ImplementationReadinessItemReference,
  ImplementationReadinessLegacyFinding,
  ImplementationReadinessResolution,
  ImplementationReadinessSourceSnapshot,
  ImplementationReadinessTrailEntry,
} from '@hey-hey/contracts/api/models';

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

const itemReferenceSchema = z
  .object({
    entityType: z.enum(['TASK', 'FEATURE', 'DESIGN_DOC', 'PLAN', 'CONTRACT', 'SERVICE']),
    entityId: z.string().uuid(),
    title: z.string().min(1),
  })
  .strict()
  .transform(
    (value): ImplementationReadinessItemReference => ({
      entityType: value.entityType,
      entityId: value.entityId,
      title: value.title,
    }),
  );

const trailEntrySchema = z
  .object({ source: itemReferenceSchema, explanation: z.string().min(1) })
  .strict()
  .transform(
    (value): ImplementationReadinessTrailEntry => ({
      source: value.source,
      explanation: value.explanation,
    }),
  );

const fixStepSchema = z
  .object({
    owner: itemReferenceSchema,
    action: z.string().min(1),
    state: z.enum(['DONE', 'REMAINING', 'USER_DECISION']),
  })
  .strict()
  .transform(
    (value): ImplementationReadinessFixStep => ({
      owner: value.owner,
      action: value.action,
      state: value.state,
    }),
  );

/** The only finding shape agents may author. */
const readinessFindingSchema = z
  .object({
    requestedOutcome: z.string().min(1),
    reasoningTrail: z.array(trailEntrySchema).min(2).max(4),
    problem: z.string().min(1),
    failureScenario: z.array(z.string().min(1)).min(2).max(8),
    fixSteps: z.array(fixStepSchema).min(1).max(8),
    userRequest: z.string().min(1),
    boundedEvidence: z.array(readinessEvidenceSchema).min(1).max(8),
  })
  .strict()
  .transform(
    (value): ImplementationReadinessFinding => ({
      requestedOutcome: value.requestedOutcome,
      reasoningTrail: value.reasoningTrail,
      problem: value.problem,
      failureScenario: value.failureScenario,
      fixSteps: value.fixSteps,
      userRequest: value.userRequest,
      boundedEvidence: value.boundedEvidence,
    }),
  );

/** Compatibility read for findings saved before the explained layout. Never authored. */
const legacyReadinessFindingSchema = z
  .object({
    affectedSourceContext: z.string().min(1),
    unresolvedDecision: z.string().min(1),
    consequentialInventionRisk: z.string().min(1),
    boundedEvidence: z.array(readinessEvidenceSchema).min(1).max(8),
    answerKind: z.string().min(1),
  })
  .strict()
  .transform(
    (value): ImplementationReadinessLegacyFinding => ({
      affectedSourceContext: value.affectedSourceContext,
      unresolvedDecision: value.unresolvedDecision,
      consequentialInventionRisk: value.consequentialInventionRisk,
      boundedEvidence: value.boundedEvidence,
      answerKind: value.answerKind,
    }),
  );

const storedReadinessFindingSchema = z.union([readinessFindingSchema, legacyReadinessFindingSchema]);

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

const buildDispositionSchema = (
  findingSchema: z.ZodType<ImplementationReadinessStoredFinding, z.ZodTypeDef, unknown>,
) =>
  z.preprocess(
    normalizeLegacyImplementationReadinessDisposition,
    z
      .object({
        state: z.enum(['CLEAR', 'REVIEW_REQUIRED', 'DISMISSED']),
        sourceSnapshot: readinessSourceSnapshotSchema,
        finding: findingSchema.nullable(),
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

/** Reads stored dispositions, including findings saved in the earlier layout. */
export const implementationReadinessDispositionSchema =
  buildDispositionSchema(storedReadinessFindingSchema);

/** Validates newly authored dispositions: findings must use the explained layout. */
export const authoredImplementationReadinessDispositionSchema =
  buildDispositionSchema(readinessFindingSchema);

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
