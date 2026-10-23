import { describe, expect, it, vi } from 'vitest';
import type { JevClient, JevInput, JevResult } from '../client';
import {
  CONTEXT_SELECTION,
  DEFAULT_WORDING,
  EDGE_RELATIONSHIPS,
  EDGES,
  JEV_CUTOFFS,
  NEIGHBOURHOOD,
  PARENT_REQUIREMENTS,
  HINT_SELECTION,
  READ_CHECK,
  buildQuestions,
  buildState,
  cacheKey,
  conflictQuestionId,
  judge,
  openingFor,
  tierOf,
  type Candidate,
  type Focal,
  type Wording,
} from '.';

const task: Focal = {
  kind: 'task',
  name: 'Add a guided change report',
  description: 'Add a guided change report to Review',
  acceptanceCriteria: 'A dedicated typed report',
  parent: {
    kind: 'feature',
    name: 'Review',
    description: 'Review lets a person o',
  },
};
const feature: Focal = { kind: 'feature', name: 'Review', description: 'Review lets a person o' };
const question: Focal = { kind: 'question', text: 'How does Review pick a model?' };

const requirements: Candidate[] = [
  { id: 'agent_configuration', kind: 'requirement', text: 'users can choose the model' },
  { id: 'invocation', kind: 'requirement', text: 'a person can start a review' },
];

describe('buildState', () => {
  it('keeps the measured task state shape', () => {
    expect(buildState(PARENT_REQUIREMENTS, task, requirements)).toEqual({
      task: {
        name: 'Add a guided change report',
        description: 'Add a guided change report to Review',
        acceptance_criteria: 'A dedicated typed report',
      },
      parent_feature: { name: 'Review', description: 'Review lets a person o' },
      requirements: {
        agent_configuration: 'users can choose the model',
        invocation: 'a person can start a review',
      },
    });
  });

  it.each([
    [feature, { focal: { name: 'Review', description: 'Review lets a person o' } }],
    [question, { focal: { description: 'How does Review pick a model?' } }],
  ])('puts a %# focal under state.focal.description', (focal, expected) => {
    expect(buildState(PARENT_REQUIREMENTS, focal, [])).toEqual(expected);
  });

  it('groups neighbourhood candidates by kind', () => {
    const state = buildState(NEIGHBOURHOOD, question, [
      { id: 'a', kind: 'ancestor', text: 'A' },
      { id: 'b', kind: 'ancestor_sibling', text: 'B' },
      { id: 'c', kind: 'sibling', text: 'C' },
      { id: 'd', kind: 'child', text: 'D' },
      { id: 'e', kind: 'child', text: 'E' },
    ]);
    expect(state).toMatchObject({
      ancestors: { a: 'A' },
      ancestor_siblings: { b: 'B' },
      siblings: { c: 'C' },
      children: { d: 'D', e: 'E' },
    });
  });

  it('puts edges under state.edges', () => {
    expect(
      buildState(EDGES, task, [{ id: 'x', kind: 'linked', text: 'DEPENDS_ON · Title · short' }]),
    ).toMatchObject({ edges: { x: 'DEPENDS_ON · Title · short' } });
  });

  it.each([
    task,
    feature,
    {
      kind: 'mockup',
      name: 'Review mockup',
      description: 'Shows Review',
      parent: {
        kind: 'feature',
        name: 'Review',
        description: 'Review',
      },
    },
    {
      kind: 'diagram',
      name: 'Review diagram',
      description: 'Maps Review',
      elements: [],
      parent: {
        kind: 'feature',
        name: 'Review',
        description: 'Review',
      },
    },
    question,
  ] satisfies Focal[])('puts the focal-kind Edges explanation in state.about for %#', (focal) => {
    const wording = structuredClone(DEFAULT_WORDING);
    wording.edges.openingSentence[focal.kind] = `Shared explanation for ${focal.kind}.`;
    const state = buildState(
      EDGES,
      focal,
      [{ id: 'x', kind: 'linked', text: 'Linked context' }],
      wording,
    );

    expect(state).toMatchObject({ about: { text: `Shared explanation for ${focal.kind}.` } });
    expect(state).toMatchObject({ edges: { x: 'Linked context' } });
  });

  it('rejects candidate kinds the scenario does not take', () => {
    expect(() =>
      buildState(PARENT_REQUIREMENTS, task, [{ id: 'x', kind: 'sibling', text: 'X' }]),
    ).toThrow(/does not take sibling/);
  });

  it('rejects ids that collide as question ids', () => {
    expect(() =>
      buildState(PARENT_REQUIREMENTS, task, [
        { id: 'x', kind: 'requirement', text: 'one' },
        { id: 'x', kind: 'requirement', text: 'two' },
      ]),
    ).toThrow(/colliding/);
    expect(() =>
      buildQuestions(
        PARENT_REQUIREMENTS,
        task,
        [
          { id: 'x', kind: 'requirement', text: 'one' },
          { id: conflictQuestionId('x'), kind: 'requirement', text: 'two' },
        ],
        DEFAULT_WORDING,
      ),
    ).toThrow(/colliding/);
  });
});

