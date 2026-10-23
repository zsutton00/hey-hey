import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MachineEnrollmentClaimController } from '../../controllers/machine-enrollment-claim.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import {
  MACHINE_ENROLLMENT_WEBAUTHN_VERIFIER,
  MachineEnrollmentClaimService,
} from './machine-enrollment-claim.service';
import { SimpleWebAuthnRegistrationVerifier } from './machine-enrollment-webauthn-verifier';
import { ControllerAuthorizationModule } from '../controller-authorization/controller-authorization.module';

@Module({
  imports: [ConfigModule, PrismaModule, ControllerAuthorizationModule],
  controllers: [MachineEnrollmentClaimController],
  providers: [
    MachineEnrollmentClaimService,
    {
      provide: MACHINE_ENROLLMENT_WEBAUTHN_VERIFIER,
      useClass: SimpleWebAuthnRegistrationVerifier,
    },
  ],
})
export class MachineEnrollmentClaimModule {}
