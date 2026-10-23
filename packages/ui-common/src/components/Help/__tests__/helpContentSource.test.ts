import { describe, expect, it } from "vitest";

import type {
  HelpNode,
  HelpSearchResult,
  HelpTreeResponse,
} from "../../../api";
import {
  helpImageUrlTransform,
  mapHelpSearchResultsToTopicList,
  mapHelpTreeToTopicList,
  resolveProjectHelpRootIdentities,
  selectProjectHelpTree,
} from "../helpContentSource";

const node = (input: {
  id: string;
  parentId: string | null;
  slug: string;
  title: string;
  ordering: number;
}): HelpNode => input;

describe("helpImageUrlTransform", () => {
  it("resolves repository-relative image sources against the configured API", () => {
    expect(
      helpImageUrlTransform(
        "assets/nested/diagram image.svg",
        "src",
        {} as never
      )
    ).toContain("/help/assets/nested/diagram%20image.svg");
    expect(
      helpImageUrlTransform("assets/nested/diagram%20image.svg", "src", {})
    ).toContain("/help/assets/nested/diagram%20image.svg");
  });

  it("leaves ordinary links on the shared Markdown URL transform", () => {
    expect(
      helpImageUrlTransform("https://example.com/docs", "href", {} as never)
    ).toBe("https://example.com/docs");
    expect(
      helpImageUrlTransform("javascript:alert(1)", "href", {} as never)
    ).toBe("");
  });
});

describe("mapHelpTreeToTopicList", () => {
  it("orders root topics and child topics by sibling ordering", () => {
    const tree: HelpTreeResponse = {
      items: [
        node({
          id: "root-a",
          parentId: null,
          slug: "root-a",
          title: "Root A",
          ordering: 2,
        }),
        node({
          id: "child-b",
          parentId: "root-b",
          slug: "child-b",
          title: "Child B",
          ordering: 2,
        }),
        node({
          id: "root-b",
          parentId: null,
          slug: "root-b",
          title: "Root B",
          ordering: 1,
        }),
        node({
          id: "child-a",
          parentId: "root-b",
          slug: "child-a",
          title: "Child A",
          ordering: 1,
        }),
      ],
    };

    const topics = mapHelpTreeToTopicList(tree);

    expect(topics.map((topic) => topic.id)).toEqual([
      "root-b",
      "child-a",
      "child-b",
      "root-a",
    ]);
    expect(topics.map((topic) => topic.number)).toEqual([1, 2, 3, 4]);
    expect(topics.map((topic) => topic.depth)).toEqual([0, 1, 1, 0]);
  });

  it("preserves source order when sibling ordering ties", () => {
    const tree: HelpTreeResponse = {
      items: [
        node({
          id: "first",
          parentId: null,
          slug: "first",
          title: "First",
          ordering: 1,
        }),
        node({
          id: "second",
          parentId: null,
          slug: "second",
          title: "Second",
          ordering: 1,
        }),
      ],
    };

    const topics = mapHelpTreeToTopicList(tree);

    expect(topics.map((topic) => topic.id)).toEqual(["first", "second"]);
    expect(topics.map((topic) => topic.title)).toEqual(["First", "Second"]);
  });

  it("keeps shallow node fields available on each topic item", () => {
    const tree: HelpTreeResponse = {
      items: [
        node({
          id: "topic",
          parentId: null,
          slug: "topic-slug",
          title: "Topic",
          ordering: 4,
        }),
      ],
    };

    const [topic] = mapHelpTreeToTopicList(tree);

    expect(topic).toMatchObject({
      id: "topic",
      slug: "topic-slug",
      slugPath: "topic-slug",
      readKey: "topic-slug",
      title: "Topic",
      parentId: null,
      ordering: 4,
      depth: 0,
      number: 1,
    });
    expect(topic.node).toBe(tree.items[0]);
  });

  it("derives hierarchical slug paths for nested nodes", () => {
    const tree: HelpTreeResponse = {
      items: [
        node({
          id: "root",
          parentId: null,
          slug: "security",
          title: "Security",
          ordering: 1,
        }),
        node({
          id: "recovery",
          parentId: "root",
          slug: "recovery",
          title: "Recovery",
          ordering: 1,
        }),
        node({
          id: "provider-recovery",
          parentId: "root",
          slug: "provider-transfer",
          title: "Provider transfer",
          ordering: 2,
        }),
        node({
          id: "other-root",
          parentId: null,
          slug: "machines",
          title: "Machines",
          ordering: 2,
        }),
        node({
          id: "machine-recovery",
          parentId: "other-root",
          slug: "recovery",
          title: "Machine recovery",
          ordering: 1,
        }),
      ],
    };

    expect(
      mapHelpTreeToTopicList(tree).map(({ slugPath, readKey }) => [
        slugPath,
        readKey,
      ])
    ).toEqual([
      ["security", "security"],
      ["security/recovery", "security/recovery"],
      ["security/provider-transfer", "security/provider-transfer"],
      ["machines", "machines"],
      ["machines/recovery", "machines/recovery"],
    ]);
  });

  it("keeps same-slug search results distinct by reading them by UUID", () => {
    const results: HelpSearchResult[] = [
      {
        id: "child-a",
        slug: "recovery",
        title: "Account recovery",
        snippet: "Recovery with a passkey.",
        rank: 0.9,
      },
      {
        id: "child-b",
        slug: "recovery",
        title: "Machine recovery",
        snippet: "Recovery after provider transfer.",
        rank: 0.8,
      },
    ];

    const topics = mapHelpSearchResultsToTopicList(results);

    expect(
      topics.map(({ id, readKey, scenario }) => [id, readKey, scenario.summary])
    ).toEqual([
      ["child-a", "child-a", "Recovery with a passkey."],
      ["child-b", "child-b", "Recovery after provider transfer."],
    ]);
  });

  it("does not carry catalog deep prose into an unread browse record", () => {
    const [topic] = mapHelpTreeToTopicList({
      items: [
        node({
          id: "create-a-task",
          parentId: null,
          slug: "create-a-task",
          title: "Create a task",
          ordering: 1,
        }),
      ],
    });

    expect(topic.scenario.deepContent).toBeUndefined();
    expect(topic.scenario.title).toBe("Create a task");
  });
});

