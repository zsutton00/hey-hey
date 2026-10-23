export interface EntityMention {
  entityType: string;
  entityId: string;
  entityName: string;
}

export interface SearchEntity {
  id: string;
  type: string;
  name: string;
  description?: string;
  status?: string;
  similarity?: number;
  metadata?: Record<string, unknown>;
}

export type EntitySearchScope =
  | {
      kind: "entity-types";
      entityTypes: string[];
    }
  | {
      kind: "work-item-types";
      taskTypes: string[];
    };

export interface SerializedMentionNode {
  type: "mention";
  version: 1;
  mention: EntityMention;
}
