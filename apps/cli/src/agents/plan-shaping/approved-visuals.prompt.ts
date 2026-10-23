import type { PlanShapingApprovedVisual } from '../../shared/agent-bridge-contract/generated/api';

const MENTION_TYPE: Record<PlanShapingApprovedVisual['entityType'], string> = {
  MOCKUP: 'mockup',
  DIAGRAM: 'diagram',
};

/**
 * The one approved-visuals block every plan-shaping prompt after visual approval renders, so
 * each agent gets the same references with the same binding instruction.
 */
export const renderApprovedVisualsBlock = (
  visuals: readonly PlanShapingApprovedVisual[],
): string | null => {
  if (visuals.length === 0) return null;
  const entries = visuals
    .map((visual) => {
      const mention = `@[${MENTION_TYPE[visual.entityType]}:${visual.entityId}|${visual.title}]`;
      return visual.summary ? `- ${mention} — ${visual.summary}` : `- ${mention}`;
    })
    .join('\n');
  return `## Approved visuals (binding)

The user explicitly approved these Mockups and Diagrams. Together with the design doc they are the decided shape of this work: the tasks you plan must implement what they show. Whenever a visual touches the portion you are planning, load the full item (\`get_full_entity\` for a Mockup, \`get_diagram\` for a Diagram) before planning it. Do not create, revise, approve, reject or re-present visual proposals in this phase.

${entries}`;
};
