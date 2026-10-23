import type { HelpNode, HelpSearchResult, HelpTreeResponse } from "../../api";
import { defaultUrlTransform, type UrlTransform } from "react-markdown";
import { getApiBaseUrl } from "../../services/runtimeConfig";
import { HELP_SCENARIO_CATALOG } from "./helpScenarioCatalog";
import type { HelpScenarioEntry } from "./helpScenarioCatalog";
import type { HelpScenarioDisplayEntry } from "./helpContentTypes";

export interface HelpTopicListItem {
  id: string;
  slug: string;
  slugPath: string;
  /** UUID for search results; hierarchical path for browse results. */
  readKey: string;
  title: string;
  parentId: string | null;
  ordering: number;
  depth: number;
  number: number;
  scenario: HelpScenarioDisplayEntry;
  node: HelpNode;
}

export type ProjectHelpSection = "welcome" | "first-project" | "help";

export interface ProjectHelpRootIdentities {
  readonly welcomeRootIds: ReadonlySet<string>;
  readonly firstProjectRootId: string | null;
}

const HELP_ASSET_REFERENCE_PREFIX = "assets/";

/**
 * Help Markdown keeps repository-relative image references in its canonical
 * body. Resolve only image sources here so ordinary Markdown links retain the
 * shared renderer's existing URL and security behavior.
 */
export const helpImageUrlTransform: UrlTransform = (url, key, _node) => {
  if (key === "src" && url.startsWith(HELP_ASSET_REFERENCE_PREFIX)) {
    const authoredAssetPath = url.slice(HELP_ASSET_REFERENCE_PREFIX.length);
    let decodedAssetPath = authoredAssetPath;
    try {
      decodedAssetPath = decodeURIComponent(authoredAssetPath);
    } catch {
      // Source validation rejects malformed escapes; keep rendering defensive
      // if an already-persisted body reaches the client before reconciliation.
    }
    const assetPath = decodedAssetPath
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    return `${getApiBaseUrl()}/help/assets/${assetPath}`;
  }

  return defaultUrlTransform(url);
};

const WELCOME_ROOT_SLUGS = new Set([
  "install-agent-bridge",
  "features-ready",
  "create-a-service",
  "create-a-task",
  "first-agent-session",
]);
const FIRST_PROJECT_ROOT_SLUG = "my-first-project";

interface IndexedHelpNode {
  node: HelpNode;
  sourceIndex: number;
}

const HELP_SCENARIO_BY_ID = new Map<string, HelpScenarioEntry>(
  HELP_SCENARIO_CATALOG.map((scenario) => [scenario.id, scenario] as const)
);

/**
 * Keep onboarding presentation affordances attached to API-backed topics,
 * while deliberately omitting the catalog's old deep prose. Long-form copy is
 * authoritative only when it has been read from the help-node endpoint.
 */
const createScenarioDisplayEntry = ({
  id,
  title,
  summary,
}: {
  id: string;
  title: string;
  summary?: string;
}): HelpScenarioDisplayEntry => {
  const catalogScenario = HELP_SCENARIO_BY_ID.get(id);
  const presentation = catalogScenario
    ? (({ deepContent: _deepContent, ...entry }) => entry)(catalogScenario)
    : {};

  return {
    ...presentation,
    id,
    title,
    ...(summary === undefined ? {} : { summary }),
  };
};

const compareSiblings = (
  left: IndexedHelpNode,
  right: IndexedHelpNode
): number => {
  if (left.node.ordering !== right.node.ordering) {
    return left.node.ordering - right.node.ordering;
  }
  return left.sourceIndex - right.sourceIndex;
};

const getRootNodes = (tree: HelpTreeResponse): HelpNode[] => {
  const knownNodeIds = new Set(tree.items.map((node) => node.id));
  return tree.items.filter(
    (node) => node.parentId === null || !knownNodeIds.has(node.parentId)
  );
};

/**
 * Resolve the source-controlled root slugs to the canonical UUIDs returned by
 * the API. Partitioning below uses only those resolved identities, never
 * mutable display copy or a client's own replacement IDs.
 */
export function resolveProjectHelpRootIdentities(
  tree: HelpTreeResponse
): ProjectHelpRootIdentities {
  const roots = getRootNodes(tree);

  return {
    welcomeRootIds: new Set(
      roots
        .filter((root) => WELCOME_ROOT_SLUGS.has(root.slug))
        .map((root) => root.id)
    ),
    firstProjectRootId:
      roots.find((root) => root.slug === FIRST_PROJECT_ROOT_SLUG)?.id ?? null,
  };
}

