import { SessionRole } from '../../generated/model/sessionRole';
import type { WorkItemTypeSessionRoleGuidance } from '../../generated/model/workItemTypeSessionRoleGuidance';
import type { WorkItemTypeRoleGuidanceDto } from '../../generated/model/workItemTypeRoleGuidanceDto';
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

// Exhaustive catalog mapping: a new shared role must be represented here.
const sessionRoleGuidanceShape = {
  implementation: z.string().optional(),
  research: z.string().optional(),
  planning: z.string().optional(),
  review: z.string().optional(),
} satisfies Record<SessionRole, z.ZodOptional<z.ZodString>>;

export const workItemTypeSessionRoleGuidanceSchema = z
  .object(sessionRoleGuidanceShape)
  .strict() satisfies z.ZodType<WorkItemTypeSessionRoleGuidance>;

export const workItemTypeRoleGuidanceSchema = z
  .object({
    typeKey: z.string().min(1),
    name: z.string(),
    sessionRole: z.nativeEnum(SessionRole),
    guidance: z.string().optional(),
  })
  .strict() satisfies z.ZodType<WorkItemTypeRoleGuidanceDto>;

export const workItemTypeGuidanceResponseSchema = z.union([
  workItemTypeGuidanceSchema,
  workItemTypeMaintenanceGuidanceSchema,
  workItemTypeRoleGuidanceSchema,
]);
