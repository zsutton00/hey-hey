import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ImplementationHintService } from '../services/service/implementation-hint.service';

/**
 * Platform-admin debug read of a project's implementation hints. Unlike the
 * organization list, it does not hide Services that have been archived.
 */
@ApiTags('DebugAdmin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('api/v1/admin/projects/:projectId/implementation-hints')
export class AdminImplementationHintController {
  constructor(
    private readonly implementationHintService: ImplementationHintService,
  ) {}

  @Get()
  async list(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return {
      services:
        await this.implementationHintService.findAllByProjectGroupedByService(
          projectId,
        ),
    };
  }
}
