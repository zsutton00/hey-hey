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
  historyFloor?: { id: string; createdAt: string };
  historyLoaded?: boolean;
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
 *   which the page lacks no longer exists. With no older continuation the
 *   response covers the entire thread, even when it is empty;
 * - a newest-first page with `before` prepends an older page and moves the
 *   continuation to its older end.
 *
 * The history cursor and lower bound travel with the list. A full-thread
 * consumer can populate the list without expanding the visible history.
 */
export const conversationMessagesFieldPolicy: FieldPolicy<
  StoredMessageConnection,
  StoredMessageConnection,
  StoredMessageConnection
> = {
  keyArgs: false,
  read(existing, { args, readField }) {
    if (!existing || args?.last == null) {
      return existing;
    }
    if (!existing.historyLoaded) {
      return undefined;
    }
    const floor = existing.historyFloor;
    if (!floor) {
      return existing;
    }
    const floorTime = Date.parse(floor.createdAt);
    return {
      ...existing,
      nodes: existing.nodes.filter((node) => {
        const createdAt = readField<string>("createdAt", node);
        if (!createdAt) {
          return true;
        }
        const time = Date.parse(createdAt);
        return (
          time > floorTime ||
          (time === floorTime &&
            String(readField("id", node)).localeCompare(floor.id) >= 0)
        );
      }),
    };
  },
  merge(existing, incoming, { args, readField }) {
    const isNewestFirst = args?.last != null || args?.before != null;
    const isOlderPage = args?.before != null;
    const isDelta = !isNewestFirst && args?.after != null;

    if (!isNewestFirst && !isDelta) {
      return {
        ...incoming,
        startCursor: existing?.startCursor ?? null,
        hasOlder: existing?.hasOlder ?? false,
        historyLoaded: existing?.historyLoaded,
        historyFloor: existing?.historyFloor,
      };
    }

    const isRecentWindow = isNewestFirst && !isOlderPage;
    if (isRecentWindow && incoming.hasOlder === false) {
      return { ...incoming, historyLoaded: true };
    }

    const windowStart = incoming.nodes[0];
    const arrived = new Set(incoming.nodes.map((node) => node.__ref));
    const loaded =
      isRecentWindow && windowStart
        ? (existing?.nodes ?? []).filter(
            (node) =>
              arrived.has(node.__ref) ||
              compareThreadOrder(readField, node, windowStart) < 0,
          )
        : (existing?.nodes ?? []);
    const nodes = unionInThreadOrder(readField, loaded, incoming.nodes);
    const newest = nodes.at(-1);
    const endCursor = newest
      ? String(readField("id", newest))
      : (incoming.endCursor ?? existing?.endCursor ?? null);

    // A full-thread consumer may load records below the viewer's current
    // window. Only a history read can open or extend that window.
    const historyLoaded = isNewestFirst || existing?.historyLoaded;
    const previousFloor = existing?.historyFloor;
    const windowStartTime =
      windowStart && readField<string>("createdAt", windowStart);
    const windowReachesFloor =
      previousFloor &&
      windowStartTime &&
      (Date.parse(windowStartTime) < Date.parse(previousFloor.createdAt) ||
        (Date.parse(windowStartTime) === Date.parse(previousFloor.createdAt) &&
          String(readField("id", windowStart)).localeCompare(
            previousFloor.id,
          ) <= 0));
    const extendsHistory =
      isNewestFirst &&
      (isOlderPage ||
        !existing?.historyLoaded ||
        !existing.nodes.length ||
        windowReachesFloor);
    const startCursor = extendsHistory
      ? incoming.startCursor
      : (existing?.startCursor ?? null);
    const hasOlder = extendsHistory
      ? incoming.hasOlder
      : (existing?.hasOlder ?? false);
    let historyFloor = existing?.historyFloor;
    if (extendsHistory) {
      const oldest = incoming.nodes[0];
      const createdAt = oldest && readField<string>("createdAt", oldest);
      const id = oldest && readField<string>("id", oldest);
      historyFloor =
        hasOlder && id && createdAt ? { id, createdAt } : undefined;
    }

    return {
      ...incoming,
      nodes,
      endCursor,
      startCursor,
      hasOlder,
      historyLoaded,
      historyFloor,
    };
  },
};
