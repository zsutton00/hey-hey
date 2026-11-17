import { DockerProcessError, type DockerFailureRecord } from './docker-process';
import { z } from 'zod';

const safeCode = z.enum([
  'ENOENT',
  'EACCES',
  'EPERM',
  'ENOSPC',
  'EDQUOT',
  'EIO',
  'EFBIG',
  'EROFS',
  'EMFILE',
  'ENFILE',
  'EEXIST',
  'ENOTDIR',
  'ELOOP',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ABORT_ERR',
  'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
  'PLATFORM_UNAVAILABLE',
  'PERMISSION_DENIED',
  'DEFAULT_COLLECTION_MISSING',
  'STORAGE_LOCKED',
  'STORAGE_FAILURE',
  'CORRUPTED_DATA',
  'SERIALIZATION_ERROR',
  'DOCKER_EXIT',
  'DOCKER_TIMEOUT',
  'DOCKER_UNAVAILABLE',
  'READINESS_TIMEOUT',
  'RELEASE_MISMATCH',
  'INSTALLATION_IDENTITY_MISSING',
  'INVALID_MACHINE_MATERIAL',
  'RATE_LIMITED',
  'NETWORK_ERROR',
  'INVALID_RESPONSE',
  'UNEXPECTED',
  'INVALID_JSON',
  'VALIDATION_FAILED',
]);
/** The closed vocabulary of cause codes; also used to recognise codes in unstructured output. */
export const startupErrorCodes: readonly string[] = safeCode.options;
const errorBoundary = z.object({
  code: safeCode.optional().catch(undefined),
  status: z.number().int().min(100).max(599).optional().catch(undefined),
  statusCode: z.number().int().min(100).max(599).optional().catch(undefined),
  response: z
    .object({ status: z.number().int().min(100).max(599) })
    .optional()
    .catch(undefined),
  exitCode: z.number().int().nullable().optional().catch(undefined),
  signal: z.enum(['SIGTERM', 'SIGKILL', 'SIGINT']).nullable().optional().catch(undefined),
  cause: z.unknown().optional(),
});

export interface SafeStartupCause {
  code: string;
  status?: number;
  exitCode?: number | null;
  signal?: string | null;
  cause?: SafeStartupCause;
  docker?: DockerFailureRecord;
}

