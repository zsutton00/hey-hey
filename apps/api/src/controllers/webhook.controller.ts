import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/decorators/public.decorator';
import { IntegrationService } from '../services/integrations/integration.service';
import { GitHubIntegrationHandler } from '../integration/handlers/github.integration.handler';
import {
  GitHubIntegrationConfig,
  GitHubWebhookAcceptedResponseDto,
} from '../generated';
import { IntegrationId } from '../types';
import { GitHubWebhookPayload } from '../types/webhook.types';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private readonly rateLimitMap = new Map<
    string,
    { count: number; resetTime: number }
  >();
  private readonly RATE_LIMIT_WINDOW = 60 * 1000;
  private readonly RATE_LIMIT_MAX_REQUESTS = 100;

  constructor(
    private readonly integrationService: IntegrationService,
    private readonly githubHandler: GitHubIntegrationHandler,
  ) {}

  @Public()
  @Post('github/:integrationId')
  @ApiOperation({
    summary: 'Accept a GitHub webhook delivery',
    description:
      'Authenticates and durably accepts one integration-scoped GitHub delivery.',
  })
  @ApiParam({ name: 'integrationId', format: 'uuid', required: true })
  @ApiHeader({ name: 'x-github-event', required: true })
  @ApiHeader({ name: 'x-github-delivery', required: true })
  @ApiHeader({ name: 'x-hub-signature-256', required: true })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The delivery was durably accepted or already existed.',
    type: Object,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid webhook authentication or payload.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Active GitHub integration not found.',
  })
  async handleGitHubWebhook(
    @Param('integrationId', new ParseUUIDPipe({ version: '4' }))
    integrationId: IntegrationId,
    @Req() request: RawBodyRequest<Request>,
    @Body() payload: GitHubWebhookPayload,
    @Headers('x-github-event') githubEvent?: string,
    @Headers('x-hub-signature-256') signature?: string,
    @Headers('x-github-delivery') deliveryId?: string,
  ): Promise<GitHubWebhookAcceptedResponseDto> {
    const clientIp =
      request.ip || request.connection.remoteAddress || 'unknown';
    if (!this.checkRateLimit(clientIp)) {
      this.logger.debug('GitHub webhook request rejected', {
        reason: 'rate_limit',
        integrationId,
      });
      throw new BadRequestException('Invalid request');
    }

    try {
      const eventName = this.requireHeader(githubEvent, 'x-github-event');
      const resolvedDeliveryId = this.requireHeader(
        deliveryId,
        'x-github-delivery',
      );
      const resolvedSignature = this.requireHeader(
        signature,
        'x-hub-signature-256',
      );
      if (!request.rawBody || request.rawBody.length === 0) {
        throw new BadRequestException('Missing raw request body');
      }

      const integration =
        await this.integrationService.findActiveGitHubIntegrationWithDecryptedConfig(
          integrationId,
        );
      const config = integration.config as GitHubIntegrationConfig;
      await this.verifyGitHubSignature(
        request.rawBody,
        resolvedSignature,
        config.webhookSecret,
      );
      this.assertRepositoryMatchesIntegration(payload, config);

      const result = await this.githubHandler.handleWebhook(
        {
          payload,
          rawBody: request.rawBody,
          eventName,
          deliveryId: resolvedDeliveryId,
        },
        this.integrationService.dtoToIntegration(integration),
      );

      this.logger.debug('GitHub webhook request acknowledged', {
        integrationId,
        projectId: integration.projectId,
        eventName,
        deliveryId: resolvedDeliveryId,
        duplicate: result.duplicate,
        inboxId: result.inboxId,
      });
      return { accepted: true } satisfies GitHubWebhookAcceptedResponseDto;
    } catch (error) {
      this.logger.debug('GitHub webhook request rejected', {
        integrationId,
        reason:
          error instanceof NotFoundException
            ? 'integration_not_found'
            : error instanceof BadRequestException
              ? 'invalid_request'
              : 'processing_failure',
      });
      if (error instanceof NotFoundException) {
        throw new NotFoundException('Resource not found');
      }
      if (error instanceof BadRequestException) {
        throw new BadRequestException('Invalid request');
      }
      throw new BadRequestException('Webhook processing failed');
    }
  }

  private requireHeader(value: string | undefined, name: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`Missing ${name} header`);
    }
    return value;
  }

  private assertRepositoryMatchesIntegration(
    payload: GitHubWebhookPayload,
    config: GitHubIntegrationConfig,
  ): void {
    const repository = payload.repository;
    if (
      !repository ||
      typeof repository.full_name !== 'string' ||
      typeof repository.html_url !== 'string'
    ) {
      throw new BadRequestException('Missing GitHub repository payload');
    }

    const fullName = repository.full_name.toLowerCase();
    const configuredRepository = config.repositoryUrl
      ? this.repositoryFullName(config.repositoryUrl)
      : config.primaryRepository?.fullName.toLowerCase();
    const configuredOrganization = config.organization?.toLowerCase();
    const repositoryOwner = fullName.split('/')[0];
    const matches = configuredRepository
      ? configuredRepository === fullName
      : configuredOrganization === repositoryOwner;

    if (!matches) {
      throw new BadRequestException(
        'GitHub repository does not belong to integration',
      );
    }
  }

  private repositoryFullName(repositoryUrl: string): string {
    try {
      const url = new URL(repositoryUrl);
      if (url.hostname.toLowerCase() !== 'github.com') {
        throw new Error('Unexpected host');
      }
      return url.pathname
        .replace(/^\//, '')
        .replace(/\.git$/, '')
        .replace(/\/$/, '')
        .toLowerCase();
    } catch {
      throw new BadRequestException('Invalid integration repository URL');
    }
  }

  private async verifyGitHubSignature(
    rawBody: Buffer,
    signature: string,
    secret?: string,
  ): Promise<void> {
    if (!secret) {
      throw new BadRequestException('Webhook secret is not configured');
    }
    if (!/^sha256=[0-9a-fA-F]{64}$/.test(signature)) {
      throw new BadRequestException('Invalid webhook signature format');
    }
    const expected = `sha256=${createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')}`;
    const expectedBytes = Buffer.from(expected);
    const actualBytes = Buffer.from(signature);
    if (
      expectedBytes.length !== actualBytes.length ||
      !timingSafeEqual(expectedBytes, actualBytes)
    ) {
      throw new BadRequestException('Invalid webhook signature');
    }
  }

  private checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = this.rateLimitMap.get(ip);
    if (!entry || now > entry.resetTime) {
      this.rateLimitMap.set(ip, {
        count: 1,
        resetTime: now + this.RATE_LIMIT_WINDOW,
      });
      return true;
    }
    if (entry.count >= this.RATE_LIMIT_MAX_REQUESTS) {
      return false;
    }
    entry.count += 1;
    return true;
  }
}
