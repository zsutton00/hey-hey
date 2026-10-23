import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedMachine } from '../../services/machine-pairing/machine-pairing.service';

/**
 * Extracts the machine authenticated by `MachineCredentialGuard` from the
 * request. Only meaningful on routes guarded by `MachineCredentialGuard`,
 * which populates `request.machine`.
 */
export const CurrentMachine = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedMachine => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ machine: AuthenticatedMachine }>();
    return request.machine;
  },
);
