import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { HintsConfig } from '../../config/hints.config';
import {
  ENTITY_RESOURCES,
  ProjectResourceAccessService,
} from '../../auth/services/project-resource-access.service';
import {
  Hint,
  HintConnection,
  HintConnectionEndpointEntityType,
  HintConnectionInput,
  HintOrigin,
} from '../../generated/graphs';
import { GraphsClientService } from '../graphs-client.service';
import type { OrganizationId, ProjectId } from '../../types';

export const MAX_HINT_CONNECTIONS = 20;
export const MAX_HINT_READ_ITEMS = 100;

export interface HintRequestor {
  userId: string;
  organizationId: OrganizationId;
  projectId: ProjectId;
  token: string;
}

export interface HintItemRef {
  id: string;
  entityType: HintConnectionEndpointEntityType;
}

export interface HintView {
  id: string;
  text: string;
  origin: HintOrigin;
  connections: Pick<
    HintConnection,
    'id' | 'targetNodeId' | 'targetEntityType' | 'strength'
  >[];
  createdAt: string;
  updatedAt: string;
}

export class HintsDisabledError extends Error {
  constructor() {
    super('Hints are turned off for this deployment');
    this.name = 'HintsDisabledError';
  }
}

const toHintView = (hint: Hint): HintView => ({
  id: hint.id,
  text: hint.text,
  origin: hint.origin,
  connections: hint.connections.map(
    ({ id, targetNodeId, targetEntityType, strength }) => ({
      id,
      targetNodeId,
      targetEntityType,
      strength,
    }),
  ),
  createdAt: hint.createdAt,
  updatedAt: hint.updatedAt,
});

const itemKey = (item: HintItemRef) => `${item.entityType}:${item.id}`;

@Injectable()
export class HintService {
  private readonly logger = new Logger(HintService.name);

  constructor(
    private readonly hintsConfig: HintsConfig,
    private readonly graphsClient: GraphsClientService,
    private readonly resourceAccess: ProjectResourceAccessService,
  ) {}

  get enabled(): boolean {
    return this.hintsConfig.enabled;
  }

  async createHint(
    requestor: HintRequestor,
    input: {
      text: string;
      origin: HintOrigin;
      connections: HintConnectionInput[];
    },
  ): Promise<HintView> {
    this.assertEnabled();
    if (
      input.connections.length < 1 ||
      input.connections.length > MAX_HINT_CONNECTIONS
    ) {
      throw new Error(
        `A hint needs between 1 and ${MAX_HINT_CONNECTIONS} connections`,
      );
    }
    this.logger.log('Creating hint', {
      organizationId: requestor.organizationId,
      projectId: requestor.projectId,
      connectionCount: input.connections.length,
      originType: input.origin.entityType,
    });
    await this.assertProjectAccess(requestor);
    await this.assertVisible(requestor, [
      { id: input.origin.entityId, entityType: input.origin.entityType },
      ...input.connections.map((c) => ({
        id: c.targetNodeId,
        entityType: c.targetEntityType,
      })),
    ]);
    const hint = await this.graphsClient.createHint(
      requestor.organizationId,
      requestor.projectId,
      input,
      requestor.token,
    );
    this.logger.log('Created hint', {
      projectId: requestor.projectId,
      hintId: hint.id,
    });
    return toHintView(hint);
  }

  async addConnection(
    requestor: HintRequestor,
    hintId: string,
    connection: HintConnectionInput,
  ): Promise<HintView> {
    this.assertEnabled();
    this.logger.log('Adding hint connection', {
      projectId: requestor.projectId,
      hintId,
      targetEntityType: connection.targetEntityType,
    });
    await this.assertProjectAccess(requestor);
    const existing = await this.graphsClient.getHint(
      requestor.organizationId,
      requestor.projectId,
      hintId,
      requestor.token,
    );
    // Connecting to a hint the caller could not read would reveal it.
    await this.assertVisible(requestor, [
      { id: connection.targetNodeId, entityType: connection.targetEntityType },
      ...existing.connections.map((c) => ({
        id: c.targetNodeId,
        entityType: c.targetEntityType,
      })),
    ]);
    const hint = await this.graphsClient.addHintConnection(
      requestor.organizationId,
      requestor.projectId,
      hintId,
      connection,
      requestor.token,
    );
    this.logger.log('Added hint connection', {
      projectId: requestor.projectId,
      hintId,
      connectionCount: hint.connections.length,
    });
    return toHintView(hint);
  }

