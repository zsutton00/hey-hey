import {
  hasGitMetadata,
  resolveWorktreeContext,
  WorktreeContext,
} from './worktree-context';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const NEVER_DROP_DATABASES = new Set(['project']);

interface ParsedDatabaseUrl {
  databaseName: string;
  hostname: string;
  port: string;
  url: URL;
  jdbc: boolean;
}

const parseDatabaseUrl = (
  value: string,
  variableName: string,
): ParsedDatabaseUrl => {
  const jdbc = value.startsWith('jdbc:');
  const urlValue = jdbc ? value.slice('jdbc:'.length) : value;
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch (error) {
    throw new Error(
      `${variableName} must be a PostgreSQL URL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(
      `${variableName} must use the postgresql: or postgres: protocol.`,
    );
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!databaseName) {
    throw new Error(`${variableName} must include a database name.`);
  }

  return {
    databaseName,
    hostname: url.hostname,
    port: url.port || '5432',
    url,
    jdbc,
  };
};

export const databaseNameFromUrl = (
  value: string,
  variableName = 'database URL',
): string => parseDatabaseUrl(value, variableName).databaseName;

export const replaceDatabaseName = (
  value: string,
  databaseName: string,
  options: { schema?: string | null } = {},
): string => {
  const parsed = parseDatabaseUrl(value, 'database URL');
  parsed.url.pathname = `/${encodeURIComponent(databaseName)}`;
  if (options.schema === null) {
    parsed.url.searchParams.delete('schema');
  } else if (options.schema !== undefined) {
    parsed.url.searchParams.set('schema', options.schema);
  }
  const result = parsed.url.toString();
  return parsed.jdbc ? `jdbc:${result}` : result;
};

export const toFlywayJdbcUrl = (
  projectDatabaseUrl: string,
  databaseName: string,
): string => {
  const parsed = parseDatabaseUrl(projectDatabaseUrl, 'PROJECT_DATABASE_URL');
  parsed.url.username = '';
  parsed.url.password = '';
  parsed.url.pathname = `/${encodeURIComponent(databaseName)}`;
  parsed.url.search = '';
  return `jdbc:${parsed.url.toString()}`;
};

export const createMaintenanceDatabaseUrl = (
  projectDatabaseUrl: string,
): string => {
  const parsed = parseDatabaseUrl(projectDatabaseUrl, 'PROJECT_DATABASE_URL');
  parsed.url.pathname = '/postgres';
  parsed.url.search = '';
  return parsed.url.toString();
};

export const assertLoopbackDatabaseHost = (
  value: string,
  variableName = 'database URL',
): void => {
  const parsed = parseDatabaseUrl(value, variableName);
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Refusing to provision a worktree database on non-loopback host ${JSON.stringify(parsed.hostname)}.`,
    );
  }
};

export const assertSafeWorktreeDatabaseTarget = (
  context: WorktreeContext,
  projectDatabaseUrl: string | undefined,
  flywayUrl?: string,
): void => {
  if (!context.isLinkedWorktree) {
    return;
  }

  const expectedDatabaseName = context.expectedDatabaseName;
  if (!expectedDatabaseName || !context.workspaceId) {
    throw new Error(
      'Linked worktree context is missing its database identity.',
    );
  }
  if (!projectDatabaseUrl) {
    throw new Error(
      `Refusing to start worktree ${JSON.stringify(context.workspaceId)} without PROJECT_DATABASE_URL. Run pnpm db:worktree:ensure first.`,
    );
  }

  const projectTarget = parseDatabaseUrl(
    projectDatabaseUrl,
    'PROJECT_DATABASE_URL',
  );
  if (projectTarget.databaseName !== expectedDatabaseName) {
    throw new Error(
      [
        `Refusing to use database ${JSON.stringify(projectTarget.databaseName)} from worktree ${JSON.stringify(context.workspaceId)}.`,
        `Expected worktree database: ${expectedDatabaseName}`,
        'Run: pnpm db:worktree:ensure',
      ].join('\n'),
    );
  }

  if (flywayUrl) {
    const flywayTarget = parseDatabaseUrl(flywayUrl, 'FLYWAY_URL');
    if (flywayTarget.databaseName !== expectedDatabaseName) {
      throw new Error(
        `Refusing to run Flyway against ${JSON.stringify(flywayTarget.databaseName)} from worktree ${JSON.stringify(context.workspaceId)}. Expected ${expectedDatabaseName}.`,
      );
    }
    if (
      flywayTarget.hostname !== projectTarget.hostname ||
      flywayTarget.port !== projectTarget.port
    ) {
      throw new Error(
        'FLYWAY_URL and PROJECT_DATABASE_URL must target the same PostgreSQL host and port in a worktree.',
      );
    }
  }
};

