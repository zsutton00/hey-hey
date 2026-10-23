# Run conformance protocol

`heyhey.run-conformance/v1` is a JSON-compatible black-box protocol for Run
lifecycle promises. Scenario data can start or admit input, apply controls,
observe and settle correlated external operations, interrupt at named durable
boundaries, and crash/restart an implementation.

The protocol deliberately exposes domain observations rather than `Run`,
`Turn`, XState, collaborator calls, or effect identifiers. The reference model
is an oracle, not a replacement runtime. Its queue is a model of admission
order; a real adapter may claim restart equivalence only where admission is
durable in the authoritative implementation contract.

`TypeScriptRunConformanceDriver` is the implementation-specific bridge. Its
boundary collects observations from runtime callbacks, stores, and controlled
external fakes. `JsonLinesRunConformanceDriver` and
`serveRunConformanceJsonLines` allow another process or language to run the
same scenario corpus one request and response per line.

The concrete TypeScript conformance test drives an unmocked `Run` through its
public input and provider-output boundaries. It records normalized assistant
delta/final output, Agent Session current-state publications, persisted final
Message identity, and settled-Turn publication through the Run's real
collaborators. The reference model supplies expectations only; it is never
used to produce observations for the TypeScript implementation.
