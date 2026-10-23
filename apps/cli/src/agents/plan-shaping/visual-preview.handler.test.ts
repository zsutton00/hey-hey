import { describe, expect, it } from 'vitest';
import {
  LocalPromptType,
  type PlanShapingVisualPreviewEntry,
  type PlanShapingVisualPreviewPromptPayload,
} from '../../shared/agent-bridge-contract/generated/api';
import { VISUAL_PREVIEW_ALLOWED_TOOLS } from './visual-preview.handler';
import { planShapingVisualPreviewHandler } from './visual-preview.handler';
import { buildVisualPreviewPrompt } from './visual-preview.prompt';
import { submitVisualPreviewReadyTool } from './visual-preview.submission-tools';
import { INCLUDE_EXISTING_PROPOSALS_TOOL_NAME } from '../submission-tools/include-existing-proposals-in-current-message-tool';
import { SubmissionToolCorrectableError } from '../submission-tools/types';

const payload = (): PlanShapingVisualPreviewPromptPayload => ({
  designDocId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  planId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  featureId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  refinementRound: 1,
  entries: [
    {
      proposalId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      artifactFamily: 'mockup',
      presentationOrder: 0,
      status: 'DRAFT',
    },
  ],
  acceptedProposalIds: [],
  feedback: 'Add the empty state.',
  userMessage: 'Please revise the empty state.',
});

const approvedMockups = [
  {
    proposalId: '11111111-1111-4111-8111-111111111111',
    artifactFamily: 'mockup',
    presentationOrder: 0,
    status: 'APPROVED',
    materializedEntity: {
      entityId: '99999999-9999-4999-8999-999999999999',
      entityType: 'TASK',
    },
  },
  {
    proposalId: '22222222-2222-4222-8222-222222222222',
    artifactFamily: 'mockup',
    presentationOrder: 1,
    status: 'APPROVED',
    relationship: {
      kind: 'depends_on',
      proposalId: '11111111-1111-4111-8111-111111111111',
    },
  },
] satisfies PlanShapingVisualPreviewEntry[];

