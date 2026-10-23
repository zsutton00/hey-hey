import { z } from 'zod';

import { DEFAULT_JEV_MODEL } from '../../jev/client';
import {
  DEFAULT_WORDING,
  JEV_CUTOFFS,
  PARENT_REQUIREMENTS,
  judge,
  tierOf,
  type Candidate,
  type Focal,
  type JevEvaluator,
} from '../../jev/scenarios';
import { RunEntityReferenceEntityTypeEnum as RunEntityType } from '../../shared/agent-bridge-contract/generated/api';
import type { MaterializedWorkItemSection } from '../../shared/api/generated';
import { firstSentence } from '../context-trimming/get-context-result';
import type { EntityContextLoader } from '../entity-context/entity-context-loader';
import type { LoadedEntityPromptContext } from '../entity-context/types';
import type { NearestParentFeatureRequest } from './nearest-parent-feature';

/** What the filter needs to ask Jev and to read the parent's structured requirements. */
export interface ParentRequirementsFilter {
  jevClient: JevEvaluator;
  entityContextLoader: Pick<EntityContextLoader, 'load'>;
  /** Read on every Project Assistant prepare so a change applies to the next run. */
  isEnabled: () => Promise<boolean>;
  /** Where each attempt's full Jev input and output, and the loads before and after, are written. */
  attemptLogDir: string;
  model?: string;
}

export interface FilteredParentRequirements {
  /** The requirements section body: relevant requirements in full, the rest as title lines. */
  requirementsMarkdown: string;
  fullCount: number;
  titleCount: number;
  jevCalled: boolean;
  jevDurationMs: number;
  inputTokens: number;
  outputTokens: number;
}

export const REQUIREMENTS_SECTION_KEY = 'requirements';

const recordSchema = z
  .object({
    id: z.string().min(1),
    statement: z.string(),
    fulfilledBy: z.array(
      z.object({ entityId: z.string(), entityType: z.string(), entityTitle: z.string() }),
    ),
  })
  .passthrough();
const recordsSchema = z.array(recordSchema);

type RequirementRecord = z.infer<typeof recordSchema>;

/** Why the starting load stays unfiltered; never carries entity content. */
export class ParentRequirementsUnfiltered extends Error {
  public constructor(
    public readonly reason: string,
    public readonly fields: Record<string, unknown> = {},
  ) {
    super(reason);
    this.name = 'ParentRequirementsUnfiltered';
  }
}

/** Reasons that are a normal outcome of the focal's type, not a failure; logged at info. */
export const EXPECTED_UNFILTERED_REASONS: ReadonlySet<string> = new Set(['focal_not_a_task']);

const sectionText = (sections: readonly MaterializedWorkItemSection[], key: string): string =>
  sections.find((section) => section.key === key)?.materializedMarkdown.trim() ?? '';

/** Only plain work (tasks, bugs, ...) is judged here; features, mockups and diagrams are not. */
const NON_TASK_TYPES: ReadonlySet<string> = new Set(['FEATURE', 'mockup', 'DIAGRAM']);

const taskFocalOf = (
  loaded: LoadedEntityPromptContext,
  parent: { name: string; sections: readonly MaterializedWorkItemSection[] },
): Focal => {
  if (loaded.kind !== 'entity' || !('type' in loaded.entity) || !('sections' in loaded.entity)) {
    throw new ParentRequirementsUnfiltered('focal_not_a_work_item');
  }
  const { entity } = loaded;
  if (NON_TASK_TYPES.has(entity.type)) {
    throw new ParentRequirementsUnfiltered('focal_not_a_task', { focalType: entity.type });
  }
  const sections = entity.sections ?? [];
  return {
    kind: 'task',
    name: entity.name,
    description: sectionText(sections, 'description'),
    acceptanceCriteria: sectionText(sections, 'acceptanceCriteria'),
    parent: {
      kind: 'feature',
      name: parent.name,
      description: [...parent.sections]
        .sort((a, b) => a.order - b.order)
        .map((section) => section.materializedMarkdown.trim())
        .filter((markdown) => markdown.length > 0)
        .join('\n\n'),
    },
  };
};

