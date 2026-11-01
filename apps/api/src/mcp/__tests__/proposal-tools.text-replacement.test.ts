import {
  editWorkItemParameters,
  ProposalToolsProvider,
} from '../tools/proposal-tools.provider';
import type { ProposalService } from '../../services/proposal/proposal.service';
import type { TaskService } from '../../services/tasks/task.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { createWarmWorkItemTypeRegistry } from '../../../test/setup/work-item-type-registry.fixture';
import { guidanceTokenForType } from '../tools/work-item-guidance-token';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const TASK_ID = '00000000-0000-4000-8000-000000000010';
const PROPOSAL_ID = '00000000-0000-4000-8000-000000000020';

let registry: WorkItemTypeRegistryService;

beforeAll(async () => {
  registry = await createWarmWorkItemTypeRegistry();
});

function request() {
  return {
    headers: { authorization: 'Bearer token', 'x-project-id': PROJECT_ID },
    cookies: {},
    user: {
      userId: 'user-1',
      email: 'test@example.com',
      name: 'Test',
      currentOrgId: ORG_ID,
      orgMemberships: [],
      isDevAdmin: false,
      devAdminMode: false,
    },
    ip: '127.0.0.1',
  } as any;
}

function providerFor(original: Record<string, unknown>) {
  const proposalCreate = jest.fn().mockResolvedValue({
    id: PROPOSAL_ID,
    action: 'UPDATE',
    targetEntityType: 'TASK',
    targetEntityId: TASK_ID,
    createdAt: '2026-09-20T00:00:00.000Z',
  });
  const proposalService = {
    create: proposalCreate,
    findOne: jest.fn(),
  } as unknown as ProposalService;
  const taskService = {
    findOne: jest.fn().mockResolvedValue(original),
  } as unknown as TaskService;
  const lintRecovery = {
    markNeedsRevision: jest.fn().mockResolvedValue(undefined),
    consumeRecovery: jest.fn().mockResolvedValue(false),
  } as any;
  const prisma = {
    db: {
      task: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      designDoc: { findMany: jest.fn().mockResolvedValue([]) },
    },
  } as any;
  return {
    provider: new ProposalToolsProvider(
      proposalService,
      taskService,
      lintRecovery,
      registry,
      prisma,
    ),
    proposalCreate,
  };
}

function standardOriginal(content: string) {
  return {
    id: TASK_ID,
    type: 'STANDARD',
    sections: [{ key: 'description', materializedMarkdown: content }],
  };
}

function replacement(overrides: Record<string, unknown> = {}) {
  return {
    eli5: 'Explains the proposed change.',
    targetEntityId: TASK_ID,
    textReplacement: {
      sectionKey: 'description',
      find: 'old phrase',
      replace: 'new phrase',
    },
    guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
    ...overrides,
  } as any;
}

function errorText(result: any): string {
  return result.content?.[0]?.text ?? '';
}

