import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  CliReadResponseDto,
  CliReadRuntimeModelCatalogGetRequest,
} from '../generated';
import { MachineId, OrganizationId, ProjectId, UserId } from '../types';
import { ExecutionGrantService } from './controller-authorization/execution-grant.service';
import { CliReadEmitter } from '../core/websockets/cli-read-emitter.service';
import { canonicalizeJcs } from '../core/websockets/trigger-canonicalization';

@Injectable()
export class RuntimeModelCatalogReadService {
  private readonly logger = new Logger(RuntimeModelCatalogReadService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly grants: ExecutionGrantService,
    private readonly emitter: CliReadEmitter,
  ) {}

  async read(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    machineId: MachineId;
    request: CliReadRuntimeModelCatalogGetRequest;
    controllerBindingSecret: string | undefined;
  }): Promise<CliReadResponseDto> {
    const project = await this.prisma.db.project.findFirst({
      where: {
        id: params.projectId,
        organizationId: params.organizationId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    const machine = await this.prisma.db.machine.findFirst({
      where: {
        id: params.machineId,
        organizationId: params.organizationId,
        userId: params.userId,
        revokedAt: null,
      },
      select: { id: true },
    });
    if (!machine)
      throw new ForbiddenException('The selected machine is unavailable');
    const admission = await this.grants.assertRuntimeModelCatalogAuthorized({
      ...params,
      authorization: params.request.authorization,
    });
    this.logger.debug('Reading runtime model catalog', {
      machineId: params.machineId,
      projectId: params.projectId,
    });
    return this.emitter.readRuntimeModelCatalog({
      ...params,
      authorizationRequestId: admission.action.requestId,
      admission: {
        authorizationId: admission.authorizationId,
        envelopeAuthorization: admission.envelopeAuthorization,
        actionPayloadHash: createHash('sha256')
          .update(canonicalizeJcs(admission.action))
          .digest('hex'),
      },
    });
  }
}
