import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgenticSession } from '../../../session/types';
import type { AgentEdgeResponseDto, FeatureSkeletonNode } from '../../../shared/api/generated/api';
import { LocalPromptType } from '../../../shared/agent-bridge-contract/generated/api';
import type { LocalFeatureTreeConversationPromptPayload } from '../../../shared/agent-bridge-contract/runtime-types';
import { PromptTypeRegistry } from '../../prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../../prompt-type-registry.test-support';
import type { PromptTypeHandlerDeps } from '../../prompt-type-handler';
import {
  createPromptTypeHandlerTestAuth,
  createPromptTypeHandlerTestDeps,
} from '../../prompt-type-handler.test-support';
import { featureTreeConversationHandler } from '../feature-tree-conversation.handler';
import { buildFeatureTreeConversationPrompt } from '../feature-tree-conversation-prompt';
import { createTestSessionRunnerFacade } from '../../../run/run.test-support';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '22222222-2222-2222-2222-222222222222';

const makeLogger = (): PromptTypeHandlerDeps['logger'] =>
  ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }) as unknown as PromptTypeHandlerDeps['logger'];

const makeSession = (overrides: Partial<AgenticSession> = {}): AgenticSession =>
  ({
    agentic_session_id: 'run-1',
    contextMetadata: {
      capturedAt: '2026-05-16T00:00:00Z',
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      fileReferences: { resolved: [], unresolved: [] },
    },
    ...overrides,
  }) as unknown as AgenticSession;

const makeSkeletonNode = (overrides: Partial<FeatureSkeletonNode> = {}): FeatureSkeletonNode =>
  ({
    id: 'feat-1',
    name: 'Plans',
    tag: 'product',
    status: 'IN_PROGRESS',
    parentId: null,
    depth: 0,
    taskCount: 3,
    ...overrides,
  }) as FeatureSkeletonNode;

const makeEdge = (overrides: Partial<AgentEdgeResponseDto> = {}): AgentEdgeResponseDto =>
  ({
    id: 'edge-1',
    sourceNodeId: 'a',
    targetNodeId: 'b',
    type: 'DEPENDS_ON',
    reasoning: 'because',
    createdAt: '2026-05-16T00:00:00Z',
    updatedAt: '2026-05-16T00:00:00Z',
    ...overrides,
  }) as AgentEdgeResponseDto;

describe('featureTreeConversationHandler — registration & allowlist', () => {
  const registry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

  it('registers under the feature_tree_conversation prompt type', () => {
    expect(featureTreeConversationHandler.promptType).toBe(LocalPromptType.FeatureTreeConversation);
  });

  it('is resolved by the prompt-type registry under the feature_tree_conversation key', async () => {
    expect(registry.get(LocalPromptType.FeatureTreeConversation)?.promptType).toBe(
      LocalPromptType.FeatureTreeConversation,
    );
  });

  it('runs on the persisted provider session and declares no required reports', () => {
    expect(featureTreeConversationHandler.runnerKind).toBe('provider_session');
    expect(featureTreeConversationHandler.reports).toEqual([]);
  });

  it('declares get_context/list_features/edit_work_item/create_work_item/create_edge as additional MCP tools', () => {
    const extras = featureTreeConversationHandler.additionalAllowedTools ?? [];
    expect(extras).toEqual(
      expect.arrayContaining([
        'get_context',
        'list_features',
        'edit_work_item',
        'create_work_item',
        'create_edge',
      ]),
    );
    expect(extras).not.toContain('create_report');
  });

  it('declares WebSearch and WebFetch as additional built-in tools', () => {
    const builtins = featureTreeConversationHandler.additionalBuiltinTools ?? [];
    expect(builtins).toEqual(expect.arrayContaining(['WebSearch', 'WebFetch']));
  });
});

