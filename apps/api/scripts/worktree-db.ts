#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseEnv } from 'node:util';
import {
  WorktreeContext,
  resolveSiblingRepository,
  resolveWorktreeContext,
} from '../src/utils/worktree-context';
import {
  assertSafeWorktreeDatabaseDrop,
  assertSafeWorktreeDatabaseTarget,
  assertLoopbackDatabaseHost,
  createMaintenanceDatabaseUrl,
  createWorktreeDatabaseEnvironment,
  databaseNameFromUrl,
  replaceDatabaseName,
} from '../src/utils/worktree-database';

type DatabaseState = 'exists' | 'missing' | 'not_applicable';
type DatabaseInitializationState =
  | 'completed'
  | 'missing'
  | 'not_applicable'
  | 'unmarked';

const INITIALIZED_DATABASE_ENVIRONMENT_VARIABLE =
  'HEY_HEY_WORKTREE_DATABASE_INITIALIZED';
const INITIALIZATION_MARKER_PREFIX = 'hey-hey-worktree-initialized:';

export interface WorktreeDatabaseEnsureResult {
  created: boolean;
  databaseName: string | null;
}

export interface PsqlOptions {
  capture?: boolean;
}

export interface WorktreeDatabaseOperations {
  runPsql: (databaseUrl: string, sql: string, options?: PsqlOptions) => string;
  cloneDatabase: (
    sourceUrl: string,
    destinationUrl: string,
    schemaName: string,
  ) => void;
}

const loadEnvironmentFiles = (context: WorktreeContext): void => {
  const originalKeys = new Set(Object.keys(process.env));
  const roots = context.isLinkedWorktree
    ? [context.mainRepositoryRoot, context.repositoryRoot]
    : [context.repositoryRoot];
  const loaded: Record<string, string> = {};

  for (const root of roots) {
    for (const filename of ['.env', '.env.local']) {
      const envPath = join(root, filename);
      if (existsSync(envPath)) {
        Object.assign(loaded, parseEnv(readFileSync(envPath, 'utf8')));
      }
    }
  }

  for (const [key, value] of Object.entries(loaded)) {
    if (!originalKeys.has(key)) {
      process.env[key] = value;
    }
  }
};

const baseProjectDatabaseUrl = (
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  const value = environment.PROJECT_DATABASE_URL || environment.DATABASE_URL;
  if (!value) {
    throw new Error(
      'PROJECT_DATABASE_URL (or DATABASE_URL) is required as the local PostgreSQL connection template.',
    );
  }
  return value;
};

const runPsql = (
  databaseUrl: string,
  sql: string,
  options: PsqlOptions = {},
): string => {
  const result = spawnSync(
    'psql',
    [databaseUrl, '-X', '-w', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', sql],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || '5',
      },
      stdio: options.capture
        ? ['ignore', 'pipe', 'pipe']
        : ['inherit', 'inherit', 'inherit'],
    },
  );

  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'psql is required for worktree database safety checks. Install the PostgreSQL client and retry.',
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = options.capture ? result.stderr.trim() : '';
    throw new Error(
      `PostgreSQL safety check failed${detail ? `: ${detail}` : '.'}`,
    );
  }
  return result.stdout?.trim() || '';
};

const quoteSqlIdentifier = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`;

const quoteSqlLiteral = (value: string): string =>
  `'${value.replaceAll("'", "''")}'`;

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return JSON.stringify(error) ?? 'Unknown error';
};

export const filterSchemaCreationFromRestoreList = (
  restoreList: string,
  schemaName: string,
): string => {
  const schemaToken = schemaName.replaceAll(/([\\.^$|?*+()[\]{}])/gu, '\\$1');
  const schemaEntry = new RegExp(
    `^\\d+;\\s+\\d+\\s+\\d+\\s+SCHEMA\\s+-\\s+${schemaToken}(?:\\s|$)`,
    'u',
  );
  return restoreList
    .split('\n')
    .filter((line) => !schemaEntry.test(line))
    .join('\n');
};

