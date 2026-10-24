import { SessionRole } from '../../generated/model/sessionRole';
import { NotFoundException } from '@nestjs/common';
import {
  getWorkItemTypeGuidanceBatchOutput,
  getWorkItemTypeGuidanceBatchParameters,
} from '../tools/work-item-type-tools.provider';
import { WorkItemTypeEffectiveSource } from '../../generated/model/workItemTypeEffectiveSource';
import { WorkItemTypeLifecycleStatus } from '../../generated/model/workItemTypeLifecycleStatus';
import { WorkItemTypeGuidancePurpose } from '../../generated/model/workItemTypeGuidancePurpose';
import type { ProjectService } from '../../services/project.service';
import type { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import {
  getWorkItemTypeOutput,
  getWorkItemTypeParameters,
  WorkItemTypeToolsProvider,
} from '../tools/work-item-type-tools.provider';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';

const COMPLETE_SUMMARY = {
  id: '00000000-0000-4000-8000-000000000040',
  projectId: PROJECT_ID,
  definition: {
    key: 'MARKETING',
    name: 'Marketing',
    role: 'work-item' as const,
    description: 'Campaign and go-to-market work.',
    agentGuidance: {
      overview: 'Semantic meaning',
      contexts: [
        { focalTypeKeys: ['FEATURE'], guidance: 'Directional meaning' },
      ],
    },
    iconKey: 'task' as const,
    sections: [
      {
        key: 'audience',
        label: 'Target audience',
        writingStandard: 'Name the segment and why it is reachable.',
      },
    ],
    requiredScalars: ['dueDate' as const],
    forbiddenScalars: ['tag' as const],
    allowedStatuses: ['BACKLOG' as const, 'ACTIVE' as const],
    allowedParentTypes: ['FEATURE'],
    edgeTargets: [
      { edgeType: 'RELATED_TO' as const, targetTypeKeys: ['STANDARD'] },
    ],
    allowedParentEntityTypes: ['PROJECT' as const],
    tracking: {
      allowedSourceEntityTypes: ['TASK' as const],
      allowedSourceTaskTypes: ['STANDARD'],
    },
    agentSettableStatuses: ['BACKLOG' as const],
    anchorableReportTypes: ['IMPLEMENT' as const],
    writingStandards: {
      create: 'Ground the campaign in a measurable outcome.',
      edit: 'Preserve that outcome while updating current intent.',
    },
    capabilities: { showsInExplorerSidebar: true },
  },
  status: WorkItemTypeLifecycleStatus.Active,
  effectiveSource: WorkItemTypeEffectiveSource.ProjectCustom,
};

function makeRequest(headers: Record<string, string> = {}) {
  return {
    headers: {
      authorization: 'Bearer tok',
      'x-project-id': PROJECT_ID,
      ...headers,
    },
    cookies: {},
    user: {
      userId: 'u1',
      email: 'test@example.com',
      name: 'Test',
      currentOrgId: ORG_ID,
      orgMemberships: [],
      isDevAdmin: false,
      devAdminMode: false,
    },
  } as any;
}

function createProvider(
  summary: unknown,
  project: unknown = { id: PROJECT_ID },
) {
  const getDefinition = jest.fn().mockReturnValue(summary);
  const registry = {
    getDefinition,
  } as unknown as WorkItemTypeRegistryService;
  const findOne = jest.fn().mockResolvedValue(project);
  const projectService = {
    findOne,
  } as unknown as ProjectService;
  return {
    provider: new WorkItemTypeToolsProvider(registry, projectService),
    getDefinition,
    findOne,
  };
}

describe('get_work_item_type', () => {
  it('exposes a strict type-key input and the complete generated summary output', () => {
    expect(getWorkItemTypeParameters.parse({ typeKey: 'MARKETING' })).toEqual({
      typeKey: 'MARKETING',
    });
    expect(() =>
      getWorkItemTypeParameters.parse({
        typeKey: 'MARKETING',
        unsupported: true,
      }),
    ).toThrow(/Unrecognized key/);
    expect(getWorkItemTypeOutput.parse(COMPLETE_SUMMARY)).toEqual(
      COMPLETE_SUMMARY,
    );
  });

  it('returns the complete project-effective custom summary from header context', async () => {
    const { provider, getDefinition, findOne } =
      createProvider(COMPLETE_SUMMARY);

    const result = await provider.getWorkItemType(
      { typeKey: 'MARKETING' },
      {} as any,
      makeRequest(),
    );

    expect(result).toEqual(COMPLETE_SUMMARY);
    expect(findOne).toHaveBeenCalledWith(PROJECT_ID, ORG_ID);
    expect(getDefinition).toHaveBeenCalledWith(PROJECT_ID, 'MARKETING');
  });

  it.each([
    ['missing', undefined],
    [
      'archived',
      { ...COMPLETE_SUMMARY, status: WorkItemTypeLifecycleStatus.Archived },
    ],
  ])(
    'fails clearly when the key is %s or unavailable',
    async (_name, summary) => {
      const { provider } = createProvider(summary);

      const result = await provider.getWorkItemType(
        { typeKey: 'MARKETING' },
        {} as any,
        makeRequest(),
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        "Work-item type 'MARKETING' was not found or is unavailable in this project.",
      );
    },
  );

  it('fails before registry access when project context is missing', async () => {
    const { provider, getDefinition } = createProvider(COMPLETE_SUMMARY);
    const request = makeRequest();
    delete request.headers['x-project-id'];

    const result = await provider.getWorkItemType(
      { typeKey: 'MARKETING' },
      {} as any,
      request,
    );

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('Missing projectId');
    expect(getDefinition).not.toHaveBeenCalled();
  });

  it('rejects a project outside the authenticated organization before registry access', async () => {
    const { provider, getDefinition, findOne } = createProvider(
      COMPLETE_SUMMARY,
      null,
    );

    const result = await provider.getWorkItemType(
      { typeKey: 'MARKETING' },
      {} as any,
      makeRequest(),
    );

    expect(findOne).toHaveBeenCalledWith(PROJECT_ID, ORG_ID);
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toBe(
      'Project not found or not accessible.',
    );
    expect(getDefinition).not.toHaveBeenCalled();
  });
});

describe('get_work_item_type_guidance_batch', () => {
  const batch = {
    results: [
      { typeKey: 'BUG', name: 'Bug', overview: 'Defects', examples: [] },
      { typeKey: 'STANDARD', name: 'Task', overview: 'Work', examples: [] },
    ],
  };

  function setup(project: unknown = { id: PROJECT_ID }) {
    const getGuidanceBatch = jest.fn().mockReturnValue(batch);
    const findOne = jest.fn().mockResolvedValue(project);
    const provider = new WorkItemTypeToolsProvider(
      { getGuidanceBatch } as unknown as WorkItemTypeRegistryService,
      { findOne } as unknown as ProjectService,
    );
    return { provider, getGuidanceBatch, findOne };
  }

  it('exposes batch guidance as the only MCP guidance read', () => {
    const prototype = WorkItemTypeToolsProvider.prototype;
    const names = Object.getOwnPropertyNames(prototype).flatMap((key) => {
      const method = Object.getOwnPropertyDescriptor(prototype, key)?.value;
      if (typeof method !== 'function') return [];
      const metadata = Reflect.getMetadata('mcp:tool', method);
      return metadata ? [metadata.name] : [];
    });
    expect(names).toContain('get_work_item_type_guidance_batch');
    expect(names).not.toContain('get_work_item_type_guidance');
  });

  it('supports a single key through the batch boundary', async () => {
    const { provider, getGuidanceBatch } = setup();
    const single = { results: [batch.results[0]] };
    getGuidanceBatch.mockReturnValue(single);
    const params = getWorkItemTypeGuidanceBatchParameters.parse({
      typeKeys: ['BUG'],
    });
    const result = await provider.getWorkItemTypeGuidanceBatch(
      params,
      {} as any,
      makeRequest(),
    );
    expect(getWorkItemTypeGuidanceBatchOutput.parse(result)).toEqual(single);
    expect(getGuidanceBatch).toHaveBeenCalledWith(PROJECT_ID, params);
  });

  it('rejects missing project context before querying', async () => {
    const { provider, getGuidanceBatch, findOne } = setup();
    const request = makeRequest();
    delete request.headers['x-project-id'];
    expect(
      await provider.getWorkItemTypeGuidanceBatch(
        { typeKeys: ['BUG'] },
        {} as any,
        request,
      ),
    ).toMatchObject({ isError: true });
    expect(getGuidanceBatch).not.toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('rejects administrative data in a semantic batch result', () => {
    expect(
      getWorkItemTypeGuidanceBatchOutput.safeParse({
        results: [
          { ...batch.results[0], definition: COMPLETE_SUMMARY.definition },
        ],
      }).success,
    ).toBe(false);
  });

  it('returns ordered results and forwards the complete batch request', async () => {
    const { provider, getGuidanceBatch, findOne } = setup();
    const params = {
      typeKeys: ['BUG', 'STANDARD'],
      focalTypeKey: 'FEATURE',
      purpose: WorkItemTypeGuidancePurpose.Semantic,
    };

    const result = await provider.getWorkItemTypeGuidanceBatch(
      params,
      {} as any,
      makeRequest(),
    );

    expect(result).toEqual(batch);
    expect(getWorkItemTypeGuidanceBatchOutput.parse(result)).toEqual(batch);
    expect(findOne).toHaveBeenCalledWith(PROJECT_ID, ORG_ID);
    expect(getGuidanceBatch).toHaveBeenCalledWith(PROJECT_ID, params);
  });

  it('selects maintenance guidance while allowing absent type-owned advice', async () => {
    const maintenance = {
      results: [
        { typeKey: 'STANDARD', name: 'Task' },
        {
          typeKey: 'BUG',
          name: 'Bug',
          maintenanceGuidance: 'Review the reproduction steps.',
        },
      ],
    };
    const { provider, getGuidanceBatch } = setup();
    getGuidanceBatch.mockReturnValue(maintenance);

    const result = await provider.getWorkItemTypeGuidanceBatch(
      {
        typeKeys: ['STANDARD', 'BUG'],
        purpose: WorkItemTypeGuidancePurpose.Maintenance,
      },
      {} as any,
      makeRequest(),
    );

    expect(getWorkItemTypeGuidanceBatchOutput.parse(result)).toEqual(
      maintenance,
    );
  });

  it.each(Object.values(SessionRole))(
    'requires an explicit selector and serves role %s',
    async (sessionRole) => {
      const { provider, getGuidanceBatch } = setup();
      const missing = await provider.getWorkItemTypeGuidanceBatch(
        { typeKeys: ['BUG'], purpose: WorkItemTypeGuidancePurpose.Role },
        {} as any,
        makeRequest(),
      );
      expect(missing).toMatchObject({ isError: true });
      expect(getGuidanceBatch).not.toHaveBeenCalled();
      const params = getWorkItemTypeGuidanceBatchParameters.parse({
        typeKeys: ['BUG', 'STANDARD'],
        purpose: 'role',
        sessionRole,
      });
      const result = {
        results: [
          { typeKey: 'BUG', name: 'Bug', sessionRole, guidance: 'Advice' },
          { typeKey: 'STANDARD', name: 'Task', sessionRole },
        ],
      };
      getGuidanceBatch.mockReturnValue(result);
      expect(
        await provider.getWorkItemTypeGuidanceBatch(
          params,
          {} as any,
          makeRequest(),
        ),
      ).toEqual(result);
      expect(getWorkItemTypeGuidanceBatchOutput.parse(result)).toEqual(result);
      expect(getGuidanceBatch).toHaveBeenCalledWith(PROJECT_ID, params);
    },
  );

  it('rejects empty, oversized, duplicate, or extra-field requests', () => {
    expect(
      getWorkItemTypeGuidanceBatchParameters.safeParse({
        typeKeys: Array.from({ length: 10 }, (_, i) => `TYPE_${i}`),
      }).success,
    ).toBe(true);
    for (const input of [
      { typeKeys: [] },
      { typeKeys: Array.from({ length: 11 }, (_, i) => `TYPE_${i}`) },
      { typeKeys: ['BUG', 'BUG'] },
      { typeKeys: ['BUG'], extra: true },
    ]) {
      expect(
        getWorkItemTypeGuidanceBatchParameters.safeParse(input).success,
      ).toBe(false);
    }
  });

  it('returns a clear key-specific registry error', async () => {
    const { provider, getGuidanceBatch } = setup();
    getGuidanceBatch.mockImplementation(() => {
      throw new NotFoundException("Work-item type 'UNKNOWN' was not found.");
    });

    await expect(
      provider.getWorkItemTypeGuidanceBatch(
        { typeKeys: ['BUG', 'UNKNOWN'] },
        {} as any,
        makeRequest(),
      ),
    ).resolves.toMatchObject({
      isError: true,
      content: [
        { type: 'text', text: "Work-item type 'UNKNOWN' was not found." },
      ],
    });
  });

  it('does not read registry guidance for an inaccessible project', async () => {
    const { provider, getGuidanceBatch } = setup(null);

    expect(
      await provider.getWorkItemTypeGuidanceBatch(
        { typeKeys: ['BUG'] },
        {} as any,
        makeRequest(),
      ),
    ).toMatchObject({ isError: true });
    expect(getGuidanceBatch).not.toHaveBeenCalled();
  });
});
