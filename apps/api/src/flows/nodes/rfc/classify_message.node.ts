import { Injectable } from '@nestjs/common';
import { ClassificationNodeBase } from '../base/';
import { rfcClassificationResponseSchema } from '../../utils/shared-schemas';
import { StandardPlaceholders as P } from '../../../services/llm/placeholders';
import {
  CompensationContext,
  CompensationResult,
  FlowContext,
  NodeResult,
  NodeType,
} from '../../../types/flow-internal.types';
import { RFC_NODES } from '../../constants/node-ids';

/**
 * RFC Classify Node - Determines next step in RFC creation
 *
 * Analyzes user input to determine if they:
 * - Need follow-up questions
 * - Have sufficient info for direct RFC generation
 * - Want conversational discussion about RFCs
 */
@Injectable()
export class RfcClassifyMessageNode extends ClassificationNodeBase<FlowContext> {
  readonly id = RFC_NODES.CLASSIFY;
  readonly title = 'RFC Input Classification';

  readonly promptConfig = {
    systemPromptTemplate: `You are a classification assistant that determines the next step for Request for Comments (RFC) creation based on user's initial input.

## What is a Request for Comments (RFC)?
An RFC is a formal document that proposes changes, new features, or improvements to systems, processes, or standards. RFCs help teams:
- Gather feedback on proposed changes before implementation
- Create a structured discussion around complex decisions
- Document the reasoning behind major changes
- Build consensus among stakeholders
- Preserve the thought process for future reference

## Common RFC Use Cases:
- New feature proposals (product features, API endpoints, user workflows)
- System architecture changes (database schema, service architecture)
- Process improvements (development workflow, deployment process, code review)
- Policy changes (security policies, coding standards, team practices)
- Technical specifications (data formats, communication protocols)
- Breaking changes (API modifications, deprecations, migrations)

## The user is starting an RFC creation process. Analyze their input and determine the best next step:

1. **"need_questions"** - User has provided some input but needs follow-up questions to create a comprehensive RFC
2. **"generate_rfc"** - User has provided sufficient information to generate an RFC directly without additional questions
3. **"conversation"** - User wants to discuss or explore RFC creation conversationally, or their intent is unclear

## Evaluate the user's input for:
- **hasProposal**: Does the user describe a specific proposal or change they want to make?
- **hasDescription**: Does the user provide details about what they want to propose?
- **sufficiencyLevel**: Based on typical RFC requirements, is the information:
  - **"insufficient"**: Very little context, definitely needs questions
  - **"partial"**: Some good context but likely needs clarification
  - **"sufficient"**: Rich context that could produce a quality RFC

## For a high-quality RFC, typically need:
- **Problem Statement**: What problem are we solving? Why is change needed?
- **Proposal**: What specific change or feature is being proposed?
- **Motivation**: Why is this the right approach? What are the benefits?
- **Detailed Design**: How will this be implemented? What are the specifics?
- **Alternatives**: What other approaches were considered? Why not those?
- **Impact**: How will this affect users, systems, or processes?

## Examples of input that would need questions:
- "I want to propose a new API"
- "We should change our deployment process"
- "I have an idea for improving user experience"

## Examples of input sufficient for direct RFC generation:
- "I propose we add user authentication to our API using JWT tokens. Currently users can access all endpoints without auth, which is a security risk. We should implement OAuth 2.0 with JWT, add middleware for token validation, and provide login/logout endpoints. This affects all existing API users who will need to update their clients."

User's input: "${P.CURRENT_MESSAGE.insert()}"

Analyze this input and determine the most appropriate next step.`,
    responseSchema: rfcClassificationResponseSchema,
  };

  readonly transitions = {
    need_questions: () => RFC_NODES.QUESTIONS,
    generate_rfc: () => RFC_NODES.GENERATE,
    conversation: () => RFC_NODES.CONVERSATION,
  };

  async compensate(
    _context: FlowContext,
    _error: Error,
    compensationContext: CompensationContext,
  ): Promise<CompensationResult> {
    const { errorClassification, attemptCount } = compensationContext;

    // Timeout: Retry with backoff
    if (errorClassification.type === 'TIMEOUT' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 5000,
        reason: 'Classification timeout, retrying with backoff',
      };
    }

    // Rate limit: Retry with delay
    if (errorClassification.type === 'RATE_LIMITED' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 8000,
        reason: 'Classification rate limited, retrying with extended delay',
      };
    }

    // Classification failures fallback to questions mode (safe default)
    if (attemptCount >= 2) {
      return {
        action: 'SKIP_TO_NODE',
        nextNodeId: RFC_NODES.QUESTIONS,
        reason: 'Classification failed, defaulting to questions mode',
      };
    }

    return { action: 'FAIL' };
  }
}
