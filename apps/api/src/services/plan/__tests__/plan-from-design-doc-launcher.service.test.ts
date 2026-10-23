import { ConflictException } from '@nestjs/common';
import { WorkStatus } from '../../../generated';
import { PlanFromDesignDocLauncherService } from '../plan-from-design-doc-launcher.service';
import {
  ConversationId,
  DesignDocId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from '../../../types';

const ORG_ID = 'org-1' as OrganizationId;
const PROJECT_ID = 'project-1' as ProjectId;
const OWNER_ID = 'owner-1' as UserId;
const DESIGN_DOC_ID = 'dd-1' as DesignDocId;
const PLAN_ID = 'plan-1';
const SESSION_ID = 'session-1';
const CONVERSATION_ID = 'conv-1';
const DOC_MARKDOWN = '# Build the thing\n\nseed body';

const baseParams = {
  designDocId: DESIGN_DOC_ID,
  designDocMarkdown: DOC_MARKDOWN,
  planTitle: 'Build the thing',
  parentFeatureId: 'feature-1' as TaskId,
  requestorId: OWNER_ID,
  projectId: PROJECT_ID,
  organizationId: ORG_ID,
};

describe('PlanFromDesignDocLauncherService', () => {
  let service: PlanFromDesignDocLauncherService;

  let tx: {
    agentSession: { updateMany: jest.Mock };
    agentSessionWorkItemAssociation: { create: jest.Mock };
  };
  let taskService: {
    createInTransaction: jest.Mock;
  };
  let agentSessionService: { createInTransaction: jest.Mock };
  let conversationService: { createConversationInTransaction: jest.Mock };

  beforeEach(() => {
    tx = {
      agentSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      agentSessionWorkItemAssociation: {
        create: jest.fn().mockResolvedValue({ id: 'association-1' }),
      },
    };
    taskService = {
      createInTransaction: jest.fn().mockResolvedValue({ id: PLAN_ID }),
    };
    agentSessionService = {
      createInTransaction: jest.fn().mockResolvedValue({ id: SESSION_ID }),
    };
    conversationService = {
      createConversationInTransaction: jest
        .fn()
        .mockResolvedValue({ id: CONVERSATION_ID }),
    };

    service = new PlanFromDesignDocLauncherService(
      taskService as never,
      agentSessionService as never,
      conversationService as never,
    );
  });

  it('creates a canonical PLAN Task with the design document sections', async () => {
    await service.materializeRunInTransaction(tx as never, baseParams);
    expect(taskService.createInTransaction).toHaveBeenCalledWith(
      tx,
      ORG_ID,
      null,
      expect.objectContaining({
        name: baseParams.planTitle,
        type: 'PLAN',
        parentTaskId: baseParams.parentFeatureId,
        status: WorkStatus.Backlog,
        assigneeId: OWNER_ID,
        sections: expect.arrayContaining([
          expect.objectContaining({
            key: 'description',
            content: DOC_MARKDOWN,
          }),
        ]),
      }),
      PROJECT_ID,
    );
  });

  it('prepares a standalone work item using TASK identity without recreating the Plan', async () => {
    await service.materializeForExistingWorkItemInTransaction(tx as never, {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      planId: PLAN_ID as never,
      planTitle: 'Existing Plan',
      designDocMarkdown: DOC_MARKDOWN,
      requestorId: OWNER_ID,
    });
    expect(taskService.createInTransaction).not.toHaveBeenCalled();
    expect(agentSessionService.createInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        entityType: 'TASK',
        entityId: PLAN_ID,
        status: 'NOT_STARTED',
      }),
      ORG_ID,
    );
    expect(
      conversationService.createConversationInTransaction,
    ).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        workflowAboutType: 'task',
        workflowAboutId: PLAN_ID,
        status: 'NOT_STARTED',
        context: {
          designDocMarkdown: DOC_MARKDOWN,
          planTitle: 'Existing Plan',
        },
      }),
      ORG_ID,
      undefined,
      OWNER_ID,
    );
    expect(tx.agentSessionWorkItemAssociation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workItemId: PLAN_ID,
        workItemType: 'PLAN',
        agentSessionId: SESSION_ID,
      }),
    });
  });

  it('creates a NOT_STARTED PLAN_GENERATION agent session on the plan', async () => {
    await service.materializeRunInTransaction(tx as never, baseParams);

    expect(agentSessionService.createInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        entityType: 'TASK',
        entityId: PLAN_ID,
        type: 'PLAN_GENERATION',
        status: 'NOT_STARTED',
        title: baseParams.planTitle,
      }),
      ORG_ID,
    );
  });

  it('binds the generation session to the canonical PLAN work item', async () => {
    await service.materializeRunInTransaction(tx as never, baseParams);

    expect(tx.agentSessionWorkItemAssociation.create).toHaveBeenCalledWith({
      data: {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        coordinatorType: 'PLAN_GENERATION',
        workItemType: 'PLAN',
        workItemId: PLAN_ID,
        agentSessionId: SESSION_ID,
      },
    });
  });

  it('creates a NOT_STARTED plan-from-design-doc conversation seeded with the markdown', async () => {
    await service.materializeRunInTransaction(tx as never, baseParams);

    expect(
      conversationService.createConversationInTransaction,
    ).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        workflowName: 'plan-from-design-doc',
        workflowAboutType: 'task',
        workflowAboutId: PLAN_ID,
        status: 'NOT_STARTED',
        context: expect.objectContaining({
          designDocMarkdown: DOC_MARKDOWN,
          planTitle: baseParams.planTitle,
          parentFeatureId: baseParams.parentFeatureId,
        }),
      }),
      ORG_ID,
      undefined,
      OWNER_ID,
    );
  });

  it('passes a grouped reserved identity to conversation creation', async () => {
    const reservedConversationId =
      '123e4567-e89b-42d3-a456-426614174350' as ConversationId;

    await service.materializeRunInTransaction(tx as never, {
      ...baseParams,
      conversationId: reservedConversationId,
    });

    expect(
      conversationService.createConversationInTransaction,
    ).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        workflowName: 'plan-from-design-doc',
      }),
      ORG_ID,
      reservedConversationId,
      OWNER_ID,
    );
  });

  it('binds the conversation to the agent session and returns the created ids', async () => {
    const result = await service.materializeRunInTransaction(
      tx as never,
      baseParams,
    );

    expect(tx.agentSession.updateMany).toHaveBeenCalledWith({
      where: { id: SESSION_ID, conversationId: null },
      data: { conversationId: CONVERSATION_ID },
    });
    expect(result).toEqual({
      planId: PLAN_ID,
      agentSessionId: SESSION_ID,
      conversationId: CONVERSATION_ID,
    });
  });

  it('throws if the agent session was already bound to a conversation', async () => {
    tx.agentSession.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.materializeRunInTransaction(tx as never, baseParams),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