export const assertSafeWorktreeDatabaseDrop = (
  context: WorktreeContext,
  projectDatabaseUrl: string,
): void => {
  if (!context.isLinkedWorktree || !context.expectedDatabaseName) {
    throw new Error('The main checkout has no disposable worktree database.');
  }

  assertLoopbackDatabaseHost(projectDatabaseUrl, 'PROJECT_DATABASE_URL');
  if (NEVER_DROP_DATABASES.has(context.expectedDatabaseName)) {
    throw new Error(
      `Refusing to drop protected database ${JSON.stringify(context.expectedDatabaseName)}.`,
    );
  }
};

export const createWorktreeDatabaseEnvironment = (
  context: WorktreeContext,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => {
  if (!context.isLinkedWorktree) {
    return { ...environment };
  }

  const expectedDatabaseName = context.expectedDatabaseName;
  const baseProjectDatabaseUrl =
    environment.PROJECT_DATABASE_URL || environment.DATABASE_URL;
  if (!expectedDatabaseName || !baseProjectDatabaseUrl) {
    throw new Error(
      'A linked worktree requires PROJECT_DATABASE_URL (or DATABASE_URL) as the connection template.',
    );
  }

  assertLoopbackDatabaseHost(baseProjectDatabaseUrl, 'PROJECT_DATABASE_URL');
  const parsedBase = parseDatabaseUrl(
    baseProjectDatabaseUrl,
    'PROJECT_DATABASE_URL',
  );
  const projectDatabaseUrl = replaceDatabaseName(
    baseProjectDatabaseUrl,
    expectedDatabaseName,
    { schema: 'public' },
  );
  const flywayUrl = environment.FLYWAY_URL
    ? replaceDatabaseName(environment.FLYWAY_URL, expectedDatabaseName, {
        schema: null,
      })
    : toFlywayJdbcUrl(baseProjectDatabaseUrl, expectedDatabaseName);

  return {
    ...environment,
    PROJECT_DATABASE_URL: projectDatabaseUrl,
    DATABASE_URL: projectDatabaseUrl,
    POSTGRES_DB: expectedDatabaseName,
    POSTGRES_SCHEMA: 'public',
    FLYWAY_URL: flywayUrl,
    FLYWAY_USER:
      environment.FLYWAY_USER || decodeURIComponent(parsedBase.url.username),
    FLYWAY_PASSWORD:
      environment.FLYWAY_PASSWORD ||
      decodeURIComponent(parsedBase.url.password),
    FLYWAY_SCHEMAS: 'public',
    FLYWAY_DEFAULT_SCHEMA: 'public',
    HEY_HEY_WORKSPACE_ID: context.workspaceId || undefined,
  };
};

export const assertCurrentWorktreeDatabaseTarget = (): void => {
  let context: WorktreeContext;
  try {
    context = resolveWorktreeContext();
  } catch (error) {
    // Production artifacts may run without Git metadata. If a Git marker is
    // present, however, detection failures must not disable worktree safety.
    if (!hasGitMetadata()) {
      return;
    }
    throw error;
  }

  assertSafeWorktreeDatabaseTarget(context, process.env.PROJECT_DATABASE_URL);
};
