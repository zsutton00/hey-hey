import { renderCodingResearchMemo } from '../prompts/coding-research-memo';
/**
 * `create_coding_research` pass-through submission tool.
 *
 * Mounted exclusively on the `project_assistant` subagent. The agent calls
 * this tool to emit a CODING_RESEARCH report when its investigation is
 * complete. The wrapper:
 *
 * 1. Posts a CODING_RESEARCH report to the platform via the proxy.
 * 2. Appends a Run memo holding the research frame and analysis directly via
 *    `run.appendMemo`, so every subsequent phase's first-turn prompt carries
 *    the bootstrap context. The producer appends as the data exists — there is
 *    no end-of-phase lifecycle hook.
 *
 * Failure behavior: a platform-post failure throws before the memo is
 * appended, surfacing the inconsistency rather than silently swallowing it.
 */

import { z } from 'zod';
import type { Run } from '../../run/run';
import { CodingResearchReportPayloadReportTypeEnum } from '../../shared/api/generated/api';
import type {
  CodingResearchReadinessEvidence,
  CodingResearchProvenance,
  CodingResearchReportPayload,
  CodingResearchUpdate,
} from '../../shared/api/generated/api';
import {
  LocalAgentSearchEntityType,
  type LocalPromptType,
} from '../../shared/agent-bridge-contract/generated/api';
import type {
  LocalResearchUpdate,
  LocalResearchUpdateTarget,
} from '../../shared/agent-bridge-contract/runtime-types';
import { LocalResearchUpdateOperation } from '../../shared/agent-bridge-contract/runtime-types';
import type { CreateReportProxy } from './create-report-proxy';
import type { PassThroughSubmissionToolDeclaration, SubmissionToolExecuteContext } from './types';

export const CREATE_CODING_RESEARCH_TOOL_NAME = 'create_coding_research';

const codingResearchProvenanceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    discoveryCalls: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tool: { type: 'string' },
          query: { type: 'string' },
          intent: { type: 'string' },
        },
        required: ['tool', 'query', 'intent'],
      },
    },
    edgesTraversed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fromId: { type: 'string' },
          toId: { type: 'string' },
          reasoning: { type: 'string' },
        },
        required: ['fromId', 'toId', 'reasoning'],
      },
    },
  },
  required: ['discoveryCalls', 'edgesTraversed'],
} as const;

const codingResearchProvenanceValidator: z.ZodType<CodingResearchProvenance> = z
  .object({
    discoveryCalls: z.array(
      z
        .object({
          tool: z.string(),
          query: z.string(),
          intent: z.string(),
        })
        .strict(),
    ),
    edgesTraversed: z.array(
      z
        .object({
          fromId: z.string(),
          toId: z.string(),
          reasoning: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

const codingResearchUpdateTargetSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    entityType: {
      type: 'string',
      enum: Object.values(LocalAgentSearchEntityType),
    },
    entityId: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
  },
  required: ['entityType', 'entityId', 'title'],
} as const;

const codingResearchUpdateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: {
      type: 'string',
      enum: Object.values(LocalResearchUpdateOperation),
    },
    targets: {
      type: 'array',
      items: codingResearchUpdateTargetSchema,
    },
    description: { type: 'string', minLength: 1 },
    reason: { type: 'string', minLength: 1 },
  },
  required: ['type', 'targets', 'description', 'reason'],
} as const;

const codingResearchUpdateTargetValidator: z.ZodType<LocalResearchUpdateTarget> = z
  .object({
    entityType: z.nativeEnum(LocalAgentSearchEntityType),
    entityId: z.string().min(1),
    title: z.string().min(1),
  })
  .strict();

const codingResearchUpdatesValidator: z.ZodType<LocalResearchUpdate[]> = z.array(
  z
    .object({
      type: z.nativeEnum(LocalResearchUpdateOperation),
      targets: z.array(codingResearchUpdateTargetValidator),
      description: z.string().min(1),
      reason: z.string().min(1),
    })
    .strict(),
);

const codingResearchReadinessEvidenceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: {
      type: 'string',
      enum: ['behavior', 'data_lifecycle', 'authority', 'security', 'isolation', 'integration'],
    },
    statement: { type: 'string', minLength: 1 },
    sourceRef: { type: 'string', minLength: 1 },
  },
  required: ['category', 'statement'],
} as const;

const codingResearchReadinessEvidenceValidator = z
  .object({
    category: z.enum([
      'behavior',
      'data_lifecycle',
      'authority',
      'security',
      'isolation',
      'integration',
    ]),
    statement: z.string().min(1),
    sourceRef: z.string().min(1).optional(),
  })
  .strict()
  .transform(
    (value): CodingResearchReadinessEvidence =>
      value.sourceRef === undefined
        ? { category: value.category, statement: value.statement }
        : {
            category: value.category,
            statement: value.statement,
            sourceRef: value.sourceRef,
          },
  );

const codingResearchReadinessEvidenceValidatorArray = z
  .array(codingResearchReadinessEvidenceValidator)
  .max(8);

