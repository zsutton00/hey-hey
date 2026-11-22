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
  CliReadWorkspaceServicePlacesListRequest,
} from '@hey-hey/contracts/api/models';
import { MachineId, OrganizationId, ProjectId, UserId } from '../types';
import { ExecutionGrantService } from './controller-authorization/execution-grant.service';
import { CliReadEmitter } from '../core/websockets/cli-read-emitter.service';
import { canonicalizeJcs } from '../core/websockets/trigger-canonicalization';

/** Reads, on the selected machine, where each Service can work. Changes nothing. */
@Injectable()
export class ServicePlacesReadService {
  private readonly logger = new Logger(ServicePlacesReadService.name);
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
    request: CliReadWorkspaceServicePlacesListRequest;
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
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const machine = await this.prisma.db.machine.findFirst({
      where: {
        id: params.machineId,
        organizationId: params.organizationId,
        userId: params.userId,
        revokedAt: null,
      },
      select: { id: true },
    });
    if (!machine) {
      throw new ForbiddenException('The selected machine is unavailable');
    }

    const { serviceIds, branchQuery, authorization } = params.request;

    // Checked before authorization is consumed or anything reaches the
    // machine: the CLI resolves IDs against a machine-wide mapping, so a
    // Service from another project would otherwise expose its local folders.
    await this.assertServicesBelongToProject(params, serviceIds);

    const admission = await this.grants.assertServicePlacesReadAuthorized({
      ...params,
      authorization,
      serviceIds,
      branchQuery,
    });

    this.logger.debug('Reading Service places', {
      machineId: params.machineId,
      projectId: params.projectId,
      serviceCount: serviceIds.length,
    });

    return this.emitter.readServicePlaces({
      ...params,
      serviceIds,
      branchQuery,
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

  private async assertServicesBelongToProject(
    params: { organizationId: OrganizationId; projectId: ProjectId },
    serviceIds: string[],
  ): Promise<void> {
    const found = await this.prisma.db.service.findMany({
      where: {
        id: { in: serviceIds },
        organizationId: params.organizationId,
        projectId: params.projectId,
      },
      select: { id: true },
    });
    const foundIds = new Set(found.map((service) => service.id));
    const outsideProject = serviceIds.filter((id) => !foundIds.has(id));
    if (outsideProject.length === 0) {
      return;
    }

    this.logger.warn('Service places read rejected: Services not in project', {
      projectId: params.projectId,
      organizationId: params.organizationId,
      serviceIds: outsideProject,
    });
    throw new NotFoundException('Service not found in this project');
  }
}
