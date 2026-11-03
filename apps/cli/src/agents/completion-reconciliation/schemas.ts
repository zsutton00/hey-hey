import type { ChangedFileClaim } from '@hey-hey/contracts/agent-bridge';
import { z } from 'zod';
import type { VerifyFeaturePayload } from '@hey-hey/contracts/api/models';

export const featureVerificationSuggestionSchema = z
  .object({
    featureId: z.string().uuid(),
    discrepancy: z.string().trim().min(1),
    impactedEntities: z.array(
      z
        .object({
          entityType: z.string().trim().min(1),
          entityId: z.string().uuid(),
          title: z.string().trim().min(1),
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
