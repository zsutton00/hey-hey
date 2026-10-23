import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Injectable, Logger } from '@nestjs/common';
import { Context, Tool } from '@rekog/mcp-nest';
import type { Request } from 'express';
import { z } from 'zod';
import type {
  ProposalGroupAuthoringSnapshot,
  ProposalGroupFinalizationResult,
} from '../../generated';
import type { ConversationId } from '../../types';
import { ProposalGroupAuthoringService } from '../../services/proposal/proposal-group-authoring.service';
import { ProposalGroupFinalizationService } from '../../services/proposal/proposal-group-finalization.service';
import { ProposalGroupService } from '../../services/proposal/proposal-group.service';
import {
  extractAuthContext,
  isAuthContext,
  isProjectId,
  mcpError,
  resolveProjectId,
} from './mcp-tool.utils';
import {
  proposalGroupAuthoringSnapshotSchema,
  proposalGroupContextSchema,
} from './proposal-group-tool.schemas';
import { PROPOSAL_GROUP_TOOL_NAMES } from './proposal-tool-names';
import { lintFindingSchema } from './proposal-lint';
import { validateAuthoringRootProof } from './authoring-guidance';

const authoringRootProofField = z
  .string()
  .optional()
  .describe(
    'Reusable proof returned by get_authoring_guidance(). Required for this proposal-group authoring mutation.',
  );

const startParameters = z
  .object({
    authoringRootProof: authoringRootProofField,
    originatingConversationId: z.string().uuid().optional(),
  })
  .strict();

const snapshotParameters = z
  .object({
    groupId: z.string().uuid(),
  })
  .strict();

const replacePrerequisitesParameters = z
  .object({
    authoringRootProof: authoringRootProofField,
    groupContext: proposalGroupContextSchema,
    memberId: z.string().uuid(),
    prerequisiteMemberIds: z
      .array(z.string().uuid())
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'prerequisiteMemberIds must contain unique values',
      }),
  })
  .strict();

const removeMemberParameters = z
  .object({
    authoringRootProof: authoringRootProofField,
    groupContext: proposalGroupContextSchema,
    memberId: z.string().uuid(),
  })
  .strict();

const validationIssueSchema = z.object({
  code: z.string(),
  location: z.string(),
  memberId: z.string().uuid().nullable().optional(),
  message: z.string(),
});

const frozenGroupSchema = z
  .object({
    groupId: z.string().uuid(),
    lifecycle: z.string(),
    currentRevision: z.number().int().min(0),
  })
  .passthrough();

const finalizeOutput = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('VALIDATION_FAILED'),
    authoringSnapshot: proposalGroupAuthoringSnapshotSchema,
    issues: z.array(validationIssueSchema).min(1),
  }),
  z.object({
    outcome: z.literal('FINALIZED'),
    group: frozenGroupSchema,
    lintFindings: z
      .array(lintFindingSchema)
      .describe('Advisory topology warnings; finalization remains successful.'),
  }),
]);

const finalizeParameters = z
  .object({
    authoringRootProof: authoringRootProofField,
    groupContext: proposalGroupContextSchema,
  })
  .strict();

@Injectable()
export class ProposalGroupToolsProvider {
  private readonly logger = new Logger(ProposalGroupToolsProvider.name);

  constructor(
    private readonly authoringService: ProposalGroupAuthoringService,
    private readonly finalizationService: ProposalGroupFinalizationService,
    private readonly proposalGroupService: ProposalGroupService,
  ) {}

  @Tool({
    name: PROPOSAL_GROUP_TOOL_NAMES.START,
    description:
      'Start one explicit hidden BUILDING proposal group. Returns the stable group identity and persisted empty authoring snapshot. For the first grouped mutation, pass the returned currentRevision as groupContext.expectedRevision. Membership is never inferred.',
    parameters: startParameters,
    outputSchema: proposalGroupAuthoringSnapshotSchema,
  })
  async start(
    params: z.infer<typeof startParameters>,
    _context: Context,
    request: Request,
  ): Promise<ProposalGroupAuthoringSnapshot | CallToolResult> {
    const scope = this.resolveScope(request);
    if ('content' in scope) return scope;

    const rootProofError = validateAuthoringRootProof({
      toolName: PROPOSAL_GROUP_TOOL_NAMES.START,
      token: params.authoringRootProof,
      required: true,
    });
    if (rootProofError) return mcpError(rootProofError);

    const conversationId = request.headers['x-conversation-id'];
    if (
      params.originatingConversationId !== undefined &&
      params.originatingConversationId !== conversationId
    ) {
      return mcpError(
        'originatingConversationId must match the authenticated MCP conversation context.',
      );
    }

    try {
      const snapshot = await this.authoringService.start(
        scope.auth.organizationId,
        scope.projectId,
        {
          originatingConversationId: params.originatingConversationId as
            | ConversationId
            | undefined,
        },
      );
      this.logger.log('MCP started explicit proposal-group authoring', {
        organizationId: scope.auth.organizationId,
        projectId: scope.projectId,
        groupId: snapshot.groupId,
        revision: snapshot.currentRevision,
      });
      return snapshot as ProposalGroupAuthoringSnapshot;
    } catch (error) {
      return this.toError(PROPOSAL_GROUP_TOOL_NAMES.START, error);
    }
  }

