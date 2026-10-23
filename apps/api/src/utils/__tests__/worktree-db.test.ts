import {
  ensureDatabase,
  filterSchemaCreationFromRestoreList,
  markDatabasePreparationComplete,
  prepareDatabase,
  WorktreeDatabaseOperations,
} from '../../../scripts/worktree-db';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorktreeContext } from '../worktree-context';

const packageScripts = JSON.parse(
  readFileSync(join(__dirname, '../../../package.json'), 'utf8'),
).scripts as Record<string, string>;
const flywayScript = readFileSync(
  join(__dirname, '../../../scripts/flyway.sh'),
  'utf8',
);

const linkedContext: WorktreeContext = {
  repositoryRoot: '/repos/api/.worktrees/feature-a',
  mainRepositoryRoot: '/repos/api',
  repositoriesRoot: '/repos',
  isLinkedWorktree: true,
  workspaceId: 'feature-a',
  expectedDatabaseName: 'hey_hey_wt_feature_a_12345678',
};

const mainDatabaseUrl =
  'postgresql://user:pass@localhost:5432/main?schema=public';

interface FakeDatabase {
  exists: boolean;
  initialized?: boolean;
  rows: string[];
  schemaVersion: number;
}

type FakeOperations = Omit<
  WorktreeDatabaseOperations,
  'runPsql' | 'cloneDatabase'
> & {
  runPsql: jest.Mock;
  cloneDatabase: jest.Mock;
  clone: jest.Mock;
};

const createFakeOperations = (
  database: FakeDatabase,
  options: { cloneError?: Error } = {},
): FakeOperations => {
  const clone = jest.fn((sourceUrl: string, destinationUrl: string) => {
    expect(sourceUrl).toBe('postgresql://user:pass@localhost:5432/main');
    expect(destinationUrl).toBe(
      'postgresql://user:pass@localhost:5432/hey_hey_wt_feature_a_12345678',
    );
    if (options.cloneError) {
      throw options.cloneError;
    }
    database.rows = ['copied-main-row'];
    database.schemaVersion = 1;
  });

  const runPsql = jest.fn((databaseUrl: string, sql: string): string => {
    if (sql.startsWith('SELECT 1 FROM pg_database')) {
      return database.exists ? '1' : '';
    }
    if (sql.startsWith('SELECT COALESCE(shobj_description')) {
      return database.initialized
        ? `hey-hey-worktree-initialized:${linkedContext.expectedDatabaseName}`
        : '';
    }
    if (sql === 'SELECT current_database();') {
      if (databaseUrl.endsWith('/main')) {
        return 'main';
      }
      return linkedContext.expectedDatabaseName!;
    }
    if (sql.startsWith('CREATE DATABASE')) {
      database.exists = true;
      database.initialized = false;
      return '';
    }
    if (sql.startsWith('COMMENT ON DATABASE')) {
      database.initialized = true;
      return '';
    }
    if (sql.startsWith('DROP DATABASE')) {
      database.exists = false;
      database.initialized = false;
      database.rows = [];
      database.schemaVersion = 0;
      return '';
    }
    return '';
  });

  return { runPsql, cloneDatabase: clone, clone };
};

