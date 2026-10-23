# Design Doc Types Expansion & Generic Staged Content Support

## Context
Currently, the system's Design Document implementation is tightly coupled to the **ADR (Architecture Decision Record)** format, consisting of specific sections: `context`, `decision`, `consequences`, and `statusNotes`.

We need to introduce additional design document types. Specifically, two new types are planned which will be **single-section** documents. To support this and future types (like RFCs), we need to refactor the underlying types and adapters to be template-agnostic and data-driven.

## Problem
1.  **Type Rigidity**: The `StagedDesignDoc` interface (in `src/types/staged-design-doc.types.ts`) hardcodes ADR-specific fields (`context`, `decision`, `consequences`).
2.  **Hardcoded Logic**: The `DesignDocStagedContentAdapter` (in `src/adapters/staged-content/design-doc.adapter.ts`) contains hardcoded mapping and validation logic specific to ADRs.
3.  **Limited Extensibility**: Adding a new template currently requires modifying TypeScript interfaces, Adapter logic, and Service presets.

## Proposed Solution

### 1. Database Changes
Update the `DesignDocTemplate` enum in `prisma/schema.prisma` to include the new types.
*   *Current*: `CLASSIC`, `ADR`, `RFC`
*   *Proposed*: Add `ONE_PAGER`, `RESEARCH_NOTE` (or specific names as required).

### 2. Type Refactoring (`StagedDesignDoc`)
Refactor `StagedDesignDoc` to separate metadata from content sections.

**Current:**
```typescript
export interface StagedDesignDoc extends StagedContentBase {
  name: string;
  template: string;
  context: string;      // ADR specific
  decision: string;     // ADR specific
  consequences: string; // ADR specific
  statusNotes: string;  // ADR specific
  tags?: string[];
}
```

**Proposed:**
```typescript
export interface StagedDesignDoc extends StagedContentBase {
  name: string;
  template: string;
  tags?: string[];
  
  // Dynamic access to sections
  sections: Record<string, string>;
  
  // Optional getters for backward compatibility (if needed) or removed entirely
  // context?: string;
}
```

### 3. Service Layer Updates (`DesignDocService`)
Update `TEMPLATE_SECTION_PRESETS` to support the new templates.

```typescript
const TEMPLATE_SECTION_PRESETS: Record<DesignDocTemplateType, string[]> = {
  ADR: ['context', 'decision', 'consequences', 'statusNotes'],
  RFC: ['summary', 'motivation', 'design', 'drawbacks', 'alternatives'],
  ONE_PAGER: ['content'], // Example single-section doc
  RESEARCH_NOTE: ['notes'], // Example single-section doc
  CLASSIC: ['context', 'decision', 'consequences', 'statusNotes'],
};
```

### 4. Adapter Refactoring (`DesignDocStagedContentAdapter`)
The adapter must become data-driven, relying on the `ContentTypeDefinition` rather than hardcoded switches.

#### Generic Mapping
Update `mapDesignDocToStagedDesignDoc` to populate the `sections` map dynamically from the materialized sections.

```typescript
private mapDesignDocToStagedDesignDoc(designDoc: DesignDocResponseDto): StagedDesignDoc {
  const sections: Record<string, string> = {};
  designDoc.sections.forEach(s => {
    sections[s.key] = s.materializedMarkdown || '';
  });

  return {
    id: designDoc.id,
    // ... other metadata
    sections,
  };
}
```

#### Generic Validation
Replace the switch-case in `validateStageContent` with a generic validator that looks up the stage definition and rules.

```typescript
async validateStageContent(entityId, stageId, orgId): Promise<ValidationError[]> {
  // 1. Fetch entity
  // 2. Get content for the stage key (which usually matches stageId or is mapped)
  const content = stagedDoc.sections[stageId] || '';
  
  // 3. Get validation rules for this stage from ContentTypeRegistry
  // (We need to look up the ContentTypeDefinition based on the doc's template)
  const validationRules = this.getValidationRules(doc.template, stageId);
  
  // 4. Apply rules (min_length, required, etc.)
  return this.applyRules(content, validationRules);
}
```

### 5. Content Type Registry
Ensure that different Design Doc templates are registered as distinct `ContentTypeDefinition`s (e.g., `design-doc-adr`, `design-doc-rfc`, `design-doc-simple`) OR a single `design-doc` type that can handle variations.
*   *Recommendation*: Use a single `design-doc` content type ID but allow the `stages` definition to vary or be superset. 
*   *Alternative (Better)*: Register separate content types for each template if their stages (workflow) differ significantly. If they share the same "lifecycle" but just have different content, we might keep one `ContentType` but map stages dynamically.
    *   However, `staged-content` framework relies on `ContentTypeId`. If an ADR has 3 stages and a Note has 1 stage, they act like different Content Types in the workflow engine.
    *   **Decision**: We might need to register `design-doc-adr`, `design-doc-onepager` etc., or make the `design-doc` ContentType dynamic. 
    *   *Simplest approach for now*: Keep `design-doc` as the Content Type ID, but make the `stages` definition aware of the template, OR simply allow the Adapter to handle the mapping and validation, effectively hiding the template differences from the high-level orchestrator if the high-level workflow is just "Draft -> Review -> Final".
    *   If the workflow *steps* are different (ADR: Context -> Decision -> Consequences; Note: Write -> Finish), then they strictly are different Content Types in the Staged Content world.
    *   **Proposed Strategy**: Register `design-doc` as the master type, but allow the Registry to return specific definitions based on a subtype/template key if possible. If not, we simply define `design-doc` to have the union of all possible stages, or we register `design-doc:adr`, `design-doc:note` etc.

## Implementation Plan

1.  **Modify `StagedDesignDoc` type**: Add `sections: Record<string, string>`.
2.  **Update `DesignDocService`**: Add new templates and presets.
3.  **Refactor Adapter**:
    *   Remove hardcoded field access.
    *   Implement generic validation.
4.  **Update `DesignDocTemplate` Enum**: Run migration.
5.  **Verify**: Ensure existing ADRs still work (mapping `sections['context']` works for legacy code if we keep the getters or update consumers).

## Migration Considerations
*   Existing code accessing `stagedDoc.context` will break. We should use a getter or update all call sites to `stagedDoc.sections['context']`.
*   Given this is an internal refactor, updating call sites is preferred for cleanliness.
