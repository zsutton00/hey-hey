import type { WorkItemTypeDefinitionDto } from "@hey-hey/ui-common/api";

export type GuidanceDraft = WorkItemTypeDefinitionDto["agentGuidance"];
export type GuidanceExample = NonNullable<
  NonNullable<GuidanceDraft>["examples"]
>[number];
export type GuidanceContext = NonNullable<
  NonNullable<GuidanceDraft>["contexts"]
>[number];

export function moveGuidanceItem<T>(
  items: readonly T[],
  index: number,
  offset: number
): T[] {
  const result = [...items];
  const target = index + offset;
  if (
    index < 0 ||
    index >= items.length ||
    target < 0 ||
    target >= items.length
  )
    return result;
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}

export function applyGuidanceDraft(
  definition: WorkItemTypeDefinitionDto,
  guidance: GuidanceDraft
): WorkItemTypeDefinitionDto {
  const result = { ...definition };
  if (guidance === undefined) delete result.agentGuidance;
  else result.agentGuidance = guidance;
  return result;
}

export function isGuidanceValid(guidance: GuidanceDraft): boolean {
  const examplesValid = (examples: GuidanceExample[] | undefined) =>
    (examples ?? []).every(
      (example) => example.title.trim() && example.guidance.trim()
    );
  return (
    guidance === undefined ||
    Boolean(
      guidance.overview.trim() &&
        examplesValid(guidance.examples) &&
        (guidance.contexts ?? []).every(
          (context) =>
            context.guidance.trim() &&
            context.focalTypeKeys.length > 0 &&
            context.focalTypeKeys.every((key) => key.trim()) &&
            examplesValid(context.examples)
        )
    )
  );
}