/** Error messages, stacks and process output are untrusted content, never diagnostic fields. */
export function safeStartupCause(error: unknown, depth = 0): SafeStartupCause {
  if (error instanceof DockerProcessError) {
    return {
      code: error.code,
      exitCode: error.diagnostic.exitCode,
      signal: error.diagnostic.signal,
      docker: error.diagnostic,
    };
  }
  const processExit = z
    .object({
      code: z.number().int(),
      signal: z.enum(['SIGTERM', 'SIGKILL', 'SIGINT']).nullable().optional(),
    })
    .safeParse(error);
  if (processExit.success) {
    return {
      code: 'PROCESS_EXIT',
      exitCode: processExit.data.code,
      ...(processExit.data.signal !== undefined ? { signal: processExit.data.signal } : {}),
    };
  }
  const parsed = errorBoundary.safeParse(error);
  if (!parsed.success) {
    return { code: 'UNCLASSIFIED_FAILURE' };
  }
  const { code, exitCode, signal, cause } = parsed.data;
  const status = parsed.data.status ?? parsed.data.statusCode ?? parsed.data.response?.status;
  return {
    code:
      code ??
      (status
        ? 'HTTP_FAILURE'
        : error instanceof SyntaxError
          ? 'INVALID_JSON'
          : error instanceof Error && error.name === 'ZodError'
            ? 'VALIDATION_FAILED'
            : 'UNCLASSIFIED_FAILURE'),
    ...(status !== undefined ? { status } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(signal !== undefined ? { signal } : {}),
    ...(cause !== undefined
      ? {
          cause: depth < 4 ? safeStartupCause(cause, depth + 1) : { code: 'CAUSE_CHAIN_TRUNCATED' },
        }
      : {}),
  };
}

export const startupStages = [
  'Checking local installation',
  'Checking graph/search model files',
  'Updating the web app address and bridge port',
  'Checking application readiness',
  'Preparing protected local storage',
  'Stopping application for the matching release update',
  'Downloading matching application images',
  'Starting PostgreSQL and Redis',
  'Provisioning separate application databases',
  'Migrating the application database',
  'Starting application services',
] as const;

const applicationState = z.enum([
  'update',
  'update-restart',
  'installation',
  'prerequisite',
  'progress',
  'recovery',
  'ready',
  'stop',
  'stopped',
  'exited',
  'cancelled',
  'docker-repair',
]);
const service = z.enum(['api', 'ui', 'postgres', 'redis', 'graph-search', 'api,ui']);
const schemas: Record<string, z.ZodType<Record<string, unknown>>> = {
  'local.application.state': z.object({
    state: applicationState,
    action: z.enum(startupStages).optional().catch(undefined),
  }),
  'local.application.failure': z.object({
    operation: z.enum(['startup', 'stop', 'update', 'inspect']),
    action: z.enum(startupStages).optional().catch(undefined),
    error: z.unknown(),
  }),
  'local.docker.inspection_failed': z.object({ error: z.unknown() }),
  'local.docker.repair_failed': z.object({ error: z.unknown() }),
  'local.docker.prerequisite': z.object({ reasonCode: z.enum(['missing', 'stopped', 'compose']) }),
  'local.docker.command': z.object({
    operation: z.enum(['--version', 'info', 'compose', 'ps', 'inspect', 'volume']),
  }),
  'local.docker.command_failed': z.object({
    operation: z.enum(['--version', 'info', 'compose', 'ps', 'inspect', 'volume']),
    error: z.unknown(),
  }),
  'local.docker.service_start_failed': z.object({ service, error: z.unknown() }),
  'local.docker.service_restart_failed': z.object({ service, error: z.unknown() }),
  'local.docker.readiness.waiting': z.object({
    attempt: z.number().int().nonnegative(),
    observations: z
      .array(
        z.object({
          service,
          present: z.boolean(),
          running: z.boolean(),
          status: z
            .enum([
              'created',
              'running',
              'paused',
              'restarting',
              'removing',
              'exited',
              'dead',
              'absent',
              'unknown',
            ])
            .catch('unknown'),
          health: z.enum(['starting', 'healthy', 'unhealthy', 'unknown']).catch('unknown'),
        }),
      )
      .max(5),
  }),
  'local.docker.signing_keys_unavailable': z.object({
    status: z.number().int().min(100).max(599).optional(),
    error: z.unknown().optional(),
  }),
  'local.credential.operation_failed': z.object({
    operation: z.enum(['store', 'retrieve', 'delete']),
    error: z.unknown(),
  }),
  'local.pairing.failure': z.object({ error: z.unknown() }),
  'local.protected_storage': z.object({
    outcome: z.enum(['checking', 'ready', 'failed']),
    error: z.unknown().optional(),
  }),
  'local.pairing.step': z.object({
    state: z.enum([
      'browser-handoff',
      'waiting-for-browser',
      'local-review',
      'activating',
      'problem',
      'finished',
    ]),
    outcome: z
      .enum(['confirmed', 'declined', 'expired', 'terminal', 'cancelled', 'failed'])
      .optional(),
  }),
  'local.pairing.readiness': z.object({
    state: z
      .enum([
        'ready',
        'unpaired',
        'machine-unrecognized',
        'legacy-controller-enrollment-required',
        'enrollment-pending',
        'no-controller',
        'machine-revoked',
        'locally-inconsistent',
      ])
      .catch('locally-inconsistent'),
  }),
  'local.browser.open': z.object({
    outcome: z.enum(['requested', 'opened', 'failed']),
    error: z.unknown().optional(),
  }),
  'local.repair': z.object({
    state: z.enum(['requested', 'approved', 'declined', 'completed', 'dismissed', 'failed']),
    error: z.unknown().optional(),
  }),
  'local.model.present': z.object({ file: z.enum(['model_quantized.onnx', 'tokenizer.json']) }),
  'local.model.download_started': z.object({
    file: z.enum(['model_quantized.onnx', 'tokenizer.json']),
  }),
  'local.model.download_finished': z.object({
    file: z.enum(['model_quantized.onnx', 'tokenizer.json']),
    bytes: z.number().nonnegative(),
  }),
  'local.model.download_failed': z.object({
    file: z.enum(['model_quantized.onnx', 'tokenizer.json']),
    error: z.unknown(),
  }),
  'local.installation.secrets_unreadable': z.object({ error: z.unknown() }),
  'local.release.selected': z.object({
    cliVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/u),
  }),
  'local.release_source.manifest_unreadable': z.object({ error: z.unknown() }),
  'local.release.optional_check_unavailable': z.object({ error: z.unknown() }),
  'local.release.update_work_unavailable': z.object({ error: z.unknown() }),
};

export function selectStartupFields(
  event: string,
  fields: unknown,
): Record<string, unknown> | null {
  const schema = schemas[event];
  if (!schema) {
    return null;
  }
  const parsed = schema.safeParse(fields);
  if (!parsed.success) {
    return null;
  }
  const selected = { ...parsed.data };
  if ('error' in selected) {
    selected['error'] = safeStartupCause(selected['error']);
  }
  return selected;
}
