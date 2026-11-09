import type { Focal } from '../scenarios';

/** The focal as Jev judges it: the work itself, with the user's ask alongside. */
export const withAsk = (focal: Focal, ask: string): Focal =>
  focal.kind === 'question' || ask.trim() === '' ? focal : { ...focal, ask };