describe('edit_work_item textReplacement', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exposes one strict structured replacement parameter', () => {
    expect(editWorkItemParameters.shape.textReplacement).toBeDefined();
    expect(editWorkItemParameters.safeParse(replacement()).success).toBe(true);
    expect(
      editWorkItemParameters.safeParse(
        replacement({
          textReplacement: {
            sectionKey: 'description',
            find: 'old phrase',
            replace: 'new phrase',
            unexpected: true,
          },
        }),
      ).success,
    ).toBe(false);
  });

  it('normalizes a literal match to a complete section update before persistence', async () => {
    const current =
      'This old phrase describes a concrete capability with enough context for review.';
    const { provider, proposalCreate } = providerFor(standardOriginal(current));

    const result = await provider.editWorkItem(
      replacement(),
      {} as any,
      request(),
    );

    expect(result).toMatchObject({ status: 'proposed' });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
    const dto = proposalCreate.mock.calls[0]![3];
    expect(dto.updates).toEqual({
      sections: [
        {
          key: 'description',
          content:
            'This new phrase describes a concrete capability with enough context for review.',
        },
      ],
    });
    expect(JSON.stringify(dto.updates)).not.toContain('textReplacement');
    expect(JSON.stringify(dto.updates)).not.toContain('old phrase');
  });

  it('accepts legacy Markdown definitions that omit the kind field', async () => {
    const definitionSpy = jest
      .spyOn(registry, 'getSectionDefinition')
      .mockReturnValueOnce({
        key: 'description',
        label: 'Description',
      } as any);
    const { provider, proposalCreate } = providerFor(
      standardOriginal(
        'This old phrase describes a concrete capability with enough context for review.',
      ),
    );

    const result = await provider.editWorkItem(
      replacement(),
      {} as any,
      request(),
    );

    expect(result).toMatchObject({ status: 'proposed' });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
    definitionSpy.mockRestore();
  });

  it.each([
    ['zero', 'No matching source text is present.', 0],
    ['multiple', 'old phrase and another old phrase are present.', 2],
  ])(
    'rejects %s literal matches without persistence',
    async (_name, content, count) => {
      const { provider, proposalCreate } = providerFor(
        standardOriginal(content),
      );

      const result = await provider.editWorkItem(
        replacement(),
        {} as any,
        request(),
      );

      expect(errorText(result)).toContain(`occurred ${count} times`);
      expect(proposalCreate).not.toHaveBeenCalled();
    },
  );

  it('counts overlapping literal matches as multiple occurrences', async () => {
    const { provider, proposalCreate } = providerFor(standardOriginal('aaa'));

    const result = await provider.editWorkItem(
      replacement({
        textReplacement: {
          sectionKey: 'description',
          find: 'aa',
          replace: 'new phrase',
        },
      }),
      {} as any,
      request(),
    );

    expect(errorText(result)).toContain('occurred 2 times');
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('uses literal rather than regular-expression matching', async () => {
    const { provider, proposalCreate } = providerFor(
      standardOriginal(
        'Keep a.b literally in this sufficiently descriptive sentence.',
      ),
    );

    await provider.editWorkItem(
      replacement({
        textReplacement: {
          sectionKey: 'description',
          find: 'a.b',
          replace: 'x[y]',
        },
      }),
      {} as any,
      request(),
    );

    expect(
      proposalCreate.mock.calls[0]![3].updates.sections[0].content,
    ).toContain('x[y]');
  });

  it('rejects direct content for the replacement section', async () => {
    const { provider, proposalCreate } = providerFor(
      standardOriginal('The old phrase is canonical.'),
    );
    const result = await provider.editWorkItem(
      replacement({
        sections: [{ key: 'description', content: 'Direct content.' }],
      }),
      {} as any,
      request(),
    );

    expect(errorText(result)).toContain('cannot be combined');
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects registry JSON and graph-shaped sections', async () => {
    const original = {
      id: TASK_ID,
      type: 'DIAGRAM',
      sections: [{ key: 'graphLayout', materializedMarkdown: '{"nodes":[]}' }],
    };
    const { provider, proposalCreate } = providerFor(original);
    const result = await provider.editWorkItem(
      replacement({
        textReplacement: {
          sectionKey: 'graphLayout',
          find: 'nodes',
          replace: 'items',
        },
        guidanceToken: guidanceTokenForType('DIAGRAM', PROJECT_ID),
      }),
      {} as any,
      request(),
    );

    expect(errorText(result)).toContain('only accepted for Markdown sections');
    expect(errorText(result)).toContain('kind "json"');
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('enforces guidance after normalization', async () => {
    const { provider, proposalCreate } = providerFor(
      standardOriginal('The old phrase is canonical.'),
    );
    const result = await provider.editWorkItem(
      replacement({ guidanceToken: undefined }),
      {} as any,
      request(),
    );

    expect(errorText(result)).toContain('guidanceToken');
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('lints the transformed content and does not persist blocking results', async () => {
    const { provider, proposalCreate } = providerFor(
      standardOriginal('Replace old phrase here.'),
    );
    const result = await provider.editWorkItem(
      replacement({
        textReplacement: {
          sectionKey: 'description',
          find: 'old phrase',
          replace: 'one\n\ntwo\n\nthree\n\nfour',
        },
      }),
      {} as any,
      request(),
    );

    expect(result).toMatchObject({ status: 'needs_revision' });
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it('rejects text replacement in the schema-backed requirements section', async () => {
    const original = {
      id: TASK_ID,
      type: 'FEATURE',
      sections: [
        {
          key: 'requirements',
          materializedMarkdown: JSON.stringify({ records: [] }),
        },
      ],
    };
    const { provider, proposalCreate } = providerFor(original);
    const result = await provider.editWorkItem(
      replacement({
        textReplacement: {
          sectionKey: 'requirements',
          find: 'old phrase',
          replace: 'new phrase',
        },
        guidanceToken: guidanceTokenForType('FEATURE', PROJECT_ID),
      }),
      {} as any,
      request(),
    );

    expect(errorText(result)).toContain(
      'textReplacement is only accepted for Markdown sections; section "requirements" has kind "json".',
    );
    expect(proposalCreate).not.toHaveBeenCalled();
  });
});