describe('featureTreeConversationHandler.prepare', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;
  let deps: PromptTypeHandlerDeps;

  beforeEach(() => {
    fetchImpl = vi.fn();
    deps = createPromptTypeHandlerTestDeps({
      fetchImpl: fetchImpl as unknown as PromptTypeHandlerDeps['fetchImpl'],
      auth: createPromptTypeHandlerTestAuth('token-xyz'),
      apiBaseUrl: 'https://api.test/v1',
      logger: makeLogger(),
    });
  });

  it('fetches the skeleton then the agent edges from contextMetadata ids and stashes both on the enriched payload', async () => {
    const skeleton = [
      makeSkeletonNode({ id: 'a', name: 'Plans' }),
      makeSkeletonNode({ id: 'b', name: 'Daily Session', depth: 1, parentId: 'a' }),
    ];
    const edges = [
      makeEdge({ id: 'e1', sourceNodeId: 'a', targetNodeId: 'b', type: 'DEPENDS_ON' }),
    ];
    fetchImpl
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: skeleton }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ content: edges, page: { totalPages: 1 } }),
      });

    const payload: LocalFeatureTreeConversationPromptPayload = { projectId: PROJECT_ID };
    const result = await featureTreeConversationHandler.prepare!(makeSession(), payload, deps);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [skeletonUrl, skeletonInit] = fetchImpl.mock.calls[0]!;
    expect(skeletonUrl).toBe(
      `https://api.test/v1/organizations/${ORG_ID}/projects/${PROJECT_ID}/features/skeleton`,
    );
    expect((skeletonInit as RequestInit).method).toBe('GET');

    const [edgesUrl, edgesInit] = fetchImpl.mock.calls[1]!;
    expect(edgesUrl).toContain(
      `https://api.test/v1/organizations/${ORG_ID}/projects/${PROJECT_ID}/agent-edges`,
    );
    expect((edgesInit as RequestInit).method).toBe('GET');
    expect(((edgesInit as RequestInit).headers as Record<string, string>)['Authorization']).toBe(
      'Bearer token-xyz',
    );

    // The skeleton must be stashed on the returned payload so buildPrompt
    // can read it back without re-fetching.
    expect((result.payload as { _skeleton?: FeatureSkeletonNode[] })._skeleton).toEqual(skeleton);

    // Edges are indexed by each incident feature id so the prompt can annotate
    // both endpoints in the tree.
    const byFeature = (
      result.payload as { _edgesByFeatureId?: Map<string, AgentEdgeResponseDto[]> }
    )._edgesByFeatureId;
    expect(byFeature?.get('a')).toEqual(edges);
    expect(byFeature?.get('b')).toEqual(edges);
  });

  it('returns an empty-skeleton enriched payload (does not throw) when the endpoint errors so a transient API hiccup does not block the session', async () => {
    fetchImpl.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'gateway',
      json: async () => ({}),
    });

    const result = await featureTreeConversationHandler.prepare!(
      makeSession(),
      { projectId: PROJECT_ID },
      deps,
    );

    expect((result.payload as { _skeleton?: FeatureSkeletonNode[] })._skeleton).toEqual([]);
  });

  it('skips the fetch and stashes an empty skeleton when the run is missing organizationId or projectId', async () => {
    const sessionMissingProject = makeSession({
      contextMetadata: {
        capturedAt: '2026-05-16T00:00:00Z',
        organizationId: ORG_ID,
        fileReferences: { resolved: [], unresolved: [] },
      } as unknown as AgenticSession['contextMetadata'],
    });

    const result = await featureTreeConversationHandler.prepare!(
      sessionMissingProject,
      { projectId: PROJECT_ID },
      deps,
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect((result.payload as { _skeleton?: FeatureSkeletonNode[] })._skeleton).toEqual([]);
  });
});

