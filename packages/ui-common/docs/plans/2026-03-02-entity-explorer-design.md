# Entity Explorer — Consolidated Design

## Overview

The Entity Explorer is a unified surface for browsing, searching, previewing, and selecting entities across the application. It consolidates several existing use cases — global navigation, entity search, reference insertion, and evidence curation — into a single, consistent component with composable behavior layers.

## Design Principles

1. **Consistent interaction model.** Click on a result always means preview, regardless of context. No mode-dependent behavior changes. Muscle memory is preserved.
2. **Composition over modes.** Different use cases are handled by layering capabilities (selection, curation) on top of the base explorer, not by switching the explorer into different modes.
3. **Browse and search are fluid, not separate.** There are no tabs or mode toggles between browsing and searching. Typing in the search bar transitions from browse to search results; clearing it returns to browse.

## Core Explorer

### Layout

The explorer is a **floating, resizable, movable panel** — not a traditional modal. It opens over the content but does not block page interaction with an overlay. This enables:

- Drag and drop from the explorer to any valid drop target on the page
- Continued interaction with the underlying UI while the explorer is open
- User control over size and position

Dismissal is via an explicit close button or Escape key (not click-outside, since the page remains interactive).

### Structure

```
+-----------------------------------+
| [Search...                ] [Cfg] |
| Searching in: My Plan [x]        |
| [Plans] [Tasks] [Documents]      |  <- filter chips, toggleable
+-----------------------------------+
| Project > My Plan >              |  <- breadcrumbs (clickable)
|                                   |
| (browse view or search results,  |
|  same content area)               |
|                                   |
+-----------------------------------+
| [Add 2 items]                    |  <- only when selection layer active
+-----------------------------------+
```

### Browse Mode (Drill-Down)

When the search bar is empty, the explorer shows a **drill-down directory view**:

- **Top level** shows entity types that serve as root containers: Initiatives, Plans, Services, Coding Sessions.
- Clicking a **container** (e.g., an initiative) drills down to show its children. The previous view is replaced entirely; breadcrumbs update to reflect the current path.
- Clicking an **entity title** opens a full-screen preview within the panel. A back button returns to the previous list. Scroll position and any active selections are preserved on return.
- Containers display a **chevron/arrow** on the right side to indicate they can be drilled into. This is a distinct click target from the title.

This is a drill-down model, not an expanding tree. Rationale:

- The entity hierarchy has real depth (Initiative > Plan > Stage > Task > subtask/document). Expanding trees at 4-5 levels with siblings at each level create scroll and indentation problems, especially in a panel.
- Users are navigating to find a specific thing, not analyzing the full structure. Breadcrumbs provide sufficient positional context.
- Consistent use of available space regardless of depth.

### Search

- **Search bar is always visible** at the top of the explorer.
- Typing in the search bar replaces the browse view with search results. Clearing the search bar returns to the browse view at the same position.
- **Breadcrumbs remain visible during search** and indicate the current search scope.

#### Scope

- **Browse starts scoped to context.** If opened from within a plan, the explorer starts drilled into that plan.
- **Search defaults to the current breadcrumb scope.** If drilled into a plan, search runs within the plan.
- Scope is visible and overridable: `Searching in: My Plan [x] [Search all]`. Clicking a breadcrumb ancestor widens scope and automatically reruns any active search.

#### Title vs. Semantic Search

Users do not choose a search mode. The system handles it:

1. User types a query. **Title search runs immediately** (fast, predictable).
2. If title search **returns results**, those are displayed. A "Search by content" link is available at the bottom for users who want it.
3. If title search **returns zero results**, semantic search runs automatically and results appear under a **"Results by content"** header.

The "Results by content" header is important — it explains why results don't match the search text literally and prevents the appearance of broken search.

```
Search: "auth decision rationale"

-- By title --------------------------
  (no results)

-- By content -------------------------
  Architecture Review - Stage 2
  Technical Decisions Log
  Sprint 14 Retrospective
```

#### Type Filters

- Displayed as toggleable chips below the search bar: `Plans`, `Tasks`, `Documents`, `Sessions`, etc.
- Persist across searches until explicitly cleared.
- Apply in both browse mode (hide entity types from the directory view) and search mode (filter results).
- Can be configured externally by the calling context (e.g., "only show tasks") or toggled internally by the user.

### Search Results vs. Browse Results

**Browse mode:** Entities are displayed within the hierarchy. Containers show a drill-down chevron. The view is spatial — you are moving through a tree.

