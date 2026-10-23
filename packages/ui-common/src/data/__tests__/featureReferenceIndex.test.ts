import { describe, expect, it } from "vitest";
import type { ServiceDto, WorkItemReferenceDto } from "../../api";
import {
  buildPassiveReferenceIndex,
  buildFeatureReferenceIndex,
  createFeatureReferenceCandidates,
  deriveAncestorNamePath,
  findCompletedFeatureReferenceMatches,
  groupFeatureReferencesByTitle,
  normalizeFeatureTitle,
  selectLongestOverlappingFeatureReferenceMatches,
} from "../featureReferenceIndex";
import type { FeatureReferenceTitleMatch } from "../featureReferenceIndex";

const reference = (
  id: string,
  name: string,
  parentTaskId: string | null = null,
  type = "FEATURE"
): WorkItemReferenceDto => ({
  id,
  name,
  type,
  parentTaskId,
});

describe("feature reference title index", () => {
  it("combines typed feature and service candidates deterministically", () => {
    const services: ServiceDto[] = [
      { id: "service-b", name: "Roadmap", organizationId: "org-1" },
      { id: "service-a", name: "API", organizationId: "org-1" },
    ];
    const index = buildPassiveReferenceIndex({
      featureReferences: [reference("feature-roadmap", "Roadmap")],
      services,
    });

    expect(
      index.candidates.map(({ entityType, id }) => ({ entityType, id }))
    ).toEqual([
      { entityType: "feature", id: "feature-roadmap" },
      { entityType: "service", id: "service-a" },
      { entityType: "service", id: "service-b" },
    ]);
    expect(
      index.groupsByNormalizedTitle
        .get("roadmap")
        ?.map(({ entityType }) => entityType)
    ).toEqual(["feature", "service"]);
  });
  it("normalizes case, Unicode compatibility forms, and whitespace without removing punctuation", () => {
    expect(normalizeFeatureTitle("  Feature   Search: V2  ")).toBe(
      "feature search: v2"
    );
    expect(normalizeFeatureTitle("ＦＥＡＴＵＲＥ")).toBe("feature");
  });

  it("derives root-to-parent ancestor paths from parent identities", () => {
    const references = [
      reference("root", "Product"),
      reference("parent", "Search", "root"),
      reference("child", "Inline Search", "parent"),
    ];

    expect(deriveAncestorNamePath(references[2]!, references)).toEqual([
      "Product",
      "Search",
    ]);
    expect(
      createFeatureReferenceCandidates(references)[2]?.ancestorPath
    ).toEqual(["Product", "Search"]);
  });

  it("keeps duplicate normalized titles as separate hierarchy-aware candidates", () => {
    const references = [
      reference("root-a", "Area A"),
      reference("root-b", "Area B"),
      reference("feature-a", "Roadmap", "root-a"),
      reference("feature-b", "roadmap", "root-b"),
    ];
    const groups = groupFeatureReferencesByTitle(references);
    const roadmap = groups.get("roadmap");

    expect(roadmap).toHaveLength(2);
    expect(roadmap?.map((candidate) => candidate.id)).toEqual([
      "feature-a",
      "feature-b",
    ]);
    expect(roadmap?.map((candidate) => candidate.ancestorPath)).toEqual([
      ["Area A"],
      ["Area B"],
    ]);
  });

  it("filters non-feature references from the feature index", () => {
    const index = buildFeatureReferenceIndex([
      reference("feature", "Feature Search"),
      reference("task", "Feature Search", null, "STANDARD"),
    ]);

    expect(index.candidates.map((candidate) => candidate.id)).toEqual([
      "feature",
    ]);
  });

  it("requires token boundaries while allowing punctuation and multi-word titles", () => {
    const index = buildFeatureReferenceIndex([
      reference("search", "Feature Search"),
    ]);
    const matches = findCompletedFeatureReferenceMatches(
      "Use FEATURE SEARCH, but not Feature Searchable or MyFeature Search.",
      index
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      matchedText: "FEATURE SEARCH",
      start: 4,
    });
  });

  it("normalizes punctuation separators while preserving the source range", () => {
    const index = buildFeatureReferenceIndex([
      reference("versioned-search", "Feature Search: V2"),
    ]);
    const matches = findCompletedFeatureReferenceMatches(
      "Use FEATURE-SEARCH V2,",
      index
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      normalizedTitle: "feature search: v2",
      matchedText: "FEATURE-SEARCH V2",
      matchKind: "exact",
      matchRank: 0,
    });
  });

  it("classifies partial trailing words and ordered token matches", () => {
    const partialIndex = buildFeatureReferenceIndex([
      reference("search-agent", "Search Agent"),
    ]);

    expect(
      findCompletedFeatureReferenceMatches("Search Ag ", partialIndex)[0]
    ).toMatchObject({
      normalizedTitle: "search agent",
      matchedText: "Search Ag",
      matchKind: "prefix",
      matchRank: 1,
    });

    const orderedIndex = buildFeatureReferenceIndex([
      reference("entity-title-search", "Entity Title Search"),
    ]);
    expect(
      findCompletedFeatureReferenceMatches("Entity Sear ", orderedIndex)[0]
    ).toMatchObject({
      normalizedTitle: "entity title search",
      matchedText: "Entity Sear",
      matchKind: "ordered-token-prefix",
      matchRank: 2,
    });
  });

  it("classifies token subsets and bounded typos or transpositions", () => {
    const subsetIndex = buildFeatureReferenceIndex([
      reference("entity-search", "Entity Search"),
    ]);
    expect(
      findCompletedFeatureReferenceMatches("Search Entity ", subsetIndex)[0]
    ).toMatchObject({
      normalizedTitle: "entity search",
      matchKind: "token-subset",
      matchRank: 3,
    });

    const fuzzyIndex = buildFeatureReferenceIndex([
      reference("agent", "Agent"),
      reference("service", "Service"),
      reference("workflows", "Workflows"),
    ]);
    expect(
      findCompletedFeatureReferenceMatches("aegnt ", fuzzyIndex)[0]
    ).toMatchObject({
      normalizedTitle: "agent",
      matchedText: "aegnt",
      matchKind: "typo",
      matchRank: 4,
    });
    expect(
      findCompletedFeatureReferenceMatches("servcie ", fuzzyIndex)[0]
    ).toMatchObject({
      normalizedTitle: "service",
      matchKind: "typo",
      matchRank: 4,
    });
    expect(
      findCompletedFeatureReferenceMatches("wrkflows ", fuzzyIndex)[0]
    ).toMatchObject({
      normalizedTitle: "workflows",
      matchKind: "typo",
      matchRank: 4,
    });
  });

  it("treats a simple singular or plural suffix as a bounded fuzzy match", () => {
    const singularIndex = buildFeatureReferenceIndex([
      reference("message", "Message"),
    ]);
    const pluralIndex = buildFeatureReferenceIndex([
      reference("messages", "Messages"),
    ]);

    expect(
      findCompletedFeatureReferenceMatches("messages ", singularIndex)[0]
    ).toMatchObject({
      normalizedTitle: "message",
      matchedText: "messages",
      matchKind: "typo",
      matchRank: 4,
    });
    expect(
      findCompletedFeatureReferenceMatches("message ", pluralIndex)[0]
    ).toMatchObject({
      normalizedTitle: "messages",
      matchedText: "message",
      matchKind: "prefix",
      matchRank: 1,
    });

    const inflectedIndex = buildFeatureReferenceIndex([
      reference("entity", "Entity"),
      reference("status", "Status"),
    ]);
    expect(
      findCompletedFeatureReferenceMatches("entities ", inflectedIndex)[0]
    ).toMatchObject({ normalizedTitle: "entity", matchKind: "typo" });
    expect(
      findCompletedFeatureReferenceMatches("statuses ", inflectedIndex)[0]
    ).toMatchObject({ normalizedTitle: "status", matchKind: "typo" });
  });

  it("rejects interior substrings, common fuzzy words, and weak phrases", () => {
    const index = buildFeatureReferenceIndex([
      reference("roadmap-navigation", "Roadmap Navigation"),
      reference("feature-search", "Feature Search"),
      reference("notifications", "Notifications"),
      reference("authentication", "Authentication"),
    ]);

    expect(findCompletedFeatureReferenceMatches("adma atio ", index)).toEqual(
      []
    );
    expect(findCompletedFeatureReferenceMatches("thentic ", index)).toEqual(
      []
    );
    expect(findCompletedFeatureReferenceMatches("then ", index)).toEqual([]);
    expect(findCompletedFeatureReferenceMatches("ag ", index)).toEqual([]);
    expect(findCompletedFeatureReferenceMatches("and ", index)).toEqual([]);
    expect(findCompletedFeatureReferenceMatches("not ", index)).toEqual([]);
    expect(
      findCompletedFeatureReferenceMatches("noti ", index)[0]
    ).toMatchObject({
      normalizedTitle: "notifications",
      matchKind: "prefix",
    });
    expect(
      findCompletedFeatureReferenceMatches("Feature Searchable ", index)
    ).toEqual([]);
  });

  it("still discovers exact three-character titles", () => {
    const index = buildFeatureReferenceIndex([
      reference("not", "Not"),
      reference("then", "Then"),
    ]);

    expect(
      findCompletedFeatureReferenceMatches("not ", index)[0]
    ).toMatchObject({
      normalizedTitle: "not",
      matchKind: "exact",
      matchRank: 0,
    });
    expect(
      findCompletedFeatureReferenceMatches("then ", index)[0]
    ).toMatchObject({
      normalizedTitle: "then",
      matchKind: "exact",
      matchRank: 0,
    });
  });

  it("keeps deliberate ordered token-prefix shorthand", () => {
    const index = buildFeatureReferenceIndex([
      reference("conversation-viewer", "Conversation Viewer"),
    ]);

    expect(
      findCompletedFeatureReferenceMatches("conv viewer ", index)[0]
    ).toMatchObject({
      normalizedTitle: "conversation viewer",
      matchedText: "conv viewer",
      matchKind: "ordered-token-prefix",
      matchRank: 2,
    });
  });

  it("keeps exact matches above weaker overlapping candidates", () => {
    const index = buildFeatureReferenceIndex([
      reference("search", "Search"),
      reference("search-agent", "Search Agent"),
    ]);
    const matches = findCompletedFeatureReferenceMatches("Search Ag ", index);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      normalizedTitle: "search",
      matchedText: "Search",
      matchKind: "exact",
      matchRank: 0,
    });
  });

  it("prefers the longest completed title when title ranges overlap", () => {
    const index = buildFeatureReferenceIndex([
      reference("short", "Feature"),
      reference("long", "Feature Search"),
      reference("punctuated", "Feature Search: V2"),
    ]);
    const matches = findCompletedFeatureReferenceMatches(
      "Feature Search: V2 is ready.",
      index
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.normalizedTitle).toBe("feature search: v2");
    expect(matches[0]?.candidates[0]?.id).toBe("punctuated");
  });

  it("does not let a rejected overlap block a later non-overlapping match", () => {
    const match = (start: number, end: number, normalizedTitle: string) =>
      ({
        normalizedTitle,
        matchedText: normalizedTitle,
        start,
        end,
        matchKind: "exact",
        matchRank: 0,
        candidates: [],
      } satisfies FeatureReferenceTitleMatch);

    expect(
      selectLongestOverlappingFeatureReferenceMatches([
        match(0, 10, "first"),
        match(5, 15, "rejected-overlap"),
        match(14, 20, "later"),
      ]).map(({ normalizedTitle }) => normalizedTitle)
    ).toEqual(["first", "later"]);
  });
});
