import { SubfacetStatus, SummaryCategory, EntityType } from '@prisma/client';

/**
 * Fixtures derived from a real consolidation run on a mature project.
 * The LLM output JSON and pre-consolidation subfacet state are captured here
 * so integration-style tests can exercise the full applyConsolidation path.
 */

export const fixtureIds = {
  organizationId: '123e4567-e89b-42d3-a456-426614174002',
  projectId: '123e4567-e89b-42d3-a456-426614174003',
};

const CATEGORY = 'technology' as SummaryCategory;

/** All subfacets that existed as ACTIVE before consolidation ran. */
export function createPreConsolidationSubfacets() {
  const names = [
    // These get merged into "CLI Architecture"
    'CLI Agent Orchestration',
    'CLI Architecture Integration',
    'CLI architecture, command structure & agent orchestration',
    'CLI architecture, file discovery & repository management',
    'CLI Architecture & artifact access',
    // These get merged into "Agent Adapter Layer"
    'Agent Adapter Layer',
    'Agent adapter abstraction & response parsing',
    'agent adapters',
    // These get merged into "Artifact Synchronization"
    'Artifact Sync Protocol',
    'Artifact Synchronization',
    'Design doc extraction & editing',
    'Design doc extraction, artifact management & implementation hints',
    'Design doc extraction, editing & artifact management',
    // These get merged into "Session Credential Management"
    'Session Credential Management',
    'Credential & session lifecycle management',
    'Credential & authentication lifecycle',
    'Credential storage, encryption & platform integration',
    'credential lifecycle',
    // These get merged into "API Authentication"
    'API authentication, authorization & token management',
    'endpoints and errors',
    // These get merged into "Cost Management"
    'Cost Token Enforcement',
    'Cost tracking, token normalization & organization management',
    // These get merged into "Event System"
    'Event system, data integrity & deduplication',
    'Event system, graph relationships & influence tracking',
    'Event system & data consistency',
    'event publishing',
    'event integration',
    // These get merged into "Graph Data Model"
    'Graph & vector data model, schema & topology',
    'database schema',
    'Database Schema Layer',
    // These get merged into "Search Hybrid Fusion"
    'Search Hybrid Fusion',
    'embedding ranking',
    'graph traversal',
    // These get merged into "Workflow Orchestration"
    'Workflow Orchestration Engine',
    'API integrations',
    // These get merged into "Influence Registry"
    'Influence registry & provenance tracking',
    'Influence registry, provenance & cross-entity linking',
    // Kept as single merged (no actual merge)
    'Error handling, retry logic & resilience',
    'Cloud deployment, infrastructure & observability',
    'Service deployment, infrastructure & cloud architecture',
    'File scanning, path resolution & codebase indexing',
    'CDRT editing UI',
    'design tokens',
    'Service metadata, implementation hints & design doc integration',
    'Topology consolidation, summary generation & rollup management',
    // These get merged into "Data Persistence"
    'data persistence',
    'encrypted storage',
    // These get merged into "UI Components"
    'ui components',
    'CLI UI infrastructure & component composition',
    // Kept standalone
    'subscription management',
    'Interface design, CLI conventions & agent integration',
    'idempotent deletion',
    // Kept as keptSubfacets
    'Coding Agents Strategy',
  ];

  return names.map((name, idx) => ({
    id: `sf-${idx.toString().padStart(3, '0')}`,
    name,
    category: CATEGORY,
    status: SubfacetStatus.ACTIVE,
    summary: `Summary for ${name}`,
    organizationId: fixtureIds.organizationId,
    projectId: fixtureIds.projectId,
    updatedAt: new Date('2026-01-15T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
  }));
}

/** The LLM consolidation output from a real run. */
export function createConsolidationLlmOutput() {
  return {
    category: CATEGORY,
    mergedSubfacets: [
      {
        name: 'CLI Architecture',
        mergedFrom: [
          'CLI Agent Orchestration',
          'CLI Architecture Integration',
          'CLI architecture, command structure & agent orchestration',
          'CLI architecture, file discovery & repository management',
          'CLI Architecture & artifact access',
        ],
        summary:
          'Unified Ink-based CLI framework with hierarchical menu navigation for plans, initiatives, and tasks.',
        justification:
          'All five subfacets describe overlapping CLI infrastructure concerns.',
      },
      {
        name: 'Agent Adapter Layer',
        mergedFrom: [
          'Agent Adapter Layer',
          'Agent adapter abstraction & response parsing',
          'agent adapters',
        ],
        summary:
          'Pluggable adapter interface enabling multi-agent support with standardized operations.',
        justification:
          'Three subfacets all address the same abstraction layer.',
      },
      {
        name: 'Artifact Synchronization',
        mergedFrom: [
          'Artifact Sync Protocol',
          'Artifact Synchronization',
          'Design doc extraction & editing',
          'Design doc extraction, artifact management & implementation hints',
          'Design doc extraction, editing & artifact management',
        ],
        summary:
          'Bidirectional sync protocol coordinating Hey Hey artifacts with coding agent outputs.',
        justification:
          'Five subfacets all describe artifact lifecycle management.',
      },
      {
        name: 'Session Credential Management',
        mergedFrom: [
          'Session Credential Management',
          'Credential & session lifecycle management',
          'Credential & authentication lifecycle',
          'Credential storage, encryption & platform integration',
          'credential lifecycle',
        ],
        summary:
          'End-to-end credential and session lifecycle spanning OAuth authentication with token refresh.',
        justification:
          'Five subfacets all address credential storage and session persistence.',
      },
      {
        name: 'API Authentication',
        mergedFrom: [
          'API authentication, authorization & token management',
          'endpoints and errors',
        ],
        summary:
          'OAuth-based authentication with organization context, RBAC, JWT tokens, and credential lifecycle.',
        justification:
          'Both subfacets describe API-level authentication and endpoint standardization.',
      },
      {
        name: 'Cost Management',
        mergedFrom: [
          'Cost Token Enforcement',
          'Cost tracking, token normalization & organization management',
        ],
        summary:
          'Organization-wide cost management and subscription enforcement with cross-provider normalization.',
        justification:
          'Both subfacets describe identical cost tracking concerns.',
      },
      {
        name: 'Event System',
        mergedFrom: [
          'Event system, data integrity & deduplication',
          'Event system, graph relationships & influence tracking',
          'Event system & data consistency',
          'event publishing',
          'event integration',
        ],
        summary:
          'Robust pub/sub event system with Redis message broker, event persistence, and replay capability.',
        justification:
          'Five subfacets all describe the event-driven architecture.',
      },
      {
        name: 'Graph Data Model',
        mergedFrom: [
          'Graph & vector data model, schema & topology',
          'database schema',
          'Database Schema Layer',
        ],
        summary:
          'Unified data model binding Neo4j nodes to embedding indices with canonical ID mapping.',
        justification:
          'Three subfacets all describe database schema and graph structure.',
      },
      {
        name: 'Search Hybrid Fusion',
        mergedFrom: [
          'Search Hybrid Fusion',
          'embedding ranking',
          'graph traversal',
        ],
        summary:
          'Hybrid search infrastructure blending Neo4j graph traversal with vector embeddings.',
        justification: 'Three subfacets all describe search infrastructure.',
      },
      {
        name: 'Workflow Orchestration',
        mergedFrom: ['Workflow Orchestration Engine', 'API integrations'],
        summary:
          'Scheduled cron workflows with configurable cadence and audit-driven entity processing.',
        justification:
          'Both subfacets describe workflow automation and orchestration.',
      },
      {
        name: 'Influence Registry',
        mergedFrom: [
          'Influence registry & provenance tracking',
          'Influence registry, provenance & cross-entity linking',
        ],
        summary:
          'Influence Registry with approved reasonType values and provenance chaining.',
        justification:
          'Both subfacets describe identical influence tracking mechanisms.',
      },
      {
        name: 'Error Handling',
        mergedFrom: ['Error handling, retry logic & resilience'],
        summary:
          'Structured error taxonomy with normalized error events and configurable retry policies.',
        justification:
          'Kept as single subfacet; distinct error handling concerns.',
      },
      {
        name: 'Cloud Deployment',
        mergedFrom: [
          'Cloud deployment, infrastructure & observability',
          'Service deployment, infrastructure & cloud architecture',
        ],
        summary:
          'Multi-service cloud deployment architecture covering five services with containerization.',
        justification:
          'Both subfacets describe identical cloud infrastructure concerns.',
      },
      {
        name: 'File Scanning',
        mergedFrom: ['File scanning, path resolution & codebase indexing'],
        summary:
          'Repository-scoped file system scanner with language detection and compact indexes.',
        justification:
          'Kept as single subfacet; distinct file discovery concerns.',
      },
      {
        name: 'CDRT Editing',
        mergedFrom: ['CDRT editing UI'],
        summary:
          'CDRT editing UI for inline editing of descriptions and details with real-time validation.',
        justification: 'Kept as single subfacet; distinct UI editing concerns.',
      },
      {
        name: 'Design Tokens',
        mergedFrom: ['design tokens'],
        summary:
          'Design system codifying typography, color, spacing, and component patterns.',
        justification:
          'Kept as single subfacet; distinct design system concerns.',
      },
      {
        name: 'Service Metadata',
        mergedFrom: [
          'Service metadata, implementation hints & design doc integration',
        ],
        summary:
          'Database table storing per-service implementation hints with indexed filtering.',
        justification:
          'Kept as single subfacet; distinct service metadata concerns.',
      },
      {
        name: 'Topology Consolidation',
        mergedFrom: [
          'Topology consolidation, summary generation & rollup management',
        ],
        summary:
          'Aggregates status and insights into centralized project summaries with version history.',
        justification:
          'Kept as single subfacet; distinct topology rollup concerns.',
      },
      {
        name: 'Data Persistence',
        mergedFrom: ['data persistence', 'encrypted storage'],
        summary:
          'Data persistence integrates Redis pub/sub with Neo4j for relationship-based context discovery.',
        justification:
          'Both subfacets describe data storage and encryption concerns.',
      },
      {
        name: 'UI Components',
        mergedFrom: [
          'ui components',
          'CLI UI infrastructure & component composition',
        ],
        summary:
          'React and Material-UI front-end with Ink-based terminal CLI and hooks-based data fetching.',
        justification:
          'Both subfacets describe UI infrastructure and component patterns.',
      },
      {
        name: 'Subscription Management',
        mergedFrom: ['subscription management'],
        summary:
          'Subscription management integrates OAuth-based authentication and session persistence.',
        justification:
          'Kept as single subfacet; distinct subscription concerns.',
      },
      {
        name: 'Interface Design',
        mergedFrom: ['Interface design, CLI conventions & agent integration'],
        summary:
          'CLI design document defining command hierarchy and interface conventions.',
        justification: 'Kept as single subfacet; distinct CLI design concerns.',
      },
      {
        name: 'Idempotent Deletion',
        mergedFrom: ['idempotent deletion'],
        summary:
          'Idempotent deletion leverages event-driven cascades with idempotency_key for reproducible deletions.',
        justification:
          'Kept as single subfacet; distinct cascade deletion concerns.',
      },
      {
        name: 'GitHub Integration',
        mergedFrom: ['Event system & data consistency'],
        summary:
          'GitHub as primary external integration for design-to-code workflow with OAuth and webhooks.',
        justification:
          'Extracted as distinct GitHub-specific integration concern.',
      },
    ],
    keptSubfacets: [
      {
        name: 'Coding Agents Strategy',
        reasonKept:
          'Distinct strategic decision scope covering agent selection, initial release scope, and artifact permissions.',
      },
    ],
    notes: [] as string[],
  };
}

/**
 * Build a map of mergedFrom → target name from the LLM output.
 * Useful for verifying entity remapping in tests.
 */
export function createMergeMap(): Map<string, string> {
  const output = createConsolidationLlmOutput();
  const map = new Map<string, string>();
  for (const merged of output.mergedSubfacets) {
    for (const from of merged.mergedFrom) {
      map.set(from.toLowerCase(), merged.name);
    }
  }
  return map;
}

/**
 * Creates mock entity summaries that reference the pre-consolidation subfacets.
 * Each entity references 1-3 subfacets from the old set.
 */
export function createPreConsolidationEntitySummaries() {
  const subfacets = createPreConsolidationSubfacets();
  const subfacetByName = new Map(
    subfacets.map((sf) => [sf.name.toLowerCase(), sf]),
  );

  const entities = [
    {
      entityType: EntityType.TASK,
      entityId: 'task-001',
      summary: 'Implement CLI menu navigation',
      subfacetNames: [
        'CLI Agent Orchestration',
        'CLI Architecture Integration',
      ],
    },
    {
      entityType: EntityType.TASK,
      entityId: 'task-002',
      summary: 'Add OAuth token refresh logic',
      subfacetNames: [
        'credential lifecycle',
        'API authentication, authorization & token management',
      ],
    },
    {
      entityType: EntityType.TASK,
      entityId: 'task-003',
      summary: 'Set up Redis event bus',
      subfacetNames: [
        'event publishing',
        'Event system, data integrity & deduplication',
      ],
    },
    {
      entityType: EntityType.TASK,
      entityId: 'task-004',
      summary: 'Design doc sync protocol',
      subfacetNames: [
        'Artifact Sync Protocol',
        'Design doc extraction & editing',
        'Design doc extraction, artifact management & implementation hints',
      ],
    },
    {
      entityType: EntityType.TASK,
      entityId: 'task-005',
      summary: 'Deploy cloud infrastructure',
      subfacetNames: ['Cloud deployment, infrastructure & observability'],
    },
    {
      entityType: EntityType.INITIATIVE,
      entityId: 'init-001',
      summary: 'Consolidate agent adapters',
      subfacetNames: ['Agent Adapter Layer', 'agent adapters'],
    },
  ];

  return entities.map((e) => ({
    entityType: e.entityType,
    entityId: e.entityId,
    summary: e.summary,
    category: CATEGORY,
    organizationId: fixtureIds.organizationId,
    projectId: fixtureIds.projectId,
    updatedAt: new Date('2026-01-20T00:00:00Z'),
    subfacets: e.subfacetNames.map((name) => {
      const sf = subfacetByName.get(name.toLowerCase());
      return {
        id: sf?.id ?? `sf-unknown-${name}`,
        name: sf?.name ?? name,
        updatedAt: sf?.updatedAt ?? new Date(),
      };
    }),
  }));
}

/**
 * Returns the expected subfacet names after consolidation.
 * 24 merged targets + 1 kept = 25 total.
 */
export function expectedPostConsolidationSubfacetNames(): string[] {
  const output = createConsolidationLlmOutput();
  const merged = output.mergedSubfacets.map((m) => m.name);
  const kept = output.keptSubfacets.map((k) => k.name);
  return [...merged, ...kept];
}

/**
 * All source subfacet names that should be deprecated after consolidation.
 * These are the mergedFrom names that are NOT also a target name.
 */
export function expectedDeprecatedSubfacetNames(): string[] {
  const output = createConsolidationLlmOutput();
  const targetNames = new Set(
    output.mergedSubfacets.map((m) => m.name.toLowerCase()),
  );
  const allMergedFrom = output.mergedSubfacets.flatMap((m) => m.mergedFrom);
  return allMergedFrom.filter((name) => !targetNames.has(name.toLowerCase()));
}