describe("selectProjectHelpTree", () => {
  const welcomeRootId = "11111111-1111-4111-8111-111111111111";
  const firstProjectRootId = "22222222-2222-4222-8222-222222222222";
  const firstProjectChildId = "33333333-3333-4333-8333-333333333333";
  const referenceRootId = "44444444-4444-4444-8444-444444444444";
  const futureRootId = "55555555-5555-4555-8555-555555555555";

  const tree: HelpTreeResponse = {
    items: [
      node({
        id: futureRootId,
        parentId: null,
        slug: "future-library-area",
        title: "Future library area",
        ordering: 4,
      }),
      node({
        id: firstProjectChildId,
        parentId: firstProjectRootId,
        slug: "choose-a-feature",
        title: "Choose a feature",
        ordering: 1,
      }),
      node({
        id: welcomeRootId,
        parentId: null,
        slug: "create-a-task",
        title: "Create a task",
        ordering: 1,
      }),
      node({
        id: referenceRootId,
        parentId: null,
        slug: "reference",
        title: "Reference",
        ordering: 3,
      }),
      node({
        id: firstProjectRootId,
        parentId: null,
        slug: "my-first-project",
        title: "My First Project",
        ordering: 2,
      }),
    ],
  };

  it("resolves known root slugs once and classifies roots by canonical ID", () => {
    const identities = resolveProjectHelpRootIdentities(tree);

    expect([...identities.welcomeRootIds]).toEqual([welcomeRootId]);
    expect(identities.firstProjectRootId).toBe(firstProjectRootId);

    const renamedTree: HelpTreeResponse = {
      items: tree.items.map((item) =>
        item.id === firstProjectRootId
          ? { ...item, slug: "renamed-guide", title: "Renamed guide" }
          : item
      ),
    };

    expect(
      selectProjectHelpTree(renamedTree, "first-project", identities).items.map(
        ({ id }) => id
      )
    ).toEqual([firstProjectChildId, firstProjectRootId]);
  });

  it("keeps the complete selected subtree without changing API input order", () => {
    expect(
      selectProjectHelpTree(tree, "first-project").items.map(({ id }) => id)
    ).toEqual([firstProjectChildId, firstProjectRootId]);

    expect(
      mapHelpTreeToTopicList(selectProjectHelpTree(tree, "first-project")).map(
        ({ id }) => id
      )
    ).toEqual([firstProjectRootId, firstProjectChildId]);
  });

  it("places every unrecognized current or future root in Help", () => {
    expect(
      mapHelpTreeToTopicList(selectProjectHelpTree(tree, "help")).map(
        ({ id }) => id
      )
    ).toEqual([referenceRootId, futureRootId]);
  });

  it("keeps only the established getting-started roots in Welcome", () => {
    expect(
      selectProjectHelpTree(tree, "welcome").items.map(({ id }) => id)
    ).toEqual([welcomeRootId]);
  });
});
