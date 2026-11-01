import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { FeatureSyncFlowContext } from 'src/types/flow-internal.types';

/**
 * Admits the runtime selected at Coding Plan approval. The selection travels
 * on the Implement trigger and the session's existing Run applies it, so a
 * provider switch never creates a replacement Run or rewrites the Agent
 * Session's provider binding.
 */
@Injectable()
export class ImplementRuntimeService {
  private readonly logger = new Logger(ImplementRuntimeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async prepare(context: FeatureSyncFlowContext): Promise<void> {
    const runtime = context.implementRuntime;
    if (!runtime) {
      this.logger.debug('Approval preserves the current runtime', {
        conversationId: context.core.conversationId,
      });
      return;
    }
    const operationId = context.implementApprovalOperationId;
    if (!operationId)
      throw new Error('Approval runtime requires its authorized operation.');
    const parent = await this.prisma.db.agentOperation.findUnique({
      where: { operationId },
    });
    if (
      !parent ||
      parent.kind !== 'WORKFLOW_ANSWER' ||
      parent.conversationId !== context.core.conversationId ||
      parent.organizationId !== context.core.organizationId ||
      parent.projectId !== context.core.projectId
    ) {
      throw new Error(
        'Approval runtime operation does not match the conversation.',
      );
    }
    if (['FAILED', 'DENIED', 'CANCELLED'].includes(parent.state)) {
      throw new Error(
        parent.failureMessage ?? 'Approval runtime could not be established.',
      );
    }
    this.logger.debug('Approval runtime delivered to the existing Run', {
      operationId,
      agentSessionId: parent.agentSessionId,
      provider: runtime.provider,
      model: runtime.model,
      reasoningEffort: runtime.reasoningEffort ?? null,
      fastMode: runtime.fastMode ?? null,
    });
  }
}
