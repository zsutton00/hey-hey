import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventRouter } from '../../core/events/event-router';
import { EventEnvelope } from '../../core/events/types/event-envelope';
import { isMachineRevokedEvent } from '../../core/events/types/domain-events';
import { EVENT_TYPES } from '../../core/events/types/event.types';
import { MachineSecurityEventType } from '../../generated';
import { MachineId, UserId } from '../../types';
import { MachineSecurityEventService } from './machine-security-event.service';

/**
 * Server-internal producer for the `revocation` security-event category. When a
 * machine's credential is revoked, MachinePairingService publishes
 * EVENT_TYPES.MACHINE.REVOKED; this consumer persists the matching feed row (and
 * the service pushes it to the owner in realtime). The CLI never reports
 * revocation — it is the one category recorded entirely server-side.
 */
@Injectable()
export class MachineSecurityEventConsumer implements OnModuleInit {
  private readonly logger = new Logger(MachineSecurityEventConsumer.name);

  constructor(
    private readonly eventRouter: EventRouter,
    private readonly service: MachineSecurityEventService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log(
      'Registering machine.revoked handler for the security event feed',
    );
    await this.eventRouter.on(EVENT_TYPES.MACHINE.REVOKED, (envelope) => {
      void this.handleMachineRevoked(envelope);
    });
  }

  private async handleMachineRevoked(envelope: EventEnvelope): Promise<void> {
    const event = envelope.event;
    if (!isMachineRevokedEvent(event)) {
      return;
    }

    const { machineId, userId, revokedAt } = event.payload;

    try {
      // Use the domain event id as the row id so re-processing the same
      // revocation event is idempotent on the PK.
      await this.service.recordEvents({
        machineId: machineId as MachineId,
        userId: userId as UserId,
        events: [
          {
            id: event.id,
            eventType: MachineSecurityEventType.Revocation,
            occurredAt: revokedAt,
            detail: 'Machine credential revoked',
          },
        ],
      });
      this.logger.log(
        `Recorded revocation security event for machine ${machineId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to record revocation security event for machine ${machineId}`,
        error,
      );
    }
  }
}
