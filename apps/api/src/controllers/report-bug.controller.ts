import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { ReportBugRequestDto, ReportBugResponseDto } from 'src/generated';
import { ReportBugService } from 'src/services/report-bug.service';
import type { UserId } from 'src/types';

@ApiTags('Report Bugs')
@Controller('api/v1/report-bug')
@UseGuards(JwtAuthGuard)
export class ReportBugController {
  constructor(private readonly reportBugService: ReportBugService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @ApiOperation({ summary: 'Report a product problem' })
  @ApiResponse({ status: 201, description: 'BUG created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid report' })
  @ApiResponse({ status: 429, description: 'Report rate limit exceeded' })
  @ApiResponse({ status: 503, description: 'Report intake unavailable' })
  reportBug(
    @Body() input: ReportBugRequestDto,
    @CurrentUser('userId') userId: UserId,
  ): Promise<ReportBugResponseDto> {
    return this.reportBugService.reportBug(input, userId);
  }
}
