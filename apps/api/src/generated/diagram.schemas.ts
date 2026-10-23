/* Generated from OpenAPI by scripts/generate-diagram-schemas.js. */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { z } from 'zod';
export const DiagramMetadataSchema = z
  .object({
    kind: z.enum([
      'GENERAL',
      'ARCHITECTURE',
      'PROCESS',
      'DYNAMIC',
      'DEPLOYMENT',
    ]),
    level: z.enum([
      'OVERVIEW',
      'SYSTEM_CONTEXT',
      'CONTAINER',
      'COMPONENT',
      'CODE',
    ]),
  })
  .strict()
  .refine(
    (value) =>
      !z
        .object({
          kind: z.enum(['GENERAL', 'PROCESS', 'DYNAMIC', 'DEPLOYMENT']),
          level: z.enum(['SYSTEM_CONTEXT', 'CONTAINER', 'COMPONENT', 'CODE']),
        })
        .passthrough()
        .safeParse(value).success,
    'Diagram kind and level combination is not allowed.',
  );
export const DiagramElementMetadataSchema = z
  .object({
    role: z.string().min(1).regex(new RegExp('^[A-Z][A-Z0-9_]*$')),
    canonicalReference: z
      .object({
        entityId: z.string().uuid(),
        entityType: z.enum(['TASK', 'SERVICE']),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export const DiagramElementPolicySchema = z
  .object({
    roles: z
      .array(
        z
          .object({
            key: z.string().min(1).regex(new RegExp('^[A-Z][A-Z0-9_]*$')),
            label: z.string().min(1),
            notation: z.enum(['box', 'person', 'cylinder', 'diamond', 'frame']),
          })
          .strict(),
      )
      .min(1),
    referenceTargets: z.array(
      z
        .object({
          entityType: z.enum(['TASK', 'SERVICE']),
          workItemTypeKeys: z.array(z.string()).optional(),
        })
        .strict(),
    ),
  })
  .strict();
export const DiagramGroupsValueSchema = z
  .object({
    schemaVersion: z.literal('diagram-groups.v1'),
    groups: z.array(
      z
        .object({
          id: z
            .string()
            .min(1)
            .max(120)
            .regex(new RegExp('^[A-Za-z][A-Za-z0-9_.:-]*$')),
          label: z.string().min(1).max(200),
          meaning: z.enum([
            'VISUAL_ASSOCIATION',
            'STRUCTURAL_BOUNDARY',
            'DEPLOYMENT_BOUNDARY',
          ]),
          color: z
            .enum(['blue', 'green', 'orange', 'purple', 'red', 'teal'])
            .optional(),
          parentGroupId: z
            .string()
            .min(1)
            .max(120)
            .regex(new RegExp('^[A-Za-z][A-Za-z0-9_.:-]*$'))
            .optional(),
          members: z.array(
            z.union([
              z
                .object({
                  kind: z.literal('persistedWorkItem'),
                  workItemId: z.string().uuid(),
                })
                .strict(),
              z
                .object({
                  kind: z.literal('temporaryWorkItem'),
                  temporaryRef: z
                    .string()
                    .min(1)
                    .max(120)
                    .regex(new RegExp('^[A-Za-z][A-Za-z0-9_.:-]*$')),
                })
                .strict(),
            ]),
          ),
        })
        .strict(),
    ),
  })
  .strict();
