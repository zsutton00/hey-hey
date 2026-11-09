import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type {
  AccountPasskeyAssertionCredentialDto,
  AccountPasskeyAssertionOptionsDto,
  AccountPasskeyDto,
  AccountPasskeyListDto,
  AccountPasskeyProofOptionsRequestDto,
  AccountPasskeyRegistrationDto,
  AccountPasskeyRegistrationOptionsDto,
  AccountPasskeyRemovalDto,
  AccountPasskeyRenameDto,
  AccountPasskeySignInDto,
  AccountProofDto,
  BrowserSessionResponseDto,
} from '@hey-hey/contracts/api/models';
import { Public } from '../decorators/public.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../strategies/jwt.strategy';
import {
  AUTH_ROUTE_PREFIX,
  REFRESH_COOKIE_NAME,
  ACCESS_COOKIE_NAME,
  browserSessionRequestMetadata,
  cookieAttributes,
  setBrowserSessionCookies,
} from '../browser-session-cookies';
import { CorsConfig } from '../../common/config/cors.config';
import { clearDemoBindingCookie } from '../../services/demo-sandbox/demo-binding-cookie';
import type { EstablishedBrowserSession } from '../services/browser-session.service';
import {
  AccountPasskeyActor,
  AccountPasskeyService,
} from './account-passkey.service';

const CEREMONY_LIMIT = { default: { limit: 20, ttl: 60_000 } };
const base64Url = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/);
const passkeyName = z.string().trim().min(1).max(100);
const attachment = z.enum(['platform', 'cross-platform']).nullable().optional();

const assertionCredentialSchema = z
  .object({
    id: base64Url,
    rawId: base64Url,
    type: z.literal('public-key'),
    authenticatorAttachment: attachment,
    response: z
      .object({
        clientDataJSON: base64Url,
        authenticatorData: base64Url,
        signature: base64Url,
        userHandle: z
          .string()
          .regex(/^[A-Za-z0-9_-]*$/)
          .nullable(),
      })
      .strict(),
  })
  .strict() satisfies z.ZodType<AccountPasskeyAssertionCredentialDto>;

const proofSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024).optional(),
    passkeyAssertion: assertionCredentialSchema.optional(),
  })
  .strict() satisfies z.ZodType<AccountProofDto>;

const registrationSchema = z
  .object({
    name: passkeyName,
    credential: z
      .object({
        id: base64Url,
        rawId: base64Url,
        type: z.literal('public-key'),
        authenticatorAttachment: attachment,
        response: z
          .object({
            clientDataJSON: base64Url,
            attestationObject: base64Url,
            transports: z
              .array(
                z.enum([
                  'ble',
                  'cable',
                  'hybrid',
                  'internal',
                  'nfc',
                  'smart-card',
                  'usb',
                ]),
              )
              .max(8),
          })
          .strict(),
      })
      .strict(),
    proof: proofSchema,
  })
  .strict() satisfies z.ZodType<AccountPasskeyRegistrationDto>;

const signInSchema = z
  .object({ credential: assertionCredentialSchema })
  .strict() satisfies z.ZodType<AccountPasskeySignInDto>;

const proofOptionsSchema = z
  .object({
    operation: z.enum(['register', 'remove']),
    passkeyId: z.string().uuid().optional(),
  })
  .strict() satisfies z.ZodType<AccountPasskeyProofOptionsRequestDto>;

const renameSchema = z
  .object({ name: passkeyName })
  .strict() satisfies z.ZodType<AccountPasskeyRenameDto>;

const removalSchema = z
  .object({ proof: proofSchema })
  .strict() satisfies z.ZodType<AccountPasskeyRemovalDto>;

@ApiTags('Authentication')
@Controller('api/v1/auth/passkeys')
export class AccountPasskeyController {
  constructor(private readonly passkeys: AccountPasskeyService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: AuthenticatedUser): Promise<AccountPasskeyListDto> {
    return this.passkeys.list(actorFor(user).userId);
  }

