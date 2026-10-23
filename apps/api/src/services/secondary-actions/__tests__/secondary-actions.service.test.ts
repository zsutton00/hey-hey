import { SecondaryActionsService } from '../secondary-actions.service';
import {
  SecondaryActionConfig,
  SecondaryActionHandler,
  SuggestedAgentActionMethod,
} from 'src/generated';

describe('SecondaryActionsService', () => {
  let service: SecondaryActionsService;

  beforeEach(() => {
    service = new SecondaryActionsService();
  });

  describe('getActions', () => {
    it('returns all actions when no filter is provided', async () => {
      const actions = await service.getActions();

      expect(actions).toHaveLength(3);
    });

    it('returns actions with stable SecondaryActionConfig structure', async () => {
      const actions = await service.getActions();

      for (const action of actions) {
        expect(action).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            type: expect.any(String),
            presentation: SecondaryActionConfig.PresentationEnum.Button,
            label: expect.any(String),
            fieldId: expect.any(String),
            handler: SecondaryActionHandler.SuggestedAgentAction,
            payload: expect.objectContaining({
              handlerType: 'suggested_agent_action',
            }),
          }),
        );
      }
    });

    it('returns sync action with method field instead of promptTemplate', async () => {
      const actions = await service.getActions({
        actionType: 'task_complete',
      });
      const syncAction = actions.find((a) => a.id === 'sa-sync-hey-hey');

      expect(syncAction).toBeDefined();
      expect(syncAction!.payload).toEqual(
        expect.objectContaining({
          handlerType: 'suggested_agent_action',
          method: SuggestedAgentActionMethod.FinalAssessment,
        }),
      );
      expect((syncAction!.payload as any).promptTemplate).toBeUndefined();
    });

    it('includes system diagram, review, and sync actions', async () => {
      const actions = await service.getActions();
      const labels = actions.map((a) => a.label);

      expect(labels).toContain('Request system diagram');
      expect(labels).toContain('Review');
      expect(labels).toContain('Sync');
    });

    it('returns only system diagram when uiElement matches final assessment', async () => {
      const actions = await service.getActions({
        uiElement: 'coding_prompt_merged_final_assessment',
      });

      expect(actions).toHaveLength(1);
      expect(actions[0]!.label).toBe('Request system diagram');
    });

    it('returns all actions when no filter context is set', async () => {
      const actions = await service.getActions({});

      expect(actions).toHaveLength(3);
    });

    it('returns no actions when uiElement does not match', async () => {
      const actions = await service.getActions({
        uiElement: 'unrelated_element',
      });

      expect(actions).toHaveLength(0);
    });

    it('returns review and sync when actionType is task_complete', async () => {
      const actions = await service.getActions({
        actionType: 'task_complete',
      });

      expect(actions).toHaveLength(2);
      const labels = actions.map((a) => a.label);
      expect(labels).toContain('Review');
      expect(labels).toContain('Sync');
    });

    it('returns no actions for unknown actionType', async () => {
      const actions = await service.getActions({
        actionType: 'unknown_event',
      });

      expect(actions).toHaveLength(0);
    });

    it('filters by both uiElement and actionType', async () => {
      const actions = await service.getActions({
        uiElement: 'coding_prompt_merged_final_assessment',
        actionType: 'task_complete',
      });

      expect(actions).toHaveLength(0);

      const noMatch = await service.getActions({
        uiElement: 'wrong_element',
        actionType: 'task_complete',
      });

      expect(noMatch).toHaveLength(0);
    });

    it('returns actions with deterministic unique ids', async () => {
      const actions = await service.getActions();
      const ids = actions.map((a) => a.id);

      expect(ids).toEqual([
        'sa-system-diagram',
        'sa-review',
        'sa-sync-hey-hey',
      ]);
    });

    it('returns stable ids across multiple calls', async () => {
      const first = await service.getActions();
      const second = await service.getActions();

      expect(first.map((a) => a.id)).toEqual(second.map((a) => a.id));
    });
  });
});