describe('buildQuestions', () => {
  it('composes the task + requirement question from the wording file', () => {
    const questions = buildQuestions(PARENT_REQUIREMENTS, task, requirements, DEFAULT_WORDING);
    expect(questions['invocation']).toEqual({
      type: 'choice',
      instructions: `${DEFAULT_WORDING.parent_requirements.task.openingSentence} ${DEFAULT_WORDING.parent_requirements.task.relevanceQuestion
        .replace('{candidate}', 'the requirement under state.requirements.invocation')
        .replace('{focal}', 'task')}`,
      criteria: Object.fromEntries(
        Object.entries(DEFAULT_WORDING.parent_requirements.task.criteria).map(([name, text]) => [
          name,
          text.replaceAll('{focal}', 'task').replaceAll('{candidate}', 'requirement'),
        ]),
      ),
    });
  });

  it('fills the criteria placeholders from the wording file', () => {
    const wording: Wording = {
      ...DEFAULT_WORDING,
      parent_requirements: {
        ...DEFAULT_WORDING.parent_requirements,
        task: {
          ...DEFAULT_WORDING.parent_requirements.task,
          criteria: {
            implements: 'The {focal} builds the {candidate}',
            informs: 'The {candidate} is merely background for the {focal}',
            same_feature_unrelated: 'x',
            other: 'y',
          },
        },
      },
    };
    expect(
      buildQuestions(PARENT_REQUIREMENTS, task, requirements, wording)['invocation'],
    ).toMatchObject({
      criteria: {
        implements: 'The task builds the requirement',
        informs: 'The requirement is merely background for the task',
      },
    });
  });

  it('asks one relevance and one conflict question per candidate', () => {
    const questions = buildQuestions(PARENT_REQUIREMENTS, feature, requirements, DEFAULT_WORDING);
    expect(Object.keys(questions).sort()).toEqual([
      'agent_configuration',
      'conflict:agent_configuration',
      'conflict:invocation',
      'invocation',
    ]);
    expect(questions['conflict:invocation']).toMatchObject({ type: 'noul' });
  });

  it('names the candidate kind and its state path in neighbourhood questions', () => {
    const questions = buildQuestions(
      NEIGHBOURHOOD,
      question,
      [{ id: 'c', kind: 'child', text: 'C' }],
      DEFAULT_WORDING,
    );
    expect(questions['c']).toMatchObject({ type: 'choice' });
    expect(questions['c']?.instructions).toBe(
      'This is a question from a user, as defined by state.focal.description. How much does the child under state.children.c apply to the question?',
    );
  });

  it('keeps only the candidate judgment in each Edges question', () => {
    const questions = buildQuestions(
      EDGES,
      task,
      [{ id: 'x', kind: 'linked', text: 'T' }],
      DEFAULT_WORDING,
    );
    expect(Object.keys(questions)).toEqual(['x']);
    expect(questions['x']).toMatchObject({ type: 'choice' });
    expect(Object.keys(questions['x']?.criteria ?? {})).toEqual([...EDGE_RELATIONSHIPS]);
    expect(questions['x']?.instructions).toBe(
      DEFAULT_WORDING.edges.readMoreQuestion
        .replace('{candidate}', 'the linked entity under state.edges.x')
        .replace('{focal}', 'task'),
    );
    expect(questions['x']?.instructions).not.toContain(DEFAULT_WORDING.edges.openingSentence.task);
  });

  it('uses edited edges question wording in the request', () => {
    const wording = structuredClone(DEFAULT_WORDING);
    wording.edges.readMoreQuestion = 'For the {focal}, read {candidate}?';
    const questions = buildQuestions(
      EDGES,
      task,
      [{ id: 'x', kind: 'linked', text: 'T' }],
      wording,
    );
    expect(questions['x']?.instructions).toContain('For the task, read ');
    expect(questions['x']?.instructions).toContain('state.edges.x?');
  });
});

