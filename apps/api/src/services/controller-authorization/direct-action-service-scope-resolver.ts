import { BadRequestException, ConflictException } from '@nestjs/common';
import type { UserMessageAdmittedServiceScope } from '../../generated';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MachinePresenceService } from '../../core/websockets/machine-presence.service';
import type {
  OrganizationId,
  ProjectId,
  UserId,
  MachineId,
  AgentSessionId,
  ConversationId,
} from '../../types';
import { extractMentions } from '../../utils/mentionFormatting';

export interface PreparedServiceAdmission {
  baselineServiceIds: string[];
  baselineLaunchServiceId: string | null;
  scope: UserMessageAdmittedServiceScope;
}

/** Resolves the complete scope before approval and again before persistence.
 * A later scope change cannot silently widen an already approved command. */
export class DirectActionServiceScopeResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly machinePresenceService: MachinePresenceService,
  ) {}

  async prepare(input: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    agentSessionId: AgentSessionId;
    conversationId?: ConversationId;
    machineId: MachineId;
    userText: string | undefined;
  }): Promise<PreparedServiceAdmission | undefined> {
    if (!input.userText) return undefined;
    const mentionedServiceIds = Array.from(
      new Set(
        extractMentions(input.userText)
          .filter((mention) => mention.entityType === 'service')
          .map((mention) => mention.entityId),
      ),
    );
    if (mentionedServiceIds.length === 0) return undefined;
    const session = await this.prisma.db.agentSession.findFirst({
      where: {
        id: input.agentSessionId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: input.userId,
        conversationId: input.conversationId,
      },
      include: {
        serviceRelations: {
          select: { serviceId: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!session) {
      throw new ConflictException(
        'The Agent Session is unavailable for Service admission',
      );
    }
    const baselineServiceIds = session.serviceRelations.map(
      ({ serviceId }) => serviceId,
    );
    if (session.serviceId && !baselineServiceIds.includes(session.serviceId)) {
      throw new ConflictException(
        'The launch Service has no selected-Service link',
      );
    }
    const serviceIds = Array.from(
      new Set([...baselineServiceIds, ...mentionedServiceIds]),
    );
    const launchServiceId = session.serviceId ?? serviceIds[0];
    if (!launchServiceId) {
      throw new ConflictException(
        'The admitted Service scope has no launch anchor',
      );
    }
    const services = await this.prisma.db.service.findMany({
      where: { id: { in: serviceIds }, organizationId: input.organizationId },
      select: { id: true, projectId: true },
    });
    if (
      services.length !== serviceIds.length ||
      services.some((service) => service.projectId !== input.projectId)
    ) {
      throw new BadRequestException(
        'Every admitted Service must belong to the project',
      );
    }
    const bindings = await this.machinePresenceService.getBindings(
      input.machineId as MachineId,
    );
    const boundServiceIds = new Set(
      bindings?.bindings.map(({ serviceId }) => serviceId),
    );
    if (
      !bindings ||
      bindings.organizationId !== input.organizationId ||
      serviceIds.some((serviceId) => !boundServiceIds.has(serviceId))
    ) {
      throw new BadRequestException(
        'Every admitted Service requires a live binding on the selected machine',
      );
    }
    return {
      baselineServiceIds,
      baselineLaunchServiceId: session.serviceId,
      scope: {
        serviceIds,
        launchServiceId,
      } satisfies UserMessageAdmittedServiceScope,
    };
  }
}