**Search results:** Flat list. Every result is a leaf regardless of its entity type. No drill-down affordance, no chevron, no tree behavior. Click previews. This avoids the complexity of "I searched, found an initiative, drilled into it, and now the search query, scope, and navigation state are all confused."

If a user searches, finds an initiative, and wants to see its children, they use the "go to" affordance to navigate to it in the main site, or they clear the search and browse to it.

### Entity Row Affordances

Every entity row in the explorer (whether browsing or searching) has:

| Element | Action |
|---------|--------|
| Entity title (click) | Preview entity content (full-screen within panel, back to return) |
| Chevron/arrow right (browse only) | Drill down into children |
| Go-to icon (always present) | Navigate to the entity's page in the main site |
| Checkbox (selection layer only) | Toggle selection |

## Selection Layer

Selection is **not a mode** — it is an additional UI layer rendered when the calling context requires entity selection. The base explorer behavior is unchanged.

### Behavior

- **Checkboxes appear** alongside each entity row.
- Clicking a checkbox toggles selection. Clicking the entity title still previews (unchanged).
- A **persistent action bar** at the bottom of the panel shows the count and a confirm button: `Add 2 items` / `Insert 3 references`.
- **Always multi-select.** Even in cases where only one entity is expected, the interaction is the same: check items, hit the button. This preserves consistency. The cost of selecting an extra item by mistake is trivially low (e.g., backspace a reference in a conversation).
- Selections **persist across preview navigation and browse navigation** within the explorer. Drilling into a folder, previewing an entity, and returning does not clear selections.
- Scroll position is also preserved when returning from a preview.

### How Selection Gets Activated

The calling context determines whether the selection layer is present:

- **Global search** (e.g., search button in nav) → no selection layer. Browse, search, preview, navigate.
- **Reference insertion** (e.g., from conversation input, or upgraded from @ mention) → selection layer active. User checks items, hits "Insert."
- **Curate / evidence editing** → selection layer active via the list view's "Add items" action (see below).

The explorer itself doesn't know what happens with the selections. It returns them to the caller and closes.

## Curate List View (Separate Component)

The curate use case — viewing and editing a pre-configured list of entities (e.g., coding session evidence) — is **not part of the explorer**. It is a separate list component that composes with the explorer.

### Behavior

- Displays the current curated set of entities.
- Supports **reordering** (drag and drop within the list).
- Supports **removal** (remove items from the list).
- Supports **preview** (click to view entity content).
- Has an **"Add items" button** that opens the explorer with the selection layer active. Selections returned from the explorer are added to the list.

This decomposition avoids tabs or mode-switching within the explorer. The list owns the curated state; the explorer is just a tool for finding things to add.

## Integration: @ Mentions

The existing @ mention UX (type `@` in a text input, get title search results) remains as a lightweight, inline option. It works well for the common case of "I roughly know the name."

For the case where @ mention falls short — "I know where the document is but not the name," or "show me recent tasks" — the explorer serves as the **escalation path**. The @ mention popover could include a "Browse for more..." action that opens the full explorer with the selection layer active.

## Drag and Drop

Because the explorer is a floating, resizable panel (not an overlay modal), drag and drop is supported as a general affordance:

- Any entity row in the explorer can be dragged to a valid drop target on the page (conversation input, task reference field, evidence list, etc.).
- Drag and drop produces the same result as check-and-insert — it's an alternative path, not a different mechanism.
- Drag and drop should also work from other surfaces (e.g., sidebar navigation items) using the same entity reference payload.

Enabling this requires the panel to be movable/resizable so the user can position it alongside the drop target — the same pattern used by OS file managers.

## Open Questions

1. **Keyboard navigation.** The drill-down browse, search, preview, and selection interactions should all be keyboard-accessible. Specific keybindings (arrow keys for navigation, Enter for preview, Space for checkbox toggle, Escape for back/close) need to be defined.
2. **@ mention → explorer transition.** The exact UX for escalating from an @ mention popover to the full explorer needs design. Does the popover have a "Browse..." button? Does a keyboard shortcut open the explorer directly from the text input?
3. **Drag and drop scope.** Which surfaces accept entity drops? Conversation inputs are the obvious case, but task fields, evidence lists, and potentially the sidebar could also be drop targets. The full set of valid targets needs enumeration.
4. **Panel state persistence.** If the user resizes/repositions the explorer, should that persist across opens? Across sessions?
5. **Deep linking from preview.** When previewing an entity that references other entities (e.g., a document that mentions a task), can you interact with those references? Navigate to them? This could create recursive explorer-within-explorer patterns that need boundaries.