describe('featureTreeConversationHandler.buildPrompt', () => {
  it('renders the skeleton plus the three-mode instructions and the WebSearch gating clause', () => {
    const enriched: LocalFeatureTreeConversationPromptPayload & {
      _skeleton?: FeatureSkeletonNode[];
      _edgesByFeatureId?: Map<string, AgentEdgeResponseDto[]>;
    } = {
      projectId: PROJECT_ID,
      userMessage: 'help me see how this tree is unbalanced',
      _skeleton: [
        makeSkeletonNode({ id: 'feat-1', name: 'Plans' }),
        makeSkeletonNode({
          id: 'feat-2',
          name: 'Daily Session',
          depth: 1,
          parentId: 'feat-1',
          tag: 'frontend',
          taskCount: 7,
        }),
      ],
      _edgesByFeatureId: new Map([
        [
          'feat-2',
          [
            makeEdge({
              id: 'e1',
              sourceNodeId: 'feat-1',
              targetNodeId: 'feat-2',
              type: 'SUPERSEDES',
            }),
          ],
        ],
      ]),
    };

    const prompt = featureTreeConversationHandler.buildPrompt(enriched);

    // Skeleton renders as feature mentions so the agent reads it as a tree.
    expect(prompt).toContain('@[feature:feat-1|Plans]');
    expect(prompt).toContain('@[feature:feat-2|Daily Session]');
    expect(prompt).toContain('taskCount=7');

    // The stale status column is gone from the injected skeleton.
    expect(prompt).not.toContain('status=');

    // Incident edges annotate the relevant line: feat-2 has an incoming
    // SUPERSEDES from feat-1, rendered as a mention.
    expect(prompt).toContain('← SUPERSEDES @[feature:feat-1|Plans]');

    // All three modes are described.
    expect(prompt).toMatch(/Structural rebalancing/i);
    expect(prompt).toMatch(/Project insights/i);
    expect(prompt).toMatch(/Competitive analysis/i);

    // WebSearch / WebFetch are explicitly gated to the competitive-analysis
    // mode and explicitly forbidden in the structural and insights modes.
    expect(prompt).toMatch(/WebSearch and WebFetch are forbidden/i);
    expect(prompt).toMatch(/explicit user request/i);

    // Competitive analysis must require a competitive_analysis report with
    // linked entity IDs.
    expect(prompt).toContain('competitive_analysis');
    expect(prompt).toContain('linkedEntityIds');

    // The user's message is no longer woven into the system prompt — it is
    // injected at the prompt end by the resolver via `addUserMessage`.
    expect(prompt).not.toContain('help me see how this tree is unbalanced');
  });

  it('formats the user message under its turn heading via addUserMessage', () => {
    expect(
      featureTreeConversationHandler.addUserMessage({
        projectId: PROJECT_ID,
        userMessage: 'help me see how this tree is unbalanced',
      }),
    ).toBe('\n\n## User message for this turn\n\nhelp me see how this tree is unbalanced');

    expect(featureTreeConversationHandler.addUserMessage({ projectId: PROJECT_ID })).toBeNull();
  });

  it('falls back to an empty-tree note when the skeleton is empty (prepare failed)', () => {
    const prompt = buildFeatureTreeConversationPrompt({ skeleton: [] });
    expect(prompt).toMatch(/no FEATURE tasks yet/i);
  });

  it('uses paired examples to rename mechanisms without flattening technical child capabilities', () => {
    const prompt = buildFeatureTreeConversationPrompt({ skeleton: [] });
    expect(prompt).toContain('Mechanism-shaped names');
    expect(prompt).toContain('`Send Updates over WebSockets` → `Live Updates`');
    expect(prompt).toContain('`Build SearchIndexService` → `Feature Search`');
    expect(prompt).toContain('`Normalize Events before Indexing` → `Searchable Activity`');
    expect(prompt).toContain('properly nested technical capability such as `Event Delivery`');
    expect(prompt).toContain('not a closed vocabulary');
  });

  it('includes custom-type drafting and project-owned read-modify-submit edit guidance', () => {
    const prompt = buildFeatureTreeConversationPrompt({ skeleton: [] });
    expect(prompt).toContain('## Drafting a custom work-item type');
    // Ground on how a core type is declared before composing.
    expect(prompt).toContain('get_tool_guidance');
    expect(prompt).toContain('ground on how a core type is declared');
    // Compose a complete definition spanning every axis.
    expect(prompt).toContain('compose a complete definition across every axis');
    // Submit through the allow-listed tool for review.
    expect(prompt).toContain('create_work_item_type');
    expect(prompt).toContain('get_work_item_type({ typeKey })');
    expect(prompt).toContain('returned complete `definition`');
    expect(prompt).toContain('CANONICAL_OVERRIDE');
    expect(prompt).toContain('PROJECT_CUSTOM');
    expect(prompt).toContain(
      'complete project override over the immutable global canonical definition',
    );
    expect(prompt).toContain('change only the fields the user requested');
    expect(prompt).toContain('preserve every other axis verbatim');
    expect(prompt).toContain('edit_work_item_type');
    expect(prompt).toContain('never reconstruct omitted axes from prompt history');
    expect(prompt).toContain('never edit the global seed directly');
    // User-initiated only — flat rule, no escape hatch.
    expect(prompt).toContain('never propose one unsolicited');
  });
});

