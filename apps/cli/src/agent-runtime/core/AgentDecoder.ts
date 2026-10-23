import type { AgentMessage } from './types';

export interface AgentDecoder {
  decode(rawChunk: string): AgentMessage[];
  flush(): AgentMessage[];
  reset(): void;
}
