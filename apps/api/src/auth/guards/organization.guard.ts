import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { AuthenticatedUser } from '../strategies/jwt.strategy';
import { ApiKeyAuthenticatedUser } from '../strategies/api-key.strategy';
import { ProjectAccessService } from '../services/project-access.service';

@Injectable()
export class OrganizationGuard implements CanActivate {
  constructor(private readonly access: ProjectAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | ApiKeyAuthenticatedUser | undefined =
      request.user;
    const organizationId = request.params.organizationId;
    if (!user) throw new ForbiddenException('User not authenticated');
    if (!organizationId || typeof organizationId !== 'string') {
      throw new ForbiddenException('Organization ID not provided');
    }
    if (
      'authType' in user &&
      user.authType === 'api-key' &&
      user.organizationId !== organizationId
    ) {
      throw new ForbiddenException(
        'API key does not have access to this organization',
      );
    }
    await this.access.assertOrganization(user.userId, organizationId);
    return true;
  }
}