describe('per-scenario wording', () => {
  const mixed: Candidate[] = [
    ...requirements,
    { id: 'a', kind: 'ancestor', text: 'A' },
    { id: 's', kind: 'sibling', text: 'S' },
    { id: 'e', kind: 'linked', text: 'L' },
  ];
  const ids = ['a', 's', 'e', 'invocation', 'agent_configuration'];
  const reworded = (
    scenario: 'parent_requirements' | 'neighbourhood',
    sentence: string,
  ): Wording => ({
    ...DEFAULT_WORDING,
    [scenario]: {
      ...DEFAULT_WORDING[scenario],
      task: { ...DEFAULT_WORDING[scenario].task, openingSentence: sentence },
    },
  });
  const changedIds = (wording: Wording): string[] => {
    const before = buildQuestions(CONTEXT_SELECTION, task, mixed, DEFAULT_WORDING);
    const after = buildQuestions(CONTEXT_SELECTION, task, mixed, wording);
    return ids.filter((id) => JSON.stringify(before[id]) !== JSON.stringify(after[id])).sort();
  };

  it('changes only requirement questions when only parent_requirements changes', () => {
    expect(changedIds(reworded('parent_requirements', 'Requirements opening.'))).toEqual([
      'agent_configuration',
      'invocation',
    ]);
  });

  it('changes only the other kinds when only neighbourhood changes', () => {
    expect(changedIds(reworded('neighbourhood', 'Neighbourhood opening.'))).toEqual([
      'a',
      'e',
      's',
    ]);
  });

  it('fills the relevance template for the candidate and the focal', () => {
    const wording: Wording = {
      ...DEFAULT_WORDING,
      neighbourhood: {
        ...DEFAULT_WORDING.neighbourhood,
        task: {
          ...DEFAULT_WORDING.neighbourhood.task,
          relevanceQuestion: 'Does {candidate} matter to the {focal}?',
        },
      },
    };
    const questions = buildQuestions(
      NEIGHBOURHOOD,
      task,
      [{ id: 'a', kind: 'ancestor', text: 'A' }],
      wording,
    );
    expect(questions['a']?.instructions).toMatch(
      / Does the ancestor feature under state\.ancestors\.a matter to the task\?$/,
    );
  });
});

describe('mockup and diagram focals', () => {
  const mockup: Focal = {
    kind: 'mockup',
    name: 'Report mockup',
    description: 'Shows the change report',
    parent: {
      kind: 'feature',
      name: 'Review',
      description: 'Review lets a person o',
    },
  };

  it('puts the mockup and its parent feature in the state', () => {
    expect(buildState(PARENT_REQUIREMENTS, mockup, requirements)).toMatchObject({
      focal: { name: 'Report mockup', description: 'Shows the change report' },
      parent_feature: { name: 'Review' },
    });
  });

  it('asks in the wording of the focal kind', () => {
    const questions = buildQuestions(PARENT_REQUIREMENTS, mockup, requirements, DEFAULT_WORDING);
    expect(questions['invocation']?.instructions).toContain(
      DEFAULT_WORDING.parent_requirements.mockup.openingSentence,
    );
    const question = questions['invocation'];
    expect(question?.type === 'choice' ? question.criteria['implements'] : '').toMatch(
      /^The requirement is part of what the mockup shows/,
    );
  });
});

describe('diagram focal', () => {
  const diagram: Focal = {
    kind: 'diagram',
    name: 'Start flow',
    description: 'How a session starts',
    elements: [
      { name: 'Call start-run', description: 'Delivers the request.' },
      { name: 'Call start-run', description: 'Retries once.' },
    ],
    parent: {
      kind: 'feature',
      name: 'Agent Sessions',
      description: 'Sessions hold work.',
    },
  };

  it('lists every element, in order, beside the Diagram and its parent feature', () => {
    expect(buildState(PARENT_REQUIREMENTS, diagram, requirements)).toMatchObject({
      focal: { name: 'Start flow', description: 'How a session starts' },
      diagram_elements: {
        '1. Call start-run': 'Delivers the request.',
        '2. Call start-run': 'Retries once.',
      },
      parent_feature: { name: 'Agent Sessions' },
    });
  });

  it('asks whether the requirement is part of what the Diagram covers or shows', () => {
    const question = buildQuestions(PARENT_REQUIREMENTS, diagram, requirements, DEFAULT_WORDING)[
      'invocation'
    ];
    expect(question?.instructions).toContain('part of what the diagram covers or shows?');
    expect(question?.type === 'choice' ? question.criteria['implements'] : '').toMatch(
      /^The requirement is part of what the diagram covers or shows/,
    );
  });
});

