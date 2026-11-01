The event is copied unchanged from the Embeddings repository's
`tests/e2e/fixtures/design_doc.content_changed.json`.

The expected fields were captured by validating the event with
`DesignDocContentChangedEvent.model_validate` and running
`DesignDocEventProcessor.handle_design_doc_content_changed` against a capture
adapter for `update_canonical_document_fields`. Metadata and searchable text are retained;
`token_embeddings` is excluded. Timestamp comparisons use
instants because the deployed update fields contain epoch milliseconds and the
HTTP metadata boundary uses RFC 3339 strings.

This regression fixture proves metadata mapping, including `summaryText`, and
searchable text composition.
It is not evidence of API publication, transport ordering, child cleanup or
HTTP write behavior. Those still require a configured running API and both
search backends with isolated fixtures.
