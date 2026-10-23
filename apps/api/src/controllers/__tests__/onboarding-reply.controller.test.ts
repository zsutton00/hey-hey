import { OnboardingReplyController } from '../onboarding-reply.controller';
import { BadRequestException } from '@nestjs/common';
import { OnboardingReplyService } from '../../services/onboarding-reply.service';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../types';
import { v4 as uuidv4 } from 'uuid';

describe('OnboardingReplyController', () => {
  it('passes only route scope, caller identity, and the generated request to admission', async () => {
    const response = { id: 'message-id' };
    const service = {
      admit: jest.fn().mockResolvedValue(response),
    } as unknown as jest.Mocked<OnboardingReplyService>;
    const controller = new OnboardingReplyController(service);
    const request = {
      parentMessageId: uuidv4() as MessageId,
      expectedConversationVersion: 3,
      answers: { project_name: 'Hey Hey' },
    };

    await expect(
      controller.submit(
        'organization-id' as OrganizationId,
        'user-id' as UserId,
        'project-id' as ProjectId,
        'conversation-id' as ConversationId,
        request,
      ),
    ).resolves.toBe(response);
    expect(service.admit).toHaveBeenCalledWith({
      organizationId: 'organization-id',
      userId: 'user-id',
      projectId: 'project-id',
      conversationId: 'conversation-id',
      request,
    });
  });

  it('rejects unknown top-level fields before admission', () => {
    const service = {
      admit: jest.fn(),
    } as unknown as jest.Mocked<OnboardingReplyService>;
    const controller = new OnboardingReplyController(service);

    expect(() =>
      controller.submit(
        'organization-id' as OrganizationId,
        'user-id' as UserId,
        'project-id' as ProjectId,
        'conversation-id' as ConversationId,
        {
          parentMessageId: uuidv4() as MessageId,
          expectedConversationVersion: 3,
          answers: { project_name: 'Hey Hey' },
          workflowId: 'client-chosen-workflow',
        } as never,
      ),
    ).toThrow(BadRequestException);
    expect(service.admit).not.toHaveBeenCalled();
  });

  it.each([
    ['missing body', undefined],
    [
      'invalid version',
      {
        parentMessageId: uuidv4() as MessageId,
        expectedConversationVersion: 0,
        answers: { project_name: 'Hey Hey' },
      },
    ],
    [
      'empty answers',
      {
        parentMessageId: uuidv4() as MessageId,
        expectedConversationVersion: 3,
        answers: {},
      },
    ],
  ])('rejects schema-invalid input: %s', (_label, request) => {
    const service = {
      admit: jest.fn(),
    } as unknown as jest.Mocked<OnboardingReplyService>;
    const controller = new OnboardingReplyController(service);

    expect(() =>
      controller.submit(
        'organization-id' as OrganizationId,
        'user-id' as UserId,
        'project-id' as ProjectId,
        'conversation-id' as ConversationId,
        request as never,
      ),
    ).toThrow(BadRequestException);
    expect(service.admit).not.toHaveBeenCalled();
  });
});
