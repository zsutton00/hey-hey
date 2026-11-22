import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MessageReadMode } from '@hey-hey/contracts/api/models';
import {
  Args,
  Context,
  ID,
  Info,
  Int,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import type { ConversationStatus } from '@hey-hey/contracts/api/models';
import type {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
} from '../../types';
import type { GraphQLResolveInfo } from 'graphql';
import { ConversationService } from '../../services/conversation.service';
import { MessageService } from '../../services/message.service';
import type { GraphQLRequestContext } from '../graphql-request-context';
import { runAsViewer } from '../run-as-viewer';
import { selectedFieldNames } from '../selected-fields';
import { UseRestErrorCodes } from '../use-rest-error-codes.decorator';
import {
  ConversationNode,
  ConversationPage,
  MessageConnection,
  MessageNode,
} from './conversation.types';
import {
  ConversationListArgs,
  WorkflowConversationArgs,
  conversationFilters,
  wantsSuggestionDecisions,
} from './conversation.args';

/** The scope WebUiReadAccessMiddleware has already authorized. */
function authorizedScope({ req }: GraphQLRequestContext): {
  organizationId: OrganizationId;
  projectId: ProjectId;
} {
  return {
    organizationId: req.params.organizationId as OrganizationId,
    projectId: req.params.projectId as ProjectId,
  };
}

@Resolver(() => ConversationNode)
@UseRestErrorCodes()
export class ConversationResolver {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
  ) {}

  /** Same read as GET /conversations/:conversationId. */
  @Query(() => ConversationNode)
  async conversation(
    @Args('id', { type: () => ID }) id: ConversationId,
    @Context() context: GraphQLRequestContext,
    @Info() info: GraphQLResolveInfo,
  ): Promise<ConversationNode> {
    const { organizationId, projectId } = authorizedScope(context);

    const conversation =
      await this.conversationService.getConversationFromAdapter(
        projectId,
        id,
        organizationId,
        { includeSuggestionDecisions: wantsSuggestionDecisions(info) },
      );
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return conversation;
  }

  /** Same read as GET /conversations. */
  @Query(() => ConversationPage)
  async conversations(
    @Context() context: GraphQLRequestContext,
    @Info() info: GraphQLResolveInfo,
    @Args() filters: ConversationListArgs,
  ): Promise<ConversationPage> {
    const { organizationId, projectId } = authorizedScope(context);

    const { data, pagination } =
      await this.conversationService.getAllConversationsFromAdapter(
        projectId,
        organizationId,
        {
          ...conversationFilters(filters),
          status: (filters.statuses ?? undefined) as
            | ConversationStatus[]
            | undefined,
          includeSuggestionDecisions: wantsSuggestionDecisions(info, ['nodes']),
        },
      );

    return { nodes: data, pageInfo: pagination };
  }

  /** Same read as GET /conversations/active. */
  @Query(() => ConversationPage)
  async activeConversations(
    @Context() context: GraphQLRequestContext,
    @Info() info: GraphQLResolveInfo,
    @Args() filters: ConversationListArgs,
  ): Promise<ConversationPage> {
    const { organizationId, projectId } = authorizedScope(context);

    const { data, pagination } =
      await this.conversationService.getActiveConversationsFromAdapter(
        projectId,
        organizationId,
        {
          ...conversationFilters(filters),
          includeSuggestionDecisions: wantsSuggestionDecisions(info, ['nodes']),
        },
      );

    return { nodes: data, pageInfo: pagination };
  }

  /** Same read as GET /workflows/:workflowName/:workflowAboutId/conversations. */
  @Query(() => ConversationPage)
  async workflowConversations(
    @Context() context: GraphQLRequestContext,
    @Args('workflowName') workflowName: string,
    @Args('workflowAboutId') workflowAboutId: string,
    @Args() paging: WorkflowConversationArgs,
  ): Promise<ConversationPage> {
    const { organizationId, projectId } = authorizedScope(context);

    const { data, pagination } =
      await this.conversationService.getConversationsByWorkflowEntityFromAdapter(
        organizationId,
        projectId,
        workflowAboutId,
        workflowName,
        {
          page: paging.page ?? undefined,
          limit: paging.limit ?? undefined,
          sortBy: paging.sortBy as
            | 'createdAt'
            | 'updatedAt'
            | 'title'
            | undefined,
          sortOrder: paging.sortOrder as 'asc' | 'desc' | undefined,
          status: (paging.statuses ?? undefined) as
            | ConversationStatus[]
            | undefined,
        },
      );

    return { nodes: data, pageInfo: pagination };
  }

  /** Same read as GET /messages/:id; a message of another project is not found. */
  @Query(() => MessageNode)
  async message(
    @Args('id', { type: () => ID }) id: MessageId,
    @Context() context: GraphQLRequestContext,
    @Info() info: GraphQLResolveInfo,
  ): Promise<MessageNode> {
    const { organizationId, projectId } = authorizedScope(context);

    // REST returns replies with a message by default; load them when selected.
    const selected = selectedFieldNames(info);
    const message = await this.messageService.getMessageForAdapter(
      id,
      organizationId,
      selected.has('responses') || selected.has('parentMessage'),
    );
    if (!message || message.projectId !== projectId) {
      throw new NotFoundException('Message not found');
    }

    return message;
  }

  /** Same read as GET /conversations/:id/messages/latest. */
  @Query(() => MessageNode, { nullable: true })
  async latestMessage(
    @Args('conversationId', { type: () => ID }) conversationId: ConversationId,
    @Context() context: GraphQLRequestContext,
  ): Promise<MessageNode | null> {
    const { organizationId, projectId } = authorizedScope(context);

    const conversation =
      await this.conversationService.getConversationFromAdapter(
        projectId,
        conversationId,
        organizationId,
      );
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return this.messageService.getLatestMessage(conversationId, organizationId);
  }

  /**
   * Same read as GET /messages?conversationId=…: the whole thread in order,
   * only newer messages with `after` (`since`), or, with `last` / `before`, the
   * newest-first page of REVERSE_HISTORY mode (`limit` / `historyCursor`).
   * `after` cannot be combined with `last` / `before`. A cursor that is not
   * of this conversation is rejected as not found.
   */
  @ResolveField(() => MessageConnection)
  async messages(
    @Parent() conversation: ConversationNode,
    @Context() context: GraphQLRequestContext,
    @Info() info: GraphQLResolveInfo,
    @Args('after', { type: () => ID, nullable: true }) after?: MessageId | null,
    @Args('last', {
      type: () => Int,
      nullable: true,
      description:
        'Read the newest `last` messages (1-100, default 8) instead of the whole thread. `nodes` stay oldest first.',
    })
    last?: number | null,
    @Args('before', {
      type: () => ID,
      nullable: true,
      description:
        'Continuation cursor from a previous newest-first page (`startCursor`).',
    })
    before?: string | null,
  ): Promise<MessageConnection> {
    const selected = selectedFieldNames(info, ['nodes']);
    const organizationId = conversation.organizationId as OrganizationId;
    const projectId = conversation.projectId as ProjectId;
    // An explicit null argument means the same as an omitted one.
    const forwardCursor = after ?? undefined;
    const pageSize = last ?? undefined;
    const historyCursor = before ?? undefined;
    const newestFirst = pageSize !== undefined || historyCursor !== undefined;
    if (newestFirst && forwardCursor !== undefined) {
      throw new BadRequestException(
        '`after` cannot be combined with `last` or `before`',
      );
    }

    // Proposal eligibility is per viewer, and nested fields run outside the
    // root field's event context.
    const result = await runAsViewer(context, () =>
      this.messageService.getMessagesForAdapter(
        {
          conversationId: conversation.id as ConversationId,
          projectId,
          since: forwardCursor,
          ...(newestFirst && {
            mode: MessageReadMode.ReverseHistory,
            limit: pageSize,
            historyCursor,
          }),
        },
        organizationId,
        projectId,
        false,
        selected.has('proposals'),
        selected.has('reports'),
      ),
    );

    if (Array.isArray(result)) {
      const newest = result.at(-1);

      return {
        nodes: result,
        endCursor: newest?.id ?? forwardCursor ?? null,
        startCursor: null,
        hasOlder: null,
      };
    }

    return {
      nodes: result.messages,
      endCursor: result.messages.at(-1)?.id ?? null,
      startCursor: result.nextCursor ?? null,
      hasOlder: result.nextCursor !== undefined,
    };
  }
}
