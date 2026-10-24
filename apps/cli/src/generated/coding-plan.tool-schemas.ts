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
  },
};

export const CodingPlanDiscrepancyToolSchema = {
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
};
