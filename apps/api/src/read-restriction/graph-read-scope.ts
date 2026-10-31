import { Injectable } from '@nestjs/common';
import type {
  EntityNeighborhoodResponse,
  IncidentEdgesResponse,
  SearchRequest,
  StructuredGraphReadResponse,
} from '../generated/graphs';
import { ReadPolicyContext } from './read-policy';
import { ReadVisibilityService } from './read-visibility.service';

/**
 * Applies the request's read policy to everything the Graph service returns. Searches carry the
 * exclusions into the query itself; the identity-shaped reads (edges, neighborhoods, structured
 * reads) have no page to fill, so protected endpoints are removed from their results.
 */
@Injectable()
export class GraphReadScope {
  constructor(private readonly visibility: ReadVisibilityService) {}

  /** Adds the policy's exclusions to a search so Graph removes protected content before paging. */
  scopeSearch(request: SearchRequest): SearchRequest {
    const { excludedTaskTypes, excludedReportTypes } =
      ReadPolicyContext.current();

    if (excludedTaskTypes.length === 0 && excludedReportTypes.length === 0) {
      return request;
    }

    return {
      ...request,
      filters: {
        ...request.filters,
        excludeTaskTypes: [
          ...new Set([
            ...(request.filters?.excludeTaskTypes ?? []),
            ...excludedTaskTypes,
          ]),
        ],
        excludeReportTypes: [
          ...new Set([
            ...(request.filters?.excludeReportTypes ?? []),
            ...excludedReportTypes,
          ]),
        ],
      },
    };
  }

  async scopeIncidentEdges(
    response: IncidentEdgesResponse,
  ): Promise<IncidentEdgesResponse> {
    const hidden = await this.visibility.hiddenIds([
      ...response.groups.map((group) => ({
        entityType: 'TASK',
        entityId: group.seedEntityId,
      })),
      ...response.groups.flatMap((group) =>
        group.endpoints.map((endpoint) => ({
          entityType: endpoint.entityType,
          entityId: endpoint.entityId,
        })),
      ),
      ...response.groups.map((group) => ({
        entityType: 'REPORT',
        entityId: group.seedEntityId,
      })),
    ]);

    if (hidden.size === 0) {
      return response;
    }

    return {
      groups: response.groups.map((group) =>
        hidden.has(group.seedEntityId)
          ? { ...group, neighborTotal: 0, relationships: [], endpoints: [] }
          : {
              ...group,
              endpoints: group.endpoints.filter(
                (endpoint) => !hidden.has(endpoint.entityId),
              ),
              relationships: group.relationships.filter(
                (relationship) =>
                  !hidden.has(relationship.sourceNodeId) &&
                  !hidden.has(relationship.targetNodeId),
              ),
            },
      ),
    };
  }

  async scopeNeighborhood(
    response: EntityNeighborhoodResponse,
  ): Promise<EntityNeighborhoodResponse> {
    const hidden = await this.visibility.hiddenIds(
      [...response.relatedEntities, ...(response.nodeCatalog ?? [])].map(
        (entity) => ({
          entityType: entity.entityType,
          entityId: entity.entityId,
        }),
      ),
    );

    if (hidden.size === 0) {
      return response;
    }

    return {
      ...response,
      relatedEntities: response.relatedEntities.filter(
        (entity) =>
          !hidden.has(entity.entityId) &&
          !entity.via?.some((hop) => hidden.has(hop.entityId)),
      ),
      ...(response.nodeCatalog
        ? {
            nodeCatalog: response.nodeCatalog.filter(
              (node) => !hidden.has(node.entityId),
            ),
          }
        : {}),
    };
  }

  async scopeStructuredRead(
    response: StructuredGraphReadResponse,
  ): Promise<StructuredGraphReadResponse> {
    const identities = [
      ...response.expansions.flatMap((expansion) =>
        expansion.targets.flatMap((target) => [
          target.identity,
          ...target.paths.flatMap((path) => path.identities),
        ]),
      ),
    ];
    const hidden = await this.visibility.hiddenIds(
      identities.map((identity) => ({
        entityType: identity.entityType,
        entityId: identity.entityId,
      })),
    );
    const hiddenEdgeEndpoints = await this.visibility.hiddenIds(
      response.directEdges.flatMap((edge) => [
        {
          entityType: edge.sourceEntityType ?? 'TASK',
          entityId: edge.sourceNodeId,
        },
        {
          entityType: edge.targetEntityType ?? 'TASK',
          entityId: edge.targetNodeId,
        },
      ]),
    );

    if (hidden.size === 0 && hiddenEdgeEndpoints.size === 0) {
      return response;
    }

    return {
      directEdges: response.directEdges.filter(
        (edge) =>
          !hiddenEdgeEndpoints.has(edge.sourceNodeId) &&
          !hiddenEdgeEndpoints.has(edge.targetNodeId),
      ),
      expansions: response.expansions.map((expansion) => ({
        ...expansion,
        targets: expansion.targets
          .filter((target) => !hidden.has(target.identity.entityId))
          .map((target) => ({
            target,
            paths: target.paths.filter(
              (path) =>
                !path.identities.some((identity) =>
                  hidden.has(identity.entityId),
                ),
            ),
          }))
          .filter(
            ({ target, paths }) =>
              target.paths.length === 0 || paths.length > 0,
          )
          .map(({ target, paths }) => ({ ...target, paths })),
      })),
    };
  }
}
