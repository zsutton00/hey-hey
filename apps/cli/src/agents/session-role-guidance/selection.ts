import { z } from 'zod';

export const referenceSchema = z.object({ id: z.string().min(1), type: z.string().min(1) });
export type GuidanceReference = z.infer<typeof referenceSchema>;
export interface SelectedReference extends GuidanceReference {
  sources: string[];
}
export interface ResearchFrame {
  nodes: GuidanceReference[];
  issues?: string[];
}
export const researchFrameSchema = z
  .object({ nodes: z.array(z.unknown()) })
  .transform(({ nodes }): ResearchFrame => {
    const references: GuidanceReference[] = [];
    const issues: string[] = [];
    nodes.forEach((node, index) => {
      const parsed = referenceSchema.safeParse(node);
      if (parsed.success) references.push(parsed.data);
      else issues.push(`Research-frame entry ${index + 1} has no resolvable identity`);
    });
    return issues.length ? { nodes: references, issues } : { nodes: references };
  })
  .catch({ nodes: [], issues: ['Invalid research-frame shape'] });

export const parseGuidanceMentions = (text: string): GuidanceReference[] =>
  Array.from(
    text.matchAll(
      /@\[([\w-]+):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|[^\]\n]+\]/giu,
    ),
    (match) => ({ type: match[1]!, id: match[2]! }),
  );

export const selectGuidanceReferences = (input: {
  focal?: GuidanceReference | null;
  frame?: ResearchFrame;
  fallback?: GuidanceReference[];
  approvedPlan?: string;
  userMessages?: readonly string[];
}): SelectedReference[] => {
  const selected = new Map<string, SelectedReference>();
  const add = (ref: GuidanceReference, source: string): void => {
    // TASK-backed aliases share identity; do not trust their spelling as a type.
    const key = ref.id;
    const previous = selected.get(key);
    if (previous) {
      if (!previous.sources.includes(source)) previous.sources.push(source);
    } else selected.set(key, { id: ref.id, type: ref.type, sources: [source] });
  };
  if (input.focal) add(input.focal, 'focal');
  if (input.frame !== undefined) input.frame.nodes.forEach((ref) => add(ref, 'research-frame'));
  else input.fallback?.forEach((ref) => add(ref, 'task-parent-context'));
  parseGuidanceMentions(input.approvedPlan ?? '').forEach((ref) => add(ref, 'approved-plan'));
  input.userMessages?.forEach((text) =>
    parseGuidanceMentions(text).forEach((ref) => add(ref, 'user-message')),
  );
  return [...selected.values()];
};

// Only the producer's frame block is selection input, never the surrounding analysis.
export const readMemoResearchFrame = (
  content: string,
): z.infer<typeof researchFrameSchema> | undefined => {
  const json = /^## Research frame\n```json\n([\s\S]*?)\n```/u.exec(content)?.[1];
  if (json === undefined) return undefined;
  try {
    return researchFrameSchema.parse(JSON.parse(json));
  } catch {
    return { nodes: [], issues: ['Invalid research-frame JSON'] };
  }
};
