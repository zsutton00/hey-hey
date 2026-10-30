/* Generated from OpenAPI; do not edit. */
export const CodingPlanEmissionInputToolSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['markdown', 'requiredServiceIds'],
  properties: {
    markdown: {
      type: 'string',
      minLength: 1,
      description:
        'Complete visible plan. Preserve this exact text through approval and implementation.',
    },
    requiredServiceIds: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: {
        type: 'string',
        format: 'uuid',
      },
    },
    discrepancies: {
      type: 'array',
      description:
        'Complete discrepancy list for this plan version. A replacement plan re-lists the discrepancies that still hold.',
      items: {
        allOf: [
          {
            type: 'object',
            required: ['sourceRef', 'sourceExcerpt', 'reasoning', 'discrepancyText', 'severity'],
            properties: {
              sourceRef: {
                type: 'object',
                required: ['sourceType', 'sourceId'],
                properties: {
                  sourceType: {
                    type: 'string',
                    enum: ['evidenceItem', 'task', 'designDoc', 'plan', 'initiative'],
                    description: 'Source types used by startup-plan structured responses',
                  },
                  sourceId: {
                    type: 'string',
                  },
                },
                description: 'Source reference used by startup-plan structured responses',
              },
              sourceField: {
                type: 'string',
              },
              sourceExcerpt: {
                type: 'string',
              },
              reasoning: {
                type: 'string',
              },
              discrepancyText: {
                type: 'string',
              },
              severity: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
              },
            },
            description: 'Input discrepancy captured in startup-plan output',
          },
          {
            type: 'object',
            required: ['sourceField'],
            properties: {
              sourceField: {
                type: 'string',
                minLength: 1,
              },
            },
          },
        ],
        description: 'One evidence-bearing, individually replyable planning issue.',
      },
    },
  },
};

export const CodingPlanDiscrepancyToolSchema = {
  type: 'object',
  description: 'One evidence-bearing, individually replyable planning issue.',
  required: [
    'sourceRef',
    'sourceExcerpt',
    'reasoning',
    'discrepancyText',
    'severity',
    'sourceField',
  ],
  properties: {
    sourceRef: {
      type: 'object',
      required: ['sourceType', 'sourceId'],
      properties: {
        sourceType: {
          type: 'string',
          enum: ['evidenceItem', 'task', 'designDoc', 'plan', 'initiative'],
          description: 'Source types used by startup-plan structured responses',
        },
        sourceId: {
          type: 'string',
        },
      },
      description: 'Source reference used by startup-plan structured responses',
    },
    sourceField: {
      type: 'string',
      minLength: 1,
    },
    sourceExcerpt: {
      type: 'string',
    },
    reasoning: {
      type: 'string',
    },
    discrepancyText: {
      type: 'string',
    },
    severity: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
    },
  },
};

export const CodingPlanQuestionToolSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['question'],
  properties: {
    question: {
      type: 'string',
      minLength: 1,
      description:
        'One question the user must answer before planning can continue, shown verbatim in the conversation.',
    },
  },
};
