import { Module } from '@nestjs/common';
import { ServerSigningModule } from '../../core/server-signing/server-signing.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { DemoSandboxActivityModule } from '../demo-sandbox/demo-sandbox-activity.module';
import { WebsocketsModule } from '../../core/websockets/websockets.module';
import { MachinePairingService } from './machine-pairing.service';
import { MachineExecutionReadinessService } from './machine-execution-readiness.service';
import { CurrentControllerMachineEligibilityService } from './current-controller-machine-eligibility.service';

@Module({
  // WebsocketsModule supplies machine connection eviction so revokeMachine can
  // force-close a revoked machine's live sockets on every replica. DomainEventPublisher is
  // injected from the @Global() DomainEventModule, so it needs no import here.
  imports: [
    PrismaModule,
    ServerSigningModule,
    WebsocketsModule,
    DemoSandboxActivityModule,
  ],
  providers: [
    MachinePairingService,
    MachineExecutionReadinessService,
    CurrentControllerMachineEligibilityService,
  ],
  exports: [
    MachinePairingService,
    MachineExecutionReadinessService,
    CurrentControllerMachineEligibilityService,
    ServerSigningModule,
  ],
})
export class MachinePairingModule {}
