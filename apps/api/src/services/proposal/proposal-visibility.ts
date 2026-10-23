import type { Prisma } from '@prisma/client';

/**
 * BUILDING group members are authoring state, not ordinary proposals.
 */
export const ORDINARY_PROPOSAL_VISIBILITY_WHERE = {
  NOT: {
    groupMembership: {
      is: {
        group: {
          is: { status: 'BUILDING' },
        },
      },
    },
  },
} satisfies Prisma.ProposalWhereInput;
