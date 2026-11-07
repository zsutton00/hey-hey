import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
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
import { selectedFieldNames } from '../selected-fields';
import { UseRestErrorCodes } from '../use-rest-error-codes.decorator';
import {
  ConversationNode,
  ConversationPage,
  MessageConnection,
} from './conversation.types';

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
  ): Promise<ConversationNode> {
    const { organizationId, projectId } = authorizedScope(context);

    const conversation =
      await this.conversationService.getConversationFromAdapter(
        projectId,
        id,
        organizationId,
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
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
  ): Promise<ConversationPage> {
    const { organizationId, projectId } = authorizedScope(context);

    const { data, pagination } =
      await this.conversationService.getAllConversationsFromAdapter(
        projectId,
        organizationId,
        { page, limit },
      );

    return { nodes: data, pageInfo: pagination };
  }

  /**
   * Same read as GET /messages?conversationId=…&since=…: the whole thread in
   * order without `after`, only newer messages after it. A cursor that is not
   * a message of this conversation is rejected as not found.
   */
  @ResolveField(() => MessageConnection)
  async messages(
    @Parent() conversation: ConversationNode,
    @Info() info: GraphQLResolveInfo,
    @Args('after', { type: () => ID, nullable: true }) after?: MessageId,
  ): Promise<MessageConnection> {
    const selected = selectedFieldNames(info, ['nodes']);
    const organizationId = conversation.organizationId as OrganizationId;
    const projectId = conversation.projectId as ProjectId;

    const result = await this.messageService.getMessagesForAdapter(
      {
        conversationId: conversation.id as ConversationId,
        projectId,
        since: after,
      },
      organizationId,
      projectId,
      false,
      selected.has('proposals'),
      selected.has('reports'),
    );
    // Only REVERSE_HISTORY mode answers with a page, and it is never requested here.
    if (!Array.isArray(result)) {
      throw new InternalServerErrorException('Unexpected message history page');
    }

    const last = result.at(-1);

    return { nodes: result, endCursor: last?.id ?? after ?? null };
  }
}
