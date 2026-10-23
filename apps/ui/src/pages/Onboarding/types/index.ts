// Define types for pillar feedback
interface PillarContent {
  title: string;
  content: string;
  feedback: string;
}

export interface PillarsState {
  engineering: PillarContent;
  launch: PillarContent;
  marketing: PillarContent;
  analytics: PillarContent;
  [key: string]: boolean | PillarContent; // Index signature for dynamic access
}

// Define type for integrations
export interface IntegrationsState {
  github: boolean;
  googleAlerts: boolean;
  analytics: boolean;
  [key: string]: boolean; // Index signature for dynamic access
}
