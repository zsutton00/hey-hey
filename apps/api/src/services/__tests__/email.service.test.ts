import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { EmailService } from '../email.service';
import type { PrivateBetaAccessRequestId } from '../../types';

describe('EmailService', () => {
  function makeService(env: Record<string, string | undefined> = {}) {
    const config = {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService;
    return new EmailService(config);
  }

  const params = {
    to: 'user@example.com',
    name: 'User',
    passwordChangeCredential: 'welcome-token',
  };

  it('throws when RESEND_API_KEY is missing', async () => {
    const service = makeService({ RESEND_FROM_ADDRESS: 'noreply@example.com' });

    await expect(service.sendWelcomeEmail(params)).rejects.toThrow(
      'Email service is not configured',
    );
  });

  it('throws when RESEND_FROM_ADDRESS is missing', async () => {
    const service = makeService({ RESEND_API_KEY: 'fake-key' });

    await expect(service.sendWelcomeEmail(params)).rejects.toThrow(
      'Email service is not configured',
    );
  });

  it('throws when both config values are missing', async () => {
    const service = makeService({});

    await expect(service.sendWelcomeEmail(params)).rejects.toThrow(
      'Email service is not configured',
    );
  });

  it('uses the local capture server and web app defaults in development', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'delivery-1' })));
    const service = makeService({ NODE_ENV: 'development' });

    await service.sendWelcomeEmail({
      ...params,
      providerIdempotencyKey: 'private-beta-welcome:request-1',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:4010/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'idempotency-key': 'private-beta-welcome:request-1',
        }),
        body: expect.stringContaining('http://localhost:5173/'),
      }),
    );
    fetchSpy.mockRestore();
  });

  it('honors a configured provider base URL loaded through ConfigService', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'delivery-1' })));
    const service = makeService({
      RESEND_API_KEY: 'fake-key',
      RESEND_FROM_ADDRESS: 'noreply@example.com',
      RESEND_BASE_URL: 'http://127.0.0.1:4010',
      WEB_APP_URL: 'http://localhost:5173',
    });

    await service.sendWelcomeEmail({
      ...params,
      providerIdempotencyKey: 'private-beta-welcome:request-1',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:4010/emails',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer fake-key',
          'idempotency-key': 'private-beta-welcome:request-1',
        }),
      }),
    );
    fetchSpy.mockRestore();
  });

  it('sends the requester receipt without requiring the welcome-email URL config', async () => {
    const service = makeService({
      RESEND_API_KEY: 'fake-key',
      RESEND_FROM_ADDRESS: 'noreply@example.com',
    });
    const send = jest.fn().mockResolvedValue({ error: null });
    Object.defineProperty(service, 'resend', {
      configurable: true,
      value: { emails: { send } },
    });

    await expect(
      service.sendPrivateBetaAccessRequesterEmail({
        requestId:
          '550e8400-e29b-41d4-a716-446655440026' as PrivateBetaAccessRequestId,
        name: 'Ada Lovelace',
        submittedEmail: 'ada@example.com',
      }),
    ).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ada@example.com',
        subject: expect.stringContaining('received'),
        html: expect.stringContaining('If admissions are paused'),
        text: expect.stringContaining('If admissions are paused'),
      }),
    );
  });

  it('requires the documented operator recipient instead of inventing one', async () => {
    const service = makeService({
      RESEND_API_KEY: 'fake-key',
      RESEND_FROM_ADDRESS: 'noreply@example.com',
    });

    await expect(
      service.sendPrivateBetaAccessOperatorEmail({
        requestId:
          '550e8400-e29b-41d4-a716-446655440026' as PrivateBetaAccessRequestId,
        name: 'Ada Lovelace',
        submittedEmail: 'ada@example.com',
        organizationName: 'Analytical Engines',
        teamSize: 5,
        productContext: 'A developer tool.',
        accessRationale: 'We want to evaluate it.',
      }),
    ).rejects.toThrow('Private-beta operator email is not configured');
  });

  it('delegates a stable provider idempotency key for request-keyed welcome delivery', async () => {
    const service = makeService({
      RESEND_API_KEY: 'fake-key',
      RESEND_FROM_ADDRESS: 'noreply@example.com',
      WEB_APP_URL: 'https://app.example.com',
    });
    const send = jest.fn().mockResolvedValue({ error: null });
    Object.defineProperty(service, 'resend', {
      configurable: true,
      value: { emails: { send } },
    });

    await service.sendWelcomeEmail({
      ...params,
      providerIdempotencyKey: 'private-beta-welcome:request-1',
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: params.to }),
      { idempotencyKey: 'private-beta-welcome:request-1' },
    );
  });

  it('does not expose recipient addresses or provider errors in logs or thrown errors', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const service = makeService({
      RESEND_API_KEY: 'fake-key',
      RESEND_FROM_ADDRESS: 'noreply@example.com',
      WEB_APP_URL: 'https://app.example.com',
    });
    const providerDetail = 'provider rejected user@example.com: mailbox data';
    const send = jest.fn().mockResolvedValue({
      error: { message: providerDetail },
    });
    Object.defineProperty(service, 'resend', {
      configurable: true,
      value: { emails: { send } },
    });

    await expect(service.sendWelcomeEmail(params)).rejects.toThrow(
      'Failed to send welcome email',
    );

    const logged = JSON.stringify([
      ...logSpy.mock.calls,
      ...debugSpy.mock.calls,
      ...errorSpy.mock.calls,
    ]);
    expect(logged).not.toContain(params.to);
    expect(logged).not.toContain(providerDetail);
    expect(logged).toContain('provider_rejected');

    logSpy.mockRestore();
    debugSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('sanitizes thrown provider transport failures', async () => {
    const service = makeService({
      RESEND_API_KEY: 'fake-key',
      RESEND_FROM_ADDRESS: 'noreply@example.com',
    });
    const send = jest
      .fn()
      .mockRejectedValue(new Error('secret provider transport detail'));
    Object.defineProperty(service, 'resend', {
      configurable: true,
      value: { emails: { send } },
    });

    await expect(
      service.sendPrivateBetaAccessRequesterEmail({
        requestId:
          '550e8400-e29b-41d4-a716-446655440026' as PrivateBetaAccessRequestId,
        name: 'Ada Lovelace',
        submittedEmail: 'ada@example.com',
      }),
    ).rejects.toThrow('Failed to send private-beta requester email');
  });
});
