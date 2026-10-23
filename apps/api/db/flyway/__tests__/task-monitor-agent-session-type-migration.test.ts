import { PrismaClient, AgentSessionType } from '@prisma/client';

describe('TASK_MONITOR AgentSessionType migration', () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('keeps the deployed PostgreSQL enum aligned with Prisma', async () => {
    const rows = await prisma.$queryRaw<{ enumlabel: string }[]>`
      SELECT enumlabel
      FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      WHERE pg_type.typname = 'AgentSessionType'
      ORDER BY pg_enum.enumsortorder
    `;

    expect(rows.map((row) => row.enumlabel)).toEqual(
      Object.values(AgentSessionType),
    );
  });
});
