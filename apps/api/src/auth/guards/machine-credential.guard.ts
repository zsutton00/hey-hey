import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuthenticatedMachine,
  MachinePairingService,
} from '../../services/machine-pairing/machine-pairing.service';

/**
 * Authorizes a request from a paired machine acting on its own behalf (e.g.
 * key rotation) using the durable machine credential — NOT the user JWT the
 * other /machines routes use. Reads the bearer credential, resolves it to a
 * non-revoked machine via MachinePairingService, and stashes the resolved
 * machine on `request.machine` for `@CurrentMachine()`. An unknown or revoked
 * credential is a 401, the same shape as a missing one, so callers can't probe
 * which case occurred.
 *
 * Apply alongside `@Public()` so the class-level JwtAuthGuard skips the route
 * and this guard is the sole authenticator.
 */
@Injectable()
export class MachineCredentialGuard implements CanActivate {
  private readonly logger = new Logger(MachineCredentialGuard.name);

  constructor(private readonly machinePairingService: MachinePairingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers?: { authorization?: string };
      machine?: AuthenticatedMachine;
    }>();

    const authHeader = request.headers?.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      this.logger.warn(
        'Machine credential rejected: missing bearer credential',
      );
      throw new UnauthorizedException('Missing machine credential');
    }

    const credential = authHeader.substring(7);
    const machine =
      await this.machinePairingService.authenticateMachineCredential(
        credential,
      );

    if (!machine) {
      throw new UnauthorizedException('Invalid or revoked machine credential');
    }

    request.machine = machine;
    return true;
  }
}
