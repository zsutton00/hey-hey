import {
  Controller,
  Post,
  Put,
  Body,
  Res,
  Req,
  UnauthorizedException,
  BadRequestException,
  Get,
  UseGuards,
  Patch,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SkipTransform } from '../common/decorators/skip-transform.decorator';
import { Request, Response } from 'express';
import { AuthService } from '../auth/services/auth.service';
import {
  AuthResponseDto,
  AccountDefaultOrganizationDto,
  SetAccountDefaultOrganizationDto,
  BrowserAuthResponseDto,
  BrowserSessionResponseDto,
  ChangeCurrentPasswordDto,
  ChangePasswordDto,
  LoginDto,
  PasswordChangeRequiredDto,
  PasswordRecoveryAcknowledgementDto,
  PasswordRecoveryRequestDto,
  RefreshBrowserSessionDto,
  RegisterDto,
} from '../generated';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  ACCESS_COOKIE_NAME,
  AUTH_ROUTE_PREFIX,
  REFRESH_COOKIE_NAME,
  browserSessionRequestMetadata,
  cookieAttributes,
  requiredExpiresIn,
  setBrowserSessionCookies,
} from '../auth/browser-session-cookies';
import { CorsConfig } from '../common/config/cors.config';
import { clearDemoBindingCookie } from '../services/demo-sandbox/demo-binding-cookie';
import { OrganizationId } from '../types';

const LEGACY_REFRESH_TTL_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;

