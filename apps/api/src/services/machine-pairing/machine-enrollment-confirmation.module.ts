import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MachineEnrollmentConfirmationController } from '../../controllers/machine-enrollment-confirmation.controller';
import { ServerSigningModule } from '../../core/server-signing/server-signing.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { MachineEnrollmentConfirmationService } from './machine-enrollment-confirmation.service';
import { ControllerAuthorizationModule } from '../controller-authorization/controller-authorization.module';
import { WebsocketsModule } from '../../core/websockets/websockets.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ServerSigningModule,
    ControllerAuthorizationModule,
    WebsocketsModule,
  ],
  controllers: [MachineEnrollmentConfirmationController],
  providers: [MachineEnrollmentConfirmationService],
})
export class MachineEnrollmentConfirmationModule {}
