import type {
  FieldFunctionOptions,
  FieldPolicy,
  Reference,
} from "@apollo/client";

type ReadField = FieldFunctionOptions["readField"];

/** The stored shape of `Conversation.messages`, as the query selects it. */
export interface StoredMessageConnection {
  __typename?: string;
  nodes: readonly Reference[];
  endCursor: string | null;
  startCursor: string | null;
  hasOlder: boolean | null;
}

const compareThreadOrder = (
  readField: ReadField,
  a: Reference,
  b: Reference,
): number => {
  const aCreatedAt = readField("createdAt", a);
  const bCreatedAt = readField("createdAt", b);
  const aMs = typeof aCreatedAt === "string" ? Date.parse(aCreatedAt) : null;
  const bMs = typeof bCreatedAt === "string" ? Date.parse(bCreatedAt) : null;

  // An undated input is not on the timeline; it never sorts among dated ones.
  if (aMs === null || bMs === null) {
    return aMs === null ? (bMs === null ? 0 : 1) : -1;
  }
  if (aMs !== bMs) {
    return aMs - bMs;
  }

  return String(readField("id", a)).localeCompare(String(readField("id", b)));
};

/** Every message once, by its normalized identity, oldest first. */
const unionInThreadOrder = (
  readField: ReadField,
  loaded: readonly Reference[],
  arrived: readonly Reference[],
): Reference[] => {
  const byIdentity = new Map<string, Reference>();
  for (const message of [...loaded, ...arrived]) {
    byIdentity.set(message.__ref, message);
  }

  return [...byIdentity.values()].sort((a, b) =>
    compareThreadOrder(readField, a, b),
  );
};

/**
 * One list of messages per conversation, whichever page or delta read
 * produced it. The reads differ only in which arguments they pass, so the
 * arguments are not part of the storage key.
 *
 * - a read of the whole thread is complete and replaces the list;
 * - a read `after` a cursor appends newer messages;
 * - a newest-first page without `before` is the recent window: it merges into
 *   what is loaded, so a refresh never drops older history. It is also
 *   complete for the span it covers, so a loaded message inside that span
 *   which the page lacks no longer exists;
 * - a newest-first page with `before` prepends an older page and moves the
 *   continuation to its older end.
 *
 * The continuation (`startCursor`, `hasOlder`) always describes the oldest
 * loaded end, so it travels with the list.
 */
export const conversationMessagesFieldPolicy: FieldPolicy<
  StoredMessageConnection,
  StoredMessageConnection,
  StoredMessageConnection
> = {
  keyArgs: false,
  merge(existing, incoming, { args, readField }) {
    const isNewestFirst = args?.last != null || args?.before != null;
    const isOlderPage = args?.before != null;
    const isDelta = !isNewestFirst && args?.after != null;

    if (!isNewestFirst && !isDelta) {
      return { ...incoming, startCursor: null, hasOlder: false };
    }
    if (!existing || existing.nodes.length === 0) {
      return incoming;
    }

    const isRecentWindow = isNewestFirst && !isOlderPage;
    const windowStart = incoming.nodes[0];
    const arrived = new Set(incoming.nodes.map((node) => node.__ref));
    const loaded =
      isRecentWindow && windowStart
        ? existing.nodes.filter(
            (node) =>
              arrived.has(node.__ref) ||
              compareThreadOrder(readField, node, windowStart) < 0,
          )
        : existing.nodes;
    const nodes = unionInThreadOrder(readField, loaded, incoming.nodes);
    const newest = nodes.at(-1);
    const endCursor = newest
      ? String(readField("id", newest))
      : (incoming.endCursor ?? existing.endCursor);

    const incomingOldest = incoming.nodes[0];
    const incomingReachesOldest =
      isOlderPage ||
      (isNewestFirst &&
        incomingOldest !== undefined &&
        nodes[0]?.__ref === incomingOldest.__ref);
    const continuation = incomingReachesOldest ? incoming : existing;

    return {
      ...incoming,
      nodes,
      endCursor,
      startCursor: continuation.startCursor,
      hasOlder: continuation.hasOlder,
    };
  },
};
