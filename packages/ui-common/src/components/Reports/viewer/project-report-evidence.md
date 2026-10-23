# Project report evidence citations

The producer writes citations in `body.html` as `data-evidence-key` attributes.
For example, `<span data-evidence-key="E1">Supporting activity</span>` cites the
entry whose `provenance.evidence[].key` equals `E1`. Keys are opaque,
report-local strings: the consumer performs exact, case-sensitive matching,
without trimming, parsing, deriving an entity ID, or inventing a URL. `E1` is
an example, not a required prefix or numbering scheme. Producers should use
nonempty, unique keys within a report so each citation resolves unambiguously.
Repeated citations may reference the same evidence entry.

The typed provenance entry owns the subject's entity type and identity, title,
kind, and optional activity/time metadata. The authored citation supplies only
the lookup key. The host never trusts authored attributes as entity references
or navigation destinations. Unknown keys do not activate host evidence and are
reported in the host's unresolved-citations notice. Missing citations do not
prevent readers from using the host evidence list.

The consumer sanitizes authored HTML, removing scripts, event handlers and URL
attributes. It renders an opaque-origin iframe with `referrerPolicy="no-referrer"`
and a no-network CSP. `allow-scripts` permits only the nonce-bound host runtime
under that CSP; `allow-same-origin` is absent. The host runtime adds button
semantics and keyboard access to resolved citations and sends nonce-channel
messages. The parent verifies the source window, channel token and typed key
before scrolling and focusing its evidence entry. This reuses
`HtmlCssHostRuntime`, not an authored script or arbitrary navigation channel.

## Entity mentions

Before sanitizing, the host rewrites `@[type:id|title]` tokens in the body's
text nodes (`projectReportMentions.ts`), never in attribute values, into
`<a class="hh-mention" data-entity-type data-entity-id>title</a>`. It parses
them with the same tolerant grammar as other system-authored surfaces,
including escaped brackets. Authored `data-entity-*` attributes are stripped
first, so only host-created links navigate. Links come from the token alone,
and nothing is fetched. The host runtime gives them link semantics and keyboard
access, and posts a typed mention message on the same nonce channel. The parent
checks the message's source, channel token and token grammar, then navigates
through `navigateToEntity`, as a mention badge does. Types it does not know stay
inert. Badge styling lives in the report theme inside the isolated document.

## Reading layout

The authored document comes first; request, summary, scope, exclusions,
coverage and evidence sit in a host-owned "Report details" accordion that starts
collapsed. Activating a citation expands it, then focuses the evidence entry
once the expansion finishes. The typed payload, including `provenance.requestId`
and `attemptId`, is unchanged; the viewer simply does not display those UUIDs.
Incomplete coverage and its limitations remain in the warning above the
document.

The host runtime reports `documentElement` height over the same nonce channel
(`ResizeObserver` plus `resize`), and the parent sizes the iframe to it. Host
CSS sets `overflow-y: hidden`, so the surrounding surface owns vertical
scrolling. A leading authored `h1`/`h2` whose text matches the payload title is
hidden, so only one title shows. The viewer shows exactly one host title: the
frame header, the title link, the renderer heading, or none when
`renderTitle={false}` because the page already shows it.

## Report styling

The isolated document applies the `report` host theme
(`shared/htmlCssReportTheme.ts`) before the authored CSS. Work-item sections
keep their own Modern and Sketch themes, and the report theme is not offered in
their style picker. The theme is built from the light `createHeyTheme` in
`contexts/ThemeContext.tsx`, so its fonts, primary blue, text, divider, info,
warning and report colors, spacing steps and radius follow the product theme.
It forbids left accent borders: its last rule zeroes `border-left` and
`border-inline-start` widths with `!important`, which also overrides authored
CSS and inline styles. The host labels `interpretation` and `limitation`
blocks. The
iframe CSP allows only `data:` fonts, so the font stacks fall back to system
fonts when those families are not installed locally.

The theme styles plain elements (headings, lists, tables) and a small class
vocabulary: `summary`, `interpretation` (inference, kept apart from recorded
facts), `limitation` (coverage gaps), `stats`/`stat`/`stat-value`/`stat-label`,
`timeline` with `<time>`, `bars`/`bar-label`/`bar`/`bar-value` (single-hue bars
sized by an inline `--value` percentage, always next to a written value), and
`num`/`muted`. Resolved citations get the host's dotted primary underline and a
focus ring. The CLI report prompt teaches authors this same vocabulary, so a
renamed or removed class needs a matching prompt change.

## Canonical grounding and verification

@[design_doc:9d30d593-4fac-4aea-b4dd-4918d22d618a|Project Reports]
requires authored evidence links to resolve through host-owned typed evidence
references and assigns payload definitions to
@[service:3ef90bdf-98c2-4010-a0bd-b1ca9001dc0a|OpenAPI] and report production to
@[service:fd9d0961-d3e9-4796-83ee-7720025c3dbe|CLI].
@[task:77012df7-2256-441e-be11-4fd4c3d5c09f|Generate and submit evidence-backed project reports]
requires evidence-reference guidance and canonical typed submission.
@[report:b100d80b-d5d5-4f4a-ada9-6ef040593844|Implement]
records changes to the canonical producer's
`src/agents/project-report/project-report-prompt.ts`,
`project-report-evidence-reader.ts`, and `project-report.handler.test.ts`.

The canonical CLI evidence reader groups selected-period activity by subject
and assigns `selected-period-1`, `selected-period-2`, and so on to each
subject's latest activity, and
`current-state-<entityType>-<entityId>` to current-state context. These are
producer choices, not consumer parsing rules. The project-report prompt now
instructs authors to put the exact supplied key in `data-evidence-key` and copy
the typed reference into provenance. Its full prompt snapshot protects this
guidance. A canonical `CreateReportTool` submission test proves that citation
HTML and typed references survive submission unchanged while the host stamps
coverage and evidence-read timestamps.

OpenAPI requires nonempty keys and now documents the citation convention.
Uniqueness is producer guidance; the schema does not enforce uniqueness by key
or validate HTML citations. Unknown keys remain unresolved at the viewer.

The downstream UI `ProjectReportPage` passes persisted reports to the shared
`ReportViewer`. Its integration test mounts the real shared renderer with a
CLI-style key and checks the typed host evidence, isolated frame, and an
unknown-key notice. Browser activation is checked at the renderer boundary.

These checks use constructed payloads. No live model generation or authenticated
API persistence round trip was performed; prompt compliance in a live generated
report remains outside this local verification.

## Browser regression check

Run `pnpm test:browser:project-report` with local Google Chrome installed, or set
`CHROME_BIN` to its executable. The check starts a loopback-only Vite server and
a temporary Chrome profile, mounts the production `ProjectReport`, and exercises
its actual isolated iframe with Chrome mouse/keyboard input. It checks click,
Enter and Space activation, host focus/visibility, inert unknown keys and their
notice, opaque-origin access denial, no referrer, script/URL sanitation, CSP
script/image/fetch denial, zero requests to a local forbidden-resource endpoint,
and blocked authored link/form/top navigation. Trusted DevTools probes test CSP
and sandbox enforcement after sanitation without replacing the host runtime.

This is Chromium coverage within the shared renderer. It does not run the CLI
producer, API persistence, downstream UI, or Firefox/WebKit.
