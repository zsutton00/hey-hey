import {
  assertSafeWorktreeDatabaseDrop,
  assertSafeWorktreeDatabaseTarget,
  createMaintenanceDatabaseUrl,
  createWorktreeDatabaseEnvironment,
  databaseNameFromUrl,
  replaceDatabaseName,
  toFlywayJdbcUrl,
} from '../worktree-database';
import { WorktreeContext } from '../worktree-context';

const linkedContext: WorktreeContext = {
  repositoryRoot: '/repos/api/.worktrees/feature-a',
  mainRepositoryRoot: '/repos/api',
  repositoriesRoot: '/repos',
  isLinkedWorktree: true,
  workspaceId: 'feature-a',
  expectedDatabaseName: 'hey_hey_wt_feature_a_12345678',
};

describe('worktree database safety', () => {
  it('rewrites Prisma and JDBC URLs without retaining schema on Flyway URLs', () => {
    expect(
      replaceDatabaseName(
        'postgresql://user:pass@localhost:5432/main?schema=public',
        'worktree_db',
        { schema: 'public' },
      ),
    ).toBe('postgresql://user:pass@localhost:5432/worktree_db?schema=public');
    expect(
      replaceDatabaseName(
        'jdbc:postgresql://localhost:5432/main?sslmode=disable',
        'worktree_db',
        { schema: null },
      ),
    ).toBe('jdbc:postgresql://localhost:5432/worktree_db?sslmode=disable');
  });

  it('derives maintenance and credential-free Flyway URLs', () => {
    const base =
      'postgresql://user:pass@localhost:5432/main?schema=custom&sslmode=disable';
    expect(createMaintenanceDatabaseUrl(base)).toBe(
      'postgresql://user:pass@localhost:5432/postgres',
    );
    expect(toFlywayJdbcUrl(base, 'worktree_db')).toBe(
      'jdbc:postgresql://localhost:5432/worktree_db',
    );
  });

  it('creates a complete isolated environment from the shared URL template', () => {
    const environment = createWorktreeDatabaseEnvironment(linkedContext, {
      PROJECT_DATABASE_URL:
        'postgresql://user:pass@localhost:5432/main?schema=public',
    });

    expect(databaseNameFromUrl(environment.PROJECT_DATABASE_URL!)).toBe(
      linkedContext.expectedDatabaseName,
    );
    expect(databaseNameFromUrl(environment.FLYWAY_URL!)).toBe(
      linkedContext.expectedDatabaseName,
    );
    expect(environment.FLYWAY_USER).toBe('user');
    expect(environment.FLYWAY_PASSWORD).toBe('pass');
  });

  it('refuses the shared database and mismatched Flyway targets', () => {
    expect(() =>
      assertSafeWorktreeDatabaseTarget(
        linkedContext,
        'postgresql://localhost:5432/main?schema=public',
      ),
    ).toThrow('Refusing to use database "main"');

    expect(() =>
      assertSafeWorktreeDatabaseTarget(
        linkedContext,
        `postgresql://localhost:5432/${linkedContext.expectedDatabaseName}?schema=public`,
        'jdbc:postgresql://localhost:5432/main',
      ),
    ).toThrow('Refusing to run Flyway');
  });

  it('refuses automatic provisioning on a remote PostgreSQL host', () => {
    expect(() =>
      createWorktreeDatabaseEnvironment(linkedContext, {
        PROJECT_DATABASE_URL:
          'postgresql://user:pass@db.example.com:5432/main?schema=public',
      }),
    ).toThrow('non-loopback host');
  });

  it('refuses remote, main-checkout, and protected database drops', () => {
    expect(() =>
      assertSafeWorktreeDatabaseDrop(
        linkedContext,
        'postgresql://user:pass@db.example.com:5432/main',
      ),
    ).toThrow('non-loopback host');

    expect(() =>
      assertSafeWorktreeDatabaseDrop(
        { ...linkedContext, isLinkedWorktree: false },
        'postgresql://user:pass@localhost:5432/main',
      ),
    ).toThrow('main checkout has no disposable worktree database');

    expect(() =>
      assertSafeWorktreeDatabaseDrop(
        { ...linkedContext, expectedDatabaseName: 'project' },
        'postgresql://user:pass@localhost:5432/main',
      ),
    ).toThrow('Refusing to drop protected database "project"');
  });
});