  @Tool({
    name: PROPOSAL_GROUP_TOOL_NAMES.GET_AUTHORING_SNAPSHOT,
    description:
      'Read the persisted BUILDING authoring snapshot for one explicitly identified proposal group. Call this after drafting and dependency changes and immediately before finalization, then pass its currentRevision as groupContext.expectedRevision.',
    parameters: snapshotParameters,
    outputSchema: proposalGroupAuthoringSnapshotSchema,
  })
  async getAuthoringSnapshot(
    params: z.infer<typeof snapshotParameters>,
    _context: Context,
    request: Request,
  ): Promise<ProposalGroupAuthoringSnapshot | CallToolResult> {
    const scope = this.resolveScope(request);
    if ('content' in scope) return scope;

    try {
      const snapshot = await this.proposalGroupService.findCanonical(
        scope.auth.organizationId,
        scope.projectId,
        params.groupId,
      );
      if (snapshot.lifecycle !== 'BUILDING') {
        return mcpError(
          'Proposal group authoring is frozen; start a new group for a changed mutation set.',
        );
      }
      this.logger.debug('MCP read persisted proposal-group authoring state', {
        organizationId: scope.auth.organizationId,
        projectId: scope.projectId,
        groupId: params.groupId,
        revision: snapshot.currentRevision,
        memberCount: snapshot.members.length,
      });
      return snapshot as ProposalGroupAuthoringSnapshot;
    } catch (error) {
      return this.toError(
        PROPOSAL_GROUP_TOOL_NAMES.GET_AUTHORING_SNAPSHOT,
        error,
      );
    }
  }

  @Tool({
    name: PROPOSAL_GROUP_TOOL_NAMES.REPLACE_PREREQUISITES,
    description:
      "Replace one member's complete all-of prerequisite set. Pass the latest snapshot currentRevision as groupContext.expectedRevision; prerequisites must be members of that same group.",
    parameters: replacePrerequisitesParameters,
    outputSchema: proposalGroupAuthoringSnapshotSchema,
  })
  async replacePrerequisites(
    params: z.infer<typeof replacePrerequisitesParameters>,
    _context: Context,
    request: Request,
  ): Promise<ProposalGroupAuthoringSnapshot | CallToolResult> {
    const scope = this.resolveScope(request);
    if ('content' in scope) return scope;

    const rootProofError = validateAuthoringRootProof({
      toolName: PROPOSAL_GROUP_TOOL_NAMES.REPLACE_PREREQUISITES,
      token: params.authoringRootProof,
      required: true,
    });
    if (rootProofError) return mcpError(rootProofError);

    try {
      const snapshot = await this.authoringService.replacePrerequisites(
        scope.auth.organizationId,
        scope.projectId,
        params.groupContext.groupId,
        params.memberId,
        {
          expectedRevision: params.groupContext.expectedRevision,
          prerequisiteMemberIds:
            params.prerequisiteMemberIds as unknown as Set<string>,
        },
      );
      this.logMutation(
        PROPOSAL_GROUP_TOOL_NAMES.REPLACE_PREREQUISITES,
        scope,
        params.groupContext,
        snapshot,
        params.memberId,
      );
      return snapshot;
    } catch (error) {
      return this.toError(
        PROPOSAL_GROUP_TOOL_NAMES.REPLACE_PREREQUISITES,
        error,
      );
    }
  }

