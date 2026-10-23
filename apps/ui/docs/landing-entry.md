# Landing entry

`src/main.tsx` chooses between the standalone public landing page and the React
application before importing either runtime. `/` loads
`src/pages/Landing/mountLanding.ts`; a nonempty `welcome` query parameter loads
the existing application invitation flow. All other paths load `src/appMain.tsx`.
This works with the existing SPA fallback in development and production; no
server routing changes are required.

The standalone page uses native DOM elements and CSS, sharing the marketing copy
and media URLs with the in-app Home page. Links navigate normally into the app.
It always shows public access/sign-in actions: session initialization and
personalized navigation happen in the app. Video selection supports mobile
sources, reduced motion, and pausing on hover/focus or when the tab is hidden.

Keep application dependencies out of this entry. In particular, importing UI
Common barrels, MUI, or app providers would undo the separation. Vite's preload
helper has its own small chunk so manual vendor chunking cannot pull a diagram
bundle into the entry. When checking sizes, inspect the complete static import
and preload graph, not just the file named `index`. Videos, posters, and external
fonts are additional transfers beyond JavaScript and CSS.

Validation: `pnpm build`, `pnpm type-check`, and
`pnpm exec vitest run src/pages/Landing`.
