import type {
  AgenticSession,
  AgenticSessionEvent,
  AppendAgenticEventInput,
  CreateAgenticSessionInput,
} from '../session/types';
import type { CompatibilityDiagnostic } from '../durable-data';
import type { RunFamilyCompatibilityDiagnostic } from './run-family';
export interface RunStorePaths {
  baseDir: string;
  runsDir: string;
  indexPath: string;
  preferencesPath: string;
}

export interface RunStoreOptions {
  paths?: RunStorePaths;
  now?: () => Date;
  randomId?: () => string;
  readerApplicationVersion?: string;
  onCompatibilityDiagnostic?: (diagnostic: RunFamilyCompatibilityDiagnostic) => void;
  /** Reports persisted records omitted from collection reads. */
  onInvalidRunMetadata?: (input: { runId: string; error: Error }) => void;
  /** Reports a derived index repaired from the persisted Run metadata. */
  onIndexReconciled?: (input: { runCount: number }) => void;
  /** Reports bounded startup progress without exposing persisted payload contents. */
  onInitializationProgress?: (progress: RunStoreInitializationProgress) => void;
  /** Reports every whole-file read of a Run's current event log. */
  onEventLogRead?: (read: RunEventLogRead) => void;
}

export type RunEventLogReadOperation = 'read_events' | 'read_provider_identity_events';

/** One whole-file event log read; carries sizes only, never event contents. */
export interface RunEventLogRead {
  readonly runId: string;
  readonly operation: RunEventLogReadOperation;
  readonly byteCount: number;
  readonly elapsedMs: number;
}

type RunStoreInitializationOperation =
  | 'run_family_scan'
  | 'run_family'
  | 'manifest_read'
  | 'source_read'
  | 'production_validation'
  | 'generation_promotion'
  | 'generation_member_promotion'
  | 'index_reconciliation';

type RunStoreInitializationStatus = 'started' | 'completed' | 'incompatible';

export interface RunStoreInitializationProgress {
  readonly operation: RunStoreInitializationOperation;
  readonly status: RunStoreInitializationStatus;
  readonly elapsedMs: number;
  readonly runId?: string;
  readonly familyIndex?: number;
  readonly familyCount?: number;
  readonly sourceKind?: 'legacy' | 'manifest';
  readonly sourcePathCount?: number;
  readonly sourceByteCount?: number;
  /** Manifest file await, separate from JSON and schema validation (`parseMs`). */
  readonly fileReadMs?: number;
  readonly parseMs?: number;
  readonly member?: import('./run-files').RunFamilyMember;
  readonly targetPath?: string;
  readonly migrated?: boolean;
  /** True when any conversion of this source is discarded rather than saved. */
  readonly readOnly?: boolean;
  readonly compatibleRunCount?: number;
}

export interface RunIndex {
  version: 1;
  byAgentSessionId: Record<string, string>;
  byProviderSessionId: Record<string, string>;
  byCanonicalRunId: Record<string, string>;
  byPromptType: Record<string, string[]>;
  byConversationId: Record<string, string>;
}

export interface RunInitResult {
  migrated: boolean;
}

export type RunFamilyMigrationStatus = 'migrated' | 'current' | 'absent' | 'incompatible';

export interface RunFamilyMigrationEntry {
  readonly runId: string;
  readonly status: RunFamilyMigrationStatus;
  readonly diagnostic?: CompatibilityDiagnostic;
}

export interface RunFamilyMigrationOptions {
  /** Validate only when false; promote validated candidates when true. */
  readonly promote?: boolean;
}

export interface RunFamilyMigrationResult {
  readonly scannedRunCount: number;
  readonly migratedRunCount: number;
  readonly currentRunCount: number;
  readonly absentRunCount: number;
  readonly incompatibleRunCount: number;
  readonly entries: readonly RunFamilyMigrationEntry[];
}

export interface PersistedRunFileChangeFactsV1 {
  version: 1;
  facts: import('../run/file-change-facts').CanonicalFileChangeFact[];
}
