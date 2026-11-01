import { describe, expect, it } from 'vitest';
import {
  parseGuidanceMentions,
  readMemoResearchFrame,
  selectGuidanceReferences,
} from './selection';
const focal = { id: '20000000-0000-4000-8000-000000000001', type: 'TASK' };
const mockup = { id: '20000000-0000-4000-8000-000000000002', type: 'mockup' };
const parent = { id: '20000000-0000-4000-8000-000000000003', type: 'TASK' };
const mention = `@[mockup:${mockup.id}|Reviewed interface]`;
describe('relevant identity selection', () => {
  it('uses only selected frame identities and retains all contributing sources', () => {
    const frame = { nodes: [{ ...mockup, edges: [{ toId: parent.id }] }] };
    expect(
      selectGuidanceReferences({
        focal,
        frame,
        fallback: [parent],
        approvedPlan: mention,
        userMessages: [mention],
      }),
    ).toEqual([
      { ...focal, sources: ['focal'] },
      { ...mockup, sources: ['research-frame', 'approved-plan', 'user-message'] },
    ]);
  });
  it('distinguishes an explicitly empty frame from absent frame', () => {
    expect(
      selectGuidanceReferences({ focal, frame: { nodes: [] }, fallback: [parent] }),
    ).toHaveLength(1);
    expect(selectGuidanceReferences({ focal, fallback: [parent] })).toHaveLength(2);
  });
  it('accepts plan and user mentions independently without reports', () => {
    expect(selectGuidanceReferences({ approvedPlan: mention })[0]?.sources).toEqual([
      'approved-plan',
    ]);
    expect(selectGuidanceReferences({ userMessages: [mention] })[0]?.sources).toEqual([
      'user-message',
    ]);
    expect(parseGuidanceMentions('ordinary words mockup diagram @[mockup:bad|invalid]')).toEqual(
      [],
    );
  });
  it('isolates invalid frame entries while keeping valid selections explicit', () => {
    const frame = readMemoResearchFrame(
      '## Research frame\n```json\n' +
        JSON.stringify({ nodes: [mockup, { title: 'broken' }] }) +
        '\n```',
    );
    expect(frame?.nodes).toEqual([mockup]);
    expect(frame?.issues).toHaveLength(1);
  });
  it('reads the frame block without selecting mentions from analysis or traversed edges', () => {
    const memo = `## Research frame\n\`\`\`json\n${JSON.stringify({ nodes: [mockup], edgesTraversed: [parent] })}\n\`\`\`\nanalysis ${mention}`;
    expect(readMemoResearchFrame(memo)).toEqual({ nodes: [mockup] });
    expect(readMemoResearchFrame(`Analysis ${mention}`)).toBeUndefined();
    expect(readMemoResearchFrame('## Research frame\n```json\n{\n```')?.issues).toEqual([
      'Invalid research-frame JSON',
    ]);
  });
});
