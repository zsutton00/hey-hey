import { ProjectModeEligibilityService } from '../project-mode-eligibility.service';
import { resolveProjectModeEligibleWorkItemTypeKeys } from '../project-mode-eligible-types';

describe('ProjectModeEligibilityService', () => {
  const organizationId = 'org-1' as any;
  const projectId = 'project-1' as any;
  const modeId = 'mode-1';
  const focalTaskId = 'task-1';
  const agentEdgeClient = { list: jest.fn() };
  const registry = { getDefinition: jest.fn() };
  const dbClient = {
    task: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };
  let service: ProjectModeEligibilityService;

  const activeDefinition = (focalTypeKeys: string[]) => ({
    status: 'ACTIVE',
    definition: {
      agentGuidance: {
        contexts: [{ focalTypeKeys }],
      },
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProjectModeEligibilityService(
      agentEdgeClient as any,
      registry as any,
    );
    registry.getDefinition.mockImplementation(
      (_project: string, type: string) =>
        type === 'MODE' ? activeDefinition(['STANDARD']) : activeDefinition([]),
    );
    dbClient.task.findFirst.mockResolvedValue({
      id: focalTaskId,
      type: 'STANDARD',
      parentTaskId: 'feature-child',
    });
    dbClient.task.findMany.mockResolvedValue([
      { id: 'feature-child', type: 'FEATURE', parentTaskId: 'feature-root' },
      { id: 'feature-root', type: 'FEATURE', parentTaskId: null },
    ]);
    agentEdgeClient.list.mockResolvedValue({ content: [] });
  });

  it('keeps a structurally owned mode global when it has no Feature dependency', async () => {
    await expect(
      service.assertEligible({
        dbClient: dbClient as any,
        organizationId,
        projectId,
        modeId,
        modeSettings: null,
        focalTaskId,
        userToken: 'token',
      }),
    ).resolves.toMatchObject({
      applicableWorkItemTypeKeys: ['STANDARD'],
      focalFeatureIds: ['feature-child', 'feature-root'],
    });
  });

  it.each([
    ['exact', 'feature-child'],
    ['descendant', 'feature-root'],
  ])(
    'accepts a mode with a %s Feature dependency',
    async (_label, featureId) => {
      agentEdgeClient.list.mockResolvedValue({
        content: [
          {
            sourceNodeId: modeId,
            targetNodeId: featureId,
            targetEntityType: 'TASK',
            targetNodeType: 'FEATURE',
            type: 'DEPENDS_ON',
          },
        ],
      });

      await expect(
        service.assertEligible({
          dbClient: dbClient as any,
          organizationId,
          projectId,
          modeId,
          modeSettings: null,
          focalTaskId,
          userToken: 'token',
        }),
      ).resolves.toBeTruthy();
    },
  );

  it('rejects an unrelated Feature dependency and ignores structural or non-Feature edges', async () => {
    agentEdgeClient.list.mockResolvedValue({
      content: [
        {
          sourceNodeId: modeId,
          targetNodeId: 'feature-other',
          targetEntityType: 'TASK',
          targetNodeType: 'FEATURE',
          type: 'DEPENDS_ON',
        },
        {
          sourceNodeId: modeId,
          targetNodeId: 'feature-child',
          targetEntityType: 'TASK',
          targetNodeType: 'FEATURE',
          type: 'RELATED_TO',
        },
        {
          sourceNodeId: modeId,
          targetNodeId: 'task-other',
          targetEntityType: 'TASK',
          targetNodeType: 'STANDARD',
          type: 'DEPENDS_ON',
        },
      ],
    });

    await expect(
      service.assertEligible({
        dbClient: dbClient as any,
        organizationId,
        projectId,
        modeId,
        modeSettings: null,
        focalTaskId,
        userToken: 'token',
      }),
    ).rejects.toThrow('not eligible for this Feature');
  });

  it('rejects type-incompatible work before reading graph applicability', async () => {
    registry.getDefinition.mockImplementation(
      (_project: string, type: string) =>
        type === 'MODE' ? activeDefinition(['BUG']) : activeDefinition([]),
    );

    await expect(
      service.assertEligible({
        dbClient: dbClient as any,
        organizationId,
        projectId,
        modeId,
        modeSettings: null,
        focalTaskId,
        userToken: 'token',
      }),
    ).rejects.toThrow('not eligible for this work-item type');
    expect(agentEdgeClient.list).not.toHaveBeenCalled();
  });

  const settingsWith = (eligibleWorkItemTypeKeys: string[]) => ({
    schemaVersion: 'project-mode-settings.v1' as const,
    projectAssistant: { enabled: true },
    eligibleWorkItemTypeKeys,
  });

  it.each(['STANDARD', 'BUG'])(
    'accepts a %s focal item for a mode configured for STANDARD and BUG',
    async (type) => {
      dbClient.task.findFirst.mockResolvedValue({
        id: focalTaskId,
        type,
        parentTaskId: 'feature-child',
      });

      await expect(
        service.assertEligible({
          dbClient: dbClient as any,
          organizationId,
          projectId,
          modeId,
          modeSettings: settingsWith(['STANDARD', 'BUG']) as any,
          focalTaskId,
          userToken: 'token',
        }),
      ).resolves.toMatchObject({
        applicableWorkItemTypeKeys: ['BUG', 'STANDARD'],
        applicableWorkItemTypeSource: 'mode-settings',
      });
    },
  );

  it('lets two modes declare different lists against the same shared MODE type', async () => {
    dbClient.task.findFirst.mockResolvedValue({
      id: focalTaskId,
      type: 'BUG',
      parentTaskId: 'feature-child',
    });
    const call = (eligible: string[]) =>
      service.assertEligible({
        dbClient: dbClient as any,
        organizationId,
        projectId,
        modeId,
        modeSettings: settingsWith(eligible) as any,
        focalTaskId,
        userToken: 'token',
      });

    await expect(call(['BUG'])).resolves.toBeTruthy();
    await expect(call(['STANDARD'])).rejects.toThrow(
      'not eligible for this work-item type',
    );
    expect(agentEdgeClient.list).toHaveBeenCalledTimes(1);
  });

  it('falls back to the legacy shared type guidance when the mode has no list', async () => {
    dbClient.task.findFirst.mockResolvedValue({
      id: focalTaskId,
      type: 'BUG',
      parentTaskId: 'feature-child',
    });

    await expect(
      service.assertEligible({
        dbClient: dbClient as any,
        organizationId,
        projectId,
        modeId,
        modeSettings: {
          schemaVersion: 'project-mode-settings.v1',
          projectAssistant: { enabled: false },
        } as any,
        focalTaskId,
        userToken: 'token',
      }),
    ).rejects.toThrow('not eligible for this work-item type');
  });

  it('intersects a per-mode list with Feature scope', async () => {
    dbClient.task.findFirst.mockResolvedValue({
      id: focalTaskId,
      type: 'BUG',
      parentTaskId: 'feature-child',
    });
    agentEdgeClient.list.mockResolvedValue({
      content: [
        {
          sourceNodeId: modeId,
          targetNodeId: 'feature-other',
          targetNodeType: 'FEATURE',
          type: 'DEPENDS_ON',
        },
      ],
    });

    await expect(
      service.assertEligible({
        dbClient: dbClient as any,
        organizationId,
        projectId,
        modeId,
        modeSettings: settingsWith(['STANDARD', 'BUG']) as any,
        focalTaskId,
        userToken: 'token',
      }),
    ).rejects.toThrow('not eligible for this Feature');
  });

  describe('shared resolver agreement for a custom work-item type', () => {
    const customTypeKey = 'JOB_APPLICATION_RECORD';
    const customTypeSettings = {
      schemaVersion: 'project-mode-settings.v1',
      projectAssistant: { enabled: true },
      eligibleWorkItemTypeKeys: [customTypeKey],
    };
    const sharedModeDefinition = {
      agentGuidance: { contexts: [{ focalTypeKeys: ['STANDARD'] }] },
    };

    beforeEach(() => {
      dbClient.task.findFirst.mockResolvedValue({
        id: focalTaskId,
        type: customTypeKey,
        parentTaskId: 'feature-child',
      });
    });

    it('accepts a custom type named only by the mode list and reports the resolver result capture records', async () => {
      const result = await service.assertEligible({
        dbClient: dbClient as any,
        organizationId,
        projectId,
        modeId,
        modeSettings: customTypeSettings as any,
        focalTaskId,
        userToken: 'token',
      });

      expect(result).toMatchObject({
        applicableWorkItemTypeKeys: [customTypeKey],
        applicableWorkItemTypeSource: 'mode-settings',
      });
      expect(result.applicableWorkItemTypeKeys).toEqual(
        resolveProjectModeEligibleWorkItemTypeKeys({
          modeTypeDefinition: sharedModeDefinition,
          settings: customTypeSettings as any,
        }).keys,
      );
    });

    it('rejects the same custom type for a mode without a list, which keeps the shared fallback', async () => {
      await expect(
        service.assertEligible({
          dbClient: dbClient as any,
          organizationId,
          projectId,
          modeId,
          modeSettings: null,
          focalTaskId,
          userToken: 'token',
        }),
      ).rejects.toThrow('not eligible for this work-item type');
      expect(
        resolveProjectModeEligibleWorkItemTypeKeys({
          modeTypeDefinition: sharedModeDefinition,
          settings: null,
        }),
      ).toEqual({ keys: ['STANDARD'], source: 'legacy-type-guidance' });
    });

    it('never reads shared focal keys when the mode carries a list', () => {
      const throwingDefinition = {
        agentGuidance: {
          get contexts(): never {
            throw new Error('shared focalTypeKeys must not be read');
          },
        },
      };

      expect(
        resolveProjectModeEligibleWorkItemTypeKeys({
          modeTypeDefinition: throwingDefinition as any,
          settings: customTypeSettings as any,
        }),
      ).toEqual({ keys: [customTypeKey], source: 'mode-settings' });
    });

    it('applies Feature scope on top of a custom type list', async () => {
      agentEdgeClient.list.mockResolvedValue({
        content: [
          {
            sourceNodeId: modeId,
            targetNodeId: 'feature-other',
            targetNodeType: 'FEATURE',
            type: 'DEPENDS_ON',
          },
        ],
      });

      await expect(
        service.assertEligible({
          dbClient: dbClient as any,
          organizationId,
          projectId,
          modeId,
          modeSettings: customTypeSettings as any,
          focalTaskId,
          userToken: 'token',
        }),
      ).rejects.toThrow('not eligible for this Feature');
    });
  });

  it('fails closed when the authenticated graph token is unavailable', async () => {
    await expect(
      service.assertEligible({
        dbClient: dbClient as any,
        organizationId,
        projectId,
        modeId,
        modeSettings: null,
        focalTaskId,
        userToken: null,
      }),
    ).rejects.toThrow('Feature applicability data is unavailable');
  });
});
