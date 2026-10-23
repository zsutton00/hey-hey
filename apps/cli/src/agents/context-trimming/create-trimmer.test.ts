import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JevClient, JevInput, JevResult } from '../../jev/client';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { ServerLogger } from '../../server/logger';
import type { LoadedEntityPromptContext } from '../entity-context/types';
import {
  readNearestParentFeature,
  readParentPlan,
} from '../project-assistant/nearest-parent-feature';
import { readDiagramElements } from './diagram-elements';
import { createContextTrimmer, type CreateContextTrimmerInput } from './create-trimmer';

vi.mock('../project-assistant/nearest-parent-feature', () => ({
  readNearestParentFeature: vi.fn(),
  readParentPlan: vi.fn(),
}));
vi.mock('./diagram-elements', () => ({ readDiagramElements: vi.fn() }));

const section = (key: string, order: number, materializedMarkdown: string) => ({
  id: `section-${key}`,
  key,
  order,
  materializedMarkdown,
  materializedProposalId: 'proposal-1',
});

const loadedEntity = (type: string): LoadedEntityPromptContext =>
  ({
    kind: 'entity',
    focalEntity: { entityId: 'focal-1', entityType: 'TASK' },
    entity: {
      id: 'focal-1',
      name: 'Trim context',
      type,
      organizationId: 'org-1',
      projectId: 'project-1',
      sections: [
        section('description', 0, 'Trim it.'),
        section('acceptanceCriteria', 1, 'Fewer tokens.'),
      ],
    },
    context: { entityId: 'focal-1', entityType: 'TASK', displayName: 'Trim context' },
  }) as unknown as LoadedEntityPromptContext;

const loadedProject = {
  kind: 'entity',
  focalEntity: { entityId: 'project-1', entityType: 'PROJECT' },
  entity: { id: 'project-1', name: 'Project' },
  context: { entityId: 'project-1', entityType: 'PROJECT', displayName: 'Project' },
} as unknown as LoadedEntityPromptContext;

const contextResult = {
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify({
        entityId: 'seed',
        relatedEntities: [
          { entityId: 'e1', entityType: 'TASK', displayName: 'One', relationship: 'related-to' },
        ],
      }),
    },
  ],
};

const makeLogger = () => {
  const warn = vi.fn();
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn,
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as ServerLogger;
  return { logger, warn };
};

const makeInput = (overrides: Partial<CreateContextTrimmerInput> = {}) => {
  const requests: JevInput[] = [];
  const evaluate = vi.fn((input: JevInput): Promise<JevResult> => {
    requests.push(input);
    return Promise.resolve({ ok: false, failure: { code: 'PROVIDER_ERROR', message: 'x' } });
  });
  const { logger, warn } = makeLogger();
  const input: CreateContextTrimmerInput = {
    promptType: LocalPromptType.ProjectAssistant,
    jevClient: { evaluate } as unknown as JevClient,
    cache: new Map(),
    loadedEntityContext: loadedEntity('STANDARD'),
    payload: { userMessage: '  Look at the proxy.  ' },
    deps: {} as CreateContextTrimmerInput['deps'],
    logger,
    ...overrides,
  };
  return { input, requests, evaluate, warn };
};

/** The state Jev is sent shows which focal the trimmer ranks against. */
const stateSentBy = async (input: CreateContextTrimmerInput, requests: JevInput[]) => {
  const trimmer = await createContextTrimmer(input);
  expect(trimmer).toBeDefined();
  await trimmer?.trimResult(contextResult);
  return requests[0]?.state;
};

