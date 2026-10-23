import { candidatesOf, type EntitySource } from './entity-source';
import type { EntityRef, GraphReader, LoadedEntity } from './types';

/** Fetches what is known of one entity. The only part that differs between live and saved reads. */
export type LoadEntitySource = (ref: EntityRef) => Promise<EntitySource>;

/**
 * The reader both the live graph and a snapshot go through: it asks `load` for an entity once,
 * and derives the read and the candidates from that one answer. The walk starts from `focal`;
 * every other entity it can reach became known through the candidates of one it already read.
 * A caller that already knows other entities, such as the read check, names them in `known`.
 */
export const createGraphReader = (
  focal: EntityRef,
  load: LoadEntitySource,
  known: readonly EntityRef[] = [],
): GraphReader => {
  const refs = new Map<string, EntityRef>([focal, ...known].map((ref) => [ref.id, ref]));
  const sources = new Map<string, Promise<EntitySource>>();

  const sourceOf = (id: string): Promise<EntitySource> => {
    const ref = refs.get(id);
    if (!ref) throw new Error(`Entity ${id} was not reached from the focal work.`);
    let source = sources.get(id);
    if (!source) {
      source = load(ref);
      sources.set(id, source);
    }
    return source;
  };

  return {
    read: async (id): Promise<LoadedEntity> => {
      const { kind, title, text } = await sourceOf(id);
      return { id, kind, title, text };
    },
    candidates: async (id) => {
      const found = candidatesOf(await sourceOf(id));
      for (const { ref } of found) {
        if (!refs.has(ref.id)) refs.set(ref.id, ref);
      }
      return found;
    },
  };
};