describe('plan-shaping visual-preview handler', () => {
  it.each([
    {
      scenario: 'initial review with two approved reused Mockups and one new Diagram',
      refinementRound: 0,
      entries: [
        ...approvedMockups,
        {
          proposalId: '33333333-3333-4333-8333-333333333333',
          artifactFamily: 'diagram',
          presentationOrder: 2,
          status: 'DRAFT',
        },
      ] satisfies PlanShapingVisualPreviewEntry[],
    },
    {
      scenario: 'all-approved reused visual set',
      refinementRound: 1,
      entries: approvedMockups,
    },
  ])(
    'requires complete presentation and user set approval for $scenario',
    ({ entries, refinementRound }) => {
      const reviewPayload = {
        designDocId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        planId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        featureId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        refinementRound,
        entries,
        acceptedProposalIds: approvedMockups.map((entry) => entry.proposalId),
      } satisfies PlanShapingVisualPreviewPromptPayload;
      const prompt = buildVisualPreviewPrompt(reviewPayload);
      const guidance = prompt.replace(/\s+/g, ' ');

      expect(prompt).toMatchSnapshot();
      expect(prompt).toContain(`Current entries: ${JSON.stringify(entries)}`);
      expect(prompt).toContain(
        `Accepted proposal ids: ${JSON.stringify(reviewPayload.acceptedProposalIds)}`,
      );
      expect(guidance).toContain(
        'On every review, including the initial review and every refinement',
      );
      expect(guidance).toContain(
        'including APPROVED proposals from another conversation in the same project',
      );
      expect(guidance).toContain(
        'retain it in the entries submitted through `submit_visual_preview_ready` (READY)',
      );
      expect(guidance).toContain(
        'call `include_existing_proposals_in_current_message` with it in `proposalIds` before submission',
      );
      expect(guidance).toContain(
        'both the ordered preview submission and current Message must include their Proposal IDs',
      );
      expect(guidance).toContain(
        'Reuse creates no duplicate proposal and preserves proposal identity, original Conversation and Message ownership, any Proposal Group home, and approval status',
      );
      expect(guidance).toContain(
        'An individually APPROVED proposal needs no renewed individual decision',
      );
      expect(guidance).toContain(
        'Explicit user approval of the complete visual set is still required before plan stages or tasks, even when every selected visual is already APPROVED',
      );
      expect(guidance).toContain(
        'two unchanged APPROVED Mockups from an earlier same-project conversation plus one new Diagram are reviewed as two Mockups shown as content and one Diagram proposal',
      );
      expect(guidance).toContain('Do not submit only the new Diagram');
      expect(guidance).toContain('Only new or revised visuals are submitted as new proposals');
      expect(guidance).toContain(
        'The review shows an unchanged APPROVED visual as its Mockup or Diagram content instead of a proposal card',
      );
      expect(guidance).toContain('new, revised, and pending visuals stay reviewable proposals');
      expect(guidance).toContain(
        'include both existing Proposal IDs in the current Message and submit both in the complete ordered preview',
      );
    },
  );

  it('registers the visual-preview prompt type and independent proposal tool path', () => {
    expect(planShapingVisualPreviewHandler.promptType).toBe(
      LocalPromptType.PlanShapingVisualPreview,
    );
    expect(planShapingVisualPreviewHandler.submissionTools?.map((tool) => tool.name)).toEqual([
      INCLUDE_EXISTING_PROPOSALS_TOOL_NAME,
      'submit_visual_preview_ready',
    ]);
    expect(planShapingVisualPreviewHandler.additionalAllowedTools).toEqual(
      VISUAL_PREVIEW_ALLOWED_TOOLS,
    );
  });

  it('keeps current proposal identity, status, order, and feedback in the prompt context', () => {
    const prompt = buildVisualPreviewPrompt(payload());

    expect(prompt).toContain('Never use a proposal group.');
    expect(prompt).toContain('a graph-shaped visual is a persistent Diagram');
    expect(prompt).toContain('using canonical type DIAGRAM_ELEMENT for each element');
    expect(prompt).toContain('The anchored design document is authoritative for plan scope.');
    expect(prompt).toContain('use them as optional discovery');
    expect(prompt).toContain('do not treat them as guaranteed-current authority or a prerequisite');
    expect(prompt).toContain('Reuse a suitable existing Mockup, Diagram, or Diagram Element');
    expect(prompt).toContain('does not inherently\nrequire a new artifact');
    expect(prompt).toContain('propose an UPDATE that targets its existing identity');
    expect(prompt).toContain('distinct from refining a pending proposal');
    expect(prompt).toContain('Diagram Elements remain local placements within their Diagram');
    expect(prompt).toContain('do not create a shared element identity');
    expect(prompt).toContain('as the DIAGRAM type guidance from `get_tool_guidance` teaches');
    expect(prompt).toContain('proposed earlier in this round are link candidates');
    expect(prompt).toContain('link to the new proposal ID');
    expect(prompt).not.toContain('workflow_step');
    expect(prompt).toMatchSnapshot();
    expect(prompt).toContain('include_existing_proposals_in_current_message');
    expect(prompt).toContain('dddddddd-dddd-dddd-dddd-dddddddddddd');
    expect(prompt).toContain('Add the empty state.');
    expect(prompt).toContain('Refinement round: 1');
    expect(prompt).toContain('Submission tools appear in your catalog');
  });

  it('formats the API-provided user message for the active turn', () => {
    expect(planShapingVisualPreviewHandler.addUserMessage(payload())).toBe(
      '\n\nUser message for this turn:\nPlease revise the empty state.',
    );
  });

  it('emits one READY completion and one visual UI field for the ordered set', async () => {
    const result = await submitVisualPreviewReadyTool.execute({
      runId: 'run-1',
      args: {
        refinementRound: 2,
        entries: [
          {
            proposalId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
            artifactFamily: 'diagram',
            presentationOrder: 0,
          },
          {
            proposalId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            artifactFamily: 'diagram',
            presentationOrder: 1,
            relationship: {
              kind: 'refines',
              proposalId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
            },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      action: 'READY',
      payload: {
        refinementRound: 2,
        entries: [
          {
            proposalId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
            artifactFamily: 'diagram',
            presentationOrder: 0,
          },
          {
            proposalId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            artifactFamily: 'diagram',
            presentationOrder: 1,
            relationship: {
              kind: 'refines',
              proposalId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
            },
          },
        ],
      },
    });
    expect(result).not.toHaveProperty('completionUiElements');
  });

  it('rejects malformed visual completion input without emitting a completion', () => {
    expect(() =>
      submitVisualPreviewReadyTool.execute({
        runId: 'run-1',
        args: {
          refinementRound: 2,
          entries: [{ artifactFamily: 'mockup', presentationOrder: 0 }],
        },
      }),
    ).toThrow(SubmissionToolCorrectableError);
  });
});
