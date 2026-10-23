import { ProjectMembershipRevocationService } from '../core/websockets/project-membership-revocation.service';
import { RedisModule } from '../core/redis/redis.module';
import { Global, Module } from '@nestjs/common';
import { ProjectAccessGuard } from './guards/project-access.guard';
import { ProjectResourceAccessService } from './services/project-resource-access.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectAccessService } from './services/project-access.service';

@Global()
@Module({
  imports: [PrismaModule, RedisModule],
  providers: [
    ProjectAccessService,
    ProjectResourceAccessService,
    ProjectAccessGuard,
    ProjectMembershipRevocationService,
  ],
  exports: [
    ProjectAccessService,
    ProjectResourceAccessService,
    ProjectAccessGuard,
    ProjectMembershipRevocationService,
  ],
})
export class ProjectAccessModule {}
