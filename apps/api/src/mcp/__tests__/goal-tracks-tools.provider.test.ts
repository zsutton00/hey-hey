import { BadRequestException } from '@nestjs/common';
import { GoalTracksToolsProvider } from '../tools/goal-tracks-tools.provider';
import { AUTHORING_ROOT_PROOF } from '../tools/authoring-guidance';
import { GoalTracksService } from '../../services/tasks/goal-tracks.service';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const GOAL_ID = '00000000-0000-4000-8000-000000000010';
const TARGET_ID = '00000000-0000-4000-8000-000000000020';
const SESSION_ID = '00000000-0000-4000-8000-000000000040';
const EDGE_ID = '00000000-0000-4000-8000-000000000050';

function makeUser() {
  return {
    userId: 'u1',
    email: 'user@example.com',
    name: 'Tester',
    currentOrgId: ORG_ID,
    orgMemberships: [],
    isDevAdmin: false,
    devAdminMode: false,
  };
}

function makeRequest(opts: Record<string, string | undefined> = {}) {
  return {
    headers: {
      authorization: `Bearer ${opts.token ?? 'tok'}`,
      'x-project-id': opts.projectId ?? PROJECT_ID,
      ...(opts.sessionId !== null
        ? { 'x-agent-session-id': opts.sessionId ?? SESSION_ID }
        : {}),
    },
    cookies: {},
    user: makeUser(),
    ip: '127.0.0.1',
  } as any;
}

function makeService(): jest.Mocked<GoalTracksService> {
  return {
    attachToGoal: jest.fn(),
    detachFromGoal: jest.fn(),
  } as unknown as jest.Mocked<GoalTracksService>;
}

describe('GoalTracksToolsProvider', () => {
  let service: jest.Mocked<GoalTracksService>;
  let provider: GoalTracksToolsProvider;

  beforeEach(() => {
    service = makeService();
    provider = new GoalTracksToolsProvider(service);
  });

  describe('attach_to_goal', () => {
    it('delegates to the service and returns the response', async () => {
      service.attachToGoal.mockResolvedValue({
        edge: {
          id: EDGE_ID,
          sourceNodeId: GOAL_ID,
          targetNodeId: TARGET_ID,
          type: 'TRACKS',
          reasoning: 'Goal tracks this entity',
          createdBySessionId: SESSION_ID,
          lastModifiedBySessionId: null,
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z',
        },
        target: {
          targetEntityId: TARGET_ID,
          targetEntityType: 'TASK',
          title: 'Build login UI',
          status: 'ACTIVE' as any,
          dueDate: null,
        },
        created: true,
      });

      const result = await provider.attachToGoal(
        {
          goalId: GOAL_ID,
          targetEntityId: TARGET_ID,
          targetEntityType: 'TASK',
          authoringRootProof: AUTHORING_ROOT_PROOF,
        },
        {} as any,
        makeRequest(),
      );

      expect(service.attachToGoal).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        GOAL_ID,
        { targetEntityId: TARGET_ID, targetEntityType: 'TASK' },
        SESSION_ID,
        'tok',
      );
      expect((result as { created: boolean }).created).toBe(true);
    });

    it('surfaces service errors via mcpError', async () => {
      service.attachToGoal.mockRejectedValue(new Error('boom'));

      const result = await provider.attachToGoal(
        {
          goalId: GOAL_ID,
          targetEntityId: TARGET_ID,
          targetEntityType: 'TASK',
          authoringRootProof: AUTHORING_ROOT_PROOF,
        },
        {} as any,
        makeRequest(),
      );

      expect(result).toMatchObject({ isError: true });
    });

    it("forwards the boundary's type-named source refusal verbatim", async () => {
      const boundaryMessage =
        'Task type STANDARD is not an eligible tracking source. ' +
        'attach_to_goal/detach_from_goal require a source task whose ' +
        'type may own tracking links. Eligible source types: GOAL.';
      service.attachToGoal.mockRejectedValue(
        new BadRequestException(boundaryMessage),
      );

      const result = await provider.attachToGoal(
        {
          goalId: GOAL_ID,
          targetEntityId: TARGET_ID,
          targetEntityType: 'TASK',
          authoringRootProof: AUTHORING_ROOT_PROOF,
        },
        {} as any,
        makeRequest(),
      );

      const text = (result as { content: { text: string }[] }).content[0]!.text;
      expect(result).toMatchObject({ isError: true });
      expect(text).toContain(boundaryMessage);
    });
  });

  describe('detach_from_goal', () => {
    it('delegates to the service', async () => {
      service.detachFromGoal.mockResolvedValue({
        deleted: true,
        targetEntityId: TARGET_ID,
        targetEntityType: 'TASK',
      });

      const result = await provider.detachFromGoal(
        {
          goalId: GOAL_ID,
          targetEntityId: TARGET_ID,
          targetEntityType: 'TASK',
          authoringRootProof: AUTHORING_ROOT_PROOF,
        },
        {} as any,
        makeRequest(),
      );

      expect(service.detachFromGoal).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        GOAL_ID,
        { targetEntityId: TARGET_ID, targetEntityType: 'TASK' },
        'tok',
      );
      expect((result as { deleted: boolean }).deleted).toBe(true);
    });
  });
});
