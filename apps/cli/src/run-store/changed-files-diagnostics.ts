import { z } from 'zod';

const diagnosticPathSchema = z.object({
  serviceId: z.string(),
  repoRelativePath: z.string(),
});

const diagnosticResultPathSchema = z.object({
  serviceId: z.string(),
  repoPath: z.string(),
  filePath: z.string(),
});

const diagnosticWorktreeSchema = z.object({
  serviceId: z.string(),
  configuredPath: z.string(),
  worktreePath: z.string().nullable(),
  repositoryPath: z.string().nullable(),
  branch: z.string().nullable(),
});

const runChangedFilesDiagnosticEntrySchema = z.object({
  recordedAt: z.string(),
  requestId: z.string(),
  operation: z.enum([
    'run.changed_files.count',
    'run.changed_files.inventory',
    'run.changed_files.detail',
  ]),
  requestAgentSessionId: z.string(),
  runId: z.string(),
  signedContext: z.object({
    organizationId: z.string().nullable(),
    projectId: z.string().nullable(),
    conversationId: z.string().nullable(),
  }),
  runContext: z.object({
    organizationId: z.string(),
    projectId: z.string(),
    conversationId: z.string(),
    provider: z.enum(['claude', 'codex', 'opencode']),
    providerSessionId: z.string().nullable(),
  }),
  membership: z.object({
    persistedFactCount: z.number().int().nonnegative().nullable(),
    projectionCount: z.number().int().nonnegative(),
    paths: z.array(diagnosticPathSchema),
    providerSessionIds: z.array(z.string()),
    turnIds: z.array(z.string()),
    diagnosticReadError: z.string().nullable(),
  }),
  workspace: z.object({
    launchServiceId: z.string().nullable(),
    workspaceRoot: z.string().nullable(),
    allowedRepositoryRoots: z.array(z.string()),
    services: z.array(diagnosticWorktreeSchema),
  }),
  result: z.object({
    changedFilesCount: z.number().int().nonnegative(),
    files: z.array(diagnosticResultPathSchema),
  }),
});

const persistedRunChangedFilesDiagnosticsSchema = z.object({
  version: z.literal(1),
  entries: z.array(runChangedFilesDiagnosticEntrySchema),
});

const legacyPersistedRunChangedFilesDiagnosticsSchema = z.object({
  version: z.literal(1),
  entries: z.array(
    z
      .object({
        operation: z.string(),
      })
      .passthrough(),
  ),
});

export type RunChangedFilesDiagnosticEntry = z.infer<typeof runChangedFilesDiagnosticEntrySchema>;

export interface PersistedRunChangedFilesDiagnosticsV1 {
  version: 1;
  entries: RunChangedFilesDiagnosticEntry[];
}

export const hasLegacyRunChangedFilesDiffDiagnostics = (value: unknown): boolean => {
  const parsed = legacyPersistedRunChangedFilesDiagnosticsSchema.safeParse(value);
  return (
    parsed.success &&
    parsed.data.entries.some((entry) => entry.operation === 'run.changed_files.diff')
  );
};

/** Maps the retired multi-file diff read to its current multi-file inventory equivalent. */
export const migratePersistedRunChangedFilesDiagnostics = (
  value: unknown,
): PersistedRunChangedFilesDiagnosticsV1 => {
  const parsed = legacyPersistedRunChangedFilesDiagnosticsSchema.parse(value);
  return persistedRunChangedFilesDiagnosticsSchema.parse({
    version: parsed.version,
    entries: parsed.entries.map((entry) =>
      entry.operation === 'run.changed_files.diff'
        ? { ...entry, operation: 'run.changed_files.inventory' }
        : entry,
    ),
  });
};

export const parsePersistedRunChangedFilesDiagnostics = (
  value: unknown,
): RunChangedFilesDiagnosticEntry[] =>
  persistedRunChangedFilesDiagnosticsSchema.parse(value).entries;