  @Tool({
    name: PROPOSAL_GROUP_TOOL_NAMES.REMOVE_MEMBER,
    description:
      'Remove one persisted member from an explicitly identified BUILDING group. Pass the latest snapshot currentRevision as groupContext.expectedRevision.',
    parameters: removeMemberParameters,
    outputSchema: proposalGroupAuthoringSnapshotSchema,
  })
  async removeMember(
    params: z.infer<typeof removeMemberParameters>,
    _context: Context,
    request: Request,
  ): Promise<ProposalGroupAuthoringSnapshot | CallToolResult> {
    const scope = this.resolveScope(request);
    if ('content' in scope) return scope;

    const rootProofError = validateAuthoringRootProof({
      toolName: PROPOSAL_GROUP_TOOL_NAMES.REMOVE_MEMBER,
      token: params.authoringRootProof,
      required: true,
    });
    if (rootProofError) return mcpError(rootProofError);

    try {
      const snapshot = await this.authoringService.removeMember(
        scope.auth.organizationId,
        scope.projectId,
        params.groupContext.groupId,
        params.memberId,
        { expectedRevision: params.groupContext.expectedRevision },
      );
      this.logMutation(
        PROPOSAL_GROUP_TOOL_NAMES.REMOVE_MEMBER,
        scope,
        params.groupContext,
        snapshot,
        params.memberId,
      );
      return snapshot;
    } catch (error) {
      return this.toError(PROPOSAL_GROUP_TOOL_NAMES.REMOVE_MEMBER, error);
    }
  }

  @Tool({
    name: PROPOSAL_GROUP_TOOL_NAMES.FINALIZE,
    description:
      'Validate and atomically freeze the explicitly identified persisted BUILDING revision for review. Pass the immediately preceding authoring snapshot currentRevision as groupContext.expectedRevision. Validation failures return every field-addressable issue and leave the group hidden and mutable.',
    parameters: finalizeParameters,
    outputSchema: finalizeOutput,
  })
  async finalize(
    params: z.infer<typeof finalizeParameters>,
    _context: Context,
    request: Request,
  ): Promise<ProposalGroupFinalizationResult | CallToolResult> {
    const scope = this.resolveScope(request);
    if ('content' in scope) return scope;

    const rootProofError = validateAuthoringRootProof({
      toolName: PROPOSAL_GROUP_TOOL_NAMES.FINALIZE,
      token: params.authoringRootProof,
      required: true,
    });
    if (rootProofError) return mcpError(rootProofError);

    try {
      const result = await this.finalizationService.finalize(
        scope.auth.organizationId,
        scope.projectId,
        params.groupContext.groupId,
        scope.auth.user,
        { expectedRevision: params.groupContext.expectedRevision },
      );
      this.logger.log('MCP finalized explicit proposal group', {
        organizationId: scope.auth.organizationId,
        projectId: scope.projectId,
        groupId: params.groupContext.groupId,
        expectedRevision: params.groupContext.expectedRevision,
        outcome: result.outcome,
        issueCount:
          result.outcome === 'VALIDATION_FAILED' ? result.issues.length : 0,
      });
      if (result.outcome === 'FINALIZED') {
        return {
          ...result,
          lintFindings: [
            ...(this.finalizationService.takeFrozenTopologyLintFindings?.(
              params.groupContext.groupId,
              result.group.currentRevision,
            ) ?? []),
          ],
        };
      }
      return result;
    } catch (error) {
      return this.toError(PROPOSAL_GROUP_TOOL_NAMES.FINALIZE, error);
    }
  }

  private resolveScope(request: Request) {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;
    const projectId = resolveProjectId({}, request);
    if (!isProjectId(projectId)) return projectId;
    return { auth, projectId };
  }

  private logMutation(
    tool: string,
    scope: Exclude<
      ReturnType<ProposalGroupToolsProvider['resolveScope']>,
      CallToolResult
    >,
    input: z.infer<typeof proposalGroupContextSchema>,
    snapshot: ProposalGroupAuthoringSnapshot,
    memberId: string,
  ): void {
    this.logger.log('MCP persisted proposal-group authoring mutation', {
      tool,
      organizationId: scope.auth.organizationId,
      projectId: scope.projectId,
      groupId: input.groupId,
      memberId,
      expectedRevision: input.expectedRevision,
      returnedRevision: snapshot.currentRevision,
    });
  }

  private toError(tool: string, error: unknown): CallToolResult {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`MCP ${tool} failed: ${message}`);
    return mcpError(message);
  }
}
