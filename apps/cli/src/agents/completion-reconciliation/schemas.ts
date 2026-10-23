import type { ChangedFileClaim } from '../../shared/agent-bridge-contract/generated/api';
import { z } from 'zod';
import type { VerifyFeaturePayload } from '../../shared/api/generated/api';

export const featureVerificationSuggestionSchema = z
  .object({
    featureId: z.string().uuid(),
    discrepancy: z.string().trim().min(1),
    impactedEntities: z.array(
      z
        .object({
          entityType: z.string().trim().min(1),
          entityId: z.string().uuid(),
        })
        .strict(),
    ),
  })
  .strict();

export type FeatureVerificationSuggestion = VerifyFeaturePayload;

export const reportedChangedFileSchema = z
  .object({
    serviceId: z.string().trim().min(1),
    path: z.string().trim().min(1),
  })
  .strict() satisfies z.ZodType<ChangedFileClaim>;

export type ReportedChangedFile = ChangedFileClaim;

export const completionResponseSchema = z.object({ response: z.string().trim().min(1) }).strip();

export type CompletionResponse = z.infer<typeof completionResponseSchema>;