const selectProjectHelpRootIds = (
  tree: HelpTreeResponse,
  section: ProjectHelpSection,
  identities: ProjectHelpRootIdentities
): Set<string> => {
  const rootIds = getRootNodes(tree).map((root) => root.id);

  if (section === "welcome") {
    return new Set(rootIds.filter((id) => identities.welcomeRootIds.has(id)));
  }

  if (section === "first-project") {
    return new Set(
      identities.firstProjectRootId === null
        ? []
        : [identities.firstProjectRootId]
    );
  }

  return new Set(
    rootIds.filter(
      (id) =>
        !identities.welcomeRootIds.has(id) &&
        id !== identities.firstProjectRootId
    )
  );
};

export function selectProjectHelpTree(
  tree: HelpTreeResponse,
  section: ProjectHelpSection,
  identities = resolveProjectHelpRootIdentities(tree)
): HelpTreeResponse {
  const selectedRootIds = selectProjectHelpRootIds(tree, section, identities);
  const nodesById = new Map(tree.items.map((node) => [node.id, node] as const));
  const rootIdByNodeId = new Map<string, string | null>();

  const findRootId = (
    nodeId: string,
    path = new Set<string>()
  ): string | null => {
    const cached = rootIdByNodeId.get(nodeId);
    if (cached !== undefined) return cached;
    if (path.has(nodeId)) return null;

    const node = nodesById.get(nodeId);
    if (!node) return null;
    if (node.parentId === null || !nodesById.has(node.parentId)) {
      rootIdByNodeId.set(nodeId, node.id);
      return node.id;
    }

    const nextPath = new Set(path);
    nextPath.add(nodeId);
    const rootId = findRootId(node.parentId, nextPath);
    rootIdByNodeId.set(nodeId, rootId);
    return rootId;
  };

  return {
    ...tree,
    items: tree.items.filter((node) => {
      const rootId = findRootId(node.id);
      return rootId !== null && selectedRootIds.has(rootId);
    }),
  };
}

const appendTopicListItems = ({
  parentId,
  depth,
  childrenByParentId,
  visitedNodeIds,
  parentSlugPath,
  items,
}: {
  parentId: string | null;
  depth: number;
  childrenByParentId: Map<string | null, IndexedHelpNode[]>;
  visitedNodeIds: Set<string>;
  parentSlugPath: string;
  items: HelpTopicListItem[];
}): void => {
  const children = childrenByParentId.get(parentId) ?? [];

  children.forEach(({ node }) => {
    if (visitedNodeIds.has(node.id)) return;

    visitedNodeIds.add(node.id);
    const slugPath = parentSlugPath
      ? `${parentSlugPath}/${node.slug}`
      : node.slug;
    items.push({
      id: node.id,
      slug: node.slug,
      slugPath,
      readKey: slugPath,
      title: node.title,
      parentId: node.parentId,
      ordering: node.ordering,
      depth,
      number: items.length + 1,
      scenario: createScenarioDisplayEntry({
        id: node.id,
        title: node.title,
      }),
      node,
    });

    appendTopicListItems({
      parentId: node.id,
      depth: depth + 1,
      childrenByParentId,
      visitedNodeIds,
      parentSlugPath: slugPath,
      items,
    });
  });
};

export function mapHelpTreeToTopicList(
  tree: HelpTreeResponse
): HelpTopicListItem[] {
  const childrenByParentId = new Map<string | null, IndexedHelpNode[]>();
  const knownNodeIds = new Set(tree.items.map((node) => node.id));

  tree.items.forEach((node, sourceIndex) => {
    const parentId = knownNodeIds.has(node.parentId ?? "")
      ? node.parentId
      : null;
    const siblings = childrenByParentId.get(parentId) ?? [];
    siblings.push({ node, sourceIndex });
    childrenByParentId.set(parentId, siblings);
  });

  childrenByParentId.forEach((siblings) => siblings.sort(compareSiblings));

  const items: HelpTopicListItem[] = [];
  appendTopicListItems({
    parentId: null,
    depth: 0,
    childrenByParentId,
    visitedNodeIds: new Set(),
    parentSlugPath: "",
    items,
  });

  return items;
}

/**
 * Adapt server-ranked body search into the same topic shape as browse rows.
 * Search has no parent data, so the UUID remains the read key: the node read
 * can therefore resolve the exact result even when two nodes share a slug.
 */
export function mapHelpSearchResultsToTopicList(
  results: readonly HelpSearchResult[]
): HelpTopicListItem[] {
  return results.map((result, index) => ({
    id: result.id,
    slug: result.slug,
    slugPath: result.slug,
    readKey: result.id,
    title: result.title,
    parentId: null,
    ordering: index,
    depth: 0,
    number: index + 1,
    scenario: createScenarioDisplayEntry({
      id: result.id,
      title: result.title,
      summary: result.snippet,
    }),
    node: {
      id: result.id,
      parentId: null,
      slug: result.slug,
      title: result.title,
      ordering: index,
    },
  }));
}
