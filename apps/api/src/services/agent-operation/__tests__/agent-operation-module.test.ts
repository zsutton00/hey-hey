import { Global, Module, UnauthorizedException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { Test } from '@nestjs/testing';
import { MachineCredentialGuard } from '../../../auth/guards/machine-credential.guard';
import { WebsocketsModule } from '../../../core/websockets/websockets.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ControllerAuthorizationModule } from '../../controller-authorization/controller-authorization.module';
import { MachinePairingModule } from '../../machine-pairing/machine-pairing.module';
import { MachinePairingService } from '../../machine-pairing/machine-pairing.service';
import { AgentOperationModule } from '../agent-operation.module';
import { ProjectAccessService } from '../../../auth/services/project-access.service';
import { ProjectResourceAccessService } from '../../../auth/services/project-resource-access.service';

@Global()
@Module({
  providers: [
    { provide: ProjectAccessService, useValue: {} },
    { provide: ProjectResourceAccessService, useValue: {} },
  ],
  exports: [ProjectAccessService, ProjectResourceAccessService],
})
class ExternalInfrastructureStub {}

describe('AgentOperationModule controller guard wiring', () => {
  it('resolves the machine guard through its imported pairing module', async () => {
    const pairing = {
      authenticateMachineCredential: jest.fn().mockResolvedValue(null),
    };
    @Module({
      providers: [{ provide: MachinePairingService, useValue: pairing }],
      exports: [MachinePairingService],
    })
    class PairingStub {}

    const builder = Test.createTestingModule({
      imports: [AgentOperationModule],
    })
      .overrideModule(PrismaModule)
      .useModule(ExternalInfrastructureStub)
      .overrideModule(WebsocketsModule)
      .useModule(ExternalInfrastructureStub)
      .overrideModule(ControllerAuthorizationModule)
      .useModule(ExternalInfrastructureStub)
      .overrideModule(MachinePairingModule)
      .useModule(PairingStub);
    // Keep real controllers and guards; isolate their backing operations.
    for (const provider of Reflect.getMetadata(
      'providers',
      AgentOperationModule,
    )) {
      builder.overrideProvider(provider).useValue({});
    }
    const module = await builder.compile();
    try {
      const guard = module.get(MachineCredentialGuard);
      await expect(
        guard.canActivate(
          new ExecutionContextHost([
            { headers: { authorization: 'Bearer test-credential' } },
          ]),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(pairing.authenticateMachineCredential).toHaveBeenCalledWith(
        'test-credential',
      );
    } finally {
      await module.close();
    }
  });
});
