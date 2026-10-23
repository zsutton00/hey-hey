# API Specification (Deprecated)

⚠️ **DEPRECATED**: This directory contains the old standalone API specification approach.

## Migration Status

- `openapi.yaml.backup`: Original standalone specification (kept for reference)
- **Current approach**: Use the modular specification at `../openapi.yaml` with `paths/*.yaml` imports

## Reason for Deprecation

The standalone approach led to:
- 85+ duplicate operations across specifications
- Maintenance overhead (changes needed in multiple places)
- Inconsistent API definitions
- Client generation conflicts

## New Architecture

The project has migrated to a modular approach:
```
specs/
├── openapi.yaml                 # Main modular specification
├── paths/                       # Individual path definitions
│   ├── auth.yaml
│   ├── organizations.yaml
│   ├── projects.yaml
│   └── ...
├── schemas/                     # Schema definitions
└── shared/                      # Shared components across services
```

## Removal Plan

This directory will be removed in a future cleanup phase after confirming the modular approach works correctly with all build processes.