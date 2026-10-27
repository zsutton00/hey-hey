/** Scenarios for evaluating authored Diagram Element references and links. */
export const mockupCases = [
  {
    name: 'screen',
    prompt:
      'A flow of screens includes Checkout page. The existing Checkout page Mockup depicts this screen.',
    target: 'checkout-mockup',
    relation: 'reference',
  },
  {
    name: 'action',
    prompt:
      'A flow of actions includes Submit checkout. The existing Checkout page Mockup depicts its submit control.',
    target: 'checkout-mockup',
    relation: 'link',
  },
  {
    name: 'ambiguous',
    prompt:
      'An element named Checkout is supported by the Checkout page Mockup, but the Diagram does not establish whether it means the screen or the action.',
    target: 'checkout-mockup',
    relation: 'link',
  },
  {
    name: 'same-round',
    prompt:
      'A flow of screens includes Checkout page. Its Mockup is a same-round proposal and does not yet exist as a work item.',
    target: 'checkout-proposal',
    relation: 'proposal',
  },
  {
    name: 'near-miss',
    prompt:
      'An element Submit checkout has only a Checkout analytics dashboard Mockup candidate; the title shares a word but there is no evidence of a relationship.',
    target: 'analytics-mockup',
    relation: 'none',
  },
] as const;

type Element = {
  sections?: Array<{
    key: string;
    content: { canonicalReference?: { entityType: string; entityId: string } | null };
  }>;
  edges?: Array<{
    edgeType: string;
    targetEntityType: string;
    targetEntityId?: string;
  }>;
};

/** Judge actual authored element fields, including target identity, not its explanation. */
export function matchesMockupCase(
  testCase: (typeof mockupCases)[number],
  element: Element,
): boolean {
  const reference = element.sections?.find((section) => section.key === 'diagramElementMetadata')
    ?.content.canonicalReference;
  const links = element.edges ?? [];
  if (testCase.relation === 'reference')
    return (
      reference?.entityType === 'TASK' &&
      reference.entityId === testCase.target &&
      links.length === 0
    );
  if (testCase.relation === 'none') return !reference && links.length === 0;
  const link = links[0];
  return (
    !reference &&
    links.length === 1 &&
    link !== undefined &&
    link.edgeType === 'RELATED_TO' &&
    (testCase.relation === 'proposal'
      ? link.targetEntityType === 'PROPOSAL' && link.targetEntityId === testCase.target
      : link.targetEntityType === 'TASK' && link.targetEntityId === testCase.target)
  );
}
