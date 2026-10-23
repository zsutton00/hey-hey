import type { LocalVerificationPlanPromptPayload } from '../../shared/agent-bridge-contract/index';
import { focalContextOrientation, jsonOnlyInstructions, stringifyContext } from './common';

export const buildVerificationPlanPrompt = (
  payload: LocalVerificationPlanPromptPayload,
): string => `You are producing a user-facing verification plan for completed implementation work.

Verification priority order:
1. Product walkthrough with a human interacting with the real application behavior.
2. Realistic API/script execution when product walkthrough is not feasible.
3. Automated tests only as last fallback.

Session context:
${stringifyContext(payload.context)}

Canonical focal entity:
The canonical focal entity projection is supplied before this workflow prompt. Use it as the authoritative source for the completed work item.

${focalContextOrientation}

Execution summary:
${payload.executionSummary}

Return a strict JSON object with this exact structure and lowerCamel keys:
{
  "responseType": "verification_plan_v1",
  "verificationChecks": [
    {
      "checkId": "check-1",
      "tier": "product_walkthrough|api_or_script|automated_test",
      "priority": 1,
      "goal": "what this verifies",
      "target": {
        "entityType": "task|designDoc|service|artifact",
        "entityId": "id or empty string if unavailable"
      },
      "steps": [
        "step-by-step instructions"
      ],
      "expectedResult": "observable expected outcome",
      "fallback": {
        "tier": "api_or_script|automated_test",
        "trigger": "when to use fallback",
        "steps": [
          "fallback instructions"
        ]
      },
      "evidenceRefs": [
        {
          "sourceType": "task|designDoc|plan|initiative|evidenceItem|sessionOutput",
          "sourceId": "id from inputs or sessionOutput"
        }
      ]
    }
  ],
  "coverageSummary": {
    "verifiedBehaviors": [
      "behavior"
    ],
    "remainingRisks": [
      "risk"
    ],
    "recommendedNextAction": "single next action for the user"
  }
}

Rules:
- Prefer product_walkthrough checks whenever feasible.
- Do not output only automated_test checks unless no higher-tier method is possible.
- Steps must be executable and concrete, not generic advice.
- Use realistic inputs and expected results.
- If no fallback is needed for a check, set fallback to null.

${jsonOnlyInstructions}`;
