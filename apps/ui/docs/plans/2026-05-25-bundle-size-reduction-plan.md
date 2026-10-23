# Bundle Size Reduction Plan — Post-Investigation

## Status (as of May 25, 2026)

We completed an initial round of optimizations based on `bundle-size-investigation.md` (recommendations #1, #3, #5, #8). **The entry chunk shrank by only ~2% (~47 KB)** and total build output **increased** by ~1 MB due to chunking overhead. The root cause was identified: **barrel exports in `ui-common/components/index.ts` force Vite to preload every vendor chunk on the home page**, nullifying all lazy-loading efforts.

**Conclusion:** We must fix the barrel exports before any other optimization can meaningfully reduce initial download.

---

## The Problem

### Barrel Export Structure

```ts
// ui-common/src/components/index.ts
export * from "./Branding";
export * from "./Conversation";
export * from "./WorkItem";
export * from "./Plans";
// ... ~20+ more subdirectories
```

Each subdirectory has its own `index.ts`:

```ts
// ui-common/src/components/Conversation/index.ts
export { ConversationViewer } from "./ConversationViewer";
export { SystemMessage } from "./Components/SystemMessage";
// etc.
```

### Why This Breaks Lazy Loading

When `App.tsx` does:

```tsx
import { HeyHeyBranding } from "@hey-hey/ui-common/components";
```

Vite sees the barrel and conservatively tracks **all** exports for `__vite__mapDeps`. Even though `HeyHeyBranding` is tiny and has no heavy dependencies, Vite preloads:

- `diagram-vendor` (because `Conversation` exports → `ConversationViewer` → `SystemMessage` → `MermaidCodeBlock` → `await import("mermaid")`)
- `editor-vendor` (because `WorkItem` exports → `WorkItemReadView` → Lexical editor)
- `interaction-vendor` (because `WorkItem` exports → `WorkItemEditor` → filepond plugins)

**All our `React.lazy()` and `manualChunks` changes are correct, but Vite preloads the chunks anyway because the entry chunk transitively references them through the barrel.**

---

## The Solution

Replace the single `ui-common/components` barrel with **granular, targeted imports**.

### Target State

```tsx
// BEFORE (barrel import — transitively depends on everything)
import { HeyHeyBranding, ConversationViewer } from "@hey-hey/ui-common/components";

// AFTER (targeted imports — only depends on what you import)
import { HeyHeyBranding } from "@hey-hey/ui-common/components/Branding";
import { ConversationViewer } from "@hey-hey/ui-common/components/Conversation";
```

### Rules for the Refactor

1. **Never import from `@hey-hey/ui-common/components` (the barrel).**
2. **Import from the specific subdirectory** (e.g., `@hey-hey/ui-common/components/Conversation`).
3. **If a component is used in the entry chunk** (`App.tsx`, `Header.tsx`, `Layout.tsx`, etc.), ensure it has **no transitive heavy dependencies**.
4. **Keep `React.lazy()` for route-level pages** — this still works for page chunks, just not for vendor chunks preloaded via the barrel.
5. **Move heavy shared components out of the entry chunk's import chain** — if a component used by `App.tsx` transitively depends on mermaid, lexical, or filepond, it must be lazy-loaded or the dependency must be dynamically imported.

---

## Phase 1: Audit the Barrel (Low Risk, Information Gathering)

### 1.1 Map Which Subdirectories Are Actually Imported by the Entry Chunk

Goal: Find which `ui-common/components/*` subdirectories are imported by files that end up in the entry chunk.

```bash
# Find all imports from @hey-hey/ui-common/components in src/
rg 'from\s+"@hey-hey/ui-common/components"' src/ --type tsx --type ts

# For each file that imports from the barrel, check if it is in the entry chunk
# (use dist/chunk-manifest.txt or sourcemap analysis)
```

Expected output: A list of entry-chunk files and which barrel subdirectories they use.

### 1.2 Identify "Safe" vs "Heavy" Subdirectories

| Subdirectory | Heavy Dependencies? | Used in Entry Chunk? | Action |
|---|---|---|---|
| `Branding` | No | Likely yes | Safe to import directly |
| `Conversation` | Yes (`MermaidCodeBlock`) | Likely yes | **Must lazy-load `MermaidCodeBlock`** inside it, or break it up |
| `WorkItem` | Yes (Lexical, filepond) | Likely yes | **Must not be imported by entry chunk** |
| `Plans` | Yes (`@xyflow/react`) | Likely no | Safe if only lazy-loaded pages use it |

### 1.3 Verify with a Test Build

After mapping, do a test: manually change **one** entry-chunk file to import from a subdirectory instead of the barrel, run `pnpm build:container`, and verify that `dist/index.html` drops **at least one** `<link rel="modulepreload">`.

This validates that the barrel is indeed the root cause before we invest in a large refactor.

**Acceptance Criteria:**
- [ ] Document all entry-chunk files that import from the barrel
- [ ] Classify each subdirectory as "safe" or "heavy"
- [ ] Produce a single-file proof-of-concept showing that granular imports reduce preloads

---

## Phase 2: Break Up the Barrel (Medium Risk, Incremental)

### 2.1 Create a Migration Script

Write a script (similar to `scripts/convert-mui-icons-v3.cjs`) that:

1. Finds all `import { X } from "@hey-hey/ui-common/components"` statements
2. Looks up which subdirectory `X` is exported from (e.g., `Conversation/index.ts`)
3. Rewrites the import to `import { X } from "@hey-hey/ui-common/components/Conversation"`
4. Leaves type-only imports untouched

**Important:** The script must handle named exports correctly. Do NOT assume `X` is in a file named `X.tsx`; it might be re-exported from an `index.ts`.

### 2.2 Migrate Entry-Chunk Files First

Priority order (highest impact first):

1. `src/App.tsx`
2. `src/components/Header.tsx` or any shared layout components
3. `src/components/Auth/*` (login/register pages may be in entry chunk)
4. Any other file that `chunk-manifest.txt` shows in the entry chunk

For each file:
- Run the migration script on that file only
- Run `pnpm build:container`
- Verify `dist/index.html` drops preloads
- Verify `pnpm preview` works (navigate to home page, login, a project page)
- Commit

### 2.3 Migrate Everything Else

Once entry-chunk files are clean, migrate the remaining files (lazy-loaded pages, hooks, etc.). These have lower risk because they're already in separate chunks.

**Acceptance Criteria:**
- [ ] Zero imports from `@hey-hey/ui-common/components` in entry-chunk files
- [ ] `dist/index.html` has ≤ 3 preloaded vendor chunks (down from 8)
- [ ] Home page still loads and functions correctly

---

## Phase 3: Re-Apply Previous Optimizations (Low Risk)

Once the barrel is broken, the following changes (already made but currently ineffective) will **finally have impact**:

1. **Lazy-loaded `MermaidCodeBlock`** — Already done in `readViewMarkdownComponents.tsx` and `SystemMessage.tsx`. Once `SystemMessage` is no longer in the entry chunk's transitive deps, `diagram-vendor` will stop being preloaded.

2. **`manualChunks` changes** — `@mermaid-js/parser`, `prismjs`, `filepond-plugin-*`, `axios` splits are already in `vite.config.ts`. They will correctly stay out of the entry chunk once the barrel stops pulling them in.

3. **MUI icon deep imports** — Already done. May show a small improvement now that the entry chunk is cleaner.

**No code changes needed in Phase 3 — just rebuild and measure.**

**Acceptance Criteria:**
- [ ] `diagram-vendor` is NOT preloaded in `index.html`
- [ ] `editor-vendor` is NOT preloaded in `index.html`
- [ ] `interaction-vendor` is NOT preloaded in `index.html`
- [ ] Entry chunk is < 1,500 KB (target: < 1,000 KB)
- [ ] Total preloaded JS on home page is < 3,000 KB (down from ~5,500 KB)

---

## Phase 4: Apply Remaining Recommendations (Medium Risk)

With the barrel fixed, these now become viable:

### 4.1 Remove `reactflow` v11 from `ui-common` (Recommendation #2)
- `ui-common` uses both `reactflow` v11 and `@xyflow/react` v12
- Migrate `PlanExecutionGuidance.tsx`, `buildPlanGraph.ts`, `buildActivityGraphNodes.ts`, `ActivityGraphEntityNode.tsx` to `@xyflow/react`
- **Impact:** Removes duplicate React Flow code (~130 KB)

### 4.2 Lazy-load `AnimatePresence` from `motion` (Recommendation #6)
- `App.tsx` imports `{ AnimatePresence } from "motion/react"`
- Wrap the router's `AnimatePresence` in a tiny lazy-loaded wrapper, or remove it if not critical
- **Impact:** Removes ~310 KB from entry chunk

### 4.3 Lazy-load `socket.io-client` (Recommendation #7)
- `WebSocketProvider` wraps the app in `App.tsx`
- Make `WebSocketProvider` lazy-load `socket.io-client` internally
- **Impact:** Removes ~50 KB from entry chunk

### 4.4 Split `@mui/x-charts` and `@mui/x-date-pickers` (Recommendation #4)
- These are in `mui-vendor` because of the barrel
- Once barrel is fixed, they may naturally split out if only lazy pages use them
- If not, add them to `manualChunks` as `mui-x-vendor`
- **Impact:** Reduces `mui-vendor` by ~200+ KB

**Acceptance Criteria:**
- [ ] `reactflow` v11 removed from `ui-common/package.json`
- [ ] `motion` is not in entry chunk (or is justified)
- [ ] `socket.io-client` is not in entry chunk
- [ ] `mui-vendor` is < 700 KB

---

## Risk Assessment

| Phase | Risk | Mitigation |
|---|---|---|
| Phase 1 (Audit) | Very Low | No code changes; only analysis |
| Phase 2 (Break barrel) | Medium | Do one file at a time; `pnpm preview` after each; rollback via git |
| Phase 3 (Re-apply) | Low | Code is already written; just needs clean barrel to work |
| Phase 4 (Remaining) | Medium | Each change is isolated; can be done in separate PRs |

## Rollback Plan

If anything breaks during Phase 2:
1. `git checkout -- <file>` to restore the barrel import
2. Run `pnpm build:container` to verify the build still works
3. Debug the granular import path (e.g., `@hey-hey/ui-common/components/Branding` may not be a valid export path)

## Success Metrics

| Metric | Baseline (May 2026) | Target |
|---|---|---|
| Entry chunk size | 2,228 KB | < 1,000 KB |
| Home page preloaded JS | ~5,500 KB | < 3,000 KB |
| Home page preloaded gzipped | ~1,534 KB | < 900 KB |
| `diagram-vendor` preloaded? | Yes | **No** |
| `editor-vendor` preloaded? | Yes | **No** |
| `interaction-vendor` preloaded? | Yes | **No** |

## Next Immediate Action

**Start Phase 1.1:** Run the audit script to find which entry-chunk files import from `@hey-hey/ui-common/components`.
