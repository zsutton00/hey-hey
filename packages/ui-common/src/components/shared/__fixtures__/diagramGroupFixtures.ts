import type { DiagramGroup } from "../../../api";
import type { DiagramLayoutInput } from "../diagramLayoutCandidates";
import {
  buildDiagramLayoutGroupHints,
  serializeDiagramGroups,
} from "../diagramGroupBoundaries";

/**
 * Paired original and grouped Diagrams. Each grouped variant is a separately
 * identified enrichment of its original: same elements, flows and canonical
 * references, plus authored groups. Originals stay ungrouped so baseline
 * readability is measured without groups.
 */
export interface DiagramGroupFixtureElement {
  id: string;
  title: string;
  /** Canonical entity this placement represents, when any. */
  canonicalReference?: { entityType: "SERVICE" | "TASK"; entityId: string };
}

export interface DiagramGroupFixture {
  key: string;
  title: string;
  kind: "PROCESS" | "DEPLOYMENT";
  elements: readonly DiagramGroupFixtureElement[];
  flows: readonly { source: string; target: string; label: string }[];
  groups: readonly DiagramGroup[];
}

export interface DiagramGroupFixturePair {
  key: string;
  original: DiagramGroupFixture;
  grouped: DiagramGroupFixture;
}

const id = (suffix: number) =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const member = (workItemId: string) => ({
  kind: "persistedWorkItem" as const,
  workItemId,
});

const PROCESS_ELEMENTS: DiagramGroupFixtureElement[] = [
  { id: id(101), title: "Open cart" },
  { id: id(102), title: "Enter shipping address" },
  { id: id(103), title: "Choose delivery speed" },
  { id: id(104), title: "Enter card" },
  { id: id(105), title: "Confirm payment" },
  { id: id(106), title: "Show receipt" },
];
const PROCESS_FLOWS = [
  { source: id(101), target: id(102), label: "" },
  { source: id(102), target: id(103), label: "" },
  { source: id(103), target: id(104), label: "" },
  { source: id(104), target: id(105), label: "" },
  { source: id(105), target: id(104), label: "Declined" },
  { source: id(105), target: id(106), label: "Approved" },
];

const processOriginal: DiagramGroupFixture = {
  key: "process-association/original",
  title: "Checkout",
  kind: "PROCESS",
  elements: PROCESS_ELEMENTS,
  flows: PROCESS_FLOWS,
  groups: [],
};

const processGrouped: DiagramGroupFixture = {
  ...processOriginal,
  key: "process-association/grouped",
  groups: [
    {
      id: "shipping",
      label: "Shipping details",
      meaning: "VISUAL_ASSOCIATION",
      members: [member(id(102)), member(id(103))],
    },
    {
      id: "payment",
      label: "Payment",
      meaning: "VISUAL_ASSOCIATION",
      members: [member(id(104)), member(id(105))],
    },
  ],
};

export const CHECKOUT_API_SERVICE_ID = id(900);

const DEPLOYMENT_ELEMENTS: DiagramGroupFixtureElement[] = [
  { id: id(201), title: "Shopper" },
  { id: id(202), title: "Global DNS" },
  {
    id: id(203),
    title: "Checkout API",
    canonicalReference: {
      entityType: "SERVICE",
      entityId: CHECKOUT_API_SERVICE_ID,
    },
  },
  { id: id(204), title: "Orders database" },
  {
    id: id(205),
    title: "Checkout API",
    canonicalReference: {
      entityType: "SERVICE",
      entityId: CHECKOUT_API_SERVICE_ID,
    },
  },
  { id: id(206), title: "Orders replica" },
  { id: id(207), title: "Payments provider" },
];
const DEPLOYMENT_FLOWS = [
  { source: id(201), target: id(202), label: "" },
  { source: id(202), target: id(203), label: "Primary" },
  { source: id(202), target: id(205), label: "Failover" },
  { source: id(203), target: id(204), label: "" },
  { source: id(205), target: id(206), label: "" },
  { source: id(204), target: id(206), label: "Replicates" },
  { source: id(203), target: id(207), label: "" },
  { source: id(205), target: id(207), label: "" },
];

const deploymentOriginal: DiagramGroupFixture = {
  key: "aws-gcp-deployment/original",
  title: "Multi-cloud checkout deployment",
  kind: "DEPLOYMENT",
  elements: DEPLOYMENT_ELEMENTS,
  flows: DEPLOYMENT_FLOWS,
  groups: [],
};

const deploymentGrouped: DiagramGroupFixture = {
  ...deploymentOriginal,
  key: "aws-gcp-deployment/grouped",
  groups: [
    {
      id: "aws",
      label: "AWS",
      meaning: "DEPLOYMENT_BOUNDARY",
      color: "orange",
      members: [],
    },
    {
      id: "aws-us-east-1",
      label: "us-east-1",
      meaning: "DEPLOYMENT_BOUNDARY",
      parentGroupId: "aws",
      color: "orange",
      members: [member(id(203)), member(id(204))],
    },
    {
      id: "gcp",
      label: "GCP",
      meaning: "DEPLOYMENT_BOUNDARY",
      color: "blue",
      members: [],
    },
    {
      id: "gcp-europe-west1",
      label: "europe-west1",
      meaning: "DEPLOYMENT_BOUNDARY",
      parentGroupId: "gcp",
      color: "blue",
      members: [member(id(205)), member(id(206))],
    },
    {
      id: "checkout-path",
      label: "Checkout request path",
      meaning: "VISUAL_ASSOCIATION",
      members: [member(id(201)), member(id(202))],
    },
  ],
};

export const DIAGRAM_GROUP_FIXTURE_PAIRS: readonly DiagramGroupFixturePair[] = [
  {
    key: "process-association",
    original: processOriginal,
    grouped: processGrouped,
  },
  {
    key: "aws-gcp-deployment",
    original: deploymentOriginal,
    grouped: deploymentGrouped,
  },
];

export const DIAGRAM_GROUP_FIXTURE_NODE_SIZE = 140;

export function diagramGroupFixtureLayoutInput(
  fixture: DiagramGroupFixture
): DiagramLayoutInput {
  const groups = buildDiagramLayoutGroupHints(
    fixture.groups,
    new Set(fixture.elements.map((element) => element.id))
  );
  return {
    nodes: fixture.elements.map((element) => ({
      id: element.id,
      title: element.title,
      width: DIAGRAM_GROUP_FIXTURE_NODE_SIZE,
      height: DIAGRAM_GROUP_FIXTURE_NODE_SIZE,
    })),
    edges: fixture.flows,
    ...(groups ? { groups } : {}),
  };
}

/** The persisted diagramGroups section value for a fixture. */
export const diagramGroupFixtureSection = (fixture: DiagramGroupFixture) =>
  serializeDiagramGroups(fixture.groups);
