import { describe, expect, it, vi } from 'vitest';
import {
  createMockupReader,
  MockupReadError,
  type MockupReaderClients,
} from './mockup-page-reader';

const definition = {
  sections: [
    {
      key: 'preview',
      kind: 'html/css',
      defaultSizeKey: 'panel',
      sizeProfiles: [
        {
          key: 'panel',
          breakpoints: [{ minContainerWidth: 0, page: { width: 800, height: 600 } }],
        },
      ],
    },
  ],
};

const clientsWith = ({
  updates,
  targetEntityType = 'TASK',
  taskType = 'mockup',
}: {
  updates: Record<string, unknown>;
  targetEntityType?: string;
  taskType?: string;
}) => {
  const tasksGet = vi.fn(() => Promise.resolve({ data: { data: { type: taskType } } }));
  const typeGet = vi.fn(() => Promise.resolve({ data: { data: { definition } } }));
  const clients = {
    tasks: { organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet: tasksGet },
    workItemTypes: { organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeyGet: typeGet },
    proposals: {
      getProposal: () =>
        Promise.resolve({
          data: { data: { targetEntityType, targetEntityId: 'task-1', updates } },
        }),
    },
  } as unknown as MockupReaderClients;
  return { clients, tasksGet, typeGet };
};

const location = {
  kind: 'proposal' as const,
  organizationId: 'org',
  projectId: 'project',
  proposalId: 'proposal-1',
  sectionKey: 'preview',
  sizeKey: null,
};

describe('createMockupReader for a proposal', () => {
  it('reads the proposed section without a revision, using the item type for an update', async () => {
    const { clients, tasksGet, typeGet } = clientsWith({
      updates: { sections: [{ key: 'preview', content: '{"html":"<p>x</p>","css":""}' }] },
    });
    const mockup = await createMockupReader(clients)(location);
    expect(mockup).toEqual({
      html: '<p>x</p>',
      css: '',
      sizeKey: 'panel',
      width: 800,
      height: 600,
      revision: null,
    });
    expect(tasksGet).toHaveBeenCalledWith({
      organizationId: 'org',
      projectId: 'project',
      taskId: 'task-1',
    });
    expect(typeGet).toHaveBeenCalledWith(expect.objectContaining({ typeKey: 'mockup' }));
  });

  it("uses a create proposal's own type and accepts object content", async () => {
    const { clients, tasksGet, typeGet } = clientsWith({
      updates: { type: 'other', sections: [{ key: 'preview', content: { html: 'a', css: 'b' } }] },
    });
    await expect(createMockupReader(clients)(location)).resolves.toMatchObject({ html: 'a' });
    expect(tasksGet).not.toHaveBeenCalled();
    expect(typeGet).toHaveBeenCalledWith(expect.objectContaining({ typeKey: 'other' }));
  });

  it('fails as not found when the proposal does not propose the section', async () => {
    const { clients } = clientsWith({ updates: { sections: [] } });
    await expect(createMockupReader(clients)(location)).rejects.toMatchObject({
      failure: 'not_found',
    });
  });

  it('fails as unreadable when the proposed content has an unexpected shape', async () => {
    const { clients } = clientsWith({
      updates: { sections: [{ key: 'preview', content: 'not json' }] },
    });
    await expect(createMockupReader(clients)(location)).rejects.toBeInstanceOf(MockupReadError);
  });
});
