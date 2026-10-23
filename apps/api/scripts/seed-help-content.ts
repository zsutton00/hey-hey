import { PrismaClient } from '@prisma/client';
import { seedHelpContent } from '../src/services/help-content-seed';

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    const summary = await seedHelpContent(prisma);
    console.log(
      [
        'Seeded help content.',
        `nodes created=${summary.nodes.created}`,
        `updated=${summary.nodes.updated}`,
        `unchanged=${summary.nodes.unchanged}`,
        `demos created=${summary.demos.created}`,
        `updated=${summary.demos.updated}`,
        `deleted=${summary.demos.deleted}`,
        `unchanged=${summary.demos.unchanged}`,
        `changedNodes=${summary.changedNodeIds.length}`,
        `drift=${summary.drift.length}`,
      ].join(' '),
    );
    for (const drift of summary.drift) {
      console.warn(
        `Help source/database drift: id=${drift.id} slugPath=${drift.slugPath}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
