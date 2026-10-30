import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JevAnswer, JevInput, JevResult } from '../../../jev/client';
import { DEFAULT_WORDING, type Focal } from '../../../jev/scenarios';
import { refsFromSearchResponse } from '../../../jev/search/search-executor';
import { ActivePlatformToolCatalog } from '../../platform-mcp-proxy/catalog';
import { PlatformMcpForwarder } from '../../platform-mcp-proxy/forwarder';
import { PlatformMcpProxySession } from '../../platform-mcp-proxy/session';
import { createTestOAuthClient } from '../../../auth/oauth-client.test-support';
import { createMemorySearchExecutor } from '../../../jev/search';
import {
  createSnapshotReader,
  type EntitySource,
  type GraphSnapshot,
} from '../../../jev/traversal';
import { gatherTraceSchema, type GatherTrace } from '../../../jev/trace';
import { ProjectAssistantHandler } from '../project-assistant.handler';
import { makeCreateReportProxy } from '../../submission-tools/create-report-proxy.test-support';
import type { ProjectAssistantPromptPayload } from '../project-assistant.handler';
import { resolveMcpToolNames } from '../../mcp-server-config';
import { NOOP_LOGGER, type ServerLogger } from '../../../server/logger';
import type { PromptTypeHandlerDeps } from '../../prompt-type-handler';
import {
  gatherProjectContext,
  GATHERED_CONTEXT_MAX_CHARS,
  type ContextGatheringDeps,
} from '../context-gathering';

const uuid = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [F, A, B] = [1, 2, 3].map(uuid) as [string, string, string];

const source = (id: string, text = `Body of ${id.slice(-2)}`): EntitySource => ({
  id,
  kind: 'task',
  title: `Title ${id.slice(-2)}`,
  text,
  edges: [],
  requirements: [],
});
const makeSnapshot = (text?: string): GraphSnapshot => ({
  entities: Object.fromEntries([F, A, B].map((id) => [id, source(id, text)])),
});

const focal: Focal = {
  kind: 'task',
  name: 'Focal work',
  description: 'Do the thing',
  acceptanceCriteria: 'It is done',
  parent: {
    kind: 'feature',
    name: 'Parent',
    description: 'The parent',
  },
};

/** Read check keeps every entity. */
const fakeJev = (drop = false, fail = false) => ({
  evaluate: (input: JevInput): Promise<JevResult> => {
    if (fail) {
      return Promise.resolve({
        ok: false,
        failure: { code: 'PROVIDER_ERROR', message: 'Unavailable' },
      });
    }
    const answers: Record<string, JevAnswer> = {};
    for (const [id, question] of Object.entries(input.questions)) {
      answers[id] =
        question.type === 'choice'
          ? {
              type: 'choice',
              choice: drop ? 'does_not_apply' : 'applies',
              confidence: 1,
              probabilities: { applies: drop ? 0.1 : 0.9, does_not_apply: drop ? 0.9 : 0.1 },
            }
          : { type: 'noul', noul: 0 };
    }
    return Promise.resolve({
      ok: true,
      model: 'm',
      answers,
      usage: { inputTokens: 1, outputTokens: 1 },
      durationMs: 1,
    });
  },
});

