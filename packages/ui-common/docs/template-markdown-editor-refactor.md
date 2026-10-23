# Template Markdown Editor Refactor Plan

## Goals

- Contain section state and collaboration wiring inside the `TemplateSectionPortal` so global editors no longer re-render per keystroke.
- Provide a template-agnostic orchestration layer that only worries about layout, save controls, and summary UI.
- Prepare a shared surface so ADR, RFC, and future design docs can plug into the same section runtime APIs.

## Architecture Snapshot

```
TemplateMarkdownEditor
 ├─ builds section map from `template.sections` + runtime descriptors
 ├─ renders `<TemplateSectionPortal />` for each section
 ├─ tracks high-level collaboration statuses for optional overlays
 └─ surfaces save buttons / debug panel / layout shell

TemplateSectionPortal (new)
 ├─ owns local markdown state (fallback when collab disabled)
 ├─ instantiates `useCollabSectionClient` when descriptors omit `clientState`
 ├─ syncs CRDT → editor via existing `TemplateEditorSection` hooks
 ├─ emits `TemplateSectionChangeEvent` up to section-level + global callbacks
 └─ memoized so sibling updates do not cause re-renders
```

Key types (all in `src/types/templateEditor.ts`):

- `TemplateMarkdownSectionDefinition`: declarative runtime config (initial text, placeholder overrides, collaboration descriptor, section-level `onChange` hooks).
- `TemplateSectionChangeEvent`: normalized payload bubbled up from every section.

## Migration Steps for ADR

1. **Describe section runtimes**  
   Build a memoized array of `TemplateMarkdownSectionDefinition` objects inside `AdrEditorContentEditor`. Each entry links a template section id (context/decision/consequences) to:
   - fallback markdown from the REST payload (`materializedMarkdown`)
   - collaboration descriptor (`section`, `sectionId`, `wsBaseUrl`, `connectOnStart`)
   - ADR-specific onChange hooks (analytics, autosave toggles, etc.)

2. **Drop shared state**  
   Remove the local `fallbackContent` object and the per-section `handleXContentChange` callbacks. After the refactor the parent component only needs to:
   - wire `onSectionChange` if we still need global notifications (e.g., dirty tracking)
   - provide `sections` + `template`

3. **Adopt TemplateMarkdownEditor**  
   Replace the custom `<AdrSectionEditor />` list with:

   ```tsx
   <TemplateMarkdownEditor
     template={adrTemplate}
     sections={sectionDefinitions}
     entityName="ADR"
     saveStatus={saveStatus}
     saveMode={saveMode}
     hasUnsavedChanges={hasUnsavedChanges}
     // ...existing save props
     onSectionChange={handleSectionChangeEvent}
     renderCollaborationStatus={(statuses) => (
       <CollabLoadingProgress
         contextStatus={statuses.context ?? DEFAULT_STATUS}
         decisionStatus={statuses.decision ?? DEFAULT_STATUS}
         consequencesStatus={statuses.consequences ?? DEFAULT_STATUS}
       />
     )}
   />
   ```

   Because each `TemplateSectionPortal` owns local state + the collab client, sibling renders are isolated.

4. **Expose Yjs handles to other consumers**  
   Suggested-content cards currently pull live content via `collaborationSections[sectionId].clientState`. Once ADR migrates, forward the `UseCollabSectionClientReturn` through `DesignDocCollabProvider` (already wired in `AdrEditorContentEditor`) so downstream widgets continue to apply diffs via the bridge.

5. **Clean up legacy hooks**  
   Delete `useSections`, `useCollaborationSections`, and the bespoke `AdrSectionEditor` once ADR uses the template editor directly. Shared utilities (`buildContextSectionConfig` etc.) can supply template metadata to both the runtime definitions and the template object.

## Follow-Up Considerations

- **Validation / metrics:** section descriptors can accept extra metadata (e.g., `metricsTag`, `required`) without changing the parent. Template sections can read those via `runtime` props and show inline badges/toolbars.
- **Awareness / cursors:** once we centralize Yjs per section we can expose awareness handles via context, letting other panes (e.g., conversation sidebar) highlight active authors.
- **Testing:** create storybook stories showcasing `TemplateMarkdownEditor` with/without collaboration, ensuring skeleton + memoization behavior is easy to verify.
