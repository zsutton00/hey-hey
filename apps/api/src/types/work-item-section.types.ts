export type WorkItemSectionKey =
  | 'description'
  | 'details'
  | 'acceptanceCriteria'
  | 'requirements';

export interface WorkItemSectionRecord {
  id: string;
  key: WorkItemSectionKey;
  order: number;
  materializedMarkdown: string | null;
}

export interface MaterializedWorkItemSection {
  id: string;
  key: WorkItemSectionKey;
  order: number;
  materializedMarkdown: string;
  materializedProposalId: string;
}