const CREATE_CODING_RESEARCH_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    frame: {
      type: 'object',
      description: 'The ResearchOutput frame adjacency list.',
    },
    analysis: {
      type: 'string',
      minLength: 1,
      description: 'User-facing markdown synthesis: what the graph implies for the focal task.',
    },
    summary: {
      type: 'string',
      minLength: 1,
      description: '50–100 word handoff to the coding agent summarising the key findings.',
    },
    provenance: {
      ...codingResearchProvenanceSchema,
      description: 'Audit trail: every discovery call made and every edge traversed.',
    },
    updates: {
      type: 'array',
      description: 'Required advisory reconciliation candidates; use [] when none were found.',
      items: codingResearchUpdateSchema,
    },
    readinessEvidence: {
      type: 'array',
      maxItems: 8,
      description:
        'Bounded evidence for consequential unresolved behavior, lifecycle, authority, security, isolation, or integration decisions. Use [] when none are evidenced.',
      items: codingResearchReadinessEvidenceSchema,
    },
  },
  required: ['frame', 'analysis', 'summary', 'provenance', 'updates', 'readinessEvidence'],
} as const;

export class CodingResearchTool implements PassThroughSubmissionToolDeclaration {
  public readonly kind = 'pass_through' as const;
  public readonly name = CREATE_CODING_RESEARCH_TOOL_NAME;
  public readonly description =
    'Record the CODING_RESEARCH output produced by the Project Assistant subagent. ' +
    'Call this exactly once at the end of the research turn with the completed `frame` ' +
    '(ResearchOutput adjacency list), `analysis` (synthesis prose), a 50–100 word ' +
    '`summary` handoff for the coding agent, and the required advisory `updates` array ' +
    '(use an empty array when no candidate was found).';
  public readonly inputSchema = CREATE_CODING_RESEARCH_INPUT_SCHEMA as unknown as Record<
    string,
    unknown
  >;
  private readonly now: () => string;

  public constructor(
    private readonly proxy: CreateReportProxy,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.now = now;
  }

  public readonly execute = async (ctx: SubmissionToolExecuteContext) => {
    const run = ctx.run;
    if (!run) {
      throw new Error('create_coding_research wrapper: ctx.run is required for pass-through tools');
    }

    const phase = run.session.promptType as LocalPromptType | undefined;
    if (!phase) {
      throw new Error(
        'create_coding_research wrapper: run.session.promptType is required to derive chain entry phase',
      );
    }

    const analysisRaw = ctx.args['analysis'];
    const summaryRaw = ctx.args['summary'];
    const frame = ctx.args['frame'];
    const provenance = ctx.args['provenance'];
    const updates = ctx.args['updates'];
    const readinessEvidence = ctx.args['readinessEvidence'];

    if (typeof analysisRaw !== 'string' || analysisRaw.length === 0) {
      throw new Error('create_coding_research wrapper: analysis must be a non-empty string');
    }
    if (typeof summaryRaw !== 'string' || summaryRaw.length === 0) {
      throw new Error('create_coding_research wrapper: summary must be a non-empty string');
    }

    const analysis: string = analysisRaw;
    const summary: string = summaryRaw;

    const parsedFrame = z.record(z.string(), z.unknown()).safeParse(frame);
    if (!parsedFrame.success) {
      throw new Error('create_coding_research wrapper: frame must be an object');
    }

    const parsedProvenance = codingResearchProvenanceValidator.safeParse(provenance);
    if (!parsedProvenance.success) {
      const issues = parsedProvenance.error.issues
        .map((issue) => `provenance.${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      throw new Error(`create_coding_research wrapper: provenance is invalid: ${issues}`);
    }

    const parsedUpdates = codingResearchUpdatesValidator.safeParse(updates);
    if (!parsedUpdates.success) {
      throw new Error(
        'create_coding_research wrapper: updates must be an array of typed advisory candidates',
      );
    }

    const parsedReadinessEvidence =
      codingResearchReadinessEvidenceValidatorArray.safeParse(readinessEvidence);
    if (!parsedReadinessEvidence.success) {
      throw new Error(
        'create_coding_research wrapper: readinessEvidence must be a bounded typed evidence array',
      );
    }

    const platformUpdates: CodingResearchUpdate[] = parsedUpdates.data.map((update) => ({
      ...update,
      targets: update.targets.map((target) => ({ ...target })),
    }));

    const reportPayload: CodingResearchReportPayload = {
      reportType: CodingResearchReportPayloadReportTypeEnum.CodingResearch,
      summary,
      frame: parsedFrame.data,
      analysis,
      provenance: parsedProvenance.data,
      updates: platformUpdates,
      readinessEvidence: parsedReadinessEvidence.data,
    };

    const platformArgs: Record<string, unknown> = {
      reportType: 'CODING_RESEARCH',
      audience: 'PROJECT_VISIBLE',
      payload: reportPayload,
    };

    const result = await this.proxy.create({
      runId: ctx.runId,
      args: platformArgs,
      conversationId: run.conversationId,
      projectId: run.projectId,
    });

    run.appendReportChainEntry({
      createdAt: this.now(),
      phase,
      reportId: result.reportId,
      reportType: 'CODING_RESEARCH',
      summary,
      audience: 'EXTERNAL',
    });

    // Carry the research frame and analysis forward as a Run memo so every
    // subsequent phase's first-turn prompt sees the bootstrap context. The
    // producer appends directly — there is no end-of-phase lifecycle hook.
    run.appendMemo({
      source: phase,
      content: renderCodingResearchMemo(reportPayload),
      writtenAt: this.now(),
    });

    return {
      content: [{ type: 'text', text: analysis }],
    };
  };
}