const withInitializationLock = <T>(
  databaseName: string,
  operation: () => T,
): T => {
  const lockKey = createHash('sha256')
    .update(databaseName)
    .digest('hex')
    .slice(0, 16);
  const lockPath = join(tmpdir(), `hey-hey-worktree-db-${lockKey}.lock`);

  const acquire = (): void => {
    try {
      mkdirSync(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      let owner = 'unknown';
      try {
        owner = readFileSync(join(lockPath, 'pid'), 'utf8').trim() || owner;
      } catch {
        // A creator may still be writing the owner file; treat the lock as active.
      }
      const ownerPid = Number(owner);
      if (Number.isInteger(ownerPid) && ownerPid > 0) {
        try {
          process.kill(ownerPid, 0);
        } catch (ownerError) {
          if ((ownerError as NodeJS.ErrnoException).code === 'ESRCH') {
            rmSync(lockPath, { recursive: true, force: true });
            mkdirSync(lockPath);
            writeFileSync(join(lockPath, 'pid'), `${process.pid}\n`, {
              mode: 0o600,
            });
            return;
          }
        }
      }
      throw new Error(
        `Worktree database initialization is already running for ${JSON.stringify(databaseName)} (PID ${owner}).`,
      );
    }
    writeFileSync(join(lockPath, 'pid'), `${process.pid}\n`, { mode: 0o600 });
  };

  acquire();
  try {
    return operation();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
};

const initializationMarker = (databaseName: string): string =>
  `${INITIALIZATION_MARKER_PREFIX}${databaseName}`;

const readInitializationMarker = (
  maintenanceUrl: string,
  databaseName: string,
  psql: WorktreeDatabaseOperations['runPsql'],
): string =>
  psql(
    maintenanceUrl,
    `SELECT COALESCE(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = ${quoteSqlLiteral(databaseName)};`,
    { capture: true },
  );

const markDatabaseInitialized = (
  maintenanceUrl: string,
  databaseName: string,
  psql: WorktreeDatabaseOperations['runPsql'],
): void => {
  psql(
    maintenanceUrl,
    `COMMENT ON DATABASE ${quoteSqlIdentifier(databaseName)} IS ${quoteSqlLiteral(initializationMarker(databaseName))};`,
  );
};

export const markDatabasePreparationComplete = (
  context: WorktreeContext,
  environment: NodeJS.ProcessEnv = process.env,
  psql: WorktreeDatabaseOperations['runPsql'] = runPsql,
): void => {
  if (!context.isLinkedWorktree || !context.expectedDatabaseName) {
    throw new Error(
      'Only a linked worktree database can be marked as prepared.',
    );
  }
  const maintenanceUrl = createMaintenanceDatabaseUrl(
    baseProjectDatabaseUrl(environment),
  );
  markDatabaseInitialized(maintenanceUrl, context.expectedDatabaseName, psql);
};

const databaseState = (
  context: WorktreeContext,
  environment: NodeJS.ProcessEnv = process.env,
  psql = runPsql,
): DatabaseState => {
  if (!context.isLinkedWorktree) {
    return 'not_applicable';
  }
  const expectedDatabaseName = context.expectedDatabaseName;
  if (!expectedDatabaseName) {
    throw new Error('Linked worktree has no expected database name.');
  }

  const maintenanceUrl = createMaintenanceDatabaseUrl(
    baseProjectDatabaseUrl(environment),
  );
  const result = psql(
    maintenanceUrl,
    `SELECT 1 FROM pg_database WHERE datname = ${quoteSqlLiteral(expectedDatabaseName)};`,
    { capture: true },
  );
  return result === '1' ? 'exists' : 'missing';
};

const databaseInitializationState = (
  context: WorktreeContext,
  environment: NodeJS.ProcessEnv = process.env,
  psql = runPsql,
): DatabaseInitializationState => {
  const state = databaseState(context, environment, psql);
  if (state !== 'exists') {
    return state;
  }

  const databaseName = context.expectedDatabaseName!;
  const maintenanceUrl = createMaintenanceDatabaseUrl(
    baseProjectDatabaseUrl(environment),
  );
  return readInitializationMarker(maintenanceUrl, databaseName, psql) ===
    initializationMarker(databaseName)
    ? 'completed'
    : 'unmarked';
};

const runPostgresTool = (
  tool: 'pg_dump' | 'pg_restore',
  args: string[],
): void => {
  const result = spawnSync(tool, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || '5',
    },
    stdio: 'inherit',
  });

  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'pg_dump and pg_restore are required to initialize a worktree database. Install the PostgreSQL client tools and retry.',
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${tool} failed${result.status === null ? ' after being terminated' : ` with exit code ${result.status}`}.`,
    );
  }
};

const dumpAndRestoreDatabase = (
  sourceUrl: string,
  destinationUrl: string,
  schemaName: string,
): void => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'hey-hey-worktree-db-'),
  );
  const dumpPath = join(temporaryDirectory, 'source.dump');
  const restoreListPath = join(temporaryDirectory, 'restore.list');

  try {
    console.log(
      `Dumping source database ${databaseNameFromUrl(sourceUrl)} to a transactionally consistent snapshot...`,
    );
    runPostgresTool('pg_dump', [
      '--format=custom',
      '--verbose',
      '--no-password',
      '--no-owner',
      '--no-privileges',
      `--schema=${schemaName}`,
      `--file=${dumpPath}`,
      `--dbname=${sourceUrl}`,
    ]);

    const listResult = spawnSync('pg_restore', ['--list', dumpPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || '5',
      },
    });
    if (listResult.error) {
      throw listResult.error;
    }
    if (listResult.status !== 0) {
      throw new Error(`pg_restore could not inspect the worktree dump.`);
    }
    writeFileSync(
      restoreListPath,
      filterSchemaCreationFromRestoreList(listResult.stdout, schemaName),
    );

    const extensionRows = runPsql(
      sourceUrl,
      `SELECT e.extname || E'\\t' || n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname <> 'plpgsql' ORDER BY e.extname;`,
      { capture: true },
    );
    for (const row of extensionRows.split('\n').filter(Boolean)) {
      const [extensionName, extensionSchema] = row.split('\t');
      if (!extensionName || !extensionSchema) {
        throw new Error(`Unexpected PostgreSQL extension metadata: ${row}`);
      }
      runPsql(
        destinationUrl,
        `CREATE SCHEMA IF NOT EXISTS ${quoteSqlIdentifier(extensionSchema)}; CREATE EXTENSION IF NOT EXISTS ${quoteSqlIdentifier(extensionName)} WITH SCHEMA ${quoteSqlIdentifier(extensionSchema)};`,
      );
    }

    console.log(
      `Restoring snapshot into worktree database ${databaseNameFromUrl(destinationUrl)}...`,
    );
    runPostgresTool('pg_restore', [
      '--verbose',
      '--no-password',
      '--no-owner',
      '--no-privileges',
      `--use-list=${restoreListPath}`,
      `--dbname=${destinationUrl}`,
      dumpPath,
    ]);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

const defaultOperations: WorktreeDatabaseOperations = {
  runPsql,
  cloneDatabase: dumpAndRestoreDatabase,
};

const verifySourceDatabase = (
  sourceUrl: string,
  sourceDatabaseName: string,
  psql: WorktreeDatabaseOperations['runPsql'],
): void => {
  const sourceConnectionUrl = replaceDatabaseName(
    sourceUrl,
    sourceDatabaseName,
    {
      schema: null,
    },
  );
  let actualDatabaseName: string;
  try {
    actualDatabaseName = psql(
      sourceConnectionUrl,
      'SELECT current_database();',
      { capture: true },
    );
  } catch (error) {
    throw new Error(
      `Unable to clone source local development database ${JSON.stringify(sourceDatabaseName)}. PostgreSQL could not connect to it: ${errorMessage(error)}`,
    );
  }

  if (actualDatabaseName !== sourceDatabaseName) {
    throw new Error(
      `Refusing to clone source database ${JSON.stringify(sourceDatabaseName)} because PostgreSQL connected to ${JSON.stringify(actualDatabaseName)} instead.`,
    );
  }
};

const dropCreatedDatabase = (
  context: WorktreeContext,
  environment: NodeJS.ProcessEnv,
  psql: WorktreeDatabaseOperations['runPsql'],
): void => {
  const databaseName = context.expectedDatabaseName;
  if (!databaseName) {
    throw new Error('Linked worktree has no expected database name.');
  }

  const projectDatabaseUrl = baseProjectDatabaseUrl(environment);
  assertSafeWorktreeDatabaseDrop(context, projectDatabaseUrl);
  const maintenanceUrl = createMaintenanceDatabaseUrl(projectDatabaseUrl);
  psql(
    maintenanceUrl,
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${quoteSqlLiteral(databaseName)} AND pid <> pg_backend_pid();`,
  );
  psql(maintenanceUrl, `DROP DATABASE ${quoteSqlIdentifier(databaseName)};`);
};