describe('gatherProjectContext', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'context-gathering-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const setup = (
    options: {
      answer?: string | Error;
      text?: string;
      jevFails?: boolean;
      matched?: boolean;
      drop?: boolean;
    } = {},
  ) => {
    const info = vi.fn();
    const logger = { ...NOOP_LOGGER, info } as unknown as ServerLogger;
    const promptOnce = vi.fn(() => {
      const answer = options.answer ?? JSON.stringify({ searches: [{ query: 'alpha' }] });
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    });
    const appendGatherTrace = vi.fn((_runId: string, trace: Omit<GatherTrace, 'round'>) =>
      Promise.resolve({ ...trace, round: 1 }),
    );
    const handlerDeps = {
      promptOnce,
      logger,
      preparationRecords: { appendGatherTrace },
    } as unknown as PromptTypeHandlerDeps;
    const snapshot = makeSnapshot(options.text);
    const deps: ContextGatheringDeps = {
      jev: {
        client: fakeJev(options.drop, options.jevFails),
        model: 'm',
        wording: DEFAULT_WORDING,
      },
      limits: [],
      maxResultsPerSearch: 25,
      executorFor: () =>
        createMemorySearchExecutor({
          alpha: refsFromSearchResponse({
            data: {
              results: [
                {
                  entityId: A,
                  entityType: 'TASK',
                  title: 'A',
                  ...(options.matched && options.text
                    ? {
                        embeddings: {
                          text: options.text,
                          matchSpans: [
                            {
                              start: options.text.indexOf('Selected'),
                              end: options.text.indexOf('Selected') + 8,
                              strength: 0.9,
                            },
                          ],
                        },
                      }
                    : {}),
                },
              ],
            },
          }),
        }),
      readerFor: (_project, focalRef, known) => createSnapshotReader(focalRef, snapshot, known),
      traceLogDir: dir,
    };
    const run = (signal = new AbortController().signal) =>
      gatherProjectContext({
        deps,
        handlerDeps,
        runId: 'run-1',
        turnId: 'turn-1',
        project: { organizationId: 'org', projectId: 'proj' },
        focalRef: { id: F, kind: 'task' },
        focal,
        ask: 'Make it work',
        promptContext: 'SYSTEM PROMPT TEXT',
        signal,
      });
    return { run, promptOnce, appendGatherTrace, info };
  };

  it('asks the Run to show gathering context from search planning onward', async () => {
    const { run, promptOnce } = setup();

    await run();

    const args = (promptOnce.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(args['startPhase']).toBe('gathering_context');
    expect(args).not.toHaveProperty('endPhase');
  });

  it('plans with the focal and ask, then returns every kept entity and records the trace', async () => {
    const { run, promptOnce, appendGatherTrace, info } = setup();

    const text = await run();

    const prompt = (promptOnce.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt;
    expect(prompt).toContain('Focal work');
    expect(prompt).toContain('SYSTEM PROMPT TEXT');
    expect(prompt).toContain('Make it work');
    expect(prompt).toContain('DESIGN_DOC');
    expect(prompt).toContain('"taskTypes"');
    expect(text).toContain(`task ${A}`);
    expect(text).toContain('Body of 02');
    expect(appendGatherTrace).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ runId: 'run-1', turnId: 'turn-1', ask: 'Make it work' }),
    );
    const file = JSON.parse(await readFile(path.join(dir, 'run-1.json'), 'utf8')) as {
      rounds: unknown[];
    };
    expect(file.rounds.map((round) => gatherTraceSchema.parse(round).turnId)).toEqual(['turn-1']);
    expect(await readFile(path.join(dir, 'run-1.turn-1.entities.txt'), 'utf8')).toBe(text);
    expect(info).toHaveBeenCalledWith(
      'project_assistant.context_gathered',
      expect.objectContaining({ counts: expect.objectContaining({ search: expect.anything() }) }),
    );
  });

  it('hands over labelled paragraphs while the same canonical identity remains fully readable', async () => {
    const body =
      'Opening background for the project.\n\nSelected requirement: preserve every matched paragraph exactly.\n\nLater governing details remain available on a full read.';
    const { run, appendGatherTrace } = setup({ text: body, matched: true });
    const gathered = await run();
    const payload = {
      promptType: 'research',
      userMessage: 'Check the governing requirement',
      entity: { entityId: F, entityType: 'TASK' },
      projectAssistantHandoff: {
        consumerHandlerId: 'free_form',
        policy: {
          allowEdgeUpdates: false,
          notifyDiscrepancies: false,
          workItemProposalMode: 'none',
        },
      },
    } satisfies ProjectAssistantPromptPayload;
    const prompt = new ProjectAssistantHandler(makeCreateReportProxy(), null).buildPrompt({
      ...payload,
      ...{ _gatheredContext: gathered },
    });
    expect(prompt).toContain(`task ${A}`);
    expect(prompt).toContain('paragraphs 2 of 3');
    expect(resolveMcpToolNames({ useCase: 'research' })).toEqual(
      expect.arrayContaining(['get_full_entity', 'get_context']),
    );
    expect(prompt).toContain('Selected requirement');
    expect(prompt).not.toContain('Opening background');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  entityId: A,
                  entityType: 'TASK',
                  title: 'A',
                  content: body,
                }),
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const proxy = new PlatformMcpProxySession(
      {
        runId: 'run-1',
        turnId: 'turn-1',
        context: { projectId: 'proj' },
        catalog: new ActivePlatformToolCatalog({ useCase: 'research' }),
        activeHandlerPromptType: 'project_assistant',
        active: true,
      },
      new PlatformMcpForwarder({
        oauthClient: createTestOAuthClient(),
        logger: NOOP_LOGGER,
        fetchImpl,
        endpointUrl: 'https://api.test/mcp',
      }),
    );
    const full = await proxy.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_full_entity', arguments: { entityId: A, entityType: 'TASK' } },
    });
    expect(full.statusCode).toBe(200);
    expect(JSON.stringify(full.body)).toContain('Opening background');
    expect(JSON.stringify(full.body)).toContain('Later governing details');
    expect(JSON.stringify(full.body)).toContain(A);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/mcp',
      expect.objectContaining({
        body: expect.stringContaining(JSON.stringify({ entityId: A, entityType: 'TASK' })),
      }),
    );
    expect(appendGatherTrace.mock.calls[0]?.[1].steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'search-keep',
          judged: [
            expect.objectContaining({
              excerpt: expect.objectContaining({ partial: true, paragraphs: [2] }),
            }),
          ],
        }),
      ]),
    );
  });

  it.each([
    { drop: false, jevFails: false, decision: 'keep', applies: 0.9, kept: true },
    { drop: true, jevFails: false, decision: 'drop', applies: 0.1, kept: false },
    { drop: false, jevFails: true, decision: 'kept-on-failure', applies: null, kept: true },
  ])('persists the chosen text alongside $decision', async (outcome) => {
    const selected = 'Selected requirement: review all release requirements before publishing.';
    const body = `Background about the release.\n\n${selected}\n\nOther release details.`;
    const { run, info } = setup({ text: body, matched: true, ...outcome });
    const prompt = await run();
    const saved = JSON.parse(await readFile(path.join(dir, 'run-1.json'), 'utf8')) as {
      rounds: unknown[];
    };
    const trace = gatherTraceSchema.parse(saved.rounds[0]);
    const step = trace.steps.find((step) => step.kind === 'search-keep');
    expect(step).toMatchObject({
      judged: [
        {
          entity: { id: A },
          text: selected,
          decision: outcome.decision,
          applies: outcome.applies,
          kept: outcome.kept,
          excerpt: { partial: true, paragraphs: [2] },
        },
      ],
    });
    expect(prompt.includes(selected)).toBe(outcome.kept);
    expect(JSON.stringify(info.mock.calls)).not.toContain(selected);
  });

  it('fails when the planning call rejects', async () => {
    const { run, appendGatherTrace } = setup({ answer: new Error('model unavailable') });
    await expect(run()).rejects.toThrow('model unavailable');
    expect(appendGatherTrace).not.toHaveBeenCalled();
  });

  it('fails when the answer is not JSON', async () => {
    await expect(setup({ answer: 'here are my searches' }).run()).rejects.toThrow();
  });

  it('fails when the answer does not match the search schema', async () => {
    await expect(setup({ answer: JSON.stringify({ searches: [] }) }).run()).rejects.toThrow();
  });

  it('fails when gathering fails', async () => {
    const { run, appendGatherTrace } = setup();
    const cancelled = new AbortController();
    cancelled.abort(new Error('cancelled'));
    await expect(run(cancelled.signal)).rejects.toThrow();
    expect(appendGatherTrace).not.toHaveBeenCalled();
  });

  it('fails when the trace cannot be stored', async () => {
    const { run, appendGatherTrace } = setup();
    appendGatherTrace.mockRejectedValueOnce(new Error('disk full'));
    await expect(run()).rejects.toThrow('disk full');
  });

  it('fails naming the size and the cap, without truncating, when the entities are too large', async () => {
    const { run } = setup({ text: 'x'.repeat(GATHERED_CONTEXT_MAX_CHARS) });
    await expect(run()).rejects.toThrow(
      new RegExp(`characters, over the ${String(GATHERED_CONTEXT_MAX_CHARS)} character cap`),
    );
    const saved = await readFile(path.join(dir, 'run-1.turn-1.entities.txt'), 'utf8');
    expect(saved.length).toBeGreaterThan(GATHERED_CONTEXT_MAX_CHARS);
  });

  it('leaves Implementation sections out of the prompt text and measures the cap after removal', async () => {
    const body = `## Goal\nKeep me\n\n## Implementation\n${'x'.repeat(GATHERED_CONTEXT_MAX_CHARS)}`;
    const { run } = setup({ text: body });
    const text = await run();
    expect(text).toContain('Keep me');
    expect(text).not.toContain('## Implementation');
    expect(text).not.toContain('xxxx');
  });
});
