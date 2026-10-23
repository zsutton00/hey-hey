import type { ArtifactStatus } from "../api";

export interface DocumentTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  icon: React.ReactNode;
}

export interface ArtifactMetadata {
  title: string;
  tags: string[];
  category: string;
  status: ArtifactStatus;
  isPublic: boolean;
}
