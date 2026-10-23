const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const EVENTS_SOURCE = path.resolve(
  PROJECT_ROOT,
  'src/core/events/types/domain-events.ts',
);
const TSCONFIG_PATH = path.resolve(PROJECT_ROOT, 'tsconfig.json');
const OUTPUT_DIR = path.resolve(PROJECT_ROOT, 'schemas/events');

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function buildFallbackDesignDocSchema() {
  const baseEvent = {
    type: 'object',
    required: ['id', 'type', 'aggregateId', 'payload'],
    additionalProperties: false,
    properties: {
      id: { type: 'string', description: 'Unique event identifier' },
      type: { type: 'string' },
      aggregateId: {
        type: 'string',
        description: 'Design document identifier associated with the event',
      },
      payload: {
        allOf: [
          { $ref: '#/$defs/ExecutionContext' },
          {
            type: 'object',
            required: ['designDoc'],
            additionalProperties: true,
            properties: {
              designDoc: { $ref: '#/$defs/DesignDoc' },
            },
          },
        ],
      },
    },
  };

  const eventDefinition = (eventType, description) => ({
    ...baseEvent,
    description,
    properties: {
      ...baseEvent.properties,
      type: { const: eventType, description: 'Discriminator for the event type' },
    },
  });

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://hey-hey-api/schemas/design-doc-events.schema.json',
    title: 'DesignDocEvents',
    description:
      'Domain events emitted when design documents are created, updated, or archived.',
    oneOf: [
      eventDefinition(
        'design_doc.created',
        'Emitted when a design document is initially created.',
      ),
      eventDefinition(
        'design_doc.updated',
        'Emitted when a design document is updated.',
      ),
      eventDefinition(
        'design_doc.archived',
        'Emitted when a design document is archived.',
      ),
    ],
    $defs: {
      ExecutionContext: {
        type: 'object',
        description:
          'Execution context describing the workflow and organizational metadata for the event.',
        required: ['organizationId', 'projectId'],
        additionalProperties: true,
        properties: {
          organizationId: {
            type: 'string',
            description: 'Owning organization identifier',
          },
          projectId: {
            type: 'string',
            description: 'Owning project identifier',
          },
          requestId: {
            type: 'string',
            description: 'Optional request correlation identifier',
          },
          workflowId: {
            type: 'string',
            description: 'Optional workflow identifier',
          },
          nodeId: {
            type: 'string',
            description: 'Optional node identifier for workflow events',
          },
          conversationId: {
            type: 'string',
            description: 'Optional conversation identifier',
          },
          userId: {
            type: 'string',
            description: 'Optional user identifier',
          },
          messageId: {
            type: 'string',
            description: 'Optional message identifier',
          },
          userMessage: {
            description:
              'Full user message payload when available. The precise structure is application specific.',
            type: 'object',
            additionalProperties: true,
          },
          correlationId: {
            type: 'string',
            description: 'Correlation identifier for tracing',
          },
          causationId: {
            type: 'string',
            description: 'Identifier of the event that caused this event',
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp at which the event occurred',
          },
        },
      },
      DesignDoc: {
        type: 'object',
        description: 'Design document snapshot included with the event payload.',
        required: [
          'id',
          'name',
          'template',
          'status',
          'organizationId',
          'tags',
          'createdAt',
          'updatedAt',
          'sections',
        ],
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'Design document identifier' },
          name: { type: 'string', description: 'Human-readable design document name' },
          template: {
            type: 'string',
            enum: ['CLASSIC', 'ADR', 'RFC'],
            description: 'Template used to author the design document',
          },
          status: {
            type: 'string',
            description: 'Current workflow status of the design document',
          },
          organizationId: {
            type: 'string',
            description: 'Owning organization identifier',
          },
          projectId: {
            anyOf: [
              {
                type: 'string',
                description: 'Owning project identifier when linked to a project',
              },
              { type: 'null' },
            ],
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Free-form tags associated with the document',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            description: 'Creation timestamp for the document',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp of the latest update to the document',
          },
          archivedAt: {
            anyOf: [
              {
                type: 'string',
                format: 'date-time',
                description: 'Timestamp at which the document was archived',
              },
              { type: 'null' },
            ],
          },
          sections: {
            type: 'array',
            minItems: 0,
            items: { $ref: '#/$defs/DesignDocSection' },
            description: 'Ordered list of document sections',
          },
          summary: {
            type: 'object',
            additionalProperties: true,
            description: 'Optional machine-generated summary metadata',
          },
          metadata: {
            type: 'object',
            additionalProperties: true,
            description: 'Additional implementation-specific metadata',
          },
        },
      },
      DesignDocSection: {
        type: 'object',
        required: ['key', 'content', 'order'],
        additionalProperties: false,
        properties: {
          key: { type: 'string', description: 'Stable identifier for the section' },
          content: { type: 'string', description: 'Markdown or HTML section content' },
          order: {
            type: 'number',
            description: 'Section ordering index (lower values appear first)',
          },
          metadata: {
            type: 'object',
            additionalProperties: true,
            description: 'Optional metadata associated with the section',
          },
        },
      },
    },
  };
}

function loadGenerator() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createGenerator } = require('ts-json-schema-generator');
    return createGenerator;
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? error.message
        : String(error);
    console.warn(
      `ts-json-schema-generator is unavailable (${message}). Falling back to built-in schema definitions.`,
    );
    return null;
  }
}

function generateWithLibrary(createGenerator) {
  const config = {
    path: EVENTS_SOURCE,
    tsconfig: TSCONFIG_PATH,
    type: 'DesignDocEvents',
    skipTypeCheck: true,
    expose: 'export',
    additionalProperties: true,
    jsDoc: 'extended',
    topRef: true,
  };
  const generator = createGenerator(config);
  return generator.createSchema(config.type);
}

function main() {
  ensureOutputDir();

  const createGenerator = loadGenerator();
  let schema;

  if (createGenerator) {
    try {
      schema = generateWithLibrary(createGenerator);
    } catch (error) {
      const message =
        error && typeof error === 'object' && 'message' in error
          ? error.message
          : String(error);
      console.warn(
        `Failed to generate schema using ts-json-schema-generator (${message}). Falling back to manual definition.`,
      );
      schema = buildFallbackDesignDocSchema();
    }
  } else {
    schema = buildFallbackDesignDocSchema();
  }

  const outputPath = path.join(OUTPUT_DIR, 'design-doc-events.schema.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
  console.log(`Design doc event schema written to ${path.relative(PROJECT_ROOT, outputPath)}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
