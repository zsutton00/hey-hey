import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../decorators/public.decorator';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { OAuthService } from './oauth.service';
import { renderLoginPage } from './oauth-login.template';
import type {
  OAuthAuthorizeQuery,
  OAuthTokenBody,
  OAuthRevokeBody,
  OAuthLoginBody,
  OAuthErrorResponse,
} from './oauth.types';

@Controller('api/oauth')
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  constructor(private readonly oauthService: OAuthService) {}

  @Public()
  @SkipTransform()
  @Get('authorize')
  getAuthorize(
    @Query() query: OAuthAuthorizeQuery,
    @Res() res: Response,
  ): void {
    const { response_type, client_id, redirect_uri, scope, state } = query;

    if (response_type !== 'code') {
      res.status(HttpStatus.BAD_REQUEST).json({
        error: 'unsupported_response_type',
        error_description: 'Only response_type=code is supported',
      } satisfies OAuthErrorResponse);
      return;
    }

    const clientError = this.oauthService.validateClient(client_id);
    if (clientError) {
      res.status(HttpStatus.BAD_REQUEST).json(clientError);
      return;
    }

    const uriError = this.oauthService.validateRedirectUri(redirect_uri);
    if (uriError) {
      res.status(HttpStatus.BAD_REQUEST).json(uriError);
      return;
    }

    if (!state) {
      res.status(HttpStatus.BAD_REQUEST).json({
        error: 'invalid_request',
        error_description: 'Missing state parameter',
      } satisfies OAuthErrorResponse);
      return;
    }

    const html = renderLoginPage({
      clientId: client_id,
      redirectUri: redirect_uri,
      scope: scope || 'read write',
      state,
    });

    res.type('text/html').send(html);
  }

  @Public()
  @SkipTransform()
  @Post('authorize')
  async postAuthorize(
    @Body() body: OAuthLoginBody,
    @Res() res: Response,
  ): Promise<void> {
    const { email, password, client_id, redirect_uri, scope, state } = body;

    // Re-validate OAuth params (form could be tampered with)
    const clientError = this.oauthService.validateClient(client_id);
    if (clientError) {
      res.status(HttpStatus.BAD_REQUEST).json(clientError);
      return;
    }

    const uriError = this.oauthService.validateRedirectUri(redirect_uri);
    if (uriError) {
      res.status(HttpStatus.BAD_REQUEST).json(uriError);
      return;
    }

    const userId = await this.oauthService.authenticateUser(email, password);
    if (!userId) {
      const html = renderLoginPage({
        clientId: client_id,
        redirectUri: redirect_uri,
        scope: scope || 'read write',
        state,
        error: 'Invalid email or password.',
        email,
      });
      res.type('text/html').send(html);
      return;
    }

    const code = await this.oauthService.generateAuthorizationCode(
      userId,
      client_id,
      redirect_uri,
      scope || 'read write',
      state,
    );

    const callbackUrl = new URL(redirect_uri);
    callbackUrl.searchParams.set('code', code);
    callbackUrl.searchParams.set('state', state);

    res.redirect(callbackUrl.toString());
  }

  @Public()
  @SkipTransform()
  @Post('token')
  @HttpCode(HttpStatus.OK)
  async token(
    @Body() body: OAuthTokenBody,
    @Res() res: Response,
  ): Promise<void> {
    const { grant_type, client_id, client_secret } = body;

    const clientError = this.oauthService.validateClient(
      client_id,
      client_secret,
    );
    if (clientError) {
      res.status(HttpStatus.UNAUTHORIZED).json(clientError);
      return;
    }

    if (grant_type === 'authorization_code') {
      if (!body.code || !body.redirect_uri) {
        res.status(HttpStatus.BAD_REQUEST).json({
          error: 'invalid_request',
          error_description: 'Missing code or redirect_uri',
        } satisfies OAuthErrorResponse);
        return;
      }

      const result = await this.oauthService.exchangeAuthorizationCode(
        body.code,
        body.redirect_uri,
        client_id,
      );

      if ('error' in result) {
        res.status(HttpStatus.BAD_REQUEST).json(result);
        return;
      }

      res.json(result);
      return;
    }

    if (grant_type === 'refresh_token') {
      const refreshToken =
        typeof body.refresh_token === 'string'
          ? body.refresh_token.trim()
          : null;

      if (!refreshToken) {
        res.status(HttpStatus.BAD_REQUEST).json({
          error: 'invalid_request',
          error_description: 'Missing or invalid refresh_token',
        } satisfies OAuthErrorResponse);
        return;
      }

      const result = await this.oauthService.refreshOAuthToken(refreshToken);

      if ('error' in result) {
        res.status(HttpStatus.BAD_REQUEST).json(result);
        return;
      }

      res.json(result);
      return;
    }

    res.status(HttpStatus.BAD_REQUEST).json({
      error: 'unsupported_grant_type',
      error_description: `Grant type '${String(grant_type)}' is not supported`,
    } satisfies OAuthErrorResponse);
  }

  @Public()
  @SkipTransform()
  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Body() body: OAuthRevokeBody,
    @Res() res: Response,
  ): Promise<void> {
    // Per RFC 7009, always return 200 regardless of token validity
    try {
      if (body.token) {
        await this.oauthService.revokeToken(body.token);
      }
    } catch (error) {
      this.logger.error('Error during token revocation', error);
    }

    res.json({});
  }
}
