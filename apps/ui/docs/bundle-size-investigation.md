# Bundle Size Investigation — May 2026

## Executive Summary

The production build produces **~11.5 MB of minified JavaScript** across all chunks. On the home page alone, the browser downloads **~5.5 MB of JavaScript** (after gzip: ~1.5 MB). The two largest files are:

- `index-BPFj_Ji6.js` — **2,228 KB** (entry chunk)
- `diagram-vendor-BJxULxEN.js` — **2,842 KB**

Both are loaded on the home page even though most of their content is not executed there.

---

## Chunk Inventory (minified, sorted by size)

| Chunk | Size (KB) | Gzip (KB) | Preloaded on home? |
|---|---|---|---|
| `diagram-vendor` | 2,842 | 811 | **Yes** |
| `index` (main entry) | 2,228 | 576 | **Yes** (it IS the entry) |
| `render-TAZW7USW` (elkjs) | 1,456 | 446 | **Yes** (via mermaid) |
| `mui-vendor` | 985 | 291 | **Yes** |
| `index-CyIggHXv` | 294 | 80 | **Yes** (secondary entry) |
| `react-vendor` | 270 | 89 | **Yes** |
| `editor-vendor` | 263 | 88 | **Yes** |
| `interaction-vendor` | 153 | 50 | **Yes** |
| `data-vendor` | 110 | 33 | **Yes** |
| `CompleteSessionPanel` | 126 | 44 | No (lazy) |
| `ProjectPage` | 73 | 20 | No (lazy) |
| `Home` | 34 | 8 | No (lazy) |

**Total preloaded on home page: ~5,481 KB minified / ~1,534 KB gzipped.**

---

## Root Cause #1: Mermaid dominates the bundle (~4.2 MB)

### What is in `diagram-vendor` (2,842 KB)?

