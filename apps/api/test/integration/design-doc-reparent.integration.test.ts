import { DesignDocParentEntityType, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

/**
 * Validates that the design-doc reparent path persists `parentEntityId` /
 * `parentEntityType` end-to-end against a real Postgres connection. The
 * service-layer rules (pairing, type allowlist, self-parent, cycle, parent
 * existence) are covered by unit tests in src/services/design-doc/__tests__;
 * this suite exists to certify that the migration columns accept the values
 * the service writes and round-trip cleanly through Prisma.
 */
describe('design doc reparent storage', () => {
  const prisma = new PrismaClient();

  const organizationId = randomUUID();
  const projectId = randomUUID();
  const movedDocId = randomUUID();
  const targetTaskId = randomUUID();
  const targetDocId = randomUUID();

  beforeAll(async () => {
    await prisma.$connect();

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: `Reparent Storage Org ${organizationId}`,
        slug: `reparent-storage-${organizationId}`,
      },
    });

    await prisma.project.create({
      data: {
        id: projectId,
        name: 'Reparent Storage Project',
        organizationId,
      },
    });

    await prisma.task.create({
      data: {
        id: targetTaskId,
        name: 'Reparent target task',
        type: 'STANDARD',
        organizationId,
        projectId,
      },
    });

    await prisma.designDoc.create({
      data: {
        id: targetDocId,
        name: 'Reparent target doc',
        template: 'BRAINSTORM',
        status: 'DRAFT_CONCEPT',
        organizationId,
        projectId,
        tags: [],
      },
    });

    await prisma.designDoc.create({
      data: {
        id: movedDocId,
        name: 'Doc to be reparented',
        template: 'BRAINSTORM',
        status: 'DRAFT_CONCEPT',
        organizationId,
        projectId,
        tags: [],
      },
    });
  });

  afterAll(async () => {
    await prisma.designDoc.deleteMany({ where: { organizationId } });
    await prisma.task.deleteMany({ where: { organizationId } });
    await prisma.project.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it('persists a TASK parent on update', async () => {
    await prisma.designDoc.update({
      where: { id: movedDocId },
      data: {
        parentEntityId: targetTaskId,
        parentEntityType: DesignDocParentEntityType.TASK,
      },
    });

    const after = await prisma.designDoc.findUniqueOrThrow({
      where: { id: movedDocId },
      select: { parentEntityId: true, parentEntityType: true },
    });
    expect(after.parentEntityId).toBe(targetTaskId);
    expect(after.parentEntityType).toBe(DesignDocParentEntityType.TASK);
  });

  it('replaces a TASK parent with a DESIGN_DOC parent on subsequent update', async () => {
    await prisma.designDoc.update({
      where: { id: movedDocId },
      data: {
        parentEntityId: targetDocId,
        parentEntityType: DesignDocParentEntityType.DESIGN_DOC,
      },
    });

    const after = await prisma.designDoc.findUniqueOrThrow({
      where: { id: movedDocId },
      select: { parentEntityId: true, parentEntityType: true },
    });
    expect(after.parentEntityId).toBe(targetDocId);
    expect(after.parentEntityType).toBe(DesignDocParentEntityType.DESIGN_DOC);
  });

  it('clears the parent fields when both are written as null', async () => {
    await prisma.designDoc.update({
      where: { id: movedDocId },
      data: {
        parentEntityId: null,
        parentEntityType: null,
      },
    });

    const after = await prisma.designDoc.findUniqueOrThrow({
      where: { id: movedDocId },
      select: { parentEntityId: true, parentEntityType: true },
    });
    expect(after.parentEntityId).toBeNull();
    expect(after.parentEntityType).toBeNull();
  });
});
