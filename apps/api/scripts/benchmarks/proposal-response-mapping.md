# Proposal authoring response mapping

This opt-in microbenchmark isolates `mapProposalResponse` from validation,
persistence, and policy resolution. It compares the previous incomplete write
result (which forces a proposal relation reload) with the complete authoritative
write result for create, draft update, and immediately applied user changes.

Run it with:

```sh
PROPOSAL_RESPONSE_BENCHMARK=1 ./node_modules/.bin/jest --runInBand \
  src/services/proposal/__tests__/proposal-response-policy.benchmark.test.ts
```

The output reports elapsed mapper time and the exact number of proposal relation
reloads for 500 samples of each workload. Timing is diagnostic rather than a CI
threshold; the database-call assertion is deterministic.

The latest local run is recorded in
`measurements/proposal-response-mapping.json`.
