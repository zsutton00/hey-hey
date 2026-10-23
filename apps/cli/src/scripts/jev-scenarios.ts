#!/usr/bin/env tsx

/**
 * Show exactly what the shared Jev scenarios send and what comes back.
 *
 *   pnpm jev:scenarios            offline: print every request, no key, no network
 *   pnpm jev:scenarios --live     send the same requests to Jev (needs TYPESAFE_API_KEY)
 *                                 and print the raw answers and the resulting judgments
 *
 * The sample data is fixed so runs are comparable. Only the sample is ever sent.
 */

import { DEFAULT_JEV_MODEL, createJevClient, type JevInput, type JevResult } from '../jev/client';
import {
  DEFAULT_WORDING,
  JEV_CUTOFFS,
  SCENARIOS,
  buildQuestions,
  buildState,
  formatRequest,
  judge,
  tierOf,
  type Candidate,
  type Focal,
  type Scenario,
} from '../jev/scenarios';

const FOCALS: Focal[] = [
  {
    kind: 'task',
    name: 'Add a guided change report',
    description: 'Add a dedicated typed report that explains a change to the reviewer.',
    acceptanceCriteria: 'The report lists what changed and why, with links to the source.',
    parent: {
      kind: 'feature',
      name: 'Review',
      description: 'Review lets a person understand a change before approving it.',
    },
  },
  {
    kind: 'feature',
    name: 'Review',
    description: 'Review lets a person understand a change before approving it.',
  },
  { kind: 'question', text: 'How does Review decide which model explains a change?' },
];

const SAMPLE_CANDIDATES: Record<Scenario['id'], Candidate[]> = {
  parent_requirements: [
    {
      id: 'change_explanation',
      kind: 'requirement',
      text: 'Each change is explained in plain language with a link to its source.',
    },
    {
      id: 'agent_configuration',
      kind: 'requirement',
      text: 'A person can choose which model produces the explanation.',
    },
  ],
  neighbourhood: [
    {
      id: 'review_ancestor',
      kind: 'ancestor',
      text: 'Agent Sessions: durable containers for AI-assisted work.',
    },
    {
      id: 'inline_comments',
      kind: 'sibling',
      text: 'Inline Comments: a reviewer leaves comments on a changed line.',
    },
    {
      id: 'report_viewer',
      kind: 'child',
      text: 'Report Viewer: shows the report next to the diff.',
    },
  ],
  edges: [
    {
      id: 'edge_1',
      kind: 'linked',
      text: 'DEPENDS_ON: Add an opt-in Jev client to the CLI. A client that sends classification requests.',
    },
    {
      id: 'edge_2',
      kind: 'linked',
      text: 'RELATED_TO: Billing Page. Shows invoices.',
    },
  ],
  hint_selection: [
    {
      id: 'report_registration',
      kind: 'hint',
      text: 'Reports: a new report type must be registered with get_report_schema as well as validated, or agents cannot discover it.',
    },
    {
      id: 'billing_rounding',
      kind: 'hint',
      text: 'Billing: invoice totals round per line, not per invoice.',
    },
  ],
  decision_selection: [
    {
      id: 'proposal_backed_edits',
      kind: 'decision',
      text: 'Record agent and user content changes through proposals\n\ndecision:\nA user save that is automatically approved still creates a proposal recording the change.',
    },
    {
      id: 'agpl_licence',
      kind: 'decision',
      text: 'License Hey Hey source under AGPL-3.0\n\ndecision:\nHey Hey source is published under AGPL-3.0.',
    },
  ],
  read_check: [
    {
      id: 'change_explanation_doc',
      kind: 'entity',
      text: '# Change Explanation\n\nEach change is explained in plain language with a link to its source.',
    },
    {
      id: 'billing_page',
      kind: 'entity',
      text: '# Billing Page\n\nShows invoices and lets a person download them.',
    },
  ],
};

const rule = (title: string): string => `\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}\n`;
const json = (value: unknown): string => JSON.stringify(value, null, 2);

const printRequest = (input: JevInput): void => {
  console.log(formatRequest(input));
};

const printJudgments = (scenario: Scenario, judgments: readonly unknown[]): void => {
  console.log('\n--- judgments ---');
  if (scenario.decision !== 'relevance') {
    console.table(judgments);
    return;
  }
  console.table(
    (judgments as { id: string; relevance: number; conflict: number }[]).map((judgment) => ({
      ...judgment,
      tier: tierOf(judgment, JEV_CUTOFFS),
    })),
  );
};

const main = async (): Promise<void> => {
  const live = process.argv.slice(2).includes('--live');
  const client = live ? createJevClient(process.env) : undefined;
  if (live && !client) throw new Error('--live needs TYPESAFE_API_KEY in the environment');

  let lastResult: JevResult | undefined;
  if (client) {
    const evaluate = client.evaluate.bind(client);
    client.evaluate = async (input) => {
      lastResult = await evaluate(input);
      return lastResult;
    };
  }

  for (const scenario of SCENARIOS) {
    for (const focal of FOCALS) {
      const candidates = SAMPLE_CANDIDATES[scenario.id];
      console.log(rule(`${scenario.id} / focal: ${focal.kind}`));
      printRequest({
        model: DEFAULT_JEV_MODEL,
        state: buildState(scenario, focal, candidates),
        questions: buildQuestions(scenario, focal, candidates, DEFAULT_WORDING),
      });
      if (!client) continue;

      const judged = await judge(
        client,
        DEFAULT_JEV_MODEL,
        scenario,
        focal,
        candidates,
        DEFAULT_WORDING,
      );
      console.log('\n--- raw Jev result ---');
      console.log(json(lastResult));
      if (judged.ok) printJudgments(scenario, judged.judgments);
      else console.log(`\njudge failed: ${judged.failure.code}: ${judged.failure.message}`);
    }
  }
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[jev:scenarios] ${message}`);
  process.exitCode = 1;
});
