# Conversation anchoring browser fixture

Run the installed local Vite server from UI Common:

```sh
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5175
```

Open `http://127.0.0.1:5175/scripts/browser/conversation-scroll.html` and click **Verify native anchoring**. The fixture uses the production scrolling hook and a declared `<main>` owner. It measures a visible reading line through growth above the viewport, history prepending, shrinking content, and decaying programmatic scroll steps. A drift above 1px fails the check.

This isolates browser anchoring; it does not render the full Conversation Viewer, deferred mention renderers, or proposal approval lifecycle. The jsdom integration tests cover their explicit-move wiring and lifecycle outcomes.

Observed in local Chrome on 2026-10-07:

| Case | Reading-line drift |
| --- | ---: |
| Hydration-shaped growth above viewport | 0.1875px |
| Older history prepend | 0px |
| Approval-shaped shrink | -0.1875px |
| Simulated decaying scroll during growth | maximum 0.1875px |

Required acceptance checks remain on the authenticated coding-session and entity-conversation pages in Chrome and Safari, including a physical trackpad flick with momentum, actual mockup/diagram hydration, approval, history loading, and a sent message followed by a long reply. The local app was signed out. Safari WebDriver could not create a session because **Develop → Allow Remote Automation** was disabled. No Safari result or authenticated-page result is claimed.

## Authenticated mockup reproduction — 2026-10-08

The user signed the shared Chrome browser into the local coding-session page. With actual deferred HTML/CSS mentions, the text following a mockup moved 885.984375px during hydration while scrolling upward in 15px animation-frame steps. The placeholder stayed deferred until it reached the visible scrollport, despite `rootMargin: "1500px 0px"`.

A paired IntersectionObserver check on the same placeholder, 187.765625px above the page viewport, reported `isIntersecting: false` with the default viewport root and `true` with the layout `<main>` root. The intervening `<main>` scrollport clips the default viewport's expanded region. This delays hydration until the placeholder is visible, where native anchoring can retain its top instead of the text below it.

Mockup and workflow/diagram observers now use the declared conversation owner as their root when it contains the target. They retain viewport observation outside an owned conversation, the 1,500px margin, latched eligibility, and no local scroll correction.

After the change, an earlier mockup hydrated above the visible region during 30 upward 20px animation-frame scroll steps. Its height grew from 132.796875px to 1018.78125px, and a visible downstream mockup frame retained its expected position with 0.015625px maximum drift. This verifies actual mention hydration on the authenticated coding-session page in Chrome; these programmatic steps are not physical trackpad momentum. Safari, the entity-conversation page, diagram hydration, and approval transitions remain unverified by this follow-up.
