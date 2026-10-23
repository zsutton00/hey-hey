# Request caller locations

Enable diagnostic attribution in the app's browser console:

```js
localStorage.setItem('hey-hey:request-initiator-tracking', 'true');
```

Reload once to capture render stacks for already-mounted queries. New captures
and outgoing requests read the flag dynamically; remove the key to disable it.
In Chrome's Network panel, inspect the request's `_from` query parameter. It
contains an original source path, line, and column, for example
`src/components/AgentSession/EntityConversationChat.tsx:270:7`.
This does not replace Chrome's native Initiator stack or reconstruct React's
parent component tree: it identifies the component or application function
that made the call.

For compiled Vite builds, attribution reads the matching same-origin
`<bundle>.js.map`, including the bundle's content hash. The map must be served
alongside that deployed bundle. Map reads are shared across requests and cached
(including failures), with a 1.5-second timeout and a bounded cache. These
diagnostic asset reads appear in Network while tracking is enabled. They do not
use the API client or its authentication headers. An unavailable or invalid map
does not fail the API request: `_from` is explicitly prefixed `unmapped:` and
contains a generated bundle position instead. Reload to retry a cached failed
map lookup after repairing map availability.

`useQuery` captures its caller during render and sends it through the collection
queue. Each collection fetcher receives request options as its third argument;
pass them to every generated-client call or spread them into every data-client
request config, including requests after an `await`, retries, and recovery reads.
The options hold request-local metadata, so concurrent queries cannot overwrite
one another. The raw stack is kept locally; only the resolved location is added
to the request URL. Direct generated-client and data-client calls capture their
current synchronous caller as well.

Coalescing continues to attribute a shared network read to the caller that opened
that queue cycle. The label is not a census of every consumer sharing the query,
and does not distinguish mount, focus, and invalidation triggers.
