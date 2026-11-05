import type { JevResult } from './client';

/** Jev's price per million tokens in USD: input is billed, output is free (structured decisions). */
export const JEV_INPUT_USD_PER_MTOK = 0.042;
export const JEV_OUTPUT_USD_PER_MTOK = 0;

export interface JevUsage {
  inputTokens: number;
  outputTokens: number;
}

export const jevCostUsd = (usage: JevUsage): number =>
  (usage.inputTokens * JEV_INPUT_USD_PER_MTOK + usage.outputTokens * JEV_OUTPUT_USD_PER_MTOK) /
  1_000_000;

/** Total tokens and cost across every Jev call; a call that failed reports no usage and adds none. */
export const summarizeJevUsage = (
  calls: ReadonlyArray<{ result: JevResult }>,
): JevUsage & { costUsd: number } => {
  const total: JevUsage = { inputTokens: 0, outputTokens: 0 };
  for (const { result } of calls) {
    if (result.ok) {
      total.inputTokens += result.usage.inputTokens;
      total.outputTokens += result.usage.outputTokens;
    }
  }

  return { costUsd: jevCostUsd(total), ...total };
};
