import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { GraphQLScalarType } from 'graphql';

/**
 * Passes a spec-defined structure through unchanged. Message data, proposals
 * and reports already have OpenAPI shapes; re-declaring them as GraphQL types
 * would create a second definition that can drift from the REST read.
 */
export const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'A value whose shape is defined by the REST contract.',
});

/** Conversation metadata. The thread is read only through `messages`. */
@ObjectType('Conversation')
export class ConversationNode {
  @Field(() => ID)
  id!: string;

  @Field()
  organizationId!: string;

  @Field()
  projectId!: string;

  @Field({ nullable: true })
  title?: string;

  @Field()
  status!: string;

  @Field()
  workflowName!: string;

  @Field({ nullable: true })
  workflowId?: string;

  @Field({ nullable: true })
  workflowAboutType?: string;

  @Field({ nullable: true })
  workflowAboutId?: string;

  @Field()
  initiatedBy!: string;

  @Field({ nullable: true })
  triggerEvent?: string;

  @Field(() => String, { nullable: true })
  createdBy!: string | null;

  @Field({ nullable: true })
  lastModifiedBy?: string;

  @Field()
  restricted!: boolean;

  @Field(() => Int)
  version!: number;

  @Field()
  createdAt!: string;

  @Field()
  updatedAt!: string;

  /** Present only when selected; maps to the REST `includeSuggestionDecisions` flag. */
  @Field(() => [JSONScalar], { nullable: true })
  suggestionDecisions?: unknown[];

  /** Present only when selected; maps to the REST `includeSuggestionDecisions` flag. */
  @Field(() => [JSONScalar], { nullable: true })
  goalPmRoutingDecisions?: unknown[];
}

@ObjectType()
export class PageInfo {
  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  limit!: number;

  @Field(() => Int)
  total!: number;

  @Field(() => Int)
  totalPages!: number;
}

@ObjectType()
export class ConversationPage {
  @Field(() => [ConversationNode])
  nodes!: ConversationNode[];

  @Field(() => PageInfo)
  pageInfo!: PageInfo;
}

@ObjectType('Message')
export class MessageNode {
  @Field(() => ID)
  id!: string;

  @Field()
  conversationId!: string;

  @Field()
  projectId!: string;

  @Field()
  type!: string;

  @Field()
  status!: string;

  @Field({ nullable: true })
  userId?: string;

  @Field({ nullable: true })
  parentMessageId?: string;

  /** Null while a queued input has not started; such a record is not on the timeline. */
  @Field(() => String, { nullable: true })
  createdAt!: string | null;

  @Field({ nullable: true })
  executionStatus?: string;

  @Field({ nullable: true })
  executionQueueConfirmed?: boolean;

  @Field({ nullable: true })
  executionAdmissionDisposition?: string;

  @Field({ nullable: true })
  executionCancellationRequested?: boolean;

  @Field({ nullable: true })
  executionOperationId?: string;

  @Field({ nullable: true })
  awaitingResponse?: boolean;

  @Field({ nullable: true })
  handler?: string;

  @Field(() => JSONScalar, { nullable: true })
  user?: unknown;

  @Field(() => JSONScalar)
  data!: unknown;

  /** Present only when selected; maps to the REST `includeProposals` flag. */
  @Field(() => [JSONScalar], { nullable: true })
  proposals?: unknown[];

  /** Present only when selected; maps to the REST `includeReports` flag. */
  @Field(() => [JSONScalar], { nullable: true })
  reports?: unknown[];

  /** Single-message reads only; the replies REST returns with a message. */
  @Field(() => [MessageNode], { nullable: true })
  responses?: MessageNode[];

  /** Single-message reads only; the parent REST returns with a message. */
  @Field(() => MessageNode, { nullable: true })
  parentMessage?: MessageNode;
}

/**
 * A conversation's messages. `nodes` are always in thread order, oldest first,
 * including for a newest-first page (`last` / `before`), which holds the
 * newest messages of the thread, still oldest first. Pass `endCursor` back as
 * `after` to receive only messages appended since this read.
 */
@ObjectType()
export class MessageConnection {
  @Field(() => [MessageNode])
  nodes!: MessageNode[];

  @Field(() => ID, { nullable: true })
  endCursor!: string | null;

  @Field(() => ID, {
    nullable: true,
    description:
      'Newest-first reads only: pass as `before` to read the next older page. Null when no older messages remain, and for reads without `last` / `before`.',
  })
  startCursor!: string | null;

  @Field(() => Boolean, {
    nullable: true,
    description:
      'Newest-first reads only: whether older messages remain before this page. Null for reads without `last` / `before`.',
  })
  hasOlder!: boolean | null;
}
