import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JevAnswer, JevInput, JevResult } from '../../../jev/client';
import { DEFAULT_WORDING, type Focal } from '../../../jev/scenarios';
import { createMemorySearchExecutor } from '../../../jev/search';
import {
  createSnapshotReader,
  type EntitySource,
  type GraphSnapshot,
} from '../../../jev/traversal';
import { gatherTraceSchema, type GatherTrace } from '../../../jev/trace';
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
    kind: 'feature', name: 'Parent', description: 'The parent' },
};

/** Read check keeps every entity. */
const fakeJev = () => ({
  evaluate: (input: JevInput): Promise<JevResult> => {
    const answers: Record<string, JevAnswer> = {};
    for (const [id, question] of Object.entries(input.questions)) {
      answers[id] =
        question.type === 'choice'
          ? {
              type: 'choice',
              choice: 'applies',
              confidence: 1,
              probabilities: { applies: 0.9, does_not_apply: 0.1 },
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

  const setup = (options: { answer?: string | Error; text?: string; jevFails?: boolean } = {}) => {
    const info = vi.fn();
    const logger = { ...NOOP_LOGGER, info } as unknown as ServerLogger;
    const promptOnce = vi.fn(() => {
      const answer = options.answer ?? JSON.stringify({ searches: [{ query: 'alpha' }] });
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    });
    const appendRunGatherTrace = vi.fn((_runId: string, trace: Omit<GatherTrace, 'round'>) =>
      Promise.resolve({ ...trace, round: 1 }),
    );
    const handlerDeps = {
      promptOnce,
      logger,
      runStore: { appendRunGatherTrace },
    } as unknown as PromptTypeHandlerDeps;
    const snapshot = makeSnapshot(options.text);
    const deps: ContextGatheringDeps = {
      jev: { client: fakeJev(), model: 'm', wording: DEFAULT_WORDING },
      limits: [],
      maxResultsPerSearch: 25,
      executorFor: () =>
        createMemorySearchExecutor({ alpha: [{ id: A, kind: 'task', title: 'A' }] }),
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
    return { run, promptOnce, appendRunGatherTrace, info };
  };

  it('asks the Run to show gathering context from search planning onward', async () => {
    const { run, promptOnce } = setup();

    await run();

    const args = (promptOnce.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(args['startPhase']).toBe('gathering_context');
    expect(args).not.toHaveProperty('endPhase');
  });

  it('plans with the focal and ask, then returns every kept entity and records the trace', async () => {
    const { run, promptOnce, appendRunGatherTrace, info } = setup();

    const text = await run();

    const prompt = (promptOnce.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt;
    expect(prompt).toContain('Focal work');
    expect(prompt).toContain('SYSTEM PROMPT TEXT');
    expect(prompt).toContain('Make it work');
    expect(prompt).toContain('DESIGN_DOC');
    expect(prompt).toContain('are all TASK');
    expect(text).toContain(`task ${A}`);
    expect(text).toContain('Body of 02');
    expect(appendRunGatherTrace).toHaveBeenCalledWith(
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

  it('fails when the planning call rejects', async () => {
    const { run, appendRunGatherTrace } = setup({ answer: new Error('model unavailable') });
    await expect(run()).rejects.toThrow('model unavailable');
    expect(appendRunGatherTrace).not.toHaveBeenCalled();
  });

  it('fails when the answer is not JSON', async () => {
    await expect(setup({ answer: 'here are my searches' }).run()).rejects.toThrow();
  });

  it('fails when the answer does not match the search schema', async () => {
    await expect(setup({ answer: JSON.stringify({ searches: [] }) }).run()).rejects.toThrow();
  });

  it('fails when gathering fails', async () => {
    const { run, appendRunGatherTrace } = setup();
    const cancelled = new AbortController();
    cancelled.abort(new Error('cancelled'));
    await expect(run(cancelled.signal)).rejects.toThrow();
    expect(appendRunGatherTrace).not.toHaveBeenCalled();
  });

  it('fails when the trace cannot be stored', async () => {
    const { run, appendRunGatherTrace } = setup();
    appendRunGatherTrace.mockRejectedValueOnce(new Error('disk full'));
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