@ApiTags('Authentication')
@Controller('api/v1/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private authService: AuthService) {}

  @Get('account-default-organization')
  @UseGuards(JwtAuthGuard)
  getAccountDefaultOrganization(
    @Req() request: Request,
  ): Promise<AccountDefaultOrganizationDto> {
    return this.authService.getAccountDefaultOrganization(
      this.browserAccessToken(request),
    );
  }

  @Put('account-default-organization')
  @UseGuards(JwtAuthGuard)
  setAccountDefaultOrganization(
    @Req() request: Request,
    @Body() dto: SetAccountDefaultOrganizationDto,
  ): Promise<AccountDefaultOrganizationDto> {
    this.assertTrustedBrowserOrigin(request);
    if (dto?.organizationId === undefined)
      throw new BadRequestException('organizationId is required');
    return this.authService.setAccountDefaultOrganization(
      this.browserAccessToken(request),
      dto.organizationId as OrganizationId,
    );
  }

  private browserAccessToken(request: Request): string | undefined {
    const authorization = request.headers.authorization;
    if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
    const token = request.cookies?.[ACCESS_COOKIE_NAME];
    return typeof token === 'string' ? token : undefined;
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login' })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: 'BrowserSessionResponseDto',
  })
  async login(
    @Body() loginDto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BrowserSessionResponseDto | PasswordChangeRequiredDto> {
    const result = await this.authService.login(
      loginDto,
      browserSessionRequestMetadata(request),
    );

    if ('mustChangePassword' in result) {
      return result;
    }

    setBrowserSessionCookies(response, result);
    clearDemoBindingCookie(response);
    this.logger.log('Browser sign-in cookies set', {
      sessionId: result.sessionId,
      familyId: result.familyId,
    });
    return result.response;
  }

  @Public()
  @Post('password-recovery')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password recovery' })
  @ApiResponse({
    status: 200,
    description: 'Indistinguishable recovery acknowledgement',
    type: 'PasswordRecoveryAcknowledgementDto',
  })
  async initiatePasswordRecovery(
    @Body() dto: PasswordRecoveryRequestDto,
    @Req() request: Request,
  ): Promise<PasswordRecoveryAcknowledgementDto> {
    return this.authService.initiatePasswordRecovery(
      dto,
      browserSessionRequestMetadata(request),
    );
  }

  @Post('register')
  @ApiOperation({ summary: 'User registration' })
  @ApiResponse({
    status: 201,
    description: 'Registration successful',
    type: 'BrowserSessionResponseDto',
  })
  async register(
    @Body() registerDto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BrowserSessionResponseDto> {
    const session = await this.authService.register(
      registerDto,
      browserSessionRequestMetadata(request),
    );

    this.clearBrowserSessionCookies(response);
    setBrowserSessionCookies(response, session);
    clearDemoBindingCookie(response);

    return session.response;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh token' })
  @ApiResponse({
    status: 200,
    description: 'Token refreshed successfully',
    type: 'BrowserSessionResponseDto',
  })
  async refreshToken(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() refreshDto?: RefreshBrowserSessionDto,
  ): Promise<BrowserSessionResponseDto> {
    this.assertTrustedBrowserOrigin(request);

    try {
      const refreshSecret = request.cookies?.[REFRESH_COOKIE_NAME];
      if (typeof refreshSecret !== 'string' || refreshSecret.length === 0) {
        throw new UnauthorizedException('Browser session is not authenticated');
      }

      const requestMetadata = browserSessionRequestMetadata(request);
      const session =
        refreshDto?.organizationId !== undefined
          ? await this.authService.refreshToken(
              refreshSecret,
              requestMetadata,
              refreshDto.organizationId as OrganizationId,
            )
          : await this.authService.refreshToken(refreshSecret, requestMetadata);

      setBrowserSessionCookies(response, session);
      return session.response;
    } catch (error) {
      this.clearBrowserSessionCookies(response);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User logout' })
  @ApiResponse({
    status: 200,
    description: 'Logout successful',
  })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ message: string }> {
    this.assertTrustedBrowserOrigin(request);

    const refreshSecret = request.cookies?.[REFRESH_COOKIE_NAME];
    const accessToken = request.cookies?.[ACCESS_COOKIE_NAME];
    await this.authService.logout(
      typeof refreshSecret === 'string' ? refreshSecret : undefined,
      typeof accessToken === 'string' ? accessToken : undefined,
      browserSessionRequestMetadata(request),
    );
    this.clearBrowserSessionCookies(response);
    clearDemoBindingCookie(response);

    return { message: 'Logged out successfully' };
  }

  @Public()
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate JWT token for external services' })
  @ApiResponse({
    status: 200,
    description: 'Token is valid',
    schema: {
      type: 'object',
      properties: {
        valid: { type: 'boolean' },
        payload: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            email: { type: 'string' },
            currentOrgId: { type: 'string' },
            orgMemberships: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  orgId: { type: 'string' },
                  role: { type: 'string' },
                },
              },
            },
            iat: { type: 'number' },
            exp: { type: 'number' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Token is invalid',
    schema: {
      type: 'object',
      properties: {
        valid: { type: 'boolean' },
        error: { type: 'string' },
      },
    },
  })
  async validateToken(
    @Body() body: { token: string },
  ): Promise<{ valid: boolean; payload?: any; error?: string }> {
    return this.authService.validateTokenForExternalService(body.token);
  }

  @Public()
  @SkipTransform()
  @Get('jwks')
  @ApiOperation({
    summary: 'Get JSON Web Key Set (JWKS) for token validation',
    description:
      'Returns the public keys that external services can use to validate JWT tokens independently',
  })
  @ApiResponse({
    status: 200,
    description: 'JWKS retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        keys: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kty: { type: 'string' },
              use: { type: 'string' },
              kid: { type: 'string' },
              n: { type: 'string' },
              e: { type: 'string' },
            },
          },
        },
      },
    },
  })
  async getJwks(): Promise<{ keys: any[] }> {
    return this.authService.getJwks();
  }

  @Public()
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change password using password-change token' })
  @ApiResponse({
    status: 200,
    description: 'Password changed successfully',
    type: 'BrowserSessionResponseDto',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired password change token',
  })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BrowserSessionResponseDto> {
    const session = await this.authService.changePassword(
      dto,
      browserSessionRequestMetadata(request),
    );
    this.clearBrowserSessionCookies(response);
    setBrowserSessionCookies(response, session);
    clearDemoBindingCookie(response);
    return session.response;
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-current-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Change the signed-in user's password" })
  @ApiResponse({
    status: 200,
    description: 'Password changed successfully',
    type: 'BrowserSessionResponseDto',
  })
  @ApiResponse({
    status: 400,
    description: 'The replacement password is invalid',
  })
  @ApiResponse({
    status: 401,
    description: 'The browser session or current password is invalid',
  })
  async changeCurrentPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangeCurrentPasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BrowserSessionResponseDto> {
    this.assertTrustedBrowserOrigin(request);

    const session = await this.authService.changeCurrentPassword(
      user.userId,
      dto,
      browserSessionRequestMetadata(request),
    );
    this.clearBrowserSessionCookies(response);
    setBrowserSessionCookies(response, session);
    return session.response;
  }

  @UseGuards(JwtAuthGuard)
  @Patch('toggle-dev-admin')
  @ApiOperation({
    summary: 'Toggle dev-admin mode',
    description:
      'Switch between normal user mode and dev-admin mode. Only available to users with dev-admin privileges.',
  })
  @ApiResponse({
    status: 200,
    description: 'Dev-admin mode toggled successfully',
    type: 'AuthResponseDto',
  })
  @ApiResponse({
    status: 403,
    description: 'User does not have dev-admin privileges',
  })
  async toggleDevAdminMode(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const authResponse = await this.authService.toggleDevAdminMode(user.userId);
    this.setLegacyAuthCookies(response, authResponse);
    return authResponse;
  }

  private setLegacyAuthCookies(
    response: Response,
    authResponse: AuthResponseDto,
  ): void {
    const expiresIn = requiredExpiresIn(
      authResponse.expiresIn,
      'Access-token expiry is missing or invalid',
    );

    response.cookie(ACCESS_COOKIE_NAME, authResponse.accessToken, {
      ...cookieAttributes('/'),
      maxAge: expiresIn * 1000,
    });
    response.cookie(REFRESH_COOKIE_NAME, authResponse.refreshToken, {
      ...cookieAttributes('/'),
      maxAge: LEGACY_REFRESH_TTL_MILLISECONDS,
    });
  }

  private clearBrowserSessionCookies(response: Response): void {
    response.clearCookie(ACCESS_COOKIE_NAME, cookieAttributes('/'));
    response.clearCookie(
      REFRESH_COOKIE_NAME,
      cookieAttributes(AUTH_ROUTE_PREFIX),
    );
    response.clearCookie(REFRESH_COOKIE_NAME, cookieAttributes('/'));
  }

  private assertTrustedBrowserOrigin(request: Request): void {
    const origin = request.headers.origin;
    if (!CorsConfig.isBrowserOriginAllowed(origin)) {
      throw new UnauthorizedException(
        'Browser session mutation is not allowed',
      );
    }
  }

  private toBrowserAuthResponse(
    authResponse: AuthResponseDto,
  ): BrowserAuthResponseDto {
    const expiresIn = requiredExpiresIn(
      authResponse.expiresIn,
      'Browser access-token expiry is missing or invalid',
    );

    return {
      user: authResponse.user,
      accessToken: authResponse.accessToken,
      expiresIn,
    } satisfies BrowserAuthResponseDto;
  }
}
