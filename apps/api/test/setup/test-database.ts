import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Set up an in-memory SQLite database for testing
 * Each test run gets a unique database to ensure isolation
 */
export async function setupTestDatabase(): Promise<PrismaService> {
  // Use a unique database URL for each test to ensure isolation
  const dbName = `test_${randomUUID()}.db`;
  const databaseUrl = `file:./test_dbs/${dbName}?mode=memory&cache=shared`;

  // Set the database URL
  process.env.DATABASE_URL = databaseUrl;

  // Ensure test database directory exists
  execSync('mkdir -p test_dbs', { stdio: 'ignore' });

  // Push schema to test database
  execSync('npx prisma db push --skip-generate', {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
    stdio: 'pipe', // Suppress output during tests
  });

  // Create and return Prisma client
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
    log: process.env.DEBUG ? ['query', 'error', 'warn'] : ['error'],
  });

  await prisma.$connect();

  return prisma as PrismaService;
}

/**
 * Clean up test database
 */
export async function cleanupTestDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$disconnect();

  // Clean up test database files
  if (process.env.DATABASE_URL?.includes('test_dbs')) {
    const dbPath = process.env.DATABASE_URL.split('?')[0].replace('file:', '');
    execSync(`rm -f ${dbPath}*`, { stdio: 'ignore' });
  }
}

/**
 * Seed test data
 */
export async function seedTestData(
  prisma: PrismaClient,
  data: {
    organizationId: string;
    projectId: string;
    userId: string;
  },
) {
  const { organizationId, projectId, userId } = data;

  // Create organization
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: 'Test Organization',
      slug: 'test-org',
    },
  });

  // Create user
  await prisma.user.create({
    data: {
      id: userId,
      email: 'test@example.com',
      name: 'Test User',
      passwordHash:
        '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5Qt6Q8kR2/lBi', // bcrypt hash of "test-password"
    },
  });

  // Create organization member
  await prisma.organizationMember.create({
    data: {
      id: `member-${userId}`,
      organizationId,
      userId,
      role: 'ADMIN',
    },
  });

  // Create project
  await prisma.project.create({
    data: {
      id: projectId,
      name: 'Test Project',
      description: 'Test project for integration tests',
      organizationId,
      createdBy: userId,
    },
  });
}
