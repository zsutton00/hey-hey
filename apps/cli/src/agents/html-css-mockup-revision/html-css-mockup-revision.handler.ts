import type {
  LocalHtmlCssMockupRevisionAnnotation,
  LocalHtmlCssMockupRevisionPromptPayload,
} from '../../shared/agent-bridge-contract/generated/api';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type {
  TaskResponseDto,
  WorkItemHtmlCssAnnotation,
  WorkItemHtmlCssSectionContent,
} from '../../shared/api/generated/api';
import type {
  PrepareResult,
  PromptTypeHandler,
  PromptTypeHandlerContext,
  PromptTypeHandlerDeps,
} from '../prompt-type-handler';
import type { AgenticSession } from '../../session/types';
import { buildHtmlCssMockupRevisionPrompt } from '../prompts/html-css-mockup-revision';

type EnrichedPayload = LocalHtmlCssMockupRevisionPromptPayload & { _taskId: string };

const stale = (reason: string): never => {
  throw new Error(`HTML/CSS mockup revision request is stale or invalid: ${reason}`);
};

const parseSectionContent = (materializedMarkdown: string): WorkItemHtmlCssSectionContent => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(materializedMarkdown);
  } catch {
    return stale('the authoritative section is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return stale('the authoritative section is not an HTML/CSS document');
  }
  const content = parsed as Partial<WorkItemHtmlCssSectionContent>;
  if (typeof content.html !== 'string' || typeof content.css !== 'string') {
    return stale('the authoritative section source is malformed');
  }
  return content as WorkItemHtmlCssSectionContent;
};

const targetMatches = (
  selected: LocalHtmlCssMockupRevisionAnnotation['target'],
  current: WorkItemHtmlCssAnnotation['target'],
): boolean => {
  if (selected.type !== current.type) return false;
  return selected.type === 'element'
    ? current.type === 'element' && selected.nodeId === current.nodeId
    : current.type === 'position' &&
        selected.x === current.x &&
        selected.y === current.y &&
        selected.sizeKey === current.sizeKey;
};

const assertSelectedAnnotationIsCurrent = (
  selected: LocalHtmlCssMockupRevisionAnnotation,
  current: WorkItemHtmlCssAnnotation | undefined,
  materializedProposalId: string,
  sizeKey: string,
): void => {
  if (!current) {
    throw new Error(
      `HTML/CSS mockup revision request is stale or invalid: annotation ${selected.id} no longer exists`,
    );
  }
  if (current.lifecycle !== 'open') stale(`annotation ${selected.id} is no longer open`);
  if (
    current.authoredProposalId !== materializedProposalId ||
    current.authoredSizeKey !== sizeKey
  ) {
    stale(`annotation ${selected.id} is no longer current`);
  }
  if (
    selected.lifecycle !== 'open' ||
    selected.note !== current.note ||
    selected.category !== current.category ||
    selected.authoredProposalId !== current.authoredProposalId ||
    selected.authoredSizeKey !== current.authoredSizeKey ||
    !targetMatches(selected.target, current.target)
  ) {
    stale(`annotation ${selected.id} no longer matches the authoritative record`);
  }
};

export const htmlCssMockupRevisionHandler: PromptTypeHandler<LocalHtmlCssMockupRevisionPromptPayload> =
  {
    id: 'html_css_mockup_revision',
    promptType: LocalPromptType.HtmlCssMockupRevision,
    service: 'required',
    launchEntity: 'none',
    implementationReadiness: 'gated',
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    providerSessionStart: 'fresh',
    providerSessionLifetime: 'turn',
    reports: [],
    eligibleWorkItemTypeKeys: ['STANDARD'],
    projectAssistant: {
      allowEdgeUpdates: false,
      notifyDiscrepancies: false,
      workItemProposalMode: 'none',
    },
    additionalAllowedTools: ['get_authoring_guidance', 'get_tool_guidance', 'edit_work_item'],

    async prepare(
      run: AgenticSession,
      payload: LocalHtmlCssMockupRevisionPromptPayload,
      _deps: PromptTypeHandlerDeps,
      ctx?: PromptTypeHandlerContext,
    ): Promise<PrepareResult<LocalHtmlCssMockupRevisionPromptPayload>> {
      const runEntity = run.entity;
      if (!runEntity || runEntity.entityType !== 'TASK') {
        throw new Error(
          'HTML/CSS mockup revision request is stale or invalid: the run is not bound to a task',
        );
      }
      const loaded = ctx?.loadedEntityContext;
      if (!loaded || loaded.kind !== 'entity') {
        throw new Error(
          'HTML/CSS mockup revision request is stale or invalid: fresh authoritative task context is missing',
        );
      }
      if (
        loaded.focalEntity.entityType !== 'TASK' ||
        loaded.focalEntity.entityId !== runEntity.entityId
      ) {
        stale('the loaded task does not match the persisted run identity');
      }
      const task = loaded.entity as TaskResponseDto;
      if (task.id !== runEntity.entityId || task.type !== 'STANDARD') {
        stale('the authoritative focal task does not match the revision run');
      }

      const section = task.sections?.find((candidate) => candidate.key === payload.section.key);
      if (!section) {
        throw new Error(
          `HTML/CSS mockup revision request is stale or invalid: section ${payload.section.key} no longer exists`,
        );
      }
      const content = parseSectionContent(section.materializedMarkdown);
      if (
        content.html !== payload.section.html ||
        content.css !== payload.section.css ||
        content.sizeKey !== payload.section.sizeKey ||
        section.materializedProposalId !== payload.section.materializedProposalId
      ) {
        stale('the authoritative section source or materialized provenance changed');
      }

      const currentById = new Map((content.annotations ?? []).map((item) => [item.id, item]));
      const selectedIds = new Set<string>();
      for (const annotation of payload.annotations) {
        if (selectedIds.has(annotation.id)) stale(`annotation ${annotation.id} was selected twice`);
        selectedIds.add(annotation.id);
        assertSelectedAnnotationIsCurrent(
          annotation,
          currentById.get(annotation.id),
          section.materializedProposalId,
          payload.section.sizeKey,
        );
      }

      return { payload: { ...payload, _taskId: task.id } as EnrichedPayload };
    },

    buildPrompt(payload: LocalHtmlCssMockupRevisionPromptPayload): string {
      const enriched = payload as EnrichedPayload;
      if (!enriched._taskId) stale('validated focal task identity is missing');
      const { _taskId, ...validatedPayload } = enriched;
      return buildHtmlCssMockupRevisionPrompt({ taskId: _taskId, payload: validatedPayload });
    },

    buildStartingMessage(): string | null {
      return 'Preparing the selected mockup feedback for revision...';
    },
  };