- `mermaid` v11 — the diagram rendering library
- `cytoscape` + `cytoscape-cose-bilkent` + `cytoscape-fcose` — graph layout engines
- `dagre` — another graph layout engine
- `chevrotain` — parser building toolkit (mermaid's dependency)
- `@iconify/utils` with full emoji support (~150 emoji regex/parser files)
- `vscode-languageserver-protocol` + `vscode-jsonrpc` + `vscode-languageserver-types`
- `dayjs` with all plugins
- `lodash` utilities (`isBuffer`, `_cloneBuffer`)
- `@braintree/sanitize-url`

### What is in `render-TAZW7USW` (1,456 KB)?

- `elkjs` (WebAssembly-based layout engine) — loaded by `@mermaid-js/layout-elk`

### Why is it loaded on the home page?

`MermaidCodeBlock.tsx` (in `ui-common`) does `await import("mermaid")` dynamically. However, the component itself is **not** lazy-loaded. It is eagerly imported by:

1. `readViewMarkdownComponents.tsx` — `import { MermaidCodeBlock } from "./MermaidCodeBlock"`
2. `SystemMessage.tsx` — `import { MermaidCodeBlock } from "../../shared/MermaidCodeBlock"`

Both files are part of the `ui-common/components` barrel:

```
ui-common/src/components/index.ts
  → export * from "./Conversation"
  → Conversation/index.ts exports { ConversationViewer }
  → ConversationViewer.tsx imports { SystemMessage }
  → SystemMessage.tsx imports { MermaidCodeBlock }
```

Because `MermaidCodeBlock` is referenced in the entry chunk, Vite considers `diagram-vendor` a **reachable dynamic-import target** and injects a `<link rel="modulepreload">` for it into `index.html`:

```html
<link rel="modulepreload" crossorigin href="/assets/diagram-vendor-BJxULxEN.js">
```

The browser downloads it immediately, even though it is only needed when a user views a markdown block containing a mermaid code fence.

### @mermaid-js/parser leakage

The `manualChunks` rule in `vite.config.ts` only catches `/node_modules/mermaid/`. It misses `/node_modules/@mermaid-js/`, so `@mermaid-js/parser` chunks ended up in the main `index` entry chunk instead of `diagram-vendor`. This is a minor bug in the regex.

---

## Root Cause #2: `@xyflow/react` v12 AND `reactflow` v11 coexist

`ui-common/package.json` declares **both** dependencies:

```json
"@xyflow/react": "^12.8.1",
"reactflow": "^11.11.4"
```

- The **UI** project uses `@xyflow/react` (v12) in `WorkflowManagement/` components.
- **ui-common** still imports from `reactflow` (v11) in:
  - `components/Plans/PlanExecutionGuidance.tsx`
  - `components/Plans/buildPlanGraph.ts`
  - `components/Activity/buildActivityGraphNodes.ts`
  - `components/Activity/ActivityGraphEntityNode.tsx`

Because of Vite's `resolve.dedupe` config and the source aliases, both versions end up in the bundle:

- `style-B4utwIaN.js` (87 KB) contains `@reactflow/core` v11 + `zustand` + `classcat`
- `Intake-Czh3Qzld.js` (46 KB) contains `@reactflow/controls` v11
- The v12 `@xyflow/react` code may be inlined into the `index` entry chunk (not visible in `manualChunks`)

**Recommendation:** Consolidate on one version. `reactflow` v11 should be removed from `ui-common`.

---

## Root Cause #3: `@mui/icons-material` barrel imports pull in every icon

`mui-vendor` is **985 KB** (291 KB gzipped). A large portion of this is `@mui/icons-material`, which is imported via the top-level barrel:

```tsx
import { AccessTime, AccountCircle } from "@mui/icons-material";
```

This causes Rollup to tree-shake *every* icon file into the vendor chunk. The chunk manifest shows thousands of `Abc.js`, `AcUnit.js`, `AccessAlarm.js`, etc.

The fix is to use deep imports:

```tsx
import AccessTime from "@mui/icons-material/AccessTime";
import AccountCircle from "@mui/icons-material/AccountCircle";
```

This would leave unused icons out of the bundle entirely.

---

## Root Cause #4: `@mui/x-charts` and `@mui/x-date-pickers` are in the initial vendor chunk

`@mui/x-charts` contributes **278 files** and `@mui/x-date-pickers` contributes **113 files** to `mui-vendor`. Both are MUI X Pro packages with large dependency trees. Like icons, they are imported through the main `@mui` namespace and end up in the shared vendor chunk that loads on every route.

---

## Root Cause #5: `framer-motion` (the `motion` package) is ~310 KB in the entry chunk

`motion` (which re-exports `framer-motion`) is used in `App.tsx`:

```tsx
import { AnimatePresence } from "motion/react";
```

Because `AnimatePresence` wraps the router, the entire `framer-motion` library (262 source files = ~310 KB minified) is pulled into the entry chunk. It is used for page transition animations on route changes, but the home page pays the cost even if no transition occurs.

---

## Root Cause #6: `socket.io-client` is in the entry chunk

`socket.io-client` is bundled into the `index` chunk (10 source files). It is required by `WebSocketProvider`, which wraps the entire app in `App.tsx`. Real-time WebSockets are only needed once a user is inside a project and viewing conversations, but the library is downloaded on `/` and `/login`.

---

## Root Cause #7: `axios` is in the entry chunk

`axios` (50 source files) is bundled into the `index` chunk. It is used by the API clients provided by `@hey-hey/ui-common`, which are imported eagerly by `WebClientProvider` in `App.tsx`. Like `socket.io-client`, this is needed for almost every route, but it inflates the entry chunk rather than being split into a separate vendor chunk.

---

## Root Cause #8: `editor-vendor` (Lexical + Yjs) is preloaded unnecessarily

`editor-vendor` (263 KB) contains:
- `@lexical/*` (rich text editor framework)
- `yjs` + `y-protocols` + `lib0` (collaborative editing CRDT)
- `prismjs` (syntax highlighting)
- `react-error-boundary`

These are needed only for the work-item editor (`WorkItemEditor.tsx`, `PlanDocumentEditor.tsx`), yet Vite preloads them on the home page because some component in the entry chunk references them.

The likely culprit: `ui-common/src/components/shared/WorkItemReadView.tsx` or `WorkItemEditor` components are imported through the `ui-common/components` barrel and end up transitively referenced by the entry chunk.

---

## Root Cause #9: `filepond` plugins are split into `index-CyIggHXv`

The `manualChunks` regex `/node_modules/filepond/` misses `filepond-plugin-*` packages. They ended up in a secondary entry chunk (`index-CyIggHXv.js`, 287 KB) rather than `interaction-vendor`. This is a minor regex bug.

---

## Import Chain Visualization (Entry Chunk → Mermaid)

```
App.tsx
  → imports @hey-hey/ui-common/components (barrel)
    → components/index.ts → export * from "./Conversation"
      → Conversation/index.ts → export { ConversationViewer }
        → ConversationViewer.tsx → import { SystemMessage }
          → SystemMessage.tsx → import { MermaidCodeBlock }
            → MermaidCodeBlock.tsx → await import("mermaid")
              → diagram-vendor chunk (2,842 KB)
              → render-TAZW7USW chunk (elkjs, 1,456 KB)
```

Because `MermaidCodeBlock` is a normal (non-lazy) import inside `SystemMessage`, the component code itself sits in the entry chunk. The `await import("mermaid")` is a dynamic import, but since the parent component is in the entry chunk, Vite preloads the target chunk.

---

## Coverage Tool Findings

The Chrome Coverage tool confirmed:
- `index-BPFj_Ji6.js` — ~75% unused on the home page
- `diagram-vendor-BJxULxEN.js` — ~100% unused on the home page (never executed)
- `mui-vendor-Ct5cgFil.js` — ~60% unused on the home page

This validates that the bulk of the downloaded JavaScript is dead weight on the landing route.

---

## Recommendations (in priority order)

1. **Lazy-load `MermaidCodeBlock`** — Make it a dynamic import inside `readViewMarkdownComponents.tsx` and `SystemMessage.tsx` so the component itself (not just mermaid) is split out. This will remove the preload directive from `index.html`.

2. **Remove `reactflow` v11 from `ui-common`** — Migrate `ui-common` to `@xyflow/react` v12. Eliminates duplicate React Flow code.

3. **Split `@mui/icons-material` into per-icon imports** — Use deep imports everywhere. This is the single biggest win for `mui-vendor`.

4. **Move `@mui/x-charts` and `@mui/x-date-pickers` out of `mui-vendor`** — Only a few pages use charts and date pickers. They should have their own lazy-loaded chunks.

5. **Add `@mermaid-js/parser` to `manualChunks`** — Fix the regex in `vite.config.ts`.

6. **Consider whether `AnimatePresence` is worth 310 KB** — If the page transition animation is not critical, remove `motion` from `App.tsx` and load it only on pages that use it.

7. **Lazy-load `socket.io-client`** — Wrap `WebSocketProvider` so the library is only loaded after login and project selection.

8. **Split `axios` into its own vendor chunk** — It is large enough to justify a separate `api-vendor` chunk.

9. **Audit `ui-common/components` barrel exports** — Many heavy components (`ConversationViewer`, `WorkItemReadView`, `WorkItemEditor`) are exported from the same barrel as lightweight utilities (`HeyHeyBranding`, `EntityIcon`). Any page that imports *one* thing from the barrel transitively depends on *everything* in the barrel unless tree-shaking is perfect. In practice, with pnpm + source aliases, tree-shaking is not perfect.

---

## What Was Attempted (May 25, 2026)

### Changes Made

1. **Lazy-loaded `MermaidCodeBlock`** (`ui-common/src/components/shared/readViewMarkdownComponents.tsx`, `SystemMessage.tsx`)
   - Converted to `React.lazy(() => import("./MermaidCodeBlock").then(mod => ({ default: mod.MermaidCodeBlock })))`
   - **Result:** Component code moved out of entry chunk, BUT `dist/index.html` still preloads `diagram-vendor` because the entry chunk transitively references the component through the `ui-common/components` barrel.

2. **Added `@mermaid-js` to `manualChunks`** (`vite.config.ts`)
   - Added `@mermaid-js/parser` and `langium` to the `diagram-vendor` regex.
   - **Result:** `@mermaid-js/parser` moved from entry chunk → `diagram-vendor`. `diagram-vendor` grew from **2,842 KB → 4,140 KB**. Still preloaded on home page.

3. **Converted `@mui/icons-material` to deep imports**
   - Script: `scripts/convert-mui-icons-v3.cjs` converted **217 files** from barrel imports (`import { Icon } from "@mui/icons-material"`) to deep imports (`import Icon from "@mui/icons-material/Icon"`).
   - **Result:** Zero bundle-size impact. `mui-vendor` remained **~962 KB**. Rollup/Vite was already tree-shaking the barrel effectively.

4. **Added `prismjs` to `editor-vendor`** and `filepond-plugin-*` to `interaction-vendor`**
   - **Result:** Code moved to correct chunks, but both chunks are still preloaded in `index.html`.

5. **Split `axios` into `api-vendor`**
   - **Result:** `api-vendor` is **71 KB** and now preloaded in `index.html`. Since `axios` was already inside the entry chunk, this is approximately net-zero for initial download (slight increase due to chunking overhead).

### Quantitative Results

| Metric | Before | After | Delta |
|---|---|---|---|
| Entry chunk (`index-*.js`) | 2,228 KB | 2,181 KB | **−47 KB (−2.1%)** |
| `diagram-vendor` | 2,842 KB | 4,140 KB | **+1,298 KB** |
| `mui-vendor` | 985 KB | 962 KB | −23 KB |
| Preloaded chunks in `index.html` | 7 | 8 | +1 (`api-vendor`) |
| Total build output | ~20 MB | ~21 MB | +1 MB |

**Net initial download reduction: negligible (~0%).**

### Why Most Changes Did Not Help

The `ui-common/src/components/index.ts` barrel exports **every** subdirectory:

```ts
export * from "./Conversation";
export * from "./WorkItem";
// ... dozens more
```

When the entry chunk (`App.tsx`) imports even one lightweight utility from this barrel (e.g., `HeyHeyBranding`), Vite tracks the **transitive dependencies of every export** for its `__vite__mapDeps` helper. This causes preload directives for:

- `diagram-vendor` (via `ConversationViewer` → `SystemMessage` → `MermaidCodeBlock`)
- `editor-vendor` (via `WorkItemReadView` → Lexical/Yjs)
- `interaction-vendor` (via `WorkItemEditor` → filepond plugins)

**All our lazy-loading and manual-chunk changes are rendered moot because Vite still preloads the target chunks.**

### The Only Path Forward

**Recommendation #9** — audit and break up the `ui-common/components` barrel — is the **prerequisite** for every other recommendation. Until the entry chunk stops transitively depending on heavy components through the barrel, no amount of lazy-loading or `manualChunks` tuning will reduce the home-page download.

This refactor is **high-risk and high-effort**:
- `ui-common/components/index.ts` exports ~20+ subdirectories.
- Both `ui` and `ui-common` packages import from this barrel pervasively.
- Changing imports from `import { X } from "@hey-hey/ui-common/components"` to `import { X } from "@hey-hey/ui-common/components/Conversation"` touches hundreds of files.
- Must be done incrementally to avoid breaking imports.

## Data Sources

- `dist/chunk-manifest.txt` — generated by custom `trace-chunks` Rollup plugin
- `dist/index.html` — shows `<link rel="modulepreload">` directives
- `dist/assets/*.js.map` sourcemaps — parsed with Python to map source files to chunks
- `vite.config.ts` — `manualChunks` configuration
- `scripts/convert-mui-icons-v3.cjs` — MUI icon conversion script
- Chrome DevTools Coverage tab — runtime execution data
