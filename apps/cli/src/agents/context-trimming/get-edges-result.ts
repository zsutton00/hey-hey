import { z } from 'zod';
import type { Candidate } from '../../jev/scenarios';
import type { JsonObject } from '../platform-mcp-proxy/session';

const edgeSchema = z.object({
  createdAt: z.string(),
  direction: z.enum(['in', 'out']),
  edgeType: z.string(),
  otherEndpoint: z.object({
    displayName: z.string(),
    entityId: z.string(),
    entityType: z.string(),
    taskType: z.string().optional(),
  }),
  reasonType: z.string().optional(),
  reasoning: z.string().optional(),
});
export const edgesResultSchema = z.object({
  edgesByEntity: z.record(z.array(edgeSchema)),
  omittedEntities: z.array(z.unknown()).optional(),
});

export type EdgesResult = z.infer<typeof edgesResultSchema>;
export type EdgeEntry = z.infer<typeof edgeSchema>;

export interface EdgeSlot {
  seedId: string;
  position: number;
  entry: EdgeEntry;
  candidate: Candidate | null;
}

export const edgeSlotsOf = (
  result: EdgesResult,
  completeSeedIds: ReadonlySet<string>,
): EdgeSlot[] =>
  Object.entries(result.edgesByEntity).flatMap(([seedId, edges]) =>
    edges.map((entry, position) => ({
      seedId,
      position,
      entry,
      candidate: completeSeedIds.has(seedId)
        ? null
        : {
            id: `edge:${seedId}:${String(position)}`,
            kind: 'linked',
            text: `${entry.otherEndpoint.displayName} (${entry.otherEndpoint.entityType}${entry.otherEndpoint.taskType ? ` ${entry.otherEndpoint.taskType}` : ''}; ${entry.edgeType}; ${entry.direction})${entry.reasoning ? `: ${entry.reasoning}` : ''}`,
          },
    })),
  );

export const edgeIndex = (entry: EdgeEntry): JsonObject => ({
  createdAt: entry.createdAt,
  direction: entry.direction,
  edgeType: entry.edgeType,
  otherEndpoint: {
    entityId: entry.otherEndpoint.entityId,
    displayName: entry.otherEndpoint.displayName,
    entityType: entry.otherEndpoint.entityType,
    ...(entry.otherEndpoint.taskType ? { taskType: entry.otherEndpoint.taskType } : {}),
  },
});