export const ensureDatabase = (
  context: WorktreeContext,
  environment: NodeJS.ProcessEnv = process.env,
  operations: WorktreeDatabaseOperations = defaultOperations,
): WorktreeDatabaseEnsureResult => {
  if (!context.isLinkedWorktree) {
    return { created: false, databaseName: null };
  }
  const expectedDatabaseName = context.expectedDatabaseName;
  if (!expectedDatabaseName) {
    throw new Error('Linked worktree has no expected database name.');
  }

  const derivedEnvironment = createWorktreeDatabaseEnvironment(
    context,
    environment,
  );
  assertSafeWorktreeDatabaseTarget(
    context,
    derivedEnvironment.PROJECT_DATABASE_URL,
    derivedEnvironment.FLYWAY_URL,
  );

  const sourceUrl = baseProjectDatabaseUrl(environment);
  const sourceSchema =
    environment.HEY_HEY_WORKTREE_CLONE_SCHEMA?.trim() ||
    new URL(sourceUrl).searchParams.get('schema') ||
    'public';
  assertLoopbackDatabaseHost(sourceUrl, 'PROJECT_DATABASE_URL');
  const sourceDatabaseName = databaseNameFromUrl(
    sourceUrl,
    'PROJECT_DATABASE_URL',
  );
  if (sourceDatabaseName === expectedDatabaseName) {
    throw new Error(
      `Refusing to initialize worktree database ${JSON.stringify(expectedDatabaseName)} because the source local development database resolves to the same database.`,
    );
  }

  return withInitializationLock(expectedDatabaseName, () => {
    let currentState: DatabaseState;
    try {
      currentState = databaseState(context, environment, operations.runPsql);
    } catch (error) {
      // If the maintenance connection is unavailable, probe the source as well
      // so a missing source produces a useful error instead of an ambiguous
      // database-existence check failure. Do not proceed when either side is
      // unverified.
      verifySourceDatabase(sourceUrl, sourceDatabaseName, operations.runPsql);
      throw new Error(
        `Unable to inspect worktree database ${JSON.stringify(expectedDatabaseName)} before cloning: ${errorMessage(error)}`,
      );
    }

    const maintenanceUrl = createMaintenanceDatabaseUrl(sourceUrl);
    if (currentState === 'exists') {
      const marker = readInitializationMarker(
        maintenanceUrl,
        expectedDatabaseName,
        operations.runPsql,
      );
      if (marker !== initializationMarker(expectedDatabaseName)) {
        throw new Error(
          `Worktree database ${JSON.stringify(expectedDatabaseName)} exists without a completed initialization marker. Refusing to reuse a potentially partial database; inspect it, then run pnpm db:worktree:drop and pnpm db:worktree:prepare to recreate it.`,
        );
      }
      return { created: false, databaseName: expectedDatabaseName };
    }

    verifySourceDatabase(sourceUrl, sourceDatabaseName, operations.runPsql);

    const sourceConnectionUrl = replaceDatabaseName(
      sourceUrl,
      sourceDatabaseName,
      {
        schema: null,
      },
    );
    const destinationConnectionUrl = replaceDatabaseName(
      sourceUrl,
      expectedDatabaseName,
      { schema: null },
    );
    let created = false;
    try {
      try {
        operations.runPsql(
          maintenanceUrl,
          `CREATE DATABASE ${quoteSqlIdentifier(expectedDatabaseName)} TEMPLATE template0;`,
        );
      } catch (error) {
        if (
          databaseState(context, environment, operations.runPsql) === 'exists'
        ) {
          throw new Error(
            `Refusing to initialize worktree database ${JSON.stringify(expectedDatabaseName)} because it appeared during preparation; no data was copied.`,
          );
        }
        throw error;
      }
      created = true;
      console.log(`Created worktree database ${expectedDatabaseName}.`);

      const actualDestinationName = operations.runPsql(
        destinationConnectionUrl,
        'SELECT current_database();',
        { capture: true },
      );
      if (actualDestinationName !== expectedDatabaseName) {
        throw new Error(
          `Refusing to initialize worktree database ${JSON.stringify(expectedDatabaseName)} because PostgreSQL connected to ${JSON.stringify(actualDestinationName)} instead.`,
        );
      }

      // A fresh PostgreSQL database already owns a public schema. Recreate it
      // only when it is the selected clone target; non-default schemas are
      // created by pg_restore from the dump.
      const quotedSourceSchema = quoteSqlIdentifier(sourceSchema);
      operations.runPsql(
        destinationConnectionUrl,
        sourceSchema === 'public'
          ? `DROP SCHEMA IF EXISTS ${quotedSourceSchema} CASCADE; CREATE SCHEMA ${quotedSourceSchema};`
          : `DROP SCHEMA IF EXISTS ${quotedSourceSchema} CASCADE;`,
      );
      operations.cloneDatabase(
        sourceConnectionUrl,
        destinationConnectionUrl,
        sourceSchema,
      );
      markDatabaseInitialized(
        maintenanceUrl,
        expectedDatabaseName,
        operations.runPsql,
      );
      console.log(
        `Copied PostgreSQL schema ${sourceSchema} from ${sourceDatabaseName} to ${expectedDatabaseName}.`,
      );
      return { created: true, databaseName: expectedDatabaseName };
    } catch (error) {
      if (!created) {
        throw error;
      }

      let cleanupError: unknown;
      try {
        dropCreatedDatabase(context, environment, operations.runPsql);
      } catch (errorDuringCleanup) {
        cleanupError = errorDuringCleanup;
      }

      const message = `Failed to initialize worktree database ${JSON.stringify(expectedDatabaseName)} from source ${JSON.stringify(sourceDatabaseName)}: ${errorMessage(error)}`;
      if (cleanupError) {
        throw new Error(
          `${message} Cleanup also failed: ${errorMessage(cleanupError)}`,
        );
      }
      throw new Error(
        `${message} The partially initialized database was dropped.`,
      );
    }
  });
};

