import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WebsocketsModule } from '../../core/websockets/websockets.module';
import { MachineSecurityEventService } from './machine-security-event.service';
import { MachineSecurityEventConsumer } from './machine-security-event.consumer';

@Module({
  // WebsocketsModule supplies the gateway used to push new events to the
  // owner's `user:` room. EventRouter is provided by the @Global()
  // EventRouterModule, so the revocation consumer needs no explicit import.
  imports: [PrismaModule, WebsocketsModule],
  providers: [MachineSecurityEventService, MachineSecurityEventConsumer],
  exports: [MachineSecurityEventService],
})
export class MachineSecurityEventModule {}