  @Post('registration/options')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  startRegistration(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AccountPasskeyRegistrationOptionsDto> {
    assertTrustedBrowserOrigin(request);
    return this.passkeys.startRegistration(actorFor(user));
  }

  @Post('proof/options')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  startProof(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<AccountPasskeyAssertionOptionsDto> {
    assertTrustedBrowserOrigin(request);
    const dto = parse(proofOptionsSchema, body);
    return this.passkeys.startProof(
      actorFor(user),
      dto.operation,
      dto.passkeyId,
    );
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle(CEREMONY_LIMIT)
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BrowserSessionResponseDto> {
    assertTrustedBrowserOrigin(request);
    const session = await this.passkeys.register(
      actorFor(user),
      parse(registrationSchema, body),
      browserSessionRequestMetadata(request),
    );
    return replaceBrowserSession(response, session);
  }

  @Patch(':passkeyId')
  @UseGuards(JwtAuthGuard)
  rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('passkeyId', new ParseUUIDPipe()) passkeyId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<AccountPasskeyDto> {
    assertTrustedBrowserOrigin(request);
    return this.passkeys.rename(
      actorFor(user).userId,
      passkeyId,
      parse(renameSchema, body).name,
    );
  }

  @Post(':passkeyId/removal')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle(CEREMONY_LIMIT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('passkeyId', new ParseUUIDPipe()) passkeyId: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BrowserSessionResponseDto> {
    assertTrustedBrowserOrigin(request);
    const session = await this.passkeys.remove(
      actorFor(user),
      passkeyId,
      parse(removalSchema, body).proof,
      browserSessionRequestMetadata(request),
    );
    return replaceBrowserSession(response, session);
  }

  @Public()
  @Post('sign-in/options')
  @HttpCode(HttpStatus.OK)
  @Throttle(CEREMONY_LIMIT)
  startSignIn(
    @Req() request: Request,
  ): Promise<AccountPasskeyAssertionOptionsDto> {
    assertTrustedBrowserOrigin(request);
    return this.passkeys.startSignIn();
  }

  @Public()
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  @Throttle(CEREMONY_LIMIT)
  async signIn(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BrowserSessionResponseDto> {
    assertTrustedBrowserOrigin(request);
    const parsed = signInSchema.safeParse(body);
    if (!parsed.success) {
      throw new UnauthorizedException('Passkey sign-in failed');
    }
    const session = await this.passkeys.completeSignIn(
      parsed.data.credential,
      browserSessionRequestMetadata(request),
    );
    return replaceBrowserSession(response, session);
  }
}

/** Account passkey changes require a browser session, never OAuth access. */
export function actorFor(user: AuthenticatedUser): AccountPasskeyActor {
  if (!user.browserSessionId) {
    throw new UnauthorizedException('A browser session is required');
  }
  return {
    userId: user.userId,
    browserSessionId: user.browserSessionId,
    email: user.email,
    name: user.name,
  };
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException('Invalid passkey request');
  }
  return parsed.data;
}

export function replaceBrowserSession(
  response: Response,
  session: EstablishedBrowserSession,
): BrowserSessionResponseDto {
  response.clearCookie(ACCESS_COOKIE_NAME, cookieAttributes('/'));
  response.clearCookie(
    REFRESH_COOKIE_NAME,
    cookieAttributes(AUTH_ROUTE_PREFIX),
  );
  response.clearCookie(REFRESH_COOKIE_NAME, cookieAttributes('/'));
  setBrowserSessionCookies(response, session);
  clearDemoBindingCookie(response);
  return session.response;
}

export function assertTrustedBrowserOrigin(request: Request): void {
  if (!CorsConfig.isBrowserOriginAllowed(request.headers.origin)) {
    throw new UnauthorizedException('Browser session mutation is not allowed');
  }
}