const assertActualDatabaseTarget = (
  context: WorktreeContext,
  environment: NodeJS.ProcessEnv = process.env,
): void => {
  if (!context.isLinkedWorktree) {
    return;
  }
  assertSafeWorktreeDatabaseTarget(
    context,
    environment.PROJECT_DATABASE_URL,
    environment.FLYWAY_URL,
  );
  const expectedDatabaseName = context.expectedDatabaseName!;
  const psqlUrl = replaceDatabaseName(
    environment.PROJECT_DATABASE_URL!,
    expectedDatabaseName,
    { schema: null },
  );
  const actualDatabaseName = runPsql(psqlUrl, 'SELECT current_database();', {
    capture: true,
  });
  if (actualDatabaseName !== expectedDatabaseName) {
    throw new Error(
      `Connected PostgreSQL database ${JSON.stringify(actualDatabaseName)} does not match expected worktree database ${JSON.stringify(expectedDatabaseName)}.`,
    );
  }
};

const printContext = (
  context: WorktreeContext,
  environment: NodeJS.ProcessEnv = process.env,
): void => {
  const siblingNames = ['ui', 'ui-common', 'testy-testerson'];
  const siblings = {
    openapi: resolveOpenapiRoot(),
    ...Object.fromEntries(
      siblingNames.map((name) => [
        name,
        resolveSiblingRepository(
          context,
          name,
          process.env[`HEY_HEY_${name.replace(/-/g, '_').toUpperCase()}_ROOT`],
        ),
      ]),
    ),
  };
  console.log(
    JSON.stringify(
      {
        ...context,
        databaseState: databaseState(context, environment),
        databaseInitializationState: databaseInitializationState(
          context,
          environment,
        ),
        siblings,
      },
      null,
      2,
    ),
  );
};

