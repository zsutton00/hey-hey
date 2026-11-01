import { describe, expect, it } from 'vitest';

import {
  readCreatedProposalGroupMembers,
  readCreatedProposalIds,
  readDeletedProposalId,
  readRemovedProposalGroupMemberId,
  readUpdatedProposal,
} from './proposal-result';
import type { JsonObject, PlatformMcpProxyResult } from './session';

const FIRST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';
const FUTURE_ID = '33333333-3333-4333-8333-333333333333';

// Success output of the API's propose_future_revision tool. `futureId` is a
// valid UUID so collecting it as a Proposal identity would be visible.
const futureRevisionOutput = (operation: 'REVISE' | 'CANCEL'): JsonObject => ({
  status: 'proposed',
  proposalId: FIRST_ID,
  futureId: FUTURE_ID,
  operation,
  targetEntityType: 'TASK',
  targetEntityId: SECOND_ID,
  createdAt: '2026-10-22T08:00:00.000Z',
});

describe('readUpdatedProposal', () => {
  const output = { id: FIRST_ID, status: 'DRAFT', targetEntityId: SECOND_ID };
  it('reads structured and text updates, including group membership', () => {
    expect(readUpdatedProposal('update_proposal', success({ structuredContent: output }))).toEqual({
      proposalId: FIRST_ID,
    });
    const grouped = { ...output, groupedAuthoring: { member: { memberId: 'member-1' } } };
    expect(
      readUpdatedProposal(
        'update_proposal',
        success({ content: [{ type: 'text', text: JSON.stringify(grouped) }] }),
      ),
    ).toEqual({ proposalId: FIRST_ID, memberId: 'member-1' });
  });
  it('ignores failures, validation results, malformed IDs and unrelated tools', () => {
    expect(readUpdatedProposal('update_proposal', { statusCode: 500 })).toBeNull();
    expect(
      readUpdatedProposal('update_proposal', success({ isError: true, structuredContent: output })),
    ).toBeNull();
    expect(
      readUpdatedProposal(
        'update_proposal',
        success({ structuredContent: { ...output, status: 'invalid_change_set' } }),
      ),
    ).toBeNull();
    expect(
      readUpdatedProposal('update_proposal', success({ structuredContent: { id: 'bad' } })),
    ).toBeNull();
    expect(readUpdatedProposal('get_context', success({ structuredContent: output }))).toBeNull();
  });
});

const success = (result: JsonObject): PlatformMcpProxyResult => ({
  statusCode: 200,
  body: {
    jsonrpc: '2.0',
    id: 1,
    result,
  },
});

describe('readCreatedProposalIds', () => {
  it('reads canonical identities from structured and text results once in creation order', () => {
    expect(
      readCreatedProposalIds(
        'edit_work_item',
        success({
          structuredContent: {
            proposals: [{ proposalId: FIRST_ID }, { proposalId: SECOND_ID }],
          },
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                proposals: [{ proposalId: FIRST_ID }, { proposalId: SECOND_ID }],
              }),
            },
          ],
        }),
      ),
    ).toEqual([FIRST_ID, SECOND_ID]);
  });

  it('reads every canonical identity from the reorder_stages API response shape', () => {
    expect(
      readCreatedProposalIds(
        'reorder_stages',
        success({
          structuredContent: {
            proposalIds: [FIRST_ID, SECOND_ID, FIRST_ID],
          },
        }),
      ),
    ).toEqual([FIRST_ID, SECOND_ID]);
  });

  it.each(['REVISE', 'CANCEL'] as const)(
    'reads only the proposal identity from a %s propose_future_revision response',
    (operation) => {
      const output = futureRevisionOutput(operation);
      const ids = readCreatedProposalIds(
        'propose_future_revision',
        success({
          structuredContent: output,
          content: [{ type: 'text', text: JSON.stringify(output) }],
        }),
      );

      expect(ids).toEqual([FIRST_ID]);
      expect(ids).not.toContain(FUTURE_ID);
    },
  );

  it('collects nothing from a failed propose_future_revision call', () => {
    const output = futureRevisionOutput('REVISE');
    expect(readCreatedProposalIds('propose_future_revision', { statusCode: 500 })).toEqual([]);
    expect(
      readCreatedProposalIds(
        'propose_future_revision',
        success({ isError: true, structuredContent: output }),
      ),
    ).toEqual([]);
  });

  it.each([{ id: FIRST_ID }, { structuredContent: { id: FIRST_ID } }])(
    'reads create_plan proposal identity from its tool-specific id response shape',
    (result) => {
      expect(readCreatedProposalIds('create_plan', success(result))).toEqual([FIRST_ID]);
    },
  );

  it('ignores transport errors, MCP errors, and malformed identities', () => {
    expect(readCreatedProposalIds('create_work_item', { statusCode: 500 })).toEqual([]);
    expect(readCreatedProposalIds('create_work_item', success({ isError: true }))).toEqual([]);
    expect(
      readCreatedProposalIds('create_work_item', success({ proposalId: 'not-a-uuid' })),
    ).toEqual([]);
    expect(readCreatedProposalIds('create_work_item', success({ id: FIRST_ID }))).toEqual([]);
  });

  it('does not collect reads, existing-Proposal mutations, or Proposal Group finalization', () => {
    const response = success({ proposalId: FIRST_ID });
    expect(readCreatedProposalIds('get_context', response)).toEqual([]);
    expect(readCreatedProposalIds('update_proposal', response)).toEqual([]);
    expect(readCreatedProposalIds('finalize_proposal_group', response)).toEqual([]);
  });
});

describe('grouped Proposal identity reconciliation', () => {
  it('maps a successful grouped creation member to its canonical Proposal', () => {
    expect(
      readCreatedProposalGroupMembers(
        'create_work_item',
        success({
          proposalId: FIRST_ID,
          groupedAuthoring: { member: { memberId: 'member-1' } },
        }),
      ),
    ).toEqual([{ memberId: 'member-1', proposalId: FIRST_ID }]);
  });

  it('maps a grouped propose_future_revision member to its proposal, not its future', () => {
    expect(
      readCreatedProposalGroupMembers(
        'propose_future_revision',
        success({
          structuredContent: {
            ...futureRevisionOutput('REVISE'),
            groupedAuthoring: { member: { memberId: 'member-1' } },
          },
        }),
      ),
    ).toEqual([{ memberId: 'member-1', proposalId: FIRST_ID }]);
  });

  it('reads a removed member only from a successful removal result', () => {
    const args = { memberId: 'member-1' };
    expect(
      readRemovedProposalGroupMemberId('remove_proposal_group_member', args, success({})),
    ).toBe('member-1');
    expect(
      readRemovedProposalGroupMemberId('remove_proposal_group_member', args, { statusCode: 500 }),
    ).toBeNull();
    expect(readRemovedProposalGroupMemberId('get_context', args, success({}))).toBeNull();
  });
});

describe('standalone Proposal deletion reconciliation', () => {
  it('reads the deleted Proposal identity only from a successful delete_proposal result', () => {
    const args = { proposalId: FIRST_ID };
    expect(readDeletedProposalId('delete_proposal', args, success({ deleted: true }))).toBe(
      FIRST_ID,
    );
    expect(readDeletedProposalId('delete_proposal', args, { statusCode: 500 })).toBeNull();
    expect(readDeletedProposalId('delete_proposal', args, success({ isError: true }))).toBeNull();
    expect(
      readDeletedProposalId('delete_proposal', { proposalId: 'invalid' }, success({})),
    ).toBeNull();
    expect(readDeletedProposalId('get_context', args, success({}))).toBeNull();
  });
});
