// Export operational identities only; arbitrary span names can contain payloads.
const services = new Set([
  'api',
  'hey-hey-api',
  'graph-service',
  'graph',
  'graphs',
  'embeddings',
]);
const operations = new Set([
  'proposal.create',
  'proposal.create.transaction',
  'proposal.authoring.validate',
  'proposal.post_commit',
  'proposal.response.map',
  'proposal.change_set.materialize',
  'proposal.change_set.prepare',
  'proposal.change_set.claim',
  'proposal.change_set.apply',
  'proposal.change_set.publish',
  'proposal.change_set.release_fences',
  'proposal.change_set.checkpoint',
  'proposal.change_set.checkpoint.renew',
  'proposal.change_set.checkpoint.applying',
  'proposal.change_set.checkpoint.precheck',
  'proposal.change_set.checkpoint.mutation',
  'proposal.change_set.checkpoint.postcheck',
  'proposal.change_set.checkpoint.completed',
  'proposal.change_set.checkpoint.failed',
  'proposal.change_set.advisory_lock',
  'proposal.change_set.published_result',
  'proposal.change_set.edge_handoff',
  'work_item.write.advisory_lock',
  'work_item.patch.response_read',
  'domain_event.persist',
  'entity_context.assemble_full',
  'graph.relationship.create',
  'neo4j.transaction',
  'neo4j.agent_edge.create',
  'graph.search.candidates',
  'graph.search.materialization',
  'graph.search.grouped_results',
  'graph.search.structured_read',
  'graph.search.identities',
  'graph.context.materialization',
  'embeddings.event.process',
  'embeddings.embedding.encode.document',
  'embeddings.embedding.encode.query',
  'vespa.document.feed',
  'vespa.search.query',
]);
function attribute(attributes, key) {
  const value = attributes?.find((item) => item.key === key)?.value;
  return value?.stringValue;
}
export function traceCoverage(spans) {
  const ids = new Set(spans.map((span) => span.spanId));
  const missingParents = spans.filter(
    (span) =>
      span.parentSpanId &&
      !/^0+$/.test(span.parentSpanId) &&
      !ids.has(span.parentSpanId),
  ).length;
  return {
    spanCount: spans.length,
    missingParents,
    incomplete: !spans.length || missingParents > 0,
    accounting:
      'Span durations overlap and nest; do not sum as independent request phases',
    phases: spans
      .filter(
        (span) =>
          span.operationName && span.startTimeUnixNano && span.endTimeUnixNano,
      )
      .map((span) => ({
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        operation: span.operationName,
        durationMs:
          Number(
            BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano),
          ) / 1e6,
      })),
  };
}
export function safeTraceSpans(trace) {
  return (trace.batches || trace.resourceSpans || []).flatMap((batch) => {
    const service = attribute(batch.resource?.attributes, 'service.name');
    return (
      batch.scopeSpans ||
      batch.instrumentationLibrarySpans ||
      []
    ).flatMap((scope) =>
      (scope.spans || []).map((span) => {
        let operation;
        if (operations.has(span.name)) operation = span.name;
        else if (
          /^PostgreSQL (SELECT|INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK|CONNECT|operation|connection|db_query|commit_transaction|serialize|response_json_serialization|client_serialize)$/.test(
            span.name,
          )
        )
          operation = span.name;
        else {
          const method =
            attribute(span.attributes, 'http.request.method') ||
            attribute(span.attributes, 'http.method');
          if (
            /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE)$/.test(
              method,
            )
          )
            operation = `HTTP ${method}`;
          else if (
            /^HTTP (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE|OTHER)$/.test(
              span.name,
            )
          )
            operation = span.name;
          else if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /.test(span.name))
            operation = `HTTP ${span.name.split(' ')[0]}`;
        }
        const operationKind = attribute(span.attributes, 'operation.kind');
        const rawIndex = span.attributes?.find(
          (a) => a.key === 'operation.index',
        )?.value?.intValue;
        const operationIndex =
          rawIndex === undefined ? undefined : Number(rawIndex);
        return {
          spanId: span.spanId,
          parentSpanId: span.parentSpanId,
          startTimeUnixNano: span.startTimeUnixNano,
          endTimeUnixNano: span.endTimeUnixNano,
          statusCode: span.status?.code,
          ...(services.has(service) ? { serviceName: service } : {}),
          ...(operation ? { operationName: operation } : {}),
          ...(operations.has(span.name) &&
          /^(workItem\.(create|update|delete)|section\.(replace|clear)|layout\.(replace|clear)|relationship\.(create|update|delete))$/.test(
            operationKind,
          )
            ? { operationKind }
            : {}),
          ...(operations.has(span.name) &&
          Number.isSafeInteger(operationIndex) &&
          operationIndex >= 0
            ? { operationIndex }
            : {}),
        };
      }),
    );
  });
}
