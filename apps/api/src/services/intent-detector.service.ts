import { Injectable } from '@nestjs/common';
import { ContextAwareLogger } from 'src/core/logging/context-aware-logger.service';
import {
  MessageResponseDto,
  QuestionsSystemMessageData,
  UserMessageData,
} from 'src/generated';
import { FlowContext, Intent } from '../types/flow-internal.types';

@Injectable()
export class IntentDetectorService {
  private readonly logger = ContextAwareLogger.createServiceLogger(
    IntentDetectorService.name,
  );

  private patterns = {
    correction: [
      /actually/i,
      /wait/i,
      /no,?\s*(not|I meant)/i,
      /let me clarify/i,
      /change that/i,
      /that's not right/i,
      /I misspoke/i,
      /correction/i,
    ],
    clarification: [
      /what do you mean/i,
      /can you explain/i,
      /I don't understand/i,
      /confused about/i,
      /unclear/i,
      /could you clarify/i,
      /what does .* mean/i,
    ],
    acceptance: [
      /looks good/i,
      /perfect/i,
      /yes,?\s*that's right/i,
      /exactly/i,
      /let's proceed/i,
      /sounds good/i,
      /I agree/i,
      /correct/i,
    ],
    moreDetail: [
      /tell me more/i,
      /can you elaborate/i,
      /what about/i,
      /how does .* work/i,
      /more details/i,
      /dive deeper/i,
      /expand on/i,
    ],
    skipAhead: [
      /skip this/i,
      /move on/i,
      /next step/i,
      /let's continue/i,
      /fast forward/i,
      /skip to/i,
    ],
    needsMoreInfo: [
      /need more information/i,
      /not enough detail/i,
      /missing something/i,
      /incomplete/i,
      /tell me about/i,
    ],
    startOver: [
      /start over/i,
      /begin again/i,
      /restart/i,
      /from the beginning/i,
      /reset/i,
    ],
    concerns: [
      /I'm worried/i,
      /concerned about/i,
      /not sure about/i,
      /problem with/i,
      /issue with/i,
      /doubt/i,
      /risky/i,
    ],
    ready: [
      /ready to proceed/i,
      /let's move forward/i,
      /ready for next/i,
      /good to go/i,
      /ready/i,
    ],
    satisfied: [
      /satisfied/i,
      /happy with/i,
      /this works/i,
      /I'm good/i,
      /that's fine/i,
    ],
  };

  async detect(
    userMessage: MessageResponseDto | null,
    context?: FlowContext,
    llmResponse?: Pick<
      QuestionsSystemMessageData,
      'detectedIntent' | 'intentConfidence' | 'reasoning'
    >,
    availableTransitions?: string[],
  ): Promise<Intent> {
    this.logger.debug('starting IntentDetector detect', {
      detectedIntent: llmResponse?.detectedIntent,
      userMessage,
    });
    const responses = (userMessage?.data ?? {}) as UserMessageData;
    const primitiveResponses = this.extractPrimitiveResponses(responses);

    // PRIORITY 1: Use LLM-provided transition key if it's valid
    if (llmResponse?.detectedIntent) {
      // If we have available transitions, validate the LLM's response
      if (availableTransitions && availableTransitions.length > 0) {
        // Check if LLM provided a valid transition key
        if (availableTransitions.includes(llmResponse.detectedIntent)) {
          return {
            type: llmResponse.detectedIntent,
            confidence: llmResponse.intentConfidence || 0.9, // High confidence since LLM chose from valid options
            userData: primitiveResponses,
            metadata: { source: 'llm_transition', availableTransitions },
          };
        }
        // If LLM provided invalid transition, log but continue with fallback
        this.logger.warn(
          `LLM provided invalid transition "${llmResponse.detectedIntent}". Available: ${availableTransitions.join(', ')}`,
        );
      } else {
        // No available transitions provided, use LLM intent as-is
        return {
          type: llmResponse.detectedIntent,
          confidence: llmResponse.intentConfidence || 0.7,
          userData: primitiveResponses,
          metadata: { source: 'llm_response' },
        };
      }
    }

    // PRIORITY 2: High-confidence pattern matches
    for (const text of Object.values(primitiveResponses)) {
      if (typeof text !== 'string') {
        continue;
      }
      const patternMatches = this.checkPatterns(text, primitiveResponses);
      if (patternMatches.length > 0) {
        const bestMatch = patternMatches[0];
        if (!bestMatch) {
          continue;
        }
        if (bestMatch.confidence > 0.8) {
          return bestMatch;
        }
      }

      if (context) {
        // PRIORITY 3: Context-based intent detection
        const contextIntent = this.detectFromContext(
          text,
          context,
          primitiveResponses,
        );
        if (contextIntent) {
          return contextIntent;
        }
      }

      if (patternMatches.length) {
        const bestMatch = patternMatches[0];
        if (bestMatch) {
          return bestMatch;
        }
      }
    }

    // PRIORITY 4: Return best pattern match or default
    return {
      type: 'default',
      confidence: 0.5,
      userData: primitiveResponses,
      metadata: { source: 'default' },
    };
  }

