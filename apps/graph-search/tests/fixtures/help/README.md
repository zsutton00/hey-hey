`help.content_changed.json` is an API-shaped `help.content_changed` event.

`help.content_changed.expected.json` is the document the deployed Embeddings
service writes for it: the event was parsed by `_parse_help_content_changed_event`
and `VespaEmbeddingService.upsert_help_projection` ran against a capture
backend, whose `store_help_chunk` arguments were passed through
`build_help_document_fields`. Chunking was left whole (one chunk) so the
composed text is comparable; this service chunks by its own word count.

The fixture proves text composition, chunk identity and metadata mapping. It is
not evidence of API publication, transport ordering or search ranking.
