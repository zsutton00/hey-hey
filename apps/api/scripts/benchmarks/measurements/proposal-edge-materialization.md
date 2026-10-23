# Proposal edge materialization batching

Measured on 2026-09-21 with the deterministic Jest harness in
`src/services/__tests__/agent-edge-client.benchmark.test.ts`. The harness adds
2 ms of Graph transport latency per HTTP request and compares the previous
serial single-edge client loop with the bounded batch client. These are local
transport measurements, not production latency measurements.

Batch size: 50 edges.

| Scenario      | Edges | Before requests | After requests | Before elapsed (ms) | After elapsed (ms) |
| ------------- | ----: | --------------: | -------------: | ------------------: | -----------------: |
| Success       |     1 |               1 |              1 |                3.99 |               2.64 |
| Success       |    10 |              10 |              1 |               24.12 |               2.41 |
| Success       |    50 |              50 |              1 |              110.16 |               2.35 |
| Success       |    51 |              51 |              2 |              115.71 |               7.85 |
| Success       |   100 |             100 |              2 |              302.97 |              19.97 |
| Mixed failure |     1 |               1 |              1 |               18.31 |               2.39 |
| Mixed failure |    10 |              10 |              1 |               23.38 |               2.13 |
| Mixed failure |    50 |              50 |              1 |              115.34 |               2.35 |
| Mixed failure |    51 |              51 |              2 |              130.52 |               5.11 |
| Mixed failure |   100 |             100 |              2 |              269.01 |               4.40 |

The request-count assertion is deterministic: serial materialization issues one
Graph request per edge, while batching issues `ceil(edgeCount / 50)` requests.
Elapsed values are observations from this run and will vary with host load.

## Generic change-set materialization

The same harness now also measures the immediate generic change-set path that
performs durable checkpoint application and publication verification. Before
this change, each new relationship incurred a missing-edge read, a create, an
immediate verification read, and a final publication read. The optimized path
uses one bounded create request and one bounded incident-edge verification
request per 50 relationships.

| Edges | Before requests | After requests | Before elapsed (ms) | After elapsed (ms) |
| ----: | --------------: | -------------: | ------------------: | -----------------: |
|     1 |               4 |              2 |               10.57 |               6.22 |
|    10 |              40 |              2 |              113.92 |               8.45 |
|    50 |             200 |              2 |              581.66 |               8.40 |
|    51 |             204 |              4 |              606.36 |              10.85 |
|   100 |             400 |              4 |             1123.71 |              17.53 |

The generic-path request-count assertion is deterministic: the prior flow uses
four Graph requests per relationship, while the optimized flow uses two
requests per bounded chunk. The elapsed values use the same simulated 2 ms
transport latency and are local observations rather than production latency.