const readRecords = async (
  request: NearestParentFeatureRequest,
  parentId: string,
  filter: ParentRequirementsFilter,
): Promise<RequirementRecord[]> => {
  const loaded = await filter.entityContextLoader.load({
    runEntity: { entityType: RunEntityType.Task, entityId: parentId },
    organizationId: request.organizationId,
    projectId: request.projectId,
  });
  const parsed = recordsSchema.safeParse(loaded.context.content?.requirementsSection?.records);
  if (!parsed.success) throw new ParentRequirementsUnfiltered('requirements_malformed');
  return parsed.data;
};

const renderFull = (record: RequirementRecord): string => {
  const citations = record.fulfilledBy.map(
    (citation) => `@[${citation.entityType}:${citation.entityId}|${citation.entityTitle}]`,
  );
  const fulfilled = citations.length > 0 ? ` (fulfilled by ${citations.join(', ')})` : '';
  return `- ${record.statement.trim()}${fulfilled}`;
};

const renderTitle = (record: RequirementRecord): string => `- ${firstSentence(record.statement)}`;

/**
 * The parent's requirements with only the ones relevant to the focal task in full. A
 * requirement the focal task fulfils is relevant by the graph and never goes to Jev.
 * Whatever prevents the judgment throws; the caller keeps the unfiltered load.
 */
export const filterParentRequirements = async (
  request: NearestParentFeatureRequest,
  parent: { id: string; name: string; sections: readonly MaterializedWorkItemSection[] },
  loaded: LoadedEntityPromptContext,
  filter: ParentRequirementsFilter,
): Promise<FilteredParentRequirements> => {
  const focal = taskFocalOf(loaded, parent);
  const focalEntityId = loaded.focalEntity.entityId;
  const records = await readRecords(request, parent.id, filter);
  if (records.length === 0) throw new ParentRequirementsUnfiltered('no_requirements');

  const candidates: Candidate[] = [];
  const full = new Set<number>();
  records.forEach((record, position) => {
    if (record.fulfilledBy.some((citation) => citation.entityId === focalEntityId)) {
      full.add(position);
      return;
    }
    candidates.push({
      id: `requirement:${String(position)}`,
      kind: 'requirement',
      text: record.statement,
    });
  });

  let jevDurationMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  if (candidates.length > 0) {
    const judged = await judge(
      filter.jevClient,
      filter.model ?? DEFAULT_JEV_MODEL,
      PARENT_REQUIREMENTS,
      focal,
      candidates,
      DEFAULT_WORDING,
    );
    if (!judged.ok) {
      throw new ParentRequirementsUnfiltered('jev_failed', {
        failureCode: judged.failure.code,
        ...(judged.failure.providerStatus !== undefined
          ? { providerStatus: judged.failure.providerStatus }
          : {}),
        ...(judged.failure.errorDetail !== undefined
          ? { errorDetail: judged.failure.errorDetail }
          : {}),
      });
    }
    jevDurationMs = judged.durationMs;
    inputTokens = judged.usage.inputTokens;
    outputTokens = judged.usage.outputTokens;
    for (const judgment of judged.judgments) {
      if (tierOf(judgment, JEV_CUTOFFS) === 'full') {
        full.add(Number(judgment.id.slice('requirement:'.length)));
      }
    }
  }

  const lines = records.map((record, position) =>
    full.has(position) ? renderFull(record) : renderTitle(record),
  );
  const titleCount = records.length - full.size;
  const note =
    titleCount > 0
      ? `Requirements not shown in full are listed by title; read the feature itself for their full text.\n\n`
      : '';
  return {
    requirementsMarkdown: `${note}${lines.join('\n')}`,
    fullCount: full.size,
    titleCount,
    jevCalled: candidates.length > 0,
    jevDurationMs,
    inputTokens,
    outputTokens,
  };
};
