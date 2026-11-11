import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { z } from 'zod';
import {
  BrowserSessionResponseDto,
  LocalBootstrapResponseDto,
  LocalCliCredentialsResponseDto,
  LocalSetupStatusDto,
} from '@hey-hey/contracts/api/models';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  browserSessionRequestMetadata,
  setBrowserSessionCookies,
} from '../auth/browser-session-cookies';
import { LocalAccessService } from './local-access.service';

const localHandoffBodySchema = z
  .object({ handoffToken: z.string().regex(/^[A-Za-z0-9_-]{40,64}$/) })
  .strict();
const localNameBodySchema = z
  .object({ name: z.string().trim().min(1).max(100) })
  .strict();

/** Local-only account routes; hosted composition never registers them. */
@ApiTags('Authentication')
@Controller('api/v1/auth')
export class LocalAuthController {
  private readonly trustedOrigin: string;

  constructor(
    private readonly localAccess: LocalAccessService,
    configService: ConfigService,
  ) {
    this.trustedOrigin = configService.getOrThrow<string>(
      'ACCOUNT_PASSKEY_ORIGIN',
    );
  }

  @Public()
  @Post('local/bootstrap')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Prepare local account access' })
  @ApiResponse({ status: 200, type: Object })
  async localBootstrap(
    @Headers('x-heyhey-local-secret') installationSecret: string | undefined,
  ): Promise<LocalBootstrapResponseDto> {
    return this.localAccess.createLocalHandoff(installationSecret);
  }

  @Public()
  @Post('local/cli-credentials')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue local CLI credentials' })
  @ApiResponse({ status: 200, type: Object })
  async localCliCredentials(
    @Headers('x-heyhey-local-secret') installationSecret: string | undefined,
  ): Promise<LocalCliCredentialsResponseDto> {
    return this.localAccess.issueLocalCliCredentials(installationSecret);
  }

  @Public()
  @Post('local/handoff')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange one-time local browser handoff' })
  @ApiResponse({ status: 200, type: Object })
  async localHandoff(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BrowserSessionResponseDto> {
    this.assertLocalBrowserOrigin(request);
    const parsedBody = localHandoffBodySchema.safeParse(body);
    if (!parsedBody.success) {
      throw new BadRequestException('Invalid local browser handoff');
    }
    const session = await this.localAccess.completeLocalHandoff(
      parsedBody.data.handoffToken,
      browserSessionRequestMetadata(request),
    );
    setBrowserSessionCookies(response, session);
    return session.response;
  }

  @Patch('local/name')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Save the local account display name' })
  @ApiResponse({ status: 200, type: Object })
  async saveLocalDisplayName(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<LocalSetupStatusDto> {
    this.assertLocalBrowserOrigin(request);
    const parsedBody = localNameBodySchema.safeParse(body);
    if (!parsedBody.success) {
      throw new BadRequestException('Name must contain 1 to 100 characters');
    }
    return this.localAccess.updateLocalDisplayName(
      user.userId,
      parsedBody.data.name,
    );
  }

  @Get('local/status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Read local account, connection and execution status',
  })
  @ApiResponse({ status: 200, type: Object })
  async getLocalStatus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LocalSetupStatusDto> {
    return this.localAccess.getLocalStatus(user.userId);
  }

  private assertLocalBrowserOrigin(request: Request): void {
    const fetchSite = request.headers['sec-fetch-site'];
    if (
      request.headers.origin !== this.trustedOrigin ||
      (fetchSite !== undefined &&
        fetchSite !== 'same-site' &&
        fetchSite !== 'same-origin')
    ) {
      throw new UnauthorizedException('Local browser origin is not trusted');
    }
  }
}
