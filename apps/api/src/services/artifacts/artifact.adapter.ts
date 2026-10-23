import { Injectable } from '@nestjs/common';
import { Artifact, Project } from '@prisma/client';
import {
  ArtifactData,
  ArtifactResponseDto,
  ArtifactSourceType,
  ArtifactType,
  SearchResultDto,
} from 'src/generated';
import { ProjectId } from 'src/types';

@Injectable()
export class ArtifactAdapter {
  /**
   * Convert database model to response DTO
   */
  toResponseDto(
    artifact: Artifact & {
      project?: Project;
      parent?: Artifact;
      children?: Artifact[];
      relatedTo?: Artifact[];
      relatedFrom?: Artifact[];
    },
  ): ArtifactResponseDto {
    return {
      id: artifact.id,
      projectId: artifact.projectId as ProjectId,
      type: artifact.type as ArtifactType,
      title: artifact.title || undefined,
      data: artifact.data as unknown as ArtifactData,
      embeddingModel: artifact.embeddingModel || undefined,
      hasEmbedding: artifact.hasEmbedding,
      parentId: artifact.parentId || undefined,
      rootId: artifact.rootId || undefined,
      sourceType: artifact.sourceType as ArtifactSourceType,
      sourceId: artifact.sourceId,
      contentHash: artifact.contentHash || undefined,
      language: artifact.language || undefined,
      tags: artifact.tags,
      category: artifact.category || undefined,
      priority: artifact.priority || undefined,
      status: artifact.status,
      isPublic: artifact.isPublic,
      createdAt: artifact.createdAt.toISOString(),
      updatedAt: artifact.updatedAt.toISOString(),
      archivedAt: artifact.archivedAt?.toISOString() || undefined,
    };
  }

  /**
   * Convert multiple database models to response DTOs
   */
  toResponseDtos(artifacts: Artifact[]): ArtifactResponseDto[] {
    return artifacts.map((ko) => this.toResponseDto(ko));
  }

  /**
   * Convert artifact object to search result format
   */
  toSearchResult(
    artifact: Artifact,
    similarity: number,
    matchType: 'semantic' | 'keyword' | 'hybrid',
  ): SearchResultDto {
    return {
      id: artifact.id,
      title: artifact.title || undefined,
      data: artifact.data as unknown as ArtifactData,
      type: artifact.type,
      projectId: artifact.projectId as ProjectId,
      tags: artifact.tags,
      category: artifact.category || undefined,
      sourceType: artifact.sourceType as ArtifactSourceType,
      sourceId: artifact.sourceId,
      score: similarity,
      similarity,
      matchType,
      createdAt: artifact.createdAt.toISOString(),
      updatedAt: artifact.updatedAt.toISOString(),
    };
  }

  /**
   * Convert artifact relation to response DTO
   */
  // toRelationshipDto(
  //   relation: ArtifactRelation & {
  //     source?: {
  //       id: ArtifactId;
  //       title?: string | null;
  //       type: ArtifactType;
  //       tags: string[];
  //       content: string;
  //       projectId: ProjectId;
  //       createdAt: Date;
  //       updatedAt: Date;
  //       category?: string | null;
  //       sourceType?: string | null;
  //       metadata: any;
  //     };
  //     target?: {
  //       id: string;
  //       title?: string | null;
  //       type: ArtifactType;
  //       tags: string[];
  //       content: string;
  //       projectId: ProjectId;
  //       createdAt: Date;
  //       updatedAt: Date;
  //       category?: string | null;
  //       sourceType?: string | null;
  //       metadata: any;
  //     };
  //   },
  // ): RelationshipResponseDto {
  //   return {
  //     sourceId: relation.sourceId,
  //     targetId: relation.targetId,
  //     relationType: relation.relationType,
  //     strength: relation.strength ?? undefined,
  //     metadata: relation.metadata as Record<string, any>,
  //     source: relation.source
  //       ? {
  //           id: relation.source.id,
  //           title: relation.source.title || undefined,
  //           content: relation.source.content,
  //           type: relation.source.type,
  //           projectId: relation.source.projectId as ProjectId,
  //           tags: relation.source.tags,
  //           category: relation.source.category || undefined,
  //           sourceType: relation.source.sourceType || undefined,
  //           score: 1.0, // Default score for relationship context
  //           createdAt: relation.source.createdAt,
  //           updatedAt: relation.source.updatedAt,
  //           metadata: relation.source.metadata as Record<string, any>,
  //         }
  //       : {
  //           id: '',
  //           content: '',
  //           type: '',
  //           projectId: '' as ProjectId,
  //           tags: [],
  //           score: 0,
  //           createdAt: new Date(),
  //           metadata: {},
  //         },
  //     target: relation.target
  //       ? {
  //           id: relation.target.id,
  //           title: relation.target.title || undefined,
  //           content: relation.target.content,
  //           type: relation.target.type,
  //           projectId: relation.target.projectId as ProjectId,
  //           tags: relation.target.tags,
  //           category: relation.target.category || undefined,
  //           sourceType: relation.target.sourceType || undefined,
  //           score: 1.0, // Default score for relationship context
  //           createdAt: relation.target.createdAt,
  //           updatedAt: relation.target.updatedAt,
  //           metadata: relation.target.metadata as Record<string, any>,
  //         }
  //       : {
  //           id: '',
  //           content: '',
  //           type: '',
  //           projectId: '' as ProjectId,
  //           tags: [],
  //           score: 0,
  //           createdAt: new Date(),
  //           metadata: {},
  //         },
  //   };
  // }