describe('cacheKey', () => {
  const state = { a: { x: '1', y: '2' }, b: 'c' };
  const questions = buildQuestions(PARENT_REQUIREMENTS, task, requirements, DEFAULT_WORDING);

  it('ignores key order', () => {
    const reordered = { b: 'c', a: { y: '2', x: '1' } };
    expect(cacheKey(reordered, questions, 'm')).toBe(cacheKey(state, questions, 'm'));
  });

  it.each([
    ['state', () => cacheKey({ ...state, b: 'd' }, questions, 'm')],
    ['questions', () => cacheKey(state, { ...questions, invocation: { type: 'noul' } }, 'm')],
    ['model', () => cacheKey(state, questions, 'other')],
  ])('changes with the %s', (_name, changed) => {
    expect(changed()).not.toBe(cacheKey(state, questions, 'm'));
  });
});

describe('tierOf', () => {
  it.each([
    [{ relevance: 0.95, conflict: 0 }, 'full'],
    [{ relevance: 0.9, conflict: 0 }, 'full'],
    [{ relevance: 0.89, conflict: 0 }, 'short'],
    [{ relevance: 0.5, conflict: 0 }, 'short'],
    [{ relevance: 0.49, conflict: 0 }, 'index'],
    [{ relevance: 0.1, conflict: 0.69 }, 'index'],
    [{ relevance: 0.1, conflict: 0.7 }, 'full'],
  ] as const)('%j → %s', (judgment, tier) => {
    expect(tierOf(judgment, JEV_CUTOFFS)).toBe(tier);
  });

  it('uses the cutoffs it is given', () => {
    expect(tierOf({ relevance: 0.6, conflict: 0 }, { full: 0.6, short: 0.2, conflict: 1 })).toBe(
      'full',
    );
  });
});

describe('judge', () => {
  const clientReturning = (result: JevResult) => {
    const evaluate = vi.fn().mockResolvedValue(result);
    return { client: { evaluate } as unknown as JevClient, evaluate };
  };
  const ok = (answers: Extract<JevResult, { ok: true }>['answers']): JevResult => ({
    ok: true,
    model: 'jev-test',
    answers,
    usage: { inputTokens: 5, outputTokens: 2 },
    durationMs: 12,
  });
  const choice = (probabilities: Record<string, number>) =>
    ({ type: 'choice', choice: 'implements', probabilities, confidence: 0.9 }) as const;

  it('reads relevance as p(implements)+p(informs) and conflict as the noul probability', async () => {
    const { client, evaluate } = clientReturning(
      ok({
        invocation: choice({
          implements: 0.5,
          informs: 0.3,
          same_feature_unrelated: 0.1,
          other: 0.1,
        }),
        'conflict:invocation': { type: 'noul', noul: 0.25 },
      }),
    );
    const result = await judge(
      client,
      'jev-test',
      PARENT_REQUIREMENTS,
      task,
      [{ id: 'invocation', kind: 'requirement', text: 'start a review' }],
      DEFAULT_WORDING,
    );
    expect(evaluate).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: true,
      model: 'jev-test',
      usage: { inputTokens: 5, outputTokens: 2 },
      judgments: [{ id: 'invocation', relevance: 0.8, conflict: 0.25 }],
    });
  });

  it('reads edge judgments as the probability of every relationship that suggests reading', async () => {
    const probabilities = {
      governs: 0.1,
      defines: 0.1,
      supplies: 0.1,
      reports_problem: 0,
      possibly_connected: 0.1,
      unrelated: 0.5,
      other: 0.1,
    };
    const requests: JevInput[] = [];
    const client = {
      evaluate: (input: JevInput) => {
        requests.push(input);
        return Promise.resolve(ok({ x: choice(probabilities) }));
      },
    } as unknown as JevClient;
    const result = await judge(
      client,
      'jev-test',
      EDGES,
      question,
      [{ id: 'x', kind: 'linked', text: 'T' }],
      DEFAULT_WORDING,
    );
    const request = requests[0];
    expect(request?.state).toMatchObject({
      about: { text: DEFAULT_WORDING.edges.openingSentence.question },
      edges: { x: 'T' },
      focal: { description: question.text },
    });
    expect(request?.questions['x']?.instructions).toBe(
      DEFAULT_WORDING.edges.readMoreQuestion
        .replace('{candidate}', 'the linked entity under state.edges.x')
        .replace('{focal}', 'question'),
    );
    expect(result).toMatchObject({
      ok: true,
      judgments: [{ id: 'x', readMore: expect.closeTo(0.4), relationships: probabilities }],
    });
  });

  it('returns the client failure unchanged', async () => {
    const failure: JevResult = {
      ok: false,
      failure: { code: 'TIMEOUT', message: 'Jev evaluation timed out.' },
    };
    const { client } = clientReturning(failure);
    await expect(
      judge(
        client,
        'jev-test',
        NEIGHBOURHOOD,
        task,
        [{ id: 'a', kind: 'ancestor', text: 'A' }],
        DEFAULT_WORDING,
      ),
    ).resolves.toBe(failure);
  });

  it('fails with INVALID_RESPONSE instead of inventing a judgment for a missing answer', async () => {
    const { client } = clientReturning(
      ok({
        invocation: choice({ implements: 1, informs: 0, same_feature_unrelated: 0, other: 0 }),
      }),
    );
    await expect(
      judge(
        client,
        'jev-test',
        PARENT_REQUIREMENTS,
        task,
        [{ id: 'invocation', kind: 'requirement', text: 'start a review' }],
        DEFAULT_WORDING,
      ),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'INVALID_RESPONSE' } });
  });
});

