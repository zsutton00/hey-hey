import { SessionRole } from '../../generated/model/sessionRole';
import type { WorkItemTypeSessionRoleGuidance } from '../../generated/model/workItemTypeSessionRoleGuidance';
import type { WorkItemTypeRoleGuidanceDto } from '../../generated/model/workItemTypeRoleGuidanceDto';
import { z } from 'zod';
import type { WorkItemTypeMaintenanceGuidanceDto } from '../../generated/model/workItemTypeMaintenanceGuidanceDto';

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
  workItemTypeMaintenanceGuidanceSchema,
  workItemTypeRoleGuidanceSchema,
]);
