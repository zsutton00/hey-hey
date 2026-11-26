import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Context, Tool } from '@rekog/mcp-nest';
import type { Request } from 'express';
import { z } from 'zod';
import type { WorkItemTypeDefinitionDto } from '@hey-hey/contracts/api/models';
import { WorkItemTypeEffectiveSource } from '@hey-hey/contracts/api/models';
import { ProposalService } from '../../services/proposal/proposal.service';
import { AdminGuard } from '../../auth/guards/admin.guard';
import {
  buildWorkItemTypeCreateProposal,
  buildWorkItemTypeEditProposal,
  buildWorkItemTypeRestoreProposal,
} from '../../services/proposal/work-item-type-proposal.builder';
import { assertWorkItemTypeEditSupported } from '../../services/proposal/work-item-type-edit-classifier';
import { WorkItemTypeLifecycleStatus } from '@hey-hey/contracts/api/models';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { IMAGE_SECTION_CONTENT_SCHEMA_REF } from '../../services/tasks/image-section-content.validator';
import { WORK_ITEM_TYPE_CAPABILITY_AXES } from '../../services/tasks/work-item-type-capabilities.schema';
import {
  WORK_ITEM_TYPE_PARENTAGE_GUIDANCE,
  workItemTypeDefinitionSchema,
} from '../../services/tasks/work-item-type-definition.schema';
import type { ProjectId } from '../../types';
import { extractAuthContext, isAuthContext, mcpError } from './mcp-tool.utils';
import { PROPOSAL_TOOL_NAMES } from './proposal-tool-names';
import { buildProvenanceEnvelope } from './provenance';
import { extractRequestorContext } from './requestor-context';
import { CREATE_WORK_ITEM_TYPE_TOOL_DESCRIPTION } from './work-item-type-review-contract';
import {
  invalidProposalChangeSetFromError,
  invalidProposalChangeSetOutputSchema,
} from './proposal-group-tool.schemas';

export { WORK_ITEM_TYPE_PARENTAGE_GUIDANCE };

// The definition fields are the shared work-item type definition check, so
// proposal validation and these tools accept exactly the same settings.
export const createWorkItemTypeParameters = z
  .object({
    ragEnabled: z.boolean().optional(),
    applicationEligible: z.boolean().optional(),
    ...workItemTypeDefinitionSchema.shape,
  })
  .strict();

export const CREATE_WORK_ITEM_TYPE_CAPABILITY_AXES =
  WORK_ITEM_TYPE_CAPABILITY_AXES;

export const CREATE_WORK_ITEM_TYPE_AUTHORING_AXES = Object.freeze(
  Object.keys(createWorkItemTypeParameters.shape),
);

export const editWorkItemTypeParameters = z
  .object({
    ragEnabled: z.boolean().optional(),
    applicationEligible: z.boolean().optional(),
    typeKey: z
      .string()
      .min(1)
      .describe(
        'Stable key of the active project-owned type to edit. This may be a ' +
          'canonical-seeded project override or a project-defined custom type.',
      ),
    definition: workItemTypeDefinitionSchema.describe(
      'Complete replacement definition submitted for bounded-edit classification.',
    ),
    acknowledgeCanonicalCustomization: z
      .boolean()
      .optional()
      .describe(
        'Must be true when editing a CANONICAL definition creates a project override.',
      ),
  })
  .strict();

export const createWorkItemTypeOutput = z.object({
  proposalId: z.string().describe('Persisted proposal ID'),
  action: z
    .string()
    .describe(
      'Proposal action (CREATE for both new definitions and retained-row ' +
        'restoration; targetEntityId distinguishes the two).',
    ),
  targetEntityType: z.string().describe('Target entity type (WORK_ITEM_TYPE)'),
  targetEntityId: z
    .string()
    .describe(
      'Nil UUID placeholder for a new CREATE proposal, or the retained ' +
        'work-item type key for a restoration CREATE proposal.',
    ),
  createdAt: z.string().describe('When the proposal was created'),
});

const createWorkItemTypeResultOutput = z.union([
  invalidProposalChangeSetOutputSchema,
  createWorkItemTypeOutput,
]);

type CreateWorkItemTypeOutput = z.infer<typeof createWorkItemTypeResultOutput>;

