import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
import type { OpenItemsTriageSessionService } from '../../services/open-items/open-items-triage-session.service';
import type { OrganizationId, ProjectId, UserId } from '../../types';
import { OpenItemsTriageSessionController } from '../open-items-triage-session.controller';

describe('OpenItemsTriageSessionController', () => {
  it('requires authentication, organization and project access', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, OpenItemsTriageSessionController),
    ).toEqual([JwtAuthGuard, OrganizationGuard, ProjectAccessGuard]);
  });

  it('creates a session for the authenticated user, never a caller-supplied one', async () => {
    const resolved = {
      agentSessionId: 'session-1',
      conversationId: 'conversation-1',
      created: true,
    };
    const service = { create: jest.fn().mockResolvedValue(resolved) };
    const controller = new OpenItemsTriageSessionController(
      service as unknown as OpenItemsTriageSessionService,
    );

    await expect(
      controller.resolveOpenItemsTriageSession(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'user-1' as UserId,
      ),
    ).resolves.toEqual(resolved);
    expect(service.create).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'project-1',
      userId: 'user-1',
    });
  });
});
