# OpenAPI Specification Structure

This directory contains the modular OpenAPI specifications for the Hey Hey platform, including core API, agents, graphs, embeddings, and the transport-neutral Agent Bridge runtime contract.

## File Structure

```
specs/
├── agent-bridge/             # Transport-neutral paired CLI runtime contract
│   └── openapi.yaml
├── openapi.yaml              # Main specification file with references
├── paths/                    # API endpoint definitions by domain
│   ├── auth.yaml            # Authentication endpoints
│   ├── organizations.yaml   # Organization management
│   ├── projects.yaml        # Project management  
│   ├── conversations.yaml   # Conversation management
│   ├── messages.yaml        # Message management
│   ├── interaction-types.yaml # Interaction type management
│   ├── interaction-flows.yaml # Interaction flow steps (NEW)
│   ├── artifacts.yaml       # Artifact management
│   ├── tags.yaml           # Tag management
│   ├── events.yaml         # WebSocket/Event endpoints
│   ├── dev.yaml            # Development/testing endpoints
│   └── debug.yaml          # Debug endpoints
└── schemas/                  # Schema definitions by domain
    ├── common.yaml          # Shared types (IDs, ApiResponse, etc.)
    ├── auth.yaml           # Authentication schemas
    ├── organizations.yaml  # Organization schemas
    ├── projects.yaml       # Project schemas
    ├── conversations.yaml  # Conversation schemas
    ├── interaction-flows.yaml # Interaction flow schemas (NEW)
    ├── artifacts.yaml      # Artifact schemas
    ├── initiatives.yaml    # Initiative/task schemas
    ├── websockets.yaml     # WebSocket event schemas
    └── dev.yaml           # Development schemas
```

## Benefits of This Structure

1. **Maintainability**: Each domain is isolated, making changes easier
2. **Collaboration**: Teams can work on different domains independently
3. **Reusability**: Schemas can be shared across different specifications
4. **Clarity**: Smaller files are easier to understand and navigate
5. **Version Control**: Changes are more focused and easier to review

## Usage

### Primary Usage
Use `specs/openapi.yaml` as the main platform specification and `specs/agent-bridge/openapi.yaml` for Agent Bridge generation and runtime validation. The Agent Bridge document contains only signed triggers, run/prompt/response models, authorized remote reads, and Task Monitor contracts.

### Legacy Support
The original `api/openapi.yaml` remains unchanged for backward compatibility.

## Key Changes Made

1. **New Interaction Flow Endpoints**: Added complete CRUD operations for interaction flow steps
2. **Modular References**: All schema references updated to use relative paths
3. **Domain Separation**: Logical grouping by business domain
4. **Shared Components**: Common schemas centralized in `common.yaml`

## Working with the Split Files

### Adding New Endpoints
1. Add path definition to appropriate file in `paths/` directory
2. Add any new schemas to appropriate file in `schemas/` directory  
3. Update `openapi.yaml` to reference new paths/schemas if needed

### Schema References
- Use `../schemas/common.yaml#/SchemaName` for shared types
- Use `../schemas/[domain].yaml#/SchemaName` for domain-specific types
- Cross-references between schema files use `./[domain].yaml#/SchemaName`
- Agent Bridge-owned runtime references use `../agent-bridge/openapi.yaml#/components/schemas/SchemaName`.

### Path References
The main spec uses JSON Pointer encoding for path references:
- `/auth/login` → `./paths/auth.yaml#/~1auth~1login`
- `{parameter}` → `~1{parameter}`

## Generated Documentation

All tooling that worked with the original specification should work with the new modular structure, as the resolved specification is functionally identical.
