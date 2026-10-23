import { z } from 'zod/v4';

const jsonValueSchema = z.json();

export type JsonValue = z.infer<typeof jsonValueSchema>;

export interface DurableDataSource {
  readonly paths: readonly string[];
  readonly bytesByPath: ReadonlyMap<string, Uint8Array>;
}

export interface VersionedDataCandidate {
  readonly source: DurableDataSource;
  readonly sourceSchemaVersion: number;
  readonly writerApplicationVersion: string | null;
  readonly payload: JsonValue;
}

export interface VersionedDataFamily<TCurrent> {
  readonly familyId: string;
  readonly currentSchemaVersion: number;
  readonly readSource: () => Promise<DurableDataSource | null>;
  readonly decodeSource: (source: DurableDataSource) => VersionedDataCandidate;
  readonly migrations: ReadonlyMap<number, (payload: JsonValue) => JsonValue>;
  readonly validateCurrent: (payload: JsonValue) => TCurrent;
  readonly promoteAtomically: (candidate: {
    readonly source: DurableDataSource;
    readonly schemaVersion: number;
    readonly writerApplicationVersion: string;
    readonly value: TCurrent;
  }) => Promise<void>;
}

export type CompatibilityDiagnosticReason =
  | 'unsupported_newer_schema'
  | 'missing_migration'
  | 'migration_failed'
  | 'production_codec_rejected'
  | 'promotion_failed';

export class CompatibilityValidationError extends Error {
  public constructor(
    readonly reason: Exclude<CompatibilityDiagnosticReason, 'promotion_failed'>,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CompatibilityValidationError';
  }
}

export interface CompatibilityDiagnostic {
  readonly familyId: string;
  readonly sourcePaths: readonly string[];
  readonly reason: CompatibilityDiagnosticReason;
  readonly readerApplicationVersion: string;
  readonly writerApplicationVersion: string | null;
  readonly sourceSchemaVersion: number;
  readonly currentSchemaVersion: number;
  readonly errorMessage: string | null;
}

export type CompatibilityOpenResult<TCurrent> =
  | { readonly status: 'absent' }
  | {
      readonly status: 'ready';
      readonly migrated: boolean;
      readonly value: TCurrent;
      readonly sourceSchemaVersion: number;
      readonly writerApplicationVersion: string | null;
    }
  | { readonly status: 'incompatible'; readonly diagnostic: CompatibilityDiagnostic };

const errorMessage = (error: object): string =>
  error instanceof Error ? error.message : String(error);

/** Owns migration ordering, production validation, and authority promotion for durable data. */
export class DurableDataCompatibilityReader {
  public constructor(
    private readonly readerApplicationVersion: string,
    private readonly report: (diagnostic: CompatibilityDiagnostic) => void,
  ) {}

  public async open<TCurrent>(
    family: VersionedDataFamily<TCurrent>,
  ): Promise<CompatibilityOpenResult<TCurrent>> {
    const source = await family.readSource();
    if (!source) return { status: 'absent' };

    let decoded: VersionedDataCandidate;
    try {
      decoded = family.decodeSource(source);
    } catch (error) {
      const diagnostic: CompatibilityDiagnostic = {
        familyId: family.familyId,
        sourcePaths: source.paths,
        reason: 'production_codec_rejected',
        readerApplicationVersion: this.readerApplicationVersion,
        writerApplicationVersion: null,
        sourceSchemaVersion: 0,
        currentSchemaVersion: family.currentSchemaVersion,
        errorMessage: errorMessage(error instanceof Object ? error : new Error(String(error))),
      };
      this.report(diagnostic);
      return { status: 'incompatible', diagnostic };
    }

    if (decoded.sourceSchemaVersion > family.currentSchemaVersion) {
      return this.incompatible(family, decoded, 'unsupported_newer_schema');
    }

    let payload = decoded.payload;
    for (
      let version = decoded.sourceSchemaVersion;
      version < family.currentSchemaVersion;
      version += 1
    ) {
      const migrate = family.migrations.get(version);
      if (!migrate) return this.incompatible(family, decoded, 'missing_migration');
      try {
        payload = migrate(payload);
      } catch (error) {
        return this.incompatible(
          family,
          decoded,
          'migration_failed',
          error instanceof Object ? error : new Error(String(error)),
        );
      }
    }

    let value: TCurrent;
    try {
      value = family.validateCurrent(payload);
    } catch (error) {
      return this.incompatible(
        family,
        decoded,
        error instanceof CompatibilityValidationError ? error.reason : 'production_codec_rejected',
        error instanceof Object ? error : new Error(String(error)),
      );
    }

    const migrated = decoded.sourceSchemaVersion !== family.currentSchemaVersion;
    if (migrated) {
      try {
        await family.promoteAtomically({
          source,
          schemaVersion: family.currentSchemaVersion,
          writerApplicationVersion: this.readerApplicationVersion,
          value,
        });
      } catch (error) {
        return this.incompatible(
          family,
          decoded,
          'promotion_failed',
          error instanceof Object ? error : new Error(String(error)),
        );
      }
    }

    return {
      status: 'ready',
      migrated,
      value,
      sourceSchemaVersion: decoded.sourceSchemaVersion,
      writerApplicationVersion: decoded.writerApplicationVersion,
    };
  }

  private incompatible<TCurrent>(
    family: VersionedDataFamily<TCurrent>,
    candidate: VersionedDataCandidate,
    reason: CompatibilityDiagnosticReason,
    error?: object,
  ): CompatibilityOpenResult<TCurrent> {
    const diagnostic: CompatibilityDiagnostic = {
      familyId: family.familyId,
      sourcePaths: candidate.source.paths,
      reason,
      readerApplicationVersion: this.readerApplicationVersion,
      writerApplicationVersion: candidate.writerApplicationVersion,
      sourceSchemaVersion: candidate.sourceSchemaVersion,
      currentSchemaVersion: family.currentSchemaVersion,
      errorMessage: error ? errorMessage(error) : null,
    };
    this.report(diagnostic);
    return { status: 'incompatible', diagnostic };
  }
}
