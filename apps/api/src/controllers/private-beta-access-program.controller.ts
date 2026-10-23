import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type {
  PrivateBetaAccessProgramCloseResultDto,
  PrivateBetaSelfServiceAdmissionModeDto,
  PrivateBetaSelfServiceAdmissionModeUpdateResultDto,
  UpdatePrivateBetaSelfServiceAdmissionModeDto,
} from '../generated';
import { PrivateBetaAccessProgramService } from '../services/private-beta-access-program.service';

@ApiTags('Private Beta Access')
@ApiBearerAuth()
@Controller('api/v1/admin/private-beta-access')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PrivateBetaAccessProgramController {
  private readonly logger = new Logger(PrivateBetaAccessProgramController.name);

  constructor(
    private readonly privateBetaAccessProgramService: PrivateBetaAccessProgramService,
  ) {}

  @Get('admission-mode')
  @ApiOperation({ summary: 'Get self-service admission mode' })
  async getAdmissionMode(): Promise<PrivateBetaSelfServiceAdmissionModeDto> {
    return this.privateBetaAccessProgramService.getSelfServiceAdmissionMode();
  }

  @Put('admission-mode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update self-service admission mode' })
  async updateAdmissionMode(
    @Body() body: UpdatePrivateBetaSelfServiceAdmissionModeDto,
    @Req() request: Request,
  ): Promise<PrivateBetaSelfServiceAdmissionModeUpdateResultDto> {
    const user = request.user as AuthenticatedUser;
    return this.privateBetaAccessProgramService.updateSelfServiceAdmissionMode(
      body.mode,
      user.userId,
    );
  }

  @Post('close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close private-beta access' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Private-beta access is durably closed.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid bearer authentication.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Admin access required.',
  })
  async close(
    @Req() request: Request,
  ): Promise<PrivateBetaAccessProgramCloseResultDto> {
    const user = request.user as AuthenticatedUser;
    this.logger.debug('Private-beta close request entered controller', {
      operatorId: user.userId,
    });
    return this.privateBetaAccessProgramService.close(user.userId);
  }
}
