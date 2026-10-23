import { z } from 'zod';
import type { WorkItemTypeAgentGuidance } from '../../generated/model/workItemTypeAgentGuidance';
import type { WorkItemTypeGuidanceDto } from '../../generated/model/workItemTypeGuidanceDto';
import type { WorkItemTypeMaintenanceGuidanceDto } from '../../generated/model/workItemTypeMaintenanceGuidanceDto';

// Mirrors the closed semantic schemas in work-item-type-definition.yaml.
export const workItemTypeGuidanceExampleSchema = z
  .object({
    title: z.string().min(1),
    guidance: z.string().min(1),
  })
  .strict();

export const workItemTypeAgentGuidanceSchema = z
  .object({
    overview: z.string().min(1),
    examples: z.array(workItemTypeGuidanceExampleSchema).optional(),
    contexts: z
      .array(
        z
          .object({
            focalTypeKeys: z.array(z.string().min(1)).min(1),
            guidance: z.string().min(1),
            examples: z.array(workItemTypeGuidanceExampleSchema).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict() satisfies z.ZodType<WorkItemTypeAgentGuidance>;

export const workItemTypeGuidanceSchema = z
  .object({
    typeKey: z.string().min(1),
    name: z.string(),
    overview: z.string().min(1),
    examples: z.array(workItemTypeGuidanceExampleSchema),
    contextualGuidance: z
      .array(
        z
          .object({
            guidance: z.string().min(1),
            examples: z.array(workItemTypeGuidanceExampleSchema),
          })
          .strict(),
      )
      .optional(),
  })
  .strict() satisfies z.ZodType<WorkItemTypeGuidanceDto>;

export const workItemTypeMaintenanceGuidanceSchema = z
  .object({
    typeKey: z.string().min(1),
    name: z.string(),
    maintenanceGuidance: z.string().optional(),
  })
  .strict() satisfies z.ZodType<WorkItemTypeMaintenanceGuidanceDto>;

export const workItemTypeGuidanceResponseSchema = z.union([
  workItemTypeGuidanceSchema,
  workItemTypeMaintenanceGuidanceSchema,
]);