  /**
   * Convert artifact objects and relationships to graph format
   */
  // toArtifactGraph(
  //   artifacts: Artifact[],
  //   relationships: ArtifactRelation[],
  // ): ArtifactGraphDto {
  //   const nodes = artifacts.map((ko) => ({
  //     id: ko.id,
  //     title: ko.title,
  //     type: ko.type,
  //     tags: ko.tags,
  //     category: ko.category,
  //     createdAt: ko.createdAt,
  //   }));

  //   const edges = relationships.map((rel) => ({
  //     id: rel.id,
  //     source: rel.sourceId,
  //     target: rel.targetId,
  //     type: rel.relationType,
  //     strength: rel.strength,
  //     metadata: rel.metadata as Record<string, any>,
  //   }));

  //   const relationshipDistribution = relationships.reduce(
  //     (acc, rel) => {
  //       acc[rel.relationType] = (acc[rel.relationType] || 0) + 1;
  //       return acc;
  //     },
  //     {} as Record<string, number>,
  //   );

  //   // For now, use center as the first artifact (this might need to be adjusted based on actual usage)
  //   const center: SearchResultDto =
  //     artifacts.length > 0
  //       ? {
  //           id: artifacts[0].id,
  //           title: artifacts[0].title || undefined,
  //           content: artifacts[0].content,
  //           type: artifacts[0].type,
  //           projectId: artifacts[0].projectId as ProjectId,
  //           tags: artifacts[0].tags,
  //           category: artifacts[0].category || undefined,
  //           sourceType: artifacts[0].sourceType || undefined,
  //           score: 1.0,
  //           createdAt: artifacts[0].createdAt,
  //           updatedAt: artifacts[0].updatedAt,
  //           metadata: artifacts[0].metadata as Record<string, any>,
  //         }
  //       : {
  //           id: '',
  //           content: '',
  //           type: '',
  //           projectId: '' as ProjectId,
  //           tags: [],
  //           score: 0,
  //           createdAt: new Date(),
  //           metadata: {},
  //         };

  //   return {
  //     center,
  //     relationships: relationships.map((rel) => this.toRelationshipDto(rel)),
  //     stats: {
  //       totalNodes: nodes.length,
  //       totalEdges: edges.length,
  //       relationshipTypes: relationshipDistribution,
  //     },
  //   };
  // }

  /**
   * Extract hierarchy information from artifact objects
   */
  buildHierarchy(artifacts: (Artifact & { children?: Artifact[] })[]) {
    const hierarchyMap = new Map<string, unknown>();
    const roots: unknown[] = [];

    // First pass: create nodes
    artifacts.forEach((ko) => {
      hierarchyMap.set(ko.id, {
        ...this.toResponseDto(ko),
        children: [],
      });
    });

    // Second pass: build hierarchy
    artifacts.forEach((ko) => {
      const node = hierarchyMap.get(ko.id);
      if (ko.parentId && hierarchyMap.has(ko.parentId)) {
        const parent = hierarchyMap.get(ko.parentId);
        (parent as { children: unknown[] }).children.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  }

  /**
   * Flatten hierarchy for export or analysis
   */
  flattenHierarchy(
    hierarchicalData: { id: string; children?: { id: string }[] }[],
    level: number = 0,
    path: string[] = [],
  ): Array<{ node: object; level: number; path: string[] }> {
    const result: Array<{ node: object; level: number; path: string[] }> = [];

    hierarchicalData.forEach((node) => {
      const currentPath = [...path, node.id];

      result.push({
        node: { ...node, children: undefined }, // Remove children for flattened view
        level,
        path: currentPath,
      });

      if (node.children && node.children.length > 0) {
        result.push(
          ...this.flattenHierarchy(node.children, level + 1, currentPath),
        );
      }
    });

    return result;
  }

  /**
   * Create summary statistics for a collection of artifact objects
   */
  generateSummaryStats(artifacts: Artifact[]) {
    const stats = {
      total: artifacts.length,
      byType: {} as Record<string, number>,
      byStatus: {} as Record<string, number>,
      byCategory: {} as Record<string, number>,
      avgWordCount: 0,
      totalWordCount: 0,
      withEmbeddings: 0,
      withParent: 0,
      publicCount: 0,
      dateRange: {
        earliest: null as Date | null,
        latest: null as Date | null,
      },
    };

    artifacts.forEach((ko) => {
      // Type distribution
      stats.byType[ko.type] = (stats.byType[ko.type] || 0) + 1;

      // Status distribution
      stats.byStatus[ko.status] = (stats.byStatus[ko.status] || 0) + 1;

      // Category distribution
      if (ko.category) {
        stats.byCategory[ko.category] =
          (stats.byCategory[ko.category] || 0) + 1;
      }

      // Other counts
      if (ko.hasEmbedding) stats.withEmbeddings++;
      if (ko.parentId) stats.withParent++;
      if (ko.isPublic) stats.publicCount++;

      // Date range
      if (
        !stats.dateRange.earliest ||
        ko.createdAt < stats.dateRange.earliest
      ) {
        stats.dateRange.earliest = ko.createdAt;
      }
      if (!stats.dateRange.latest || ko.createdAt > stats.dateRange.latest) {
        stats.dateRange.latest = ko.createdAt;
      }
    });

    return stats;
  }
}
