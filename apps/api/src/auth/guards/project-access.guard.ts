import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProjectAccessService } from '../services/project-access.service';
import { ProjectResource } from '../services/project-resource-access.service';

const RESOURCE = 'project-access:resource';
export const ProjectResourceId = (resource: ProjectResource) =>
  SetMetadata(RESOURCE, resource);

@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(
    private readonly access: ProjectAccessService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;
    const organizationId = request.params.organizationId;
    if (!userId || !organizationId)
      throw new ForbiddenException('Authenticated organization required');
    // Project controllers use "id" for the project itself. Entity ownership
    // belongs to endpoint queries, not this membership guard.
    const resource = this.reflector.getAllAndOverride<ProjectResource>(
      RESOURCE,
      [context.getHandler(), context.getClass()],
    );
    const projectId =
      request.params.projectId ??
      (resource === 'project' ? request.params.id : undefined);
    if (projectId)
      await this.access.assertProject(userId, organizationId, projectId);
    return true;
  }
}