describe('session-runner forwarding of additionalBuiltinTools', () => {
  it('forwards the handler-declared built-in tools through new-session-runner into runPrompt', async () => {
    const { NewSessionRunner } = await import('../../../run/runners/new-session-runner');
    const runPromptMock = vi.fn().mockResolvedValue({
      providerSessionId: 'prov-1',
      providerConversationId: null,
      errorCount: 0,
    });
    const ctx = {
      run: {
        session: makeSession(),
        refreshSessionFields: vi.fn(),
        setHasProviderSession: vi.fn(),
      },
      handler: featureTreeConversationHandler,
      resolvedPrompt: 'do the thing',
      input: {},
      effectiveModel: undefined,
      effectiveReasoningEffort: undefined,
    } as unknown as ConstructorParameters<typeof NewSessionRunner>[0];

    const sessionRunnerFacade = createTestSessionRunnerFacade();
    vi.mocked(sessionRunnerFacade.runPrompt).mockImplementation(runPromptMock);
    const runner = new NewSessionRunner(ctx, {
      sessionRunnerFacade,
      logger: makeLogger(),
    });

    await runner.run(new AbortController().signal);

    expect(runPromptMock).toHaveBeenCalledTimes(1);
    const args = runPromptMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(args['additionalAllowedTools']).toEqual(
      expect.arrayContaining([
        'get_context',
        'list_features',
        'edit_work_item',
        'create_work_item',
        'create_edge',
      ]),
    );
    expect(
      (args['additionalAllowedTools'] as string[] | undefined)?.includes('create_report'),
    ).toBe(false);
    expect(args['additionalBuiltinTools']).toEqual(
      expect.arrayContaining(['WebSearch', 'WebFetch']),
    );
  });
});

describe('feature-tree-conversation trigger payload zod schema', () => {
  it('rejects a missing projectId at the dispatcher boundary', async () => {
    const { validateTriggerPayload, TriggerPayloadValidationError } =
      await import('../../../server/conversation-dispatch/trigger-payload-schemas');
    expect(() =>
      validateTriggerPayload(LocalPromptType.FeatureTreeConversation, {
        userMessage: 'hi',
      }),
    ).toThrow(TriggerPayloadValidationError);
  });

  it('rejects a non-UUID projectId', async () => {
    const { validateTriggerPayload, TriggerPayloadValidationError } =
      await import('../../../server/conversation-dispatch/trigger-payload-schemas');
    expect(() =>
      validateTriggerPayload(LocalPromptType.FeatureTreeConversation, {
        projectId: 'not-a-uuid',
      }),
    ).toThrow(TriggerPayloadValidationError);
  });

  it('accepts a well-formed payload with just a UUID projectId', async () => {
    const { validateTriggerPayload } =
      await import('../../../server/conversation-dispatch/trigger-payload-schemas');
    const out = validateTriggerPayload(LocalPromptType.FeatureTreeConversation, {
      projectId: PROJECT_ID,
    });
    expect(out).toEqual({ projectId: PROJECT_ID });
  });

  it('accepts a well-formed payload with projectId + optional userMessage', async () => {
    const { validateTriggerPayload } =
      await import('../../../server/conversation-dispatch/trigger-payload-schemas');
    const out = validateTriggerPayload(LocalPromptType.FeatureTreeConversation, {
      projectId: PROJECT_ID,
      userMessage: 'kick off the conversation',
    });
    expect(out).toEqual({
      projectId: PROJECT_ID,
      userMessage: 'kick off the conversation',
    });
  });
});
