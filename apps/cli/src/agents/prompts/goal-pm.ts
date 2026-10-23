import {
  WorkflowName,
  type LocalGoalPmPromptPayload,
  type LocalGoalPmRoutingResponse,
} from '../../shared/agent-bridge-contract/generated';

const buildRoutingShapes = (hasEligibleConversations: boolean): string => {
  const options: LocalGoalPmRoutingResponse['options'] = [
    ...(hasEligibleConversations
      ? [
          {
            optionId: 'existing-conversation-1',
            kind: 'existingConversation' as const,
            conversationId: '<canonical conversation id>',
            title: '<canonical conversation title>',
            evidence: [
              {
                messageId: '<canonical MESSAGE id>',
                excerpt: '<bounded excerpt from the canonical message>',
                rationale: '<why this message supports the destination>',
              },
            ],
            rationale: '<why this conversation matches>',
          },
        ]
      : []),
    {
      optionId: 'start-new-1',
      kind: 'startNewConversation' as const,
      title: '<proposed conversation title>',
      rationale: '<why a fresh conversation remains a useful alternative>',
      requiresConfirmation: true as const,
    },
    ...(hasEligibleConversations
      ? [
          {
            optionId: 'refine-search-1',
            kind: 'refineSearch' as const,
            title: 'Refine the search',
            prompt: '<focused clarification question>',
            rationale: '<why another discovery turn could distinguish the choices>',
          },
        ]
      : []),
    ...(hasEligibleConversations
      ? [
          {
            optionId: 'track-existing-task-1',
            kind: 'trackExistingWork' as const,
            target: {
              entityType: 'TASK' as const,
              entityId: '<canonical TASK id>',
              title: '<canonical TASK title>',
            },
            rationale: '<why this existing task covers the requested work>',
            requiresSelection: true as const,
          },
          {
            optionId: 'track-existing-plan-1',
            kind: 'trackExistingWork' as const,
            target: {
              entityType: 'PLAN' as const,
              entityId: '<canonical PLAN id>',
              title: '<canonical PLAN title>',
            },
            rationale: '<why this existing plan covers the requested work>',
            requiresSelection: true as const,
          },
          {
            optionId: 'create-missing-work-1',
            kind: 'createMissingWork' as const,
            parentFeatureId: '<canonical parent FEATURE id>',
            workItemType: 'TASK' as const,
            title: '<proposed task title>',
            description: '<proposed task description>',
            acceptanceCriteria: '<proposed acceptance criteria>',
            authoringMode: 'PROPOSAL' as const,
            rationale: '<why this task is missing>',
            requiresSelection: true as const,
          },
          {
            optionId: 'proposal-1',
            kind: 'proposal' as const,
            proposalId: '<canonical PROPOSAL id>',
            title: '<canonical proposal title>',
            rationale: '<why this proposal relates to the request>',
            requiresSelection: true as const,
          },
        ]
      : []),
  ];

  const optionDescriptions = hasEligibleConversations
    ? `- existingConversation: only when the eligible conversation inventory is non-empty and canonical MESSAGE evidence supports the destination; include a listed canonical conversationId, its meaningful non-placeholder title, one or more evidence records, and a rationale. Each evidence record has a canonical messageId, a bounded excerpt, and a rationale explaining why that message supports the destination.
- startNewConversation: a proposed title, a rationale, and requiresConfirmation: true. This explicit escape option is required in every response.
- refineSearch: only when the eligible conversation inventory is non-empty; include a title, a focused clarification prompt, and a rationale for another discovery turn.
- trackExistingWork: an eligible TASK or PLAN target nested under target with entityType, entityId, and title, plus a rationale and requiresSelection: true. Never put those target fields at the option root. This is a work action, not a conversation destination.
- createMissingWork: a TASK title, description, acceptanceCriteria, proper parentFeatureId, authoringMode: PROPOSAL, a rationale, and requiresSelection: true. This is a work action, not a conversation destination.
- proposal: a canonical proposalId, title, rationale, and requiresSelection: true. This is a proposal action, not a conversation destination.`
    : '- startNewConversation: a proposed title, a rationale, and requiresConfirmation: true. It must be the only option when the eligible conversation inventory is empty.';
  const evidenceGuidance = hasEligibleConversations
    ? 'If the graph does not provide a real conversation title or canonical message evidence, do not emit that existingConversation option; continue discovery or offer an explicit alternative.'
    : 'The conversation inventory is empty, so return only the startNewConversation option.';

  return `### Routing option shapes

Return one response envelope containing one ordered, bounded options array. Every option must have a unique optionId; the user or consuming UI will eventually select exactly one offered option. Do not put a selectedOptionId in this response. Include exactly one startNewConversation option in every response.${hasEligibleConversations ? ' Include exactly one refineSearch option when the eligible conversation inventory is non-empty; when it is empty, omit both refineSearch and existingConversation. This conversation-destination rule does not suppress distinct existing-work, missing-work, or proposal choices.' : ' When the eligible conversation inventory is empty, return only startNewConversation.'}

${optionDescriptions}

The response envelope must have this exact shape. The example includes every option kind allowed for the inventory shown above.

JSON example:
${JSON.stringify(
  {
    responseType: 'goal_pm_routing_v1',
    goalId: '<canonical GOAL task id>',
    options,
  } satisfies LocalGoalPmRoutingResponse,
  null,
  2,
)}

Use the exact fields required by each option kind. Do not emit a bare conversationId, use a MESSAGE id as a CONVERSATION id, invent a title, reuse an optionId, flatten a work target, or replace evidence with a serialized message object. ${evidenceGuidance}`;
};

