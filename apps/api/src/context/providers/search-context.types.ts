export type EmbeddingSearchType = 'semantic' | 'hybrid' | 'keyword';
export type EmbeddingSearchMatchType = 'semantic' | 'keyword' | 'hybrid';

export interface EmbeddingSearchRequest {
  query: string;
  max_results?: number;
  similarity_threshold?: number;
  search_type?: EmbeddingSearchType;
  boost_recent?: boolean;
  filters?: Record<string, unknown>;
}

export interface EmbeddingSearchResult {
  id: string;
  text: string;
  similarity: number;
  metadata?: Record<string, any>;
  chunk_index?: number;
  match_type?: EmbeddingSearchMatchType;
}

export interface EmbeddingSearchResponse {
  success: boolean;
  query: string;
  results: number;
  data: EmbeddingSearchResult[];
}
