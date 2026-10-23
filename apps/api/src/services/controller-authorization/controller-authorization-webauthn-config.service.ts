import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveMachineEnrollmentWebAuthnConfiguration } from '../machine-pairing/machine-enrollment-claim.service';

@Injectable()
export class ControllerAuthorizationWebAuthnConfigService {
  readonly rpId: string;
  readonly origin: string;

  constructor(configService: ConfigService) {
    const resolved =
      resolveMachineEnrollmentWebAuthnConfiguration(configService);
    this.rpId = resolved.rpId;
    this.origin = resolved.origin;
  }
}