describe('worktree database initialization', () => {
  it('removes only the selected schema creation entry from a restore list', () => {
    const restoreList = [
      '; Archive created at 2026-08-18',
      '12; 2615 852319 SCHEMA - public zac',
      '13; 2615 852320 SCHEMA - audit zac',
      '100; 1259 852321 TABLE public projects zac',
      '',
    ].join('\n');

    expect(filterSchemaCreationFromRestoreList(restoreList, 'public')).toBe(
      [
        '; Archive created at 2026-08-18',
        '13; 2615 852320 SCHEMA - audit zac',
        '100; 1259 852321 TABLE public projects zac',
        '',
      ].join('\n'),
    );
  });

  it('exposes one idempotent preparation command that runs Flyway migration', () => {
    expect(packageScripts['db:worktree:prepare']).toBe(
      'node -r ts-node/register/transpile-only scripts/worktree-db.ts prepare',
    );
    expect(packageScripts['db:flyway:migrate']).toBe(
      'bash scripts/worktree-flyway.sh migrate',
    );
  });

  it('ignores source-applied migrations missing from linked worktrees only', () => {
    expect(flywayScript).toContain('IS_LINKED_WORKTREE=false');
    expect(flywayScript).toContain('IS_LINKED_WORKTREE=true');
    expect(flywayScript).toContain('if [[ "$IS_LINKED_WORKTREE" == "true" ]]');
    expect(flywayScript).toContain('IGNORE_MIGRATION_PATTERNS="*:missing"');
    expect(flywayScript).toContain(
      'COMMON_ARGS+=("-ignoreMigrationPatterns=${IGNORE_MIGRATION_PATTERNS}")',
    );
  });

  it('refuses to prepare from the main checkout', async () => {
    await expect(
      prepareDatabase({ ...linkedContext, isLinkedWorktree: false }),
    ).rejects.toThrow('refusing to migrate the main checkout database');
  });

  it('durably marks a database after successful preparation', () => {
    const database: FakeDatabase = {
      exists: true,
      initialized: false,
      rows: [],
      schemaVersion: 1,
    };
    const operations = createFakeOperations(database);

    markDatabasePreparationComplete(
      linkedContext,
      { PROJECT_DATABASE_URL: mainDatabaseUrl },
      operations.runPsql,
    );

    expect(database.initialized).toBe(true);
  });

  it('copies main data only on first creation and leaves branch migrations to Flyway', () => {
    const database: FakeDatabase = {
      exists: false,
      rows: [],
      schemaVersion: 0,
    };
    const operations = createFakeOperations(database);

    const firstResult = ensureDatabase(
      linkedContext,
      { PROJECT_DATABASE_URL: mainDatabaseUrl },
      operations,
    );

    expect(firstResult).toEqual({
      created: true,
      databaseName: linkedContext.expectedDatabaseName,
    });
    expect(database.rows).toEqual(['copied-main-row']);
    expect(operations.clone).toHaveBeenCalledTimes(1);
    expect(operations.clone).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'public',
    );

    // This represents the normal command ordering: worktree preparation first,
    // then the branch's Flyway migrations against the derived destination.
    database.schemaVersion = 2;
    expect(database.schemaVersion).toBe(2);

    database.rows.push('worktree-only-row');
    const secondResult = ensureDatabase(
      linkedContext,
      { PROJECT_DATABASE_URL: mainDatabaseUrl },
      operations,
    );

    expect(secondResult).toEqual({
      created: false,
      databaseName: linkedContext.expectedDatabaseName,
    });
    expect(database.rows).toEqual(['copied-main-row', 'worktree-only-row']);
    expect(database.schemaVersion).toBe(2);
    expect(operations.clone).toHaveBeenCalledTimes(1);
  });

  it('clones only the explicitly selected PostgreSQL schema', () => {
    const database: FakeDatabase = {
      exists: false,
      rows: [],
      schemaVersion: 0,
    };
    const operations = createFakeOperations(database);

    ensureDatabase(
      linkedContext,
      {
        PROJECT_DATABASE_URL: mainDatabaseUrl,
        HEY_HEY_WORKTREE_CLONE_SCHEMA: 'project',
      },
      operations,
    );

    expect(operations.clone).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'project',
    );
  });

  it('does not clone an existing database even when the source is unavailable', () => {
    const database: FakeDatabase = {
      exists: true,
      initialized: true,
      rows: ['worktree-data'],
      schemaVersion: 7,
    };
    const operations = createFakeOperations(database);
    operations.runPsql.mockImplementation(
      (_databaseUrl: string, sql: string) => {
        if (sql.startsWith('SELECT 1 FROM pg_database')) {
          return '1';
        }
        if (sql.startsWith('SELECT COALESCE(shobj_description')) {
          return `hey-hey-worktree-initialized:${linkedContext.expectedDatabaseName}`;
        }
        throw new Error('source is unavailable');
      },
    );

    const result = ensureDatabase(
      linkedContext,
      { PROJECT_DATABASE_URL: mainDatabaseUrl },
      operations,
    );

    expect(result.created).toBe(false);
    expect(database.rows).toEqual(['worktree-data']);
    expect(operations.clone).not.toHaveBeenCalled();
  });

  it('refuses to reuse an existing database without a completed initialization marker', () => {
    const database: FakeDatabase = {
      exists: true,
      initialized: false,
      rows: ['possibly-partial-data'],
      schemaVersion: 1,
    };
    const operations = createFakeOperations(database);

    expect(() =>
      ensureDatabase(
        linkedContext,
        { PROJECT_DATABASE_URL: mainDatabaseUrl },
        operations,
      ),
    ).toThrow('exists without a completed initialization marker');
    expect(database.rows).toEqual(['possibly-partial-data']);
    expect(operations.clone).not.toHaveBeenCalled();
  });

  it('rejects source and destination confusion before database operations', () => {
    const operations = createFakeOperations({
      exists: false,
      rows: [],
      schemaVersion: 0,
    });

    expect(() =>
      ensureDatabase(
        { ...linkedContext, expectedDatabaseName: 'main' },
        { PROJECT_DATABASE_URL: mainDatabaseUrl },
        operations,
      ),
    ).toThrow(
      'source local development database resolves to the same database',
    );
    expect(operations.runPsql).not.toHaveBeenCalled();
    expect(operations.clone).not.toHaveBeenCalled();
  });

  it('does not restore or drop a destination that appears during creation', () => {
    const database: FakeDatabase = {
      exists: false,
      rows: ['concurrent-data'],
      schemaVersion: 4,
    };
    const operations = createFakeOperations(database);
    operations.runPsql.mockImplementation(
      (databaseUrl: string, sql: string): string => {
        if (sql.startsWith('SELECT 1 FROM pg_database')) {
          return database.exists ? '1' : '';
        }
        if (sql === 'SELECT current_database();') {
          return databaseUrl.endsWith('/main')
            ? 'main'
            : linkedContext.expectedDatabaseName!;
        }
        if (sql.startsWith('CREATE DATABASE')) {
          database.exists = true;
          throw new Error('database already exists');
        }
        return '';
      },
    );

    expect(() =>
      ensureDatabase(
        linkedContext,
        { PROJECT_DATABASE_URL: mainDatabaseUrl },
        operations,
      ),
    ).toThrow('it appeared during preparation; no data was copied');
    expect(database.rows).toEqual(['concurrent-data']);
    expect(database.schemaVersion).toBe(4);
    expect(operations.clone).not.toHaveBeenCalled();
    expect(operations.runPsql).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('DROP DATABASE'),
    );
  });

  it('keeps the main checkout path unchanged', () => {
    const operations = createFakeOperations({
      exists: false,
      rows: [],
      schemaVersion: 0,
    });

    expect(
      ensureDatabase(
        { ...linkedContext, isLinkedWorktree: false },
        {},
        operations,
      ),
    ).toEqual({ created: false, databaseName: null });
    expect(operations.runPsql).not.toHaveBeenCalled();
    expect(operations.clone).not.toHaveBeenCalled();
  });

  it('drops a partially initialized database when cloning fails', () => {
    const database: FakeDatabase = {
      exists: false,
      rows: [],
      schemaVersion: 0,
    };
    const operations = createFakeOperations(database, {
      cloneError: new Error('dump restore failed'),
    });

    expect(() =>
      ensureDatabase(
        linkedContext,
        { PROJECT_DATABASE_URL: mainDatabaseUrl },
        operations,
      ),
    ).toThrow('The partially initialized database was dropped');
    expect(database.exists).toBe(false);
    expect(database.rows).toEqual([]);
    expect(operations.clone).toHaveBeenCalledTimes(1);
    expect(operations.runPsql).toHaveBeenCalledWith(
      expect.stringContaining('/postgres'),
      expect.stringContaining('DROP DATABASE'),
    );
  });

  it('reports an unavailable source without creating a destination', () => {
    const database: FakeDatabase = {
      exists: false,
      rows: [],
      schemaVersion: 0,
    };
    const operations = createFakeOperations(database);
    let sourceCheck = true;
    operations.runPsql.mockImplementation(
      (_databaseUrl: string, sql: string) => {
        if (sql.startsWith('SELECT 1 FROM pg_database')) {
          return '';
        }
        if (sourceCheck && sql === 'SELECT current_database();') {
          sourceCheck = false;
          throw new Error('connection refused');
        }
        return '';
      },
    );

    expect(() =>
      ensureDatabase(
        linkedContext,
        { PROJECT_DATABASE_URL: mainDatabaseUrl },
        operations,
      ),
    ).toThrow('Unable to clone source local development database "main"');
    expect(database.exists).toBe(false);
    expect(operations.clone).not.toHaveBeenCalled();
  });
});