describe('requests of the scenarios that existed before the read check', () => {
  const askedTask: Focal = { ...task, ask: 'Explain changes' };
  const requestKey = (
    scenario: Parameters<typeof buildState>[0],
    candidates: Candidate[],
  ): string =>
    cacheKey(
      buildState(scenario, askedTask, candidates, DEFAULT_WORDING),
      buildQuestions(scenario, askedTask, candidates, DEFAULT_WORDING),
      'm',
    );

  // Saved evaluation results are keyed by a hash of the whole request; a changed hash here means
  // every saved result for that scenario stopped matching. Update only with the wording itself.
  it.each([
    [
      'parent_requirements',
      PARENT_REQUIREMENTS,
      [{ id: 'r', kind: 'requirement', text: 'users can choose the model' }],
      '46fdb1ad870145f2f93baa83b6f30aed008934562a787ed999f1204562325080',
    ],
    [
      'neighbourhood',
      NEIGHBOURHOOD,
      [
        { id: 'a', kind: 'ancestor', text: 'A' },
        { id: 'c', kind: 'child', text: 'C' },
      ],
      '531a4ae7d669f36b0c10942f8360219b83089c8bdadd5bfa7b65e0ba9553ba13',
    ],
    [
      'edges',
      EDGES,
      [
        { id: 'l', kind: 'linked', text: 'DEPENDS_ON · T' },
        { id: 'm', kind: 'mentioned', text: 'mentioned in X' },
      ],
      '33f3c5339837728699a4a98fb8e30ec1035679c592d9d973904dceee03a13b16',
    ],
    [
      'hint_selection',
      HINT_SELECTION,
      [{ id: 'h', kind: 'hint', text: 'Reports: register' }],
      '91dcc37fd73e1631b06f0946abc3997b08a1be0c40343d4a41db5e4188a6e421',
    ],
  ] as const)('keeps the %s request unchanged', (_name, scenario, candidates, expected) => {
    expect(requestKey(scenario, [...candidates])).toBe(expected);
  });
});

describe('focal parent', () => {
  const orphan: Extract<Focal, { kind: 'task' }> = {
    kind: 'task',
    name: 'Stop reminders once an invoice is paid',
    description: 'Reminders stop when payment lands.',
    acceptanceCriteria: 'No reminder after payment.',
  };
  const planned: Focal = {
    ...orphan,
    parent: { kind: 'plan', name: 'Eval rollout', description: 'Ship evals in stages.' },
  };

  it('names the parent block by what the parent is', () => {
    expect(buildState(NEIGHBOURHOOD, planned, [], DEFAULT_WORDING)).toMatchObject({
      parent_plan: { name: 'Eval rollout', description: 'Ship evals in stages.' },
    });
    expect(buildState(NEIGHBOURHOOD, planned, [], DEFAULT_WORDING)).not.toHaveProperty(
      'parent_feature',
    );
  });

  it('leaves the parent block out when there is no parent', () => {
    const state = buildState(NEIGHBOURHOOD, orphan, [], DEFAULT_WORDING);
    expect(state).not.toHaveProperty('parent_feature');
    expect(state).not.toHaveProperty('parent_plan');
  });

  it.each([
    ['feature', task, 'state.parent_feature.description'],
    ['plan', planned, 'state.parent_plan.description'],
    ['no', orphan, 'has no parent feature or plan'],
  ] as const)('words the opening for a %s parent', (_name, focal, phrase) => {
    const candidates: Candidate[] = [{ id: 'x', kind: 'sibling', text: 'X' }];
    const instructions = buildQuestions(NEIGHBOURHOOD, focal, candidates, DEFAULT_WORDING)['x']
      ?.instructions;
    expect(instructions).toContain(phrase);
    expect(instructions).not.toContain('{parent}');
    const state = buildState(EDGES, { ...focal, ask: 'Go' }, [], DEFAULT_WORDING);
    expect(JSON.stringify(state)).toContain(phrase);
  });
});

