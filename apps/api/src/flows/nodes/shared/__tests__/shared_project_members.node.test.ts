import { SharedProjectMembersNode } from '../shared-project-members.node';
import { NodeType } from '../../../../types/flow-internal.types';
import { SHARED_NODES } from '../../../constants/node-ids';

describe('SharedProjectMembersNode', () => {
  const node = new SharedProjectMembersNode();

  describe('node configuration', () => {
    it('should have correct basic properties', () => {
      expect(node.id).toBe(SHARED_NODES.PROJECT_MEMBERS);
      expect(node.type).toBe(NodeType.ACTION);
      expect(node.title).toBe('Invite Team Members');
      expect(node.skippable).toBe(true);
    });
  });

  describe('action execution', () => {
    it('should return correct response with skippable field', async () => {
      const result = await node.execute();

      expect(result.type).toBe(NodeType.LLM_QUESTIONS);
      expect(result.message).toContain('set up your project team');
      expect(result.data).toEqual(
        expect.objectContaining({
          detectedIntent: 'team_setup',
          intentConfidence: 0.9,
          skippable: true,
        }),
      );
    });

    it('should include team_members UI element', async () => {
      const result = await node.execute();

      expect(result.uiElements?.find((el) => el.id === 'team_members')).toEqual(
        expect.objectContaining({
          id: 'team_members',
          type: 'team_members',
          required: false,
        }),
      );
    });
  });
});
