import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgenticSession } from '../../../session/types';
import { LocalPromptType } from '../../../shared/agent-bridge-contract/generated/api';
import type { LocalResearchPromptPayload } from '../../../shared/agent-bridge-contract/index';
import { PromptTypeRegistry } from '../../prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../../prompt-type-registry.test-support';
import type { PromptTypeHandlerDeps } from '../../prompt-type-handler';
import {
  createPromptTypeHandlerTestAuth,
  createPromptTypeHandlerTestDeps,
} from '../../prompt-type-handler.test-support';
import { researchHandler, type ResearchChildPayload } from '../research.handler';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '22222222-2222-2222-2222-222222222222';
const TASK_ID = '33333333-3333-3333-3333-333333333333';

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
    entity: { entityType: 'TASK', entityId: TASK_ID },
    agentic_session_id: 'run-research-1',
    contextMetadata: {
      capturedAt: '2026-06-05T00:00:00Z',
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      fileReferences: { resolved: [], unresolved: [] },
    },
    ...overrides,
  }) as unknown as AgenticSession;

const makePayload = (
  overrides: Partial<LocalResearchPromptPayload> = {},
): LocalResearchPromptPayload =>
  ({
    startupInput: {
      task: { id: TASK_ID, title: 'Wire research mode' },
      adjacentScopeTasks: [],
      evidenceItems: [],
    },
    ...overrides,
  }) as LocalResearchPromptPayload;

describe('researchHandler — registration & toolset', () => {
  const registry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

  it('registers under the research prompt type', () => {
    expect(researchHandler.promptType).toBe(LocalPromptType.Research);
    expect(researchHandler.replaceProviderSystemPrompt).toBe(true);
  });

  it('is resolved by the prompt-type registry under the research key', async () => {
    expect(registry.get(LocalPromptType.Research)?.promptType).toBe(LocalPromptType.Research);
  });

  it('runs on the persisted provider session and declares no required reports', () => {
    expect(researchHandler.runnerKind).toBe('provider_session');
    expect(researchHandler.reports).toEqual([]);
  });

  it('declares the research MCP tool use case (read-only base)', () => {
    expect(researchHandler.mcpToolUseCase).toBe('research');
  });

  it('exposes no create_*, edit_*, create_edge, proposal, or report tools', () => {
    const extras = researchHandler.additionalAllowedTools ?? [];
    const builtins = researchHandler.additionalBuiltinTools ?? [];
    const forbidden = [
      'create_work_item',
      'edit_work_item',
      'edit_tasks',
      'create_step',
      'update_step',
      'create_plan',
      'create_edge',
      'update_edge',
      'delete_edge',
      'update_proposal',
      'get_proposal',
      'create_report',
      'create_implementation_hint',
      'edit_implementation_hint',
      'delete_implementation_hint',
    ];
    for (const tool of forbidden) {
      expect(extras).not.toContain(tool);
      expect(builtins).not.toContain(tool);
    }
  });
});

describe('researchHandler.prepare', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;
  let deps: PromptTypeHandlerDeps;

  beforeEach(() => {
    fetchImpl = vi.fn();
    deps = createPromptTypeHandlerTestDeps({
      fetchImpl: fetchImpl as unknown as PromptTypeHandlerDeps['fetchImpl'],
      auth: createPromptTypeHandlerTestAuth('token-research'),
      apiBaseUrl: 'https://api.test/v1',
      logger: makeLogger(),
    });
  });

  it('does not fetch or append a duplicate focal context', async () => {
    const payload = makePayload();
    const result = await researchHandler.prepare!(makeSession(), payload, deps);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.payload.startupInput).toBe(payload.startupInput);
  });

  it('uses Run-owned worktree paths in the Research Services context', async () => {
    const result = await researchHandler.prepare!(
      makeSession({
        services: [
          { id: 'service-a', path: '/host/service-a' },
          { id: 'service-b', path: '/host/service-b' },
        ],
        launchServiceId: 'service-a',
        worktreeState: {
          'service-a': {
            repoPath: '/host/service-a',
            worktreePath: '/worktrees/service-a',
            branch: 'feature/worktrees',
          },
          'service-b': {
            repoPath: '/host/service-b',
            worktreePath: '/worktrees/service-b',
            branch: 'feature/worktrees',
          },
        },
      }),
      makePayload(),
      deps,
    );

    const prompt = researchHandler.buildPrompt(result.payload);
    expect(prompt).toContain('Launch service `service-a` at `/worktrees/service-a`');
    expect(prompt).toContain('`service-b` at `/worktrees/service-b`');
    expect(prompt).not.toContain('/host/service-a');
    expect(prompt).not.toContain('/host/service-b');
  });

  it('does not require organization or project context to prepare the prompt', async () => {
    const sessionMissingProject = makeSession({
      contextMetadata: {
        capturedAt: '2026-06-05T00:00:00Z',
        organizationId: ORG_ID,
        fileReferences: { resolved: [], unresolved: [] },
      } as unknown as AgenticSession['contextMetadata'],
    });

    const result = await researchHandler.prepare!(sessionMissingProject, makePayload(), deps);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.payload.startupInput).toBeDefined();
  });
});

describe('researchHandler.buildPrompt', () => {
  it('declares read-only child permissions and final-answer research', () => {
    expect(researchHandler.childConfig).toMatchObject({
      mcpAllowedTools: [
        'get_context',
        'get_edges',
        'get_full_entity',
        'get_agent_session',
        'get_diagram',
        'get_work_item_type_guidance_batch',
        'unified_search',
        'search_implementation_hints',
        'list_services',
      ],
      builtinAllowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
      submissionTools: 'none',
      codexSandboxMode: 'read-only',
    });
    const childPayload = { ...makePayload(), _touchedFiles: [] };
    const prompt = researchHandler.buildPrompt(childPayload);
    expect(prompt).toMatch(/Return a short handoff for your slice/u);
    expect(prompt).not.toContain('structured submission');
  });
  it("runs the Project Assistant checks only when the fan-out passes the parent's gates", () => {
    const plainPayload = { ...makePayload(), _touchedFiles: [] };
    const plain = researchHandler.buildPrompt(plainPayload);
    expect(plain).not.toContain('## Project Assistant checks for your slice');

    const childPayload: ResearchChildPayload & { _touchedFiles: string[] } = {
      ...makePayload(),
      _touchedFiles: [],
      _projectAssistantChecks: {
        policy: {
          allowEdgeUpdates: false,
          notifyDiscrepancies: true,
          workItemProposalMode: 'edit',
        },
        fulfilledBySuggestionEligible: true,
      },
    };
    const fannedOut = researchHandler.buildPrompt(childPayload);
    expect(fannedOut).toContain('## Project Assistant checks for your slice');
    expect(fannedOut).toContain('Work-item proposal mode is `edit`');
  });
  it('does not render a duplicate focal context block', () => {
    const prompt = researchHandler.buildPrompt(makePayload());

    expect(prompt).not.toContain('## Pre-fetched get_context for the session task');
    expect(prompt).not.toContain('Wire research mode');
  });
});
