import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WebsocketsModule } from '../../core/websockets/websockets.module';
import { MachinePairingModule } from '../machine-pairing/machine-pairing.module';
import { ControllerManagementController } from '../../controllers/controller-management.controller';
import { ControllerManagementService } from './controller-management.service';

@Module({
  imports: [PrismaModule, WebsocketsModule, MachinePairingModule],
  controllers: [ControllerManagementController],
  providers: [ControllerManagementService],
  exports: [ControllerManagementService],
})
export class ControllerManagementModule {}