export const editWorkItemTypeOutput = z.object({
  proposalId: z.string().describe('Persisted proposal ID'),
  action: z.string().describe('Proposal action (UPDATE)'),
  targetEntityType: z.string().describe('Target entity type (WORK_ITEM_TYPE)'),
  targetEntityId: z
    .string()
    .describe('Stable work-item type key targeted by the UPDATE proposal.'),
  createdAt: z.string().describe('When the proposal was created'),
});

const editWorkItemTypeResultOutput = z.union([
  invalidProposalChangeSetOutputSchema,
  editWorkItemTypeOutput,
]);

type EditWorkItemTypeOutput = z.infer<typeof editWorkItemTypeResultOutput>;

export const EDIT_WORK_ITEM_TYPE_TOOL_DESCRIPTION =
  'After calling get_work_item_type, propose a bounded edit to an active ' +
  'project-owned work-item type (CANONICAL, CANONICAL_OVERRIDE, or PROJECT_CUSTOM). Submit ' +
  'the complete definition and preserve every unchanged definition axis for ' +
  'user review. For a canonical-seeded type, approval creates or updates a ' +
  'complete project override over the immutable global canonical definition; ' +
  'it does not mutate the global seed. ' +
  WORK_ITEM_TYPE_PARENTAGE_GUIDANCE;

@Injectable()
export class WorkItemTypeProposalToolsProvider {
  private readonly logger = new Logger(WorkItemTypeProposalToolsProvider.name);

  constructor(
    private readonly proposalService: ProposalService,
    private readonly adminGuard: AdminGuard,
    @Optional()
    private readonly workItemTypeRegistry?: WorkItemTypeRegistryService,
  ) {}

  @Tool({
    name: PROPOSAL_TOOL_NAMES.CREATE_WORK_ITEM_TYPE,
    description: CREATE_WORK_ITEM_TYPE_TOOL_DESCRIPTION,
    parameters: createWorkItemTypeParameters,
    outputSchema: createWorkItemTypeResultOutput,
  })
  async createWorkItemType(
    params: z.infer<typeof createWorkItemTypeParameters>,
    _context: Context,
    request: Request,
  ): Promise<CreateWorkItemTypeOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const conversationId = request.headers['x-conversation-id'] as
      | string
      | undefined;
    const projectId = request.headers['x-project-id'] as string | undefined;

    if (!projectId) {
      return mcpError(
        'Missing project context. Ensure X-Project-ID header is set.',
      );
    }

    // Apart from the two proposal settings, the validated params are the
    // definition that serializes into the proposal's `updates`.
    const { ragEnabled, applicationEligible, ...submitted } = params;
    const definition: WorkItemTypeDefinitionDto = submitted;

    if (
      !this.adminGuard.isPlatformAdmin({
        user: auth.user,
        socket: request.socket,
        headers: request.headers,
      }) &&
      definition.sections.some(
        (section) => section.schemaRef === IMAGE_SECTION_CONTENT_SCHEMA_REF,
      )
    ) {
      return mcpError('Image sections are restricted to platform admins.');
    }

    const requestorContext = extractRequestorContext(
      auth,
      request,
      PROPOSAL_TOOL_NAMES.CREATE_WORK_ITEM_TYPE,
      conversationId,
    );

    const provenance = buildProvenanceEnvelope(requestorContext, undefined);

    const retained = this.workItemTypeRegistry?.getDefinition(
      projectId,
      definition.key,
    );
    const dto =
      retained?.status === WorkItemTypeLifecycleStatus.Archived
        ? buildWorkItemTypeRestoreProposal({
            typeKey: definition.key,
            definition,
            requestorContext,
            influences: provenance.influences,
            conversationId,
          })
        : buildWorkItemTypeCreateProposal({
            definition,
            requestorContext,
            influences: provenance.influences,
            conversationId,
          });

