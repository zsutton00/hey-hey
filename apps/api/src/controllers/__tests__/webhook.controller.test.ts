import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import { Request } from 'express';
import { WebhookController } from '../webhook.controller';
import { IntegrationService } from '../../services/integrations/integration.service';
import { GitHubIntegrationHandler } from '../../integration/handlers/github.integration.handler';
import {
  IntegrationConnectionStatus,
  IntegrationState,
  IntegrationType,
} from '../../generated';
import { IntegrationId, OrganizationId, ProjectId } from '../../types';
import { GitHubWebhookPayload } from '../../types/webhook.types';

describe('WebhookController', () => {
  const secret = 'integration-specific-secret';
  const integrationId = '9bd92fd6-16b1-4f8c-a773-b07ae4cc1f90' as IntegrationId;
  const organizationId =
    'f7ac166f-aef2-4fbe-a514-0f96bc5ac924' as OrganizationId;
  const projectId = '66d4eeec-e20c-429f-bef9-b58471668bf2' as ProjectId;
  const payload: GitHubWebhookPayload = {
    action: 'closed',
    repository: {
      id: 42,
      name: 'api',
      full_name: 'hey-hey/api',
      html_url: 'https://github.com/hey-hey/api',
      clone_url: 'https://github.com/hey-hey/api.git',
      ssh_url: 'git@github.com:hey-hey/api.git',
      private: true,
      owner: { login: 'hey-hey', id: 7, type: 'Organization' },
    },
    pull_request: {
      id: 100,
      number: 12,
      state: 'closed',
      merged: true,
      merged_at: '2026-08-18T18:00:00.000Z',
      html_url: 'https://github.com/hey-hey/api/pull/12',
      head: { sha: 'abc123' },
      base: { sha: 'def456' },
    },
  };
  const integrationDto = {
    id: integrationId,
    organizationId,
    projectId,
    name: 'GitHub',
    type: IntegrationType.Github,
    state: IntegrationState.Active,
    connectionStatus: IntegrationConnectionStatus.Connected,
    targetType: 'PROJECT',
    config: {
      token: 'token',
      webhookSecret: secret,
      repositoryUrl: 'https://github.com/hey-hey/api',
    },
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  } as any;
  const integrationRecord = {
    ...integrationDto,
    createdAt: new Date(integrationDto.createdAt),
    updatedAt: new Date(integrationDto.updatedAt),
    lastConnectionCheck: null,
    lastSuccessfulSync: null,
    errorMessage: null,
    createdBy: null,
    deletedAt: null,
  } as any;

  let controller: WebhookController;
  let integrationService: {
    findActiveGitHubIntegrationWithDecryptedConfig: jest.Mock;
    dtoToIntegration: jest.Mock;
  };
  let githubHandler: { handleWebhook: jest.Mock };

  beforeEach(async () => {
    integrationService = {
      findActiveGitHubIntegrationWithDecryptedConfig: jest
        .fn()
        .mockResolvedValue(integrationDto),
      dtoToIntegration: jest.fn().mockReturnValue(integrationRecord),
    };
    githubHandler = {
      handleWebhook: jest.fn().mockResolvedValue({
        accepted: true,
        duplicate: false,
        inboxId: 'ef0099ee-468b-4841-a473-df9f9363a15f',
      }),
    };
    const module = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: IntegrationService, useValue: integrationService },
        { provide: GitHubIntegrationHandler, useValue: githubHandler },
      ],
    }).compile();
    controller = module.get(WebhookController);
  });

  async function signedRequest(body: GitHubWebhookPayload = payload) {
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = `sha256=${createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')}`;
    return {
      rawBody,
      signature,
      request: {
        rawBody,
        ip: '127.0.0.1',
        connection: { remoteAddress: '127.0.0.1' },
      } as Request & { rawBody: Buffer },
    };
  }

  it('accepts a signed merge for the route-selected integration', async () => {
    const signed = await signedRequest();
    await expect(
      controller.handleGitHubWebhook(
        integrationId,
        signed.request,
        payload,
        'pull_request',
        signed.signature,
        'delivery-1',
      ),
    ).resolves.toEqual({ accepted: true });

    expect(
      integrationService.findActiveGitHubIntegrationWithDecryptedConfig,
    ).toHaveBeenCalledWith(integrationId);
    expect(githubHandler.handleWebhook).toHaveBeenCalledWith(
      {
        payload,
        rawBody: signed.rawBody,
        eventName: 'pull_request',
        deliveryId: 'delivery-1',
      },
      integrationRecord,
    );
  });

  it.each([
    ['x-github-event', undefined, 'valid', 'delivery-1'],
    ['x-hub-signature-256', 'pull_request', undefined, 'delivery-1'],
    ['x-github-delivery', 'pull_request', 'valid', undefined],
  ])(
    'rejects a missing %s header',
    async (_name, event, signature, delivery) => {
      const signed = await signedRequest();
      await expect(
        controller.handleGitHubWebhook(
          integrationId,
          signed.request,
          payload,
          event,
          signature === 'valid' ? signed.signature : signature,
          delivery,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(githubHandler.handleWebhook).not.toHaveBeenCalled();
    },
  );

  it('rejects a request when captured raw bytes are unavailable', async () => {
    const signed = await signedRequest();
    const request = { ...signed.request, rawBody: undefined } as any;
    await expect(
      controller.handleGitHubWebhook(
        integrationId,
        request,
        payload,
        'pull_request',
        signed.signature,
        'delivery-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an invalid signature before persistence', async () => {
    const signed = await signedRequest();
    await expect(
      controller.handleGitHubWebhook(
        integrationId,
        signed.request,
        payload,
        'pull_request',
        `sha256=${'0'.repeat(64)}`,
        'delivery-1',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(githubHandler.handleWebhook).not.toHaveBeenCalled();
  });

  it('returns not found for an inactive or absent route-selected integration', async () => {
    integrationService.findActiveGitHubIntegrationWithDecryptedConfig.mockRejectedValue(
      new NotFoundException(),
    );
    const signed = await signedRequest();
    await expect(
      controller.handleGitHubWebhook(
        integrationId,
        signed.request,
        payload,
        'pull_request',
        signed.signature,
        'delivery-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a repository that is outside the integration membership', async () => {
    const mismatched = {
      ...payload,
      repository: { ...payload.repository, full_name: 'other/api' },
    };
    const signed = await signedRequest(mismatched);
    await expect(
      controller.handleGitHubWebhook(
        integrationId,
        signed.request,
        mismatched,
        'pull_request',
        signed.signature,
        'delivery-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('keeps identical repositories isolated by callback integration identity', async () => {
    const otherIntegrationId =
      '5163845f-bef9-4d67-97b1-8f356832e8e0' as IntegrationId;
    const signed = await signedRequest();
    await controller.handleGitHubWebhook(
      otherIntegrationId,
      signed.request,
      payload,
      'pull_request',
      signed.signature,
      'delivery-1',
    );
    expect(
      integrationService.findActiveGitHubIntegrationWithDecryptedConfig,
    ).toHaveBeenCalledWith(otherIntegrationId);
  });
});
