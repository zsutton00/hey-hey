/**
 * Shared rendering of the Run's accumulating, never-consumed memo list. A
 * third inter-phase carryover mechanism alongside `previousProviderSession`
 * (a rolling single slot) and the report chain (`report-chain.ts`): memos are
 * append-only and prepended to every subsequent phase's first-turn prompt
 * without ever being cleared. Each entry is appended directly by a producer
 * (e.g. the `create_coding_research` tool), labelled by the `source`
 * promptType that produced it.
 */

import type { RunMemo } from '../../session/types';

const HEADER = `## Context from prior phases

The notes below were carried forward from earlier phases of this run. They are durable context, not a transcript — read them before starting work.`;

export const renderMemoBlock = (memos: ReadonlyArray<RunMemo>): string => {
  const sections = memos.map((memo) => [`### ${memo.source}`, '', memo.content].join('\n'));
  return `${HEADER}\n\n${sections.join('\n\n')}`;
};