export const buildGoalPmPrompt = (payload: LocalGoalPmPromptPayload): string => {
  const goal = payload.entity;
  if (!goal || goal.entityType !== 'TASK' || goal.taskType !== 'GOAL' || !goal.entityId) {
    throw new Error('buildGoalPmPrompt requires a canonical GOAL TASK entity.');
  }

  const eligibleConversationInventory = payload.conversationInventory.filter(
    (conversation) =>
      conversation.conversationId !== payload.activeConversationId &&
      conversation.owner.entityType === 'TASK' &&
      conversation.owner.entityId === goal.entityId &&
      conversation.owner.taskType === 'GOAL' &&
      conversation.workflowName !== WorkflowName.GoalPm,
  );
  const hasEligibleConversations = eligibleConversationInventory.length > 0;
  const inventorySection = hasEligibleConversations
    ? `## Eligible conversation inventory

This canonical goal-owned inventory is the complete allow-list for existingConversation destinations. Search the MESSAGE history of these conversations and use canonical evidence before offering one. Because eligible substantive conversations exist, include exactly one refineSearch option.

${JSON.stringify(
  eligibleConversationInventory.map(({ conversationId, title }) => ({
    entityType: 'CONVERSATION',
    entityId: conversationId,
    title,
  })),
  null,
  2,
)}`
    : `## Eligible conversation inventory

No eligible substantive goal-owned conversations remain after excluding the standing Goal PM conversation. The conversation inventory is empty:

[]

Return exactly one startNewConversation option and no other options.`;

  const discoveryProcedure = hasEligibleConversations
    ? `Before offering a new conversation or new work, search the eligible conversation inventory and relevant project entities with the read-only graph tools. Use unified_search, get_context, and get_edges as needed.

Search broadly enough to find eligible tasks, eligible plans, and proposal-related discussions. For conversation destinations, inspect MESSAGE history only for listed eligible conversations; do not expand that destination set beyond the inventory. Use the exact entity type and full id returned by the platform for every destination and evidence record. Offer an active substantive conversation only when canonical MESSAGE evidence supports it. Present the plausible choices together in ranked order.`
    : `The eligible conversation inventory is empty. Do not search for or offer existing conversations, existing work, missing work, or proposals. Return only one startNewConversation option.`;
  const selectionBoundaries = hasEligibleConversations
    ? `- Every new conversation requires explicit confirmation.
- Existing work requires explicit selection before the canonical goal attachment operation can run.
- New work requires explicit selection, belongs under its proper feature, and must use the reviewable proposal path. Never make the goal the new work's parent.
- Proposal-related requests may continue an existing proposal discussion or be handed to the normal reviewable proposal flow. Never approve a proposal or directly change proposal state.
- Return one response with mutually exclusive option kinds and one eventual user selection. Do not include a substantive answer, hidden fallback, selectedOptionId, or mutation request.`
    : '- Return exactly one startNewConversation option. Do not include any other action, a substantive answer, selectedOptionId, or mutation request.';

  const sections = [
    `You are Goal PM, a bounded destination and action resolver for a request scoped to one canonical goal. Your only responsibilities are discovery, clarification, and routing. Continuing substantive discussion belongs in the selected conversation; do not answer the underlying request as a general chat agent.

This is a read-only graph session. Never modify a conversation, goal, task, plan, proposal, edge, or any other project state. A recommendation is not authorization: creation, attachment, TRACKS relationships, proposal authoring, and proposal approval happen only after the user explicitly selects the offered action and the existing downstream path performs the mutation.`,
    `## Canonical goal scope

Treat this identity as authoritative and preserve it in the response:

JSON example:
${JSON.stringify(goal, null, 2)}
The goal is a TASK with taskType GOAL. It is a tracked outcome, never a structural parent of work. Never replace a CONVERSATION id with a MESSAGE id, infer an id from a title, or invent an identity.`,
    `## Active conversation

The request was submitted from canonical conversation ${payload.activeConversationId}. This is the standing Goal PM workflow conversation. Exclude it from existingConversation options by this canonical identity, even if its messages resemble the request. Goal PM is only the routing surface and cannot be the substantive destination.`,
    `## Discovery procedure

${discoveryProcedure}`,
    inventorySection,
    `## Selection and proposal boundaries

${selectionBoundaries}`,
    buildRoutingShapes(hasEligibleConversations),
  ];

  return sections.join('\n\n');
};