  private extractPrimitiveResponses(
    responses: UserMessageData,
  ): Record<string, string | number | boolean> {
    return Object.fromEntries(
      Object.entries(responses).filter(
        ([, value]) =>
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean',
      ),
    ) as Record<string, string | number | boolean>;
  }

  private checkPatterns(
    text: string,
    userData: Record<string, string | boolean | number>,
  ): Intent[] {
    const matches: Intent[] = [];

    for (const [intentType, patterns] of Object.entries(this.patterns)) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          matches.push({
            type: intentType,
            confidence: this.calculatePatternConfidence(pattern, text),
            userData,
            metadata: {
              matchedPattern: pattern.toString(),
              source: 'pattern_matching',
            },
          });
        }
      }
    }

    // Sort by confidence
    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  private calculatePatternConfidence(pattern: RegExp, text: string): number {
    const match = text.match(pattern);
    if (!match) return 0;

    let confidence = 0.8; // Base confidence for pattern match

    // Adjust based on match position (earlier in text = higher confidence)
    const matchIndex = match.index || 0;
    const textLength = text.length;
    const positionRatio = matchIndex / textLength;

    if (positionRatio < 0.2) {
      confidence += 0.1; // Boost for early matches
    } else if (positionRatio > 0.8) {
      confidence -= 0.1; // Reduce for late matches
    }

    // Adjust based on text length (shorter, more focused responses = higher confidence)
    if (textLength < 50) {
      confidence += 0.05;
    } else if (textLength > 200) {
      confidence -= 0.05;
    }

    return Math.min(0.95, confidence);
  }

  private technicalTerms = [
    /architecture/i,
    /implementation/i,
    /deploy/i,
    /build/i,
    /code/i,
    /develop/i,
  ];

  private detectFromContext(
    text: string,
    context: FlowContext,
    userData: Record<string, string | number | boolean>,
  ): Intent | null {
    // Check for technical terms that might indicate readiness to proceed
    if (context.core.session.interactionCount > 2 && text.length > 100) {
      for (const technicalTerm of this.technicalTerms) {
        if (technicalTerm.test(text)) {
          return {
            type: 'ready_to_proceed',
            confidence: 0.7,
            userData,
            metadata: { source: 'context_analysis', reason: 'technical_depth' },
          };
        }
      }
    }

    // Check for length-based intent (very short responses might indicate acceptance)
    if (text.length < 20) {
      if (/yes/i.test(text) || /ok/i.test(text) || /sure/i.test(text)) {
        return {
          type: 'acceptance',
          confidence: 0.6,
          userData,
          metadata: { source: 'context_analysis', reason: 'short_positive' },
        };
      }
    }

    // Check for question format (might indicate need for clarification)
    if (/\?/i.test(text) && !/what if/i.test(text)) {
      return {
        type: 'clarification',
        confidence: 0.6,
        userData,
        metadata: { source: 'context_analysis', reason: 'question_format' },
      };
    }

    return null;
  }

  // Helper method to map detected intents to flow transitions
  mapIntentToTransition(
    intent: Intent,
    availableTransitions: string[],
  ): string {
    // Direct mapping
    if (availableTransitions.includes(intent.type)) {
      return intent.type;
    }

    // Semantic mapping
    const mappings: Record<string, string[]> = {
      ready_to_proceed: ['ready_for_analysis', 'ready_to_proceed', 'continue'],
      acceptance: ['user_accepts', 'satisfied', 'continue'],
      correction: [
        'user_wants_changes',
        'actually_different_focus',
        'more_changes',
      ],
      clarification: ['needs_clarification', 'need_more_info'],
      concerns: ['user_has_concerns', 'address_concerns'],
      moreDetail: [
        'need_more_technical',
        'more_technical_detail',
        'need_integration_details',
      ],
      skipAhead: ['skip_integrations', 'move_forward'],
      startOver: ['start_over', 'begin_again'],
    };

    const possibleTransitions = mappings[intent.type] || [];
    const matchingTransition = possibleTransitions.find((t) =>
      availableTransitions.includes(t),
    );

    return matchingTransition || 'default';
  }
}