    try {
      const proposal = await this.proposalService.create(
        auth.organizationId,
        projectId as ProjectId,
        auth.user.userId,
        { ...dto, ragEnabled, applicationEligible },
      );

      this.logger.log(
        `create_work_item_type proposal created: ${proposal.id} ` +
          `(type key ${definition.key}) for project ${projectId}`,
      );

      return {
        proposalId: proposal.id,
        action: proposal.action,
        targetEntityType: proposal.targetEntityType,
        targetEntityId: proposal.targetEntityId,
        createdAt: proposal.createdAt,
      };
    } catch (error: unknown) {
      const invalidChangeSet = invalidProposalChangeSetFromError(error);
      if (invalidChangeSet) return invalidChangeSet;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`create_work_item_type failed: ${message}`);
      return mcpError(message);
    }
  }

  @Tool({
    name: PROPOSAL_TOOL_NAMES.EDIT_WORK_ITEM_TYPE,
    description: EDIT_WORK_ITEM_TYPE_TOOL_DESCRIPTION,
    parameters: editWorkItemTypeParameters,
    outputSchema: editWorkItemTypeResultOutput,
  })
  async editWorkItemType(
    params: z.infer<typeof editWorkItemTypeParameters>,
    _context: Context,
    request: Request,
  ): Promise<EditWorkItemTypeOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    if (
      !this.adminGuard.isPlatformAdmin({
        user: auth.user,
        socket: request.socket,
        headers: request.headers,
      }) &&
      params.definition.sections.some(
        (section) => section.schemaRef === IMAGE_SECTION_CONTENT_SCHEMA_REF,
      )
    ) {
      return mcpError('Image sections are restricted to platform admins.');
    }

    const conversationId = request.headers['x-conversation-id'] as
      | string
      | undefined;
    const projectId = request.headers['x-project-id'] as string | undefined;

    if (!projectId) {
      return mcpError(
        'Missing project context. Ensure X-Project-ID header is set.',
      );
    }

    try {
      const existing = this.workItemTypeRegistry?.getDefinition(
        projectId,
        params.typeKey,
      );
      if (!existing) {
        throw new NotFoundException(
          `Work-item type '${params.typeKey}' is not available in this project.`,
        );
      }
      if (existing.projectId !== projectId) {
        throw new NotFoundException(
          `Work-item type '${params.typeKey}' is not available in this project.`,
        );
      }
      if (
        existing.effectiveSource === WorkItemTypeEffectiveSource.Canonical &&
        params.acknowledgeCanonicalCustomization !== true
      ) {
        throw new ForbiddenException(
          `Canonical customization acknowledgement is required for work-item type '${params.typeKey}'.`,
        );
      }
      if (
        existing.effectiveSource !== WorkItemTypeEffectiveSource.Canonical &&
        existing.effectiveSource !==
          WorkItemTypeEffectiveSource.ProjectCustom &&
        existing.effectiveSource !==
          WorkItemTypeEffectiveSource.CanonicalOverride
      ) {
        throw new ForbiddenException(
          `Work-item type '${params.typeKey}' cannot be edited by this tool.`,
        );
      }
      if (existing.status !== WorkItemTypeLifecycleStatus.Active) {
        throw new ForbiddenException(
          `Work-item type '${params.typeKey}' is not active in this project.`,
        );
      }

      assertWorkItemTypeEditSupported(existing, params.definition);

      const requestorContext = extractRequestorContext(
        auth,
        request,
        PROPOSAL_TOOL_NAMES.EDIT_WORK_ITEM_TYPE,
        conversationId,
      );
      const provenance = buildProvenanceEnvelope(requestorContext, undefined);
      const dto = buildWorkItemTypeEditProposal({
        typeKey: params.typeKey,
        definition: params.definition,
        currentDefinition: existing.definition,
        requestorContext,
        influences: provenance.influences,
        conversationId,
        acknowledgeCanonicalCustomization:
          params.acknowledgeCanonicalCustomization,
      });
      const proposal = await this.proposalService.create(
        auth.organizationId,
        projectId as ProjectId,
        auth.user.userId,
        {
          ...dto,
          ragEnabled: params.ragEnabled,
          applicationEligible: params.applicationEligible,
        },
      );

      this.logger.log(
        `edit_work_item_type proposal created: ${proposal.id} ` +
          `(type key ${params.typeKey}) for project ${projectId}`,
      );

      return {
        proposalId: proposal.id,
        action: proposal.action,
        targetEntityType: proposal.targetEntityType,
        targetEntityId: proposal.targetEntityId,
        createdAt: proposal.createdAt,
      };
    } catch (error: unknown) {
      const invalidChangeSet = invalidProposalChangeSetFromError(error);
      if (invalidChangeSet) return invalidChangeSet;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`edit_work_item_type failed: ${message}`);
      return mcpError(message);
    }
  }
}
