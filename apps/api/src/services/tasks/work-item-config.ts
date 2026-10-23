import { BadRequestException, ConflictException } from '@nestjs/common';
import { z } from 'zod';
import type { WorkItemConfigV1 } from '../../generated/model/workItemConfigV1';
import { WorkItemConfigKind } from '../../generated/model/workItemConfigKind';

/**
 * The generated client currently collapses the one-variant OpenAPI union to
 * WorkItemConfigV1. Keep the service boundary named after the contract so a
 * later config kind can widen this alias without changing task call sites.
 */
export type WorkItemConfig = WorkItemConfigV1;

export const workItemConfigV1Schema = z
  .object({
    kind: z.literal(WorkItemConfigKind.InitialWorktree),
    version: z.literal('v1'),
    initialWorktreeBranch: z.string().min(1).nullable().optional(),
  })
  .strict();

export const workItemConfigSchema = workItemConfigV1Schema;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const formatValidationIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
    .join('; ');

function parseWorkItemConfig(
  value: unknown,
  errorFactory: (message: string) => Error,
): WorkItemConfig | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw errorFactory('Work-item config must be an object or null.');
  }

  if (value.kind !== WorkItemConfigKind.InitialWorktree) {
    throw errorFactory(
      `Unsupported work-item config kind '${String(value.kind)}'.`,
    );
  }
  if (value.version !== 'v1') {
    throw errorFactory(
      `Unsupported work-item config version '${String(value.version)}' for kind '${value.kind}'.`,
    );
  }

  const result = workItemConfigV1Schema.safeParse(value);
  if (!result.success) {
    throw errorFactory(
      `Invalid work-item config: ${formatValidationIssues(result.error)}`,
    );
  }
  return result.data as WorkItemConfig;
}

/** Validate a client-supplied envelope before it is persisted. */
export function validateWorkItemConfig(value: unknown): WorkItemConfig | null {
  return parseWorkItemConfig(
    value,
    (message) => new BadRequestException(message),
  );
}

/**
 * Read a persisted envelope with explicit version handling. Unknown kinds or
 * versions are omitted so a newer config cannot make otherwise readable work
 * items fail; the raw value remains persisted for a future compatible reader.
 * Known kinds and versions still go through strict validation so corruption of
 * the current contract is surfaced as a conflict.
 */
export function readWorkItemConfig(value: unknown): WorkItemConfig | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new ConflictException('Work-item config must be an object or null.');
  }
  if (
    value.kind !== WorkItemConfigKind.InitialWorktree ||
    value.version !== 'v1'
  ) {
    return null;
  }
  return parseWorkItemConfig(
    value,
    (message) => new ConflictException(message),
  );
}

/** Validate both the envelope and the effective type's explicit policy. */
export function validateWorkItemConfigForType(
  value: unknown,
  acceptedConfigKinds: readonly WorkItemConfigKind[],
  taskType: string,
): WorkItemConfig | null {
  const config = validateWorkItemConfig(value);
  if (config && !acceptedConfigKinds.includes(config.kind)) {
    throw new BadRequestException(
      `Work-item type '${taskType}' does not accept config kind '${config.kind}'.`,
    );
  }
  return config;
}
