import { EntityType } from 'src/generated';
import { createWarmWorkItemTypeRegistryWithCustomTypes } from '../../../../test/setup/work-item-type-registry.fixture';
import {
  assertCreateWorkItemTracksAttachmentValid,
  assertNoRawTracksDeclaration,
  storeTracksAttachmentAsProposalEdge,
} from '../proposal-tracking-attachment';

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const GOAL_ID = '00000000-0000-4000-8000-000000000003';
const PORTFOLIO_ID = '00000000-0000-4000-8000-000000000004';
const STANDARD_ID = '00000000-0000-4000-8000-000000000005';

describe('compound create-work-item TRACKS attachment', () => {
  let registry: Awaited<
    ReturnType<typeof createWarmWorkItemTypeRegistryWithCustomTypes>
  >;
  let db: { task: { findFirst: jest.Mock } };

  beforeAll(async () => {
    registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
      {
        typeKey: 'PORTFOLIO',
        projectId: PROJECT_ID,
        sectionKeys: ['description'],
        tracking: {
          allowedSourceEntityTypes: [EntityType.Task],
          allowedSourceTaskTypes: ['PORTFOLIO'],
        },
      },
    ]);
  });

  beforeEach(() => {
    db = {
      task: {
        findFirst: jest.fn().mockImplementation(({ where: { id } }) => {
          if (id === GOAL_ID) return { id, type: 'GOAL' };
          if (id === PORTFOLIO_ID) return { id, type: 'PORTFOLIO' };
          if (id === STANDARD_ID) return { id, type: 'STANDARD' };
          return null;
        }),
      },
    };
  });

  const makeDto = (sourceEntityId: string, targetType: string) => ({
    type: 'SINGLE' as const,
    action: 'CREATE' as const,
    targetEntityId: '00000000-0000-0000-0000-000000000000',
    targetEntityType: 'TASK' as const,
    updates: { name: `New ${targetType}`, type: targetType },
    tracks: { sourceEntityId },
  });

  it.each(['STANDARD', 'FEATURE', 'BUG'])(
    'accepts GOAL to %s from the central tracking allow-list',
    async (targetType) => {
      await expect(
        assertCreateWorkItemTracksAttachmentValid({
          db: db as any,
          registry,
          organizationId: ORGANIZATION_ID as any,
          projectId: PROJECT_ID as any,
          dto: makeDto(GOAL_ID, targetType),
        }),
      ).resolves.toBeUndefined();
    },
  );

  it('rejects a source type that is not configured for tracking', async () => {
    await expect(
      assertCreateWorkItemTracksAttachmentValid({
        db: db as any,
        registry,
        organizationId: ORGANIZATION_ID as any,
        projectId: PROJECT_ID as any,
        dto: makeDto(STANDARD_ID, 'BUG'),
      }),
    ).rejects.toThrow('BUG does not allow tracking source type STANDARD');
  });

  it('rejects a target type outside the source allow-list', async () => {
    await expect(
      assertCreateWorkItemTracksAttachmentValid({
        db: db as any,
        registry,
        organizationId: ORGANIZATION_ID as any,
        projectId: PROJECT_ID as any,
        dto: makeDto(GOAL_ID, 'GOAL'),
      }),
    ).rejects.toThrow('GOAL does not allow tracking source type GOAL');
  });

  it('rejects using a non-parenting tracking source as parentTaskId', async () => {
    await expect(
      assertCreateWorkItemTracksAttachmentValid({
        db: db as any,
        registry,
        organizationId: ORGANIZATION_ID as any,
        projectId: PROJECT_ID as any,
        dto: {
          ...makeDto(GOAL_ID, 'STANDARD'),
          updates: {
            name: 'New STANDARD',
            type: 'STANDARD',
            parentTaskId: GOAL_ID,
          },
        },
      }),
    ).rejects.toThrow(
      'Tracking source type GOAL cannot also be the structural parent of STANDARD',
    );
  });

  it('uses the same path for a second configured tracking-source type', async () => {
    await expect(
      assertCreateWorkItemTracksAttachmentValid({
        db: db as any,
        registry,
        organizationId: ORGANIZATION_ID as any,
        projectId: PROJECT_ID as any,
        dto: makeDto(PORTFOLIO_ID, 'PORTFOLIO'),
      }),
    ).resolves.toBeUndefined();
  });

  it('stores validated attachment intent as a reviewable TRACKS declaration', () => {
    expect(
      storeTracksAttachmentAsProposalEdge(makeDto(GOAL_ID, 'BUG')),
    ).toEqual(
      expect.objectContaining({
        tracks: undefined,
        edges: [
          {
            targetEntityId: GOAL_ID,
            targetEntityType: 'TASK',
            edgeType: 'TRACKS',
            description: 'Tracks the newly created work item',
          },
        ],
      }),
    );
  });

  it('rejects direct TRACKS edge authorship outside the structured field', () => {
    expect(() =>
      assertNoRawTracksDeclaration({
        ...makeDto(GOAL_ID, 'BUG'),
        tracks: undefined,
        edges: [
          {
            targetEntityId: GOAL_ID,
            targetEntityType: 'TASK',
            edgeType: 'TRACKS',
          },
        ],
      }),
    ).toThrow('use the structured tracks attachment');
  });
});
