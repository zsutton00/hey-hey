import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { PlatformAdminAccessDto } from '../generated';

/**
 * Tells the signed-in browser whether its user is a platform admin, using the
 * same decision AdminGuard applies to every admin endpoint.
 */
@ApiTags('DebugAdmin')
@Controller('api/v1/admin/platform-access')
@UseGuards(JwtAuthGuard)
export class PlatformAdminAccessController {
  constructor(private readonly adminGuard: AdminGuard) {}

  @Get()
  getAccess(
    @Req() request: Request & { user: AuthenticatedUser },
  ): PlatformAdminAccessDto {
    return { isPlatformAdmin: this.adminGuard.isPlatformAdmin(request) };
  }
}