describe('createContextTrimmer', () => {
  beforeEach(() => {
    vi.mocked(readNearestParentFeature).mockReset();
    vi.mocked(readParentPlan).mockReset().mockResolvedValue(null);
  });

  it('ranks a task against its description, criteria and the full parent feature', async () => {
    vi.mocked(readNearestParentFeature).mockResolvedValue({
      id: 'parent-1',
      name: 'Jev Integration',
      sections: [section('requirements', 1, 'Second.'), section('description', 0, 'First.')],
    } as never);
    const { input, requests } = makeInput();

    expect(await stateSentBy(input, requests)).toMatchObject({
      task: { name: 'Trim context', description: 'Trim it.', acceptance_criteria: 'Fewer tokens.' },
      parent_feature: { name: 'Jev Integration', description: 'First.\n\nSecond.' },
    });
  });

  it('ranks a mockup against its description and the full parent feature, without acceptance criteria', async () => {
    vi.mocked(readNearestParentFeature).mockResolvedValue({
      id: 'parent-1',
      name: 'Jev Integration',
      sections: [section('description', 0, 'First.')],
    } as never);
    const { input, requests } = makeInput({ loadedEntityContext: loadedEntity('mockup') });

    const state = await stateSentBy(input, requests);
    expect(state).toMatchObject({
      focal: { name: 'Trim context', description: 'Trim it.' },
      parent_feature: { name: 'Jev Integration', description: 'First.' },
    });
    expect(state).not.toHaveProperty('task');
    expect(state).not.toHaveProperty('diagram_elements');
  });

  it('ranks a DIAGRAM against its description, its elements and the full parent feature', async () => {
    vi.mocked(readNearestParentFeature).mockResolvedValue({
      id: 'parent-1',
      name: 'Jev Integration',
      sections: [section('description', 0, 'First.')],
    } as never);
    vi.mocked(readDiagramElements).mockResolvedValue([
      { name: 'Call start-run', description: 'Delivers the request.' },
    ]);
    const { input, requests } = makeInput({ loadedEntityContext: loadedEntity('DIAGRAM') });

    const state = await stateSentBy(input, requests);
    expect(readDiagramElements).toHaveBeenCalledWith(
      { organizationId: 'org-1', projectId: 'project-1', diagramId: 'focal-1' },
      input.deps,
    );
    expect(state).toMatchObject({
      focal: { name: 'Trim context', description: 'Trim it.' },
      diagram_elements: { '1. Call start-run': 'Delivers the request.' },
      parent_feature: { name: 'Jev Integration', description: 'First.' },
    });
    expect(state).not.toHaveProperty('task');
  });

  it.each([LocalPromptType.FeatureSyncAnalyze, LocalPromptType.FeatureSyncIterate])(
    'trims for %s',
    async (promptType) => {
      vi.mocked(readNearestParentFeature).mockResolvedValue({
        id: 'parent-1',
        name: 'Parent',
        sections: [],
      } as never);
      const { input } = makeInput({ promptType });

      expect(await createContextTrimmer(input)).toBeDefined();
    },
  );

  it('ranks a feature against its own description', async () => {
    const { input, requests } = makeInput({ loadedEntityContext: loadedEntity('FEATURE') });

    expect(await stateSentBy(input, requests)).toMatchObject({
      focal: { name: 'Trim context', description: 'Trim it.' },
    });
    expect(readNearestParentFeature).not.toHaveBeenCalled();
  });

  it('ranks against the user message when the focal entity is not a task or feature', async () => {
    const { input, requests } = makeInput({ loadedEntityContext: loadedProject });

    expect(await stateSentBy(input, requests)).toMatchObject({
      focal: { description: 'Look at the proxy.' },
    });
  });

  it('does not trim without a Jev client', async () => {
    const { input } = makeInput({ jevClient: undefined });

    expect(await createContextTrimmer(input)).toBeUndefined();
  });

  it('does not trim for other handlers', async () => {
    const { input } = makeInput({ promptType: LocalPromptType.Implement });

    expect(await createContextTrimmer(input)).toBeUndefined();
    expect(readNearestParentFeature).not.toHaveBeenCalled();
  });

  it.each([
    ['the Context is not loaded', { loadedEntityContext: null }, 'focal_context_not_loaded'],
    [
      'there is nothing to rank against',
      { loadedEntityContext: loadedProject, payload: {} },
      'no_focal_work',
    ],
  ])('logs why it does not trim when %s', async (_name, overrides, reason) => {
    const { input, warn } = makeInput(overrides);

    expect(await createContextTrimmer(input)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      'local.platform_mcp_proxy.get_context_trim.disabled',
      expect.objectContaining({ reason }),
    );
  });

  it('ranks a planned task against the plan it belongs to', async () => {
    vi.mocked(readNearestParentFeature).mockResolvedValue(null);
    vi.mocked(readParentPlan).mockResolvedValue({
      id: 'plan-1',
      name: 'Eval rollout',
      sections: [section('description', 0, 'Ship evals in stages.')],
    } as never);
    const { input, requests } = makeInput();

    const state = await stateSentBy(input, requests);
    expect(state).toMatchObject({
      task: { name: 'Trim context' },
      parent_plan: { name: 'Eval rollout', description: 'Ship evals in stages.' },
    });
    expect(state).not.toHaveProperty('parent_feature');
  });

  it('ranks a task with no parent feature or plan against the task alone', async () => {
    vi.mocked(readNearestParentFeature).mockResolvedValue(null);
    const { input, requests, warn } = makeInput();

    const state = await stateSentBy(input, requests);
    expect(state).toMatchObject({ task: { name: 'Trim context' } });
    expect(state).not.toHaveProperty('parent_feature');
    expect(state).not.toHaveProperty('parent_plan');
    expect(warn).not.toHaveBeenCalledWith(
      'local.platform_mcp_proxy.get_context_trim.disabled',
      expect.objectContaining({ reason: 'no_focal_work' }),
    );
  });

  it('prefers the parent feature over the plan', async () => {
    vi.mocked(readNearestParentFeature).mockResolvedValue({
      id: 'parent-1',
      name: 'Jev Integration',
      sections: [section('description', 0, 'First.')],
    } as never);
    const { input, requests } = makeInput();

    expect(await stateSentBy(input, requests)).not.toHaveProperty('parent_plan');
    expect(readParentPlan).not.toHaveBeenCalled();
  });

  it('logs and runs untrimmed when the parent feature cannot be read', async () => {
    vi.mocked(readNearestParentFeature).mockRejectedValue(new Error('HTTP 500'));
    const { input, warn } = makeInput();

    expect(await createContextTrimmer(input)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('local.platform_mcp_proxy.get_context_trim.disabled', {
      reason: 'focal_unavailable',
      error: 'HTTP 500',
    });
  });
});
