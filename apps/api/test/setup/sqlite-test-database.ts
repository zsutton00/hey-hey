import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Interface that matches our PrismaService structure
export interface TestPrismaService extends PrismaClient {
  db: PrismaClient;
  onModuleInit?: () => Promise<void>;
  onModuleDestroy?: () => Promise<void>;
}

/**
 * Creates the SQLite schema using raw SQL
 * This is needed because Prisma migrate doesn't work well with in-memory SQLite
 */
async function createSchema(prisma: PrismaClient): Promise<void> {
  // Read the SQL schema from our test.prisma file and convert to SQLite SQL
  // For now, we'll use a simplified schema

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "Organization" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "slug" TEXT NOT NULL UNIQUE,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "Project" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "organizationId" TEXT NOT NULL,
      "config" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
    );
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL UNIQUE,
      "name" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "OrganizationMember" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "organizationId" TEXT NOT NULL,
      "role" TEXT NOT NULL DEFAULT 'MEMBER',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
      UNIQUE ("userId", "organizationId")
    );
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "Conversation" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT NOT NULL,
      "workflowId" TEXT NOT NULL UNIQUE,
      "status" TEXT NOT NULL DEFAULT 'STARTED',
      "title" TEXT,
      "category" TEXT,
      "initiatedBy" TEXT NOT NULL,
      "triggerEvent" TEXT NOT NULL,
      "triggerData" TEXT NOT NULL DEFAULT '{}',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE
    );
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "Message" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "conversationId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "role" TEXT,
      "content" TEXT,
      "data" TEXT NOT NULL DEFAULT '{}',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE
    );
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "Initiative" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "description" TEXT,
      "status" TEXT NOT NULL DEFAULT 'TODO',
      "priority" TEXT NOT NULL DEFAULT 'medium',
      "projectId" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE
    );
  `;

  // Create indexes
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "idx_conversation_workflow" ON "Conversation"("workflowId");`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "idx_message_conversation" ON "Message"("conversationId");`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "idx_project_org" ON "Project"("organizationId");`;
}

/**
 * Set up an in-memory SQLite database for functional testing
 * Each test gets a fresh database instance
 */
export async function setupSQLiteTestDatabase(): Promise<TestPrismaService> {
  // Create Prisma client with in-memory SQLite
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: 'file::memory:',
      },
    },
    log: process.env.DEBUG ? ['query', 'error', 'warn'] : ['error'],
  });

  await prisma.$connect();

  // Create the schema
  await createSchema(prisma);

  // Create a wrapper that matches PrismaService interface
  const testPrismaService: TestPrismaService = Object.assign(prisma, {
    db: prisma,
    onModuleInit: async () => {
      await prisma.$connect();
    },
    onModuleDestroy: async () => {
      await prisma.$disconnect();
    },
  });

  return testPrismaService;
}

/**
 * Clean up test database
 */
export async function cleanupSQLiteTestDatabase(
  prisma: TestPrismaService,
): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Seed test data
 */
export async function seedTestData(
  prisma: TestPrismaService,
  data: {
    organizationId: string;
    projectId: string;
    userId: string;
  },
): Promise<void> {
  const { organizationId, projectId, userId } = data;

  // Use raw SQL for better SQLite compatibility
  await prisma.$executeRaw`
    INSERT INTO "Organization" (id, name, slug)
    VALUES (${organizationId}, 'Test Organization', 'test-org');
  `;

  await prisma.$executeRaw`
    INSERT INTO "User" (id, email, name)
    VALUES (${userId}, 'test@example.com', 'Test User');
  `;

  await prisma.$executeRaw`
    INSERT INTO "OrganizationMember" (id, organizationId, userId, role)
    VALUES (${`member-${userId}`}, ${organizationId}, ${userId}, 'ADMIN');
  `;

  await prisma.$executeRaw`
    INSERT INTO "Project" (id, name, organizationId)
    VALUES (${projectId}, 'Test Project', ${organizationId});
  `;
}

/**
 * Helper to get conversation with messages
 */
export async function getConversationWithMessages(
  prisma: TestPrismaService,
  workflowId: string,
): Promise<any> {
  const conversation = await prisma.$queryRaw`
    SELECT * FROM "Conversation" WHERE "workflowId" = ${workflowId} LIMIT 1;
  `;

  if (!conversation || (conversation as any[]).length === 0) {
    return null;
  }

  const conv = (conversation as any[])[0];
  const messages = await prisma.$queryRaw`
    SELECT * FROM "Message" 
    WHERE "conversationId" = ${conv.id} 
    ORDER BY "createdAt" ASC;
  `;

  return {
    ...conv,
    messages,
  };
}