describe('read check', () => {
  const entities: Candidate[] = [
    { id: 'doc', kind: 'entity', text: '# Reminder Scheduling\n\nUnpaid invoices are queued.' },
    { id: 'task', kind: 'entity', text: '# Notification email\n\nPeople set the address.' },
  ];
  const asked: Focal = { ...task, ask: 'Stop reminders after payment' };

  it('puts the opening sentence once in state.about, the ask in state.ask and entities under state.entities', () => {
    const state = buildState(READ_CHECK, asked, entities, DEFAULT_WORDING);
    expect(state).toMatchObject({
      about: { text: openingFor(DEFAULT_WORDING.read_check.openingSentence.task, asked) },
      ask: { text: 'Stop reminders after payment' },
      entities: { doc: entities[0]?.text, task: entities[1]?.text },
    });
    expect(
      JSON.stringify(buildQuestions(READ_CHECK, asked, entities, DEFAULT_WORDING)),
    ).not.toContain('Hey Hey is a project');
  });

  it('asks one applies question per entity and no conflict question', () => {
    const questions = buildQuestions(READ_CHECK, asked, entities, DEFAULT_WORDING);
    expect(Object.keys(questions)).toEqual(['doc', 'task']);
    const doc = questions['doc'];
    expect(doc?.type).toBe('choice');
    expect(doc?.instructions).toContain('the item under state.entities.doc');
    expect(Object.keys(doc?.type === 'choice' ? doc.criteria : {})).toEqual([
      'applies',
      'does_not_apply',
    ]);
  });

  it('opens in the wording of the focal kind', () => {
    for (const focal of [task, feature, question] satisfies Focal[]) {
      expect(buildState(READ_CHECK, focal, [], DEFAULT_WORDING)).toMatchObject({
        about: { text: openingFor(DEFAULT_WORDING.read_check.openingSentence[focal.kind], focal) },
      });
    }
  });

  it('refuses candidates of the other scenarios', () => {
    expect(() => buildState(READ_CHECK, task, requirements, DEFAULT_WORDING)).toThrow();
    expect(() => buildState(NEIGHBOURHOOD, task, entities, DEFAULT_WORDING)).toThrow();
  });

  it('judges applies from the choice and its probability', async () => {
    const answer = (choice: string, applies: number) =>
      ({
        type: 'choice',
        choice,
        confidence: 0.9,
        probabilities: { applies, does_not_apply: 1 - applies },
      }) as const;
    const evaluate = vi.fn().mockResolvedValue({
      ok: true,
      model: 'm',
      answers: { doc: answer('applies', 0.8), task: answer('does_not_apply', 0.1) },
      usage: { inputTokens: 1, outputTokens: 1 },
      durationMs: 1,
    });
    const result = await judge({ evaluate }, 'm', READ_CHECK, asked, entities, DEFAULT_WORDING);
    expect(result).toMatchObject({
      ok: true,
      judgments: [
        { id: 'doc', choice: 'applies', applies: 0.8 },
        { id: 'task', choice: 'does_not_apply', applies: 0.1 },
      ],
    });
  });

  it('fails with INVALID_RESPONSE when an answer lacks an option', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      ok: true,
      model: 'm',
      answers: {
        doc: { type: 'choice', choice: 'applies', confidence: 1, probabilities: { applies: 1 } },
        task: { type: 'choice', choice: 'applies', confidence: 1, probabilities: { applies: 1 } },
      },
      usage: { inputTokens: 1, outputTokens: 1 },
      durationMs: 1,
    });
    const result = await judge({ evaluate }, 'm', READ_CHECK, asked, entities, DEFAULT_WORDING);
    expect(result).toMatchObject({ ok: false, failure: { code: 'INVALID_RESPONSE' } });
  });
});
