# Initiative Detail Page Tabs Design

**Date:** 2025-11-25
**Status:** Approved
**Component:** InitiativeDetailPage

## Overview

Add tabs to the Initiative Detail Page to organize content into three sections: Initiative details, Tasks, and Design Documents. This addresses the issue of requiring long scrolling to access tasks by making content accessible through tabs.

## Problem Statement

Currently, the Initiative Detail Page displays all content in a single vertical layout:
- Initiative details (description, technical details, acceptance criteria)
- Tasks section (TaskList component)

Users must scroll significantly to reach the tasks section, especially when initiative details are lengthy. This creates poor UX for users who primarily want to work with tasks.

## Solution

Implement a tabbed interface using Material-UI Tabs component with URL-based state management to organize content into three distinct sections.

## Design

### Tab Structure

Three tabs will be available:
1. **Initiative** - Initiative details (description, technical details, acceptance criteria)
2. **Tasks** - Task list and task management functionality
3. **Design Documents** - Placeholder for future functionality

### State Management

URL-based state management using the `nuqs` library:
- Tab selection stored in URL query parameter: `?tab=initiative|tasks|documents`
- Default tab: `initiative`
- Type-safe tab values using `parseAsStringLiteral`
- Benefits:
  - Bookmarkable/shareable tab URLs
  - Browser back/forward button support
  - Tab persists on page refresh
  - Follows codebase URL state management patterns

### Component Structure

```
Header (unchanged)
├── Breadcrumbs
├── Back button
├── Title
└── Edit button

Tabs Component (NEW)
├── Initiative tab
├── Tasks tab
└── Design Documents tab

Tab Panels (conditional rendering)
├── Initiative Panel (activeTab === 'initiative')
│   └── Paper with initiative details (existing content)
├── Tasks Panel (activeTab === 'tasks')
│   └── TaskList component (existing content)
└── Documents Panel (activeTab === 'documents')
    └── "Coming soon" placeholder

Modals (unchanged, rendered outside tabs)
└── NewTaskModal
```

### Implementation Details

**New Dependency:**
```bash
pnpm add nuqs
```

**Imports:**
```typescript
import { Tabs, Tab } from '@mui/material';
import { useQueryState, parseAsStringLiteral } from 'nuqs';
```

**Tab State Hook:**
```typescript
const [activeTab, setActiveTab] = useQueryState(
  'tab',
  parseAsStringLiteral(['initiative', 'tasks', 'documents'] as const)
    .withDefault('initiative')
);
```

**Tabs Component:**
```typescript
<Tabs
  value={activeTab}
  onChange={(_, newValue) => setActiveTab(newValue)}
  sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}
>
  <Tab label="Initiative" value="initiative" />
  <Tab label="Tasks" value="tasks" />
  <Tab label="Design Documents" value="documents" />
</Tabs>
```

**Tab Panels:**
- Each panel conditionally renders based on `activeTab` value
- Initiative panel: Existing Paper component with initiative details
- Tasks panel: Existing TaskList component
- Documents panel: Paper with centered "Coming soon" message

### Code Changes

**Files Modified:**
- `src/pages/Initiatives/Details/InitiativeDetailPage.tsx`

**Changes:**
1. Add `nuqs` import and hook
2. Add MUI Tabs/Tab imports
3. Add tab state management after existing hooks
4. Insert Tabs component after header section (line ~253)
5. Wrap initiative details Paper in conditional render
6. Wrap TaskList in conditional render
7. Add documents tab panel with placeholder
8. Keep modals outside tab conditionals

**No Changes Required:**
- All existing event handlers remain unchanged
- All data fetching logic remains unchanged
- NewTaskModal remains at bottom, outside tab panels
- Header section (breadcrumbs, buttons) remains unchanged

### Design Documents Tab

The Design Documents tab will show a simple placeholder:
```typescript
<Paper elevation={1} sx={{ p: 3 }}>
  <Typography variant="h6" color="text.secondary" align="center">
    Coming Soon
  </Typography>
  <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 1 }}>
    Design documents functionality will be available in a future release.
  </Typography>
</Paper>
```

Future implementation will show a list of design documents related to the initiative using the existing `useDesignDocs` hook and design document components.

## Testing Considerations

**Existing Tests:**
- Most tests should continue to pass
- Tests checking initiative details may need `?tab=initiative` in URL
- Tests checking tasks may need `?tab=tasks` in URL

**New Test Scenarios:**
- Tab switching changes URL parameter
- URL parameter determines active tab
- Default tab is "initiative"
- Invalid tab parameter falls back to default
- Browser back/forward buttons work with tabs

## Benefits

1. **Improved UX:** No scrolling required to access different content sections
2. **Bookmarkable:** Users can share direct links to specific tabs
3. **Browser-friendly:** Back/forward buttons work naturally
4. **Persistent:** Tab selection survives page refresh
5. **Future-ready:** Design Documents tab prepared for future implementation
6. **Clean Code:** Minimal changes to existing logic, just reorganizing presentation

## Alternatives Considered

**Local State with useState:**
- Simpler implementation
- No URL dependency
- **Rejected:** Doesn't persist on refresh, can't bookmark/share tabs, violates codebase URL state patterns

## Implementation Checklist

- [ ] Install nuqs package
- [ ] Add imports for Tabs, Tab, and nuqs
- [ ] Add tab state management hook
- [ ] Insert Tabs component in JSX
- [ ] Wrap initiative details in conditional
- [ ] Wrap TaskList in conditional
- [ ] Add documents placeholder panel
- [ ] Run type-check to verify no TypeScript errors
- [ ] Test tab switching functionality
- [ ] Test URL parameter synchronization
- [ ] Update integration tests if needed
