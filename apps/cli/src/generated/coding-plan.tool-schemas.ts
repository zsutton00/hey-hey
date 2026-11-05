/* Generated from OpenAPI; do not edit. */
export const CodingPlanEmissionInputToolSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['markdown', 'requiredServiceIds', 'discrepancies'],
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
        'Complete finding list for this plan version; use an empty array when there are none. A replacement plan re-lists the findings that still apply with their current direction, disposition and follow-through.',
      items: {
        allOf: [
          {
            allOf: [
              {
                type: 'object',
                required: [
                  'sourceRef',
                  'sourceExcerpt',
                  'reasoning',
                  'discrepancyText',
                  'severity',
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
                  suspectedImpact: {
                    type: 'string',
                    description: 'A material inference that is not established by observation.',
                  },
                  findingId: {
                    type: 'string',
                    minLength: 1,
                    description:
                      'Stable identity that a finding keeps across replacement plan versions.',
                  },
                  category: {
                    type: 'string',
                    enum: ['implementation', 'project_context'],
                    description:
                      'Kind of concern, independent of severity. project_context marks a conflict with recorded requirements, Contracts, designs or other governing context.',
                  },
                  userDirection: {
                    type: 'string',
                    description: 'The direction or assent the user gave about this finding.',
                  },
                  disposition: {
                    type: 'string',
                    enum: ['open', 'accepted', 'repair_planned', 'withdrawn'],
                    description:
                      'Current state of the finding. Assent changes the disposition and never removes the finding.',
                  },
                  implementationFollowThrough: {
                    type: 'string',
                    description: 'What implementation must address or verify for this finding.',
                  },
                  withdrawalEvidence: {
                    type: 'string',
                    description: 'Evidence that a withdrawn finding was mistaken or moot.',
                  },
                },
              },
            ],
            description: 'One evidence-bearing planning issue.',
          },
          {
            type: 'object',
            required: ['findingId', 'category', 'disposition'],
            properties: {
              findingId: {
                type: 'string',
                minLength: 1,
                description:
                  'Stable identity that a finding keeps across replacement plan versions.',
              },
              category: {
                type: 'string',
                enum: ['implementation', 'project_context'],
                description:
                  'Kind of concern, independent of severity. project_context marks a conflict with recorded requirements, Contracts, designs or other governing context.',
              },
              disposition: {
                type: 'string',
                enum: ['open', 'accepted', 'repair_planned', 'withdrawn'],
                description:
                  'Current state of the finding. Assent changes the disposition and never removes the finding.',
              },
            },
          },
        ],
        description:
          'A finding as emitted with a new plan version; carries the required finding metadata.',
      },
    },
  },
};

export const CodingPlanDiscrepancyToolSchema = {
  type: 'object',
  description: 'One evidence-bearing planning issue.',
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
    suspectedImpact: {
      type: 'string',
      description: 'A material inference that is not established by observation.',
    },
    findingId: {
      type: 'string',
      minLength: 1,
      description: 'Stable identity that a finding keeps across replacement plan versions.',
    },
    category: {
      type: 'string',
      enum: ['implementation', 'project_context'],
      description:
        'Kind of concern, independent of severity. project_context marks a conflict with recorded requirements, Contracts, designs or other governing context.',
    },
    userDirection: {
      type: 'string',
      description: 'The direction or assent the user gave about this finding.',
    },
    disposition: {
      type: 'string',
      enum: ['open', 'accepted', 'repair_planned', 'withdrawn'],
      description:
        'Current state of the finding. Assent changes the disposition and never removes the finding.',
    },
    implementationFollowThrough: {
      type: 'string',
      description: 'What implementation must address or verify for this finding.',
    },
    withdrawalEvidence: {
      type: 'string',
      description: 'Evidence that a withdrawn finding was mistaken or moot.',
    },
  },
};