  async findHintsForItems(
    requestor: HintRequestor,
    itemIds: string[],
  ): Promise<HintView[]> {
    if (!this.enabled) {
      this.logger.log('Hints disabled; returning no hints', {
        projectId: requestor.projectId,
      });
      return [];
    }
    const nodeIds = Array.from(new Set(itemIds));
    if (nodeIds.length === 0) return [];
    if (nodeIds.length > MAX_HINT_READ_ITEMS) {
      throw new Error(
        `Hints can be read for at most ${MAX_HINT_READ_ITEMS} items at once`,
      );
    }
    this.logger.log('Reading hints for items', {
      projectId: requestor.projectId,
      itemCount: nodeIds.length,
    });
    await this.assertProjectAccess(requestor);
    const { hints } = await this.graphsClient.findHintsByConnectedItems(
      requestor.organizationId,
      requestor.projectId,
      // The generator types uniqueItems as Set, which JSON-serializes to {}.
      { nodeIds: nodeIds as unknown as Set<string> },
      requestor.token,
    );
    const targets = new Map<string, HintItemRef>();
    for (const connection of hints.flatMap((h) => h.connections)) {
      const ref = {
        id: connection.targetNodeId,
        entityType: connection.targetEntityType,
      };
      targets.set(itemKey(ref), ref);
    }
    const visible = await this.visibleItemKeys(requestor, [
      ...targets.values(),
    ]);
    // A hint is only as visible as its least visible connected item.
    const kept = hints.filter((h) =>
      h.connections.every((c) =>
        visible.has(
          itemKey({ id: c.targetNodeId, entityType: c.targetEntityType }),
        ),
      ),
    );
    this.logger.log('Filtered hints by visibility', {
      projectId: requestor.projectId,
      returned: kept.length,
      dropped: hints.length - kept.length,
    });
    return kept.map(toHintView);
  }

  private assertEnabled(): void {
    if (!this.enabled) throw new HintsDisabledError();
  }

  private assertProjectAccess(requestor: HintRequestor): Promise<void> {
    return this.resourceAccess.assertResource(
      requestor.userId,
      requestor.organizationId,
      'project',
      requestor.projectId,
    );
  }

  private async assertVisible(
    requestor: HintRequestor,
    items: HintItemRef[],
  ): Promise<void> {
    const visible = await this.visibleItemKeys(requestor, items);
    const hidden = items.filter((item) => !visible.has(itemKey(item)));
    if (hidden.length > 0) {
      this.logger.warn('Hint write refused: items not visible', {
        projectId: requestor.projectId,
        hiddenCount: hidden.length,
      });
      throw new ForbiddenException(
        `Items are not accessible in this project: ${hidden
          .map((item) => item.id)
          .join(', ')}`,
      );
    }
  }

  private async visibleItemKeys(
    requestor: HintRequestor,
    items: HintItemRef[],
  ): Promise<Set<string>> {
    const visible = new Set<string>();
    for (const item of items) {
      // Hints share the project scope; each hint's own items gate its reads.
      if (item.entityType === HintConnectionEndpointEntityType.Hint) {
        visible.add(itemKey(item));
        continue;
      }
      const resource = ENTITY_RESOURCES[item.entityType];
      if (!resource) continue;
      try {
        await this.resourceAccess.assertResource(
          requestor.userId,
          requestor.organizationId,
          resource,
          item.id,
          requestor.projectId,
        );
        visible.add(itemKey(item));
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    return visible;
  }
}
