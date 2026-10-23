import type { MessagePoster } from '../run/message-poster';
import type { ServerLogger } from './logger';
import type { MonitorProjectContext } from './monitors/project-context';
import type { MachineRevokedContext } from './platform-ws';
import { postDropNoticeMessage } from './trigger-verification/drop-notice-message';

/** Owns user-visible conversation notices when the platform revokes this machine. */
export class MachineRevocationSurface {
  public constructor(
    private readonly poster: MessagePoster,
    private readonly projectContext: MonitorProjectContext,
    private readonly logger: ServerLogger,
  ) {}

  public readonly handle = (context: MachineRevokedContext): void => {
    const projectId = this.projectContext.currentProjectId;
    if (!context.organizationId || !projectId || context.conversationIds.length === 0) {
      this.logger.warn('platform-ws.machine_revoked.surface_skipped', {
        hasOrganizationId: Boolean(context.organizationId),
        hasProjectId: Boolean(projectId),
        conversationCount: context.conversationIds.length,
      });
      return;
    }

    for (const conversationId of context.conversationIds) {
      void postDropNoticeMessage({
        poster: this.poster,
        organizationId: context.organizationId,
        projectId,
        conversationId,
        reason: 'machine_revoked',
      }).catch((error) => {
        this.logger.error('platform-ws.machine_revoked.surface_failed', {
          conversationId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  };
}
