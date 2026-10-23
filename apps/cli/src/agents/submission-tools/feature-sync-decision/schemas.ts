import { z } from 'zod';
import {
  FeatureSyncReportSourceType,
  type FeatureSyncDecisionGroup,
  type FeatureSyncDecisionReportPayloadV1,
  type FeatureSyncDecisionReportPayloadV2,
} from '../../../shared/api/generated/api';
import type { SubmissionToolExecuteContext } from '../types';

const textSchema = z.string().min(1);
const sourceSchema = z
  .object({
    entityType: z.nativeEnum(FeatureSyncReportSourceType),
    entityId: textSchema,
    title: textSchema,
  })
  .passthrough();

const choiceSchema = z
  .object({
    id: textSchema,
    label: textSchema.regex(
      /^(?!\s*(?:[0-9]+[.):]|[A-Za-z][.)]|\([0-9A-Za-z]+\)|[IVXLCDMivxlcdm]+[.)])\s).*/,
      'Choice labels must not have ordinal prefixes',
    ),
    description: textSchema.optional(),
    isNoChange: z.boolean(),
  })
  .passthrough()
  .transform(({ description, ...choice }) => ({
    ...choice,
    ...(description === undefined ? {} : { description }),
  }));

const featureSyncDecisionGroupSchema = z
  .object({
    id: textSchema,
    affectedEntities: z.array(sourceSchema).min(1),
    title: textSchema,
    summary: textSchema,
    choices: z.array(choiceSchema).min(2),
  })
  .passthrough()
  .superRefine((group, ctx) => {
    if (group.choices.filter((choice) => choice.isNoChange).length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['choices'],
        message: 'Exactly one no-change choice is required',
      });
    }
    const choiceIds = new Set<string>();
    group.choices.forEach((choice, index) => {
      if (choiceIds.has(choice.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['choices', index, 'id'],
          message: 'Duplicate choice identity',
        });
      }
      choiceIds.add(choice.id);
    });
    const targets = new Set<string>();
    group.affectedEntities.forEach((target, index) => {
      const key = JSON.stringify([target.entityType, target.entityId]);
      if (targets.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['affectedEntities', index],
          message: 'Repeated typed target',
        });
      }
      targets.add(key);
    });
  }) satisfies z.ZodType<FeatureSyncDecisionGroup, z.ZodTypeDef, object>;

const featureSyncDecisionV1Schema = z
  .object({
    reportType: z.literal('FEATURE_SYNC_DECISION'),
    summary: textSchema,
    discrepancies: z
      .array(
        z
          .object({
            sourceType: z.nativeEnum(FeatureSyncReportSourceType),
            source: sourceSchema,
            description: textSchema,
          })
          .passthrough(),
      )
      .min(1),
    reconciliationOptions: z
      .array(
        z
          .object({
            description: textSchema,
            discrepancyIndices: z.array(z.number().int().min(0)),
          })
          .passthrough(),
      )
      .min(1),
    decisionGroups: z.never().optional(),
    schemaVersion: z.never().optional(),
  })
  .passthrough() satisfies z.ZodType<FeatureSyncDecisionReportPayloadV1>;

export const featureSyncDecisionV2Schema = z
  .object({
    reportType: z.literal('FEATURE_SYNC_DECISION'),
    summary: textSchema,
    decisionGroups: z.array(featureSyncDecisionGroupSchema).min(1),
    discrepancies: z.never().optional(),
    reconciliationOptions: z.never().optional(),
    schemaVersion: z.never().optional(),
  })
  .passthrough()
  .superRefine((payload, ctx) => {
    const ids = new Set<string>();
    payload.decisionGroups.forEach((group, index) => {
      if (ids.has(group.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['decisionGroups', index, 'id'],
          message: 'Duplicate group identity',
        });
      }
      ids.add(group.id);
    });
  }) satisfies z.ZodType<FeatureSyncDecisionReportPayloadV2, z.ZodTypeDef, object>;

const featureSyncDecisionEnvelopeSchema = z.union([
  z.object({
    reportType: z.literal('FEATURE_SYNC_DECISION'),
    schemaVersion: z.literal(1).optional(),
    payload: featureSyncDecisionV1Schema,
  }),
  z.object({
    reportType: z.literal('FEATURE_SYNC_DECISION'),
    schemaVersion: z.literal(2),
    payload: featureSyncDecisionV2Schema,
  }),
]);

/** Validate the untrusted submission boundary before any persistence or run bookkeeping. */
export function parseFeatureSyncDecisionReport(args: SubmissionToolExecuteContext['args']) {
  const nestedType = z
    .object({ reportType: z.literal('FEATURE_SYNC_DECISION') })
    .safeParse(args['payload']);
  if (args['reportType'] !== 'FEATURE_SYNC_DECISION' && !nestedType.success) {
    return { ok: true as const, value: null };
  }
  const parsed = featureSyncDecisionEnvelopeSchema.safeParse(args);
  return parsed.success
    ? { ok: true as const, value: parsed.data }
    : { ok: false as const, error: parsed.error.message };
}
