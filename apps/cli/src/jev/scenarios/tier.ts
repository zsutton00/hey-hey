export interface Cutoffs {
  /** Relevance at or above this earns full text. */
  full: number;
  /** Relevance at or above this (and below `full`) earns the short form. */
  short: number;
}

export const JEV_CUTOFFS: Cutoffs = { full: 0.9, short: 0.5 };

export type Tier = 'full' | 'short' | 'index';

export const tierOf = (judgment: { relevance: number }, cutoffs: Cutoffs): Tier => {
  if (judgment.relevance >= cutoffs.full) return 'full';
  return judgment.relevance >= cutoffs.short ? 'short' : 'index';
};
