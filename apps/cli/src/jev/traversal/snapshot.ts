import { z } from 'zod';
import { entitySourceSchema, type EntitySource } from './entity-source';
import { createGraphReader } from './graph-reader';
import type { EntityRef, GraphReader } from './types';

/** A saved copy of the part of the graph a walk can reach, keyed by entity id. */
export const snapshotSchema = z.object({
  entities: z.record(entitySourceSchema),
});

export type GraphSnapshot = z.infer<typeof snapshotSchema>;

/** A reader that answers from the snapshot; an entity the snapshot lacks is an error, not an empty read. */
export const createSnapshotReader = (
  focal: EntityRef,
  snapshot: GraphSnapshot,
  known: readonly EntityRef[] = [],
): GraphReader =>
  createGraphReader(
    focal,
    (ref): Promise<EntitySource> => {
      const source = snapshot.entities[ref.id];
      return source
        ? Promise.resolve(source)
        : Promise.reject(new Error(`Snapshot has no entity ${ref.id}.`));
    },
    known,
  );
