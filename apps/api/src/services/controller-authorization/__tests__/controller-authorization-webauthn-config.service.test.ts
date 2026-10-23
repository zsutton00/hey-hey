import { ConfigService } from '@nestjs/config';
import { ControllerAuthorizationWebAuthnConfigService } from '../controller-authorization-webauthn-config.service';

describe('ControllerAuthorizationWebAuthnConfigService', () => {
  const configService = (
    values: Record<string, string | undefined>,
  ): ConfigService =>
    ({
      get: jest.fn((key: string) => values[key]),
    }) as unknown as ConfigService;

  it('uses the enrollment production RP ID and exact origin', () => {
    const config = new ControllerAuthorizationWebAuthnConfigService(
      configService({ NODE_ENV: 'production' }),
    );
    expect(config).toMatchObject({
      rpId: 'heyhey.dev',
      origin: 'https://heyhey.dev',
    });
  });

  it('uses the staging origin for authorization in production runtime mode', () => {
    const config = new ControllerAuthorizationWebAuthnConfigService(
      configService({
        NODE_ENV: 'production',
        MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'staging.heyhey.dev',
        MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://staging.heyhey.dev',
      }),
    );
    expect(config).toMatchObject({
      rpId: 'staging.heyhey.dev',
      origin: 'https://staging.heyhey.dev',
    });
  });

  it.each([
    { MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'staging.heyhey.dev' },
    { MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://staging.heyhey.dev' },
    {
      MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: '',
      MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: '',
    },
  ])('rejects incomplete explicit production configuration: %j', (values) => {
    expect(
      () =>
        new ControllerAuthorizationWebAuthnConfigService(
          configService({ NODE_ENV: 'production', ...values }),
        ),
    ).toThrow('must be explicitly configured');
  });

  it('requires explicit valid non-production configuration', () => {
    expect(
      () =>
        new ControllerAuthorizationWebAuthnConfigService(
          configService({ NODE_ENV: 'test' }),
        ),
    ).toThrow('MACHINE_ENROLLMENT_WEBAUTHN_RP_ID');
    expect(
      () =>
        new ControllerAuthorizationWebAuthnConfigService(
          configService({
            NODE_ENV: 'test',
            MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'other.example',
            MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://test.heyhey.dev',
          }),
        ),
    ).toThrow('Machine enrollment WebAuthn configuration is invalid');
  });
});