const dropDatabase = (
  context: WorktreeContext,
  environment: NodeJS.ProcessEnv = process.env,
): void => {
  if (!context.isLinkedWorktree || !context.expectedDatabaseName) {
    throw new Error('The main checkout has no disposable worktree database.');
  }
  const projectDatabaseUrl = baseProjectDatabaseUrl(environment);
  assertSafeWorktreeDatabaseDrop(context, projectDatabaseUrl);
  if (databaseState(context, environment) === 'missing') {
    console.log(
      `Worktree database ${context.expectedDatabaseName} does not exist.`,
    );
    return;
  }

  const maintenanceUrl = createMaintenanceDatabaseUrl(projectDatabaseUrl);
  const databaseName = context.expectedDatabaseName!;
  runPsql(
    maintenanceUrl,
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${quoteSqlLiteral(databaseName)} AND pid <> pg_backend_pid();`,
  );
  runPsql(maintenanceUrl, `DROP DATABASE ${quoteSqlIdentifier(databaseName)};`);
  console.log(`Dropped worktree database ${databaseName}.`);
};

const runCommand = async (
  context: WorktreeContext,
  args: string[],
): Promise<number> => {
  const separatorIndex = args.indexOf('--');
  if (separatorIndex === -1 || !args[separatorIndex + 1]) {
    throw new Error(
      'Usage: worktree-db.ts exec [--ensure] -- <command> [...args]',
    );
  }
  const shouldEnsure = args.slice(0, separatorIndex).includes('--ensure');
  let ensureResult: WorktreeDatabaseEnsureResult = {
    created: false,
    databaseName: null,
  };
  if (shouldEnsure) {
    ensureResult = ensureDatabase(context);
  }
  const childEnvironment = createWorktreeDatabaseEnvironment(
    context,
    process.env,
  );
  if (ensureResult.created) {
    childEnvironment[INITIALIZED_DATABASE_ENVIRONMENT_VARIABLE] = '1';
  } else {
    delete childEnvironment[INITIALIZED_DATABASE_ENVIRONMENT_VARIABLE];
  }
  const command = args[separatorIndex + 1]!;
  const commandArgs = args.slice(separatorIndex + 2);
  const child = spawn(command, commandArgs, {
    env: childEnvironment,
    stdio: 'inherit',
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as NodeJS.Signals[]) {
    process.once(signal, () => child.kill(signal));
  }

  return await new Promise<number>((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        resolvePromise(1);
        return;
      }
      resolvePromise(code ?? 1);
    });
  });
};

export const prepareDatabase = async (
  context: WorktreeContext,
): Promise<number> => {
  if (!context.isLinkedWorktree) {
    throw new Error(
      'Worktree database preparation is only available from a linked worktree; refusing to migrate the main checkout database.',
    );
  }

  const exitCode = await runCommand(context, [
    '--ensure',
    '--',
    'bash',
    join(context.repositoryRoot, 'scripts/flyway.sh'),
    'migrate',
  ]);
  if (exitCode === 0) {
    markDatabasePreparationComplete(context);
  }
  return exitCode;
};

const main = async (): Promise<void> => {
  const context = resolveWorktreeContext();
  loadEnvironmentFiles(context);
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'context':
    case 'status':
      printContext(context);
      return;
    case 'doctor':
      if (context.isLinkedWorktree) {
        const derivedEnvironment = createWorktreeDatabaseEnvironment(
          context,
          process.env,
        );
        assertSafeWorktreeDatabaseTarget(
          context,
          derivedEnvironment.PROJECT_DATABASE_URL,
          derivedEnvironment.FLYWAY_URL,
        );
        if (databaseState(context) === 'missing') {
          throw new Error(
            `Worktree database ${context.expectedDatabaseName} is missing. Run: pnpm db:worktree:ensure`,
          );
        }
      }
      printContext(context);
      return;
    case 'ensure':
      ensureDatabase(context);
      if (context.expectedDatabaseName) {
        console.log(`Worktree database ready: ${context.expectedDatabaseName}`);
      } else {
        console.log('Main checkout uses its configured database.');
      }
      return;
    case 'prepare':
      process.exitCode = await prepareDatabase(context);
      return;
    case 'drop':
      dropDatabase(context);
      return;
    case 'assert':
      assertActualDatabaseTarget(context);
      return;
    case 'exec':
      process.exitCode = await runCommand(context, args);
      return;
    default:
      throw new Error(
        'Usage: worktree-db.ts <context|doctor|ensure|prepare|status|drop|assert|exec>',
      );
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
