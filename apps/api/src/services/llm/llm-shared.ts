export enum LLMProviderName {
  CLAUDE = 'claude',
  OPENAI = 'openai',
  SYNTHETIC = 'synthetic',
  LOCAL = 'local',
}

export enum ClaudeModel {
  CLAUDE_4_OPUS_5 = 'claude-opus-4-5-20251101',
  CLAUDE_4_SONNET_6 = 'claude-sonnet-4-6',
  CLAUDE_4_SONNET_5 = 'claude-sonnet-4-5-20250929',
  CLAUDE_4_HAIKU_5 = 'claude-haiku-4-5',
  CLAUDE_5_HAIKU_5 = 'claude-haiku-5-5',
}

export enum OpenAIModel {
  GPT_5_1 = 'gpt-5.1',
  GPT_5_MINI = 'gpt-5-mini',
  GPT_5_NANO = 'gpt-5-nano',
  GPT_5_1_CODEX = 'gpt-5.1-codex',
  GPT_5_1_CODEX_MINI = 'gpt-5.1-codex-mini',
}

export enum SyntheticModel {
  DEEPSEEK_R1_0528 = 'hf:deepseek-ai/DeepSeek-R1-0528',
  DEEPSEEK_V3 = 'hf:deepseek-ai/DeepSeek-V3',
  DEEPSEEK_V3_0324 = 'hf:deepseek-ai/DeepSeek-V3-0324',
  DEEPSEEK_V3_2 = 'hf:deepseek-ai/DeepSeek-V3.2',
  LLAMA_3_3_70B_INSTRUCT = 'hf:meta-llama/Llama-3.3-70B-Instruct',
  MINIMAX_M2_1 = 'hf:MiniMaxAI/MiniMax-M2.1',
  KIMI_K2_INSTRUCT_0905 = 'hf:moonshotai/Kimi-K2-Instruct-0905',
  KIMI_K2_THINKING = 'hf:moonshotai/Kimi-K2-Thinking',
  KIMI_K2_5 = 'hf:moonshotai/Kimi-K2.5',
  KIMI_K2_5_NVFP4 = 'hf:nvidia/Kimi-K2.5-NVFP4',
  GPT_OSS_120B = 'hf:openai/gpt-oss-120b',
  QWEN3_235B_A22B_THINKING_2507 = 'hf:Qwen/Qwen3-235B-A22B-Thinking-2507',
  QWEN3_CODER_480B_A35B_INSTRUCT = 'hf:Qwen/Qwen3-Coder-480B-A35B-Instruct',
  GLM_4_7 = 'hf:zai-org/GLM-4.7',
  GLM_4_7_FLASH = 'hf:zai-org/GLM-4.7-Flash',
  NEMOTRON_3_SUPER_120B_A12B_NVFP4 = 'hf:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4',
}

export type LLMModel = ClaudeModel | OpenAIModel | SyntheticModel;

export type AnthropicTier = 'haiku' | 'sonnet' | 'opus';
export type OpenAITier = 'nano' | 'mini' | 'base' | 'codex';

export interface ModelTier {
  model: LLMModel;
  provider: LLMProviderName;
  speed: 'fastest' | 'fast' | 'balanced' | 'capable' | 'most_capable';
  costTier: 'lowest' | 'low' | 'medium' | 'high' | 'highest';
  contextWindowTokens?: number;
  inputCostPer1M: number;
  outputCostPer1M: number;
  cachedInputCostPer1M?: number;
  specialFeatures?: string[];
}

// Haiku 5.5 does not accept non-default sampling temperatures.
export function llmTemperatureParams(
  model: string | undefined,
  temperature?: number,
): { temperature?: number } {
  return model === ClaudeModel.CLAUDE_5_HAIKU_5
    ? {}
    : { temperature: temperature || 0.7 };
}

export const CLAUDE_MODEL_TIERS: Record<ClaudeModel, ModelTier> = {
  [ClaudeModel.CLAUDE_5_HAIKU_5]: {
    model: ClaudeModel.CLAUDE_5_HAIKU_5,
    provider: LLMProviderName.CLAUDE,
    speed: 'fastest',
    costTier: 'lowest',
    contextWindowTokens: 1_000_000,
    // First-party rates for prompts up to 100K tokens.
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.5,
  },
  [ClaudeModel.CLAUDE_4_OPUS_5]: {
    model: ClaudeModel.CLAUDE_4_OPUS_5,
    provider: LLMProviderName.CLAUDE,
    speed: 'most_capable',
    costTier: 'highest',
    inputCostPer1M: 5.0,
    outputCostPer1M: 25.0,
    cachedInputCostPer1M: 0.5,
  },
  [ClaudeModel.CLAUDE_4_SONNET_5]: {
    model: ClaudeModel.CLAUDE_4_SONNET_5,
    provider: LLMProviderName.CLAUDE,
    speed: 'balanced',
    costTier: 'medium',
    inputCostPer1M: 3.0,
    outputCostPer1M: 15.0,
    cachedInputCostPer1M: 0.3,
  },
  [ClaudeModel.CLAUDE_4_SONNET_6]: {
    model: ClaudeModel.CLAUDE_4_SONNET_6,
    provider: LLMProviderName.CLAUDE,
    speed: 'balanced',
    costTier: 'medium',
    contextWindowTokens: 1_000_000,
    inputCostPer1M: 3.0,
    outputCostPer1M: 15.0,
    cachedInputCostPer1M: 0.3,
  },
  [ClaudeModel.CLAUDE_4_HAIKU_5]: {
    model: ClaudeModel.CLAUDE_4_HAIKU_5,
    provider: LLMProviderName.CLAUDE,
    speed: 'fastest',
    costTier: 'low',
    inputCostPer1M: 1.0,
    outputCostPer1M: 5.0,
    cachedInputCostPer1M: 0.1,
  },
};

export const OPENAI_MODEL_TIERS: Record<OpenAIModel, ModelTier> = {
  [OpenAIModel.GPT_5_1]: {
    model: OpenAIModel.GPT_5_1,
    provider: LLMProviderName.OPENAI,
    speed: 'most_capable',
    costTier: 'medium',
    inputCostPer1M: 1.25,
    outputCostPer1M: 10.0,
    cachedInputCostPer1M: 0.125,
  },
  [OpenAIModel.GPT_5_MINI]: {
    model: OpenAIModel.GPT_5_MINI,
    provider: LLMProviderName.OPENAI,
    speed: 'fast',
    costTier: 'low',
    inputCostPer1M: 0.25,
    outputCostPer1M: 2.0,
    cachedInputCostPer1M: 0.025,
  },
  [OpenAIModel.GPT_5_NANO]: {
    model: OpenAIModel.GPT_5_NANO,
    provider: LLMProviderName.OPENAI,
    speed: 'fastest',
    costTier: 'lowest',
    inputCostPer1M: 0.05,
    outputCostPer1M: 0.4,
    cachedInputCostPer1M: 0.005,
  },
  [OpenAIModel.GPT_5_1_CODEX]: {
    model: OpenAIModel.GPT_5_1_CODEX,
    provider: LLMProviderName.OPENAI,
    speed: 'most_capable',
    costTier: 'medium',
    inputCostPer1M: 1.25,
    outputCostPer1M: 10.0,
    cachedInputCostPer1M: 0.125,
  },
  [OpenAIModel.GPT_5_1_CODEX_MINI]: {
    model: OpenAIModel.GPT_5_1_CODEX_MINI,
    provider: LLMProviderName.OPENAI,
    speed: 'fast',
    costTier: 'low',
    inputCostPer1M: 0.25,
    outputCostPer1M: 2.0,
    cachedInputCostPer1M: 0.025,
  },
};

export const SYNTHETIC_MODEL_TIERS: Record<SyntheticModel, ModelTier> = {
  [SyntheticModel.DEEPSEEK_R1_0528]: {
    model: SyntheticModel.DEEPSEEK_R1_0528,
    provider: LLMProviderName.SYNTHETIC,
    speed: 'capable',
    costTier: 'highest',
    contextWindowTokens: 128_000,
    inputCostPer1M: 3.0,
    outputCostPer1M: 8.0,
  },
  [SyntheticModel.DEEPSEEK_V3]: {
    model: SyntheticModel.DEEPSEEK_V3,
    provider: LLMProviderName.SYNTHETIC,
    speed: 'capable',
    costTier: 'medium',
    contextWindowTokens: 128_000,
    inputCostPer1M: 1.25,
    outputCostPer1M: 1.25,
  },
  [SyntheticModel.DEEPSEEK_V3_0324]: {
    model: SyntheticModel.DEEPSEEK_V3_0324,
    provider: LLMProviderName.SYNTHETIC,
    speed: 'capable',
    costTier: 'medium',
    contextWindowTokens: 128_000,
    inputCostPer1M: 1.2,
    outputCostPer1M: 1.2,
  },
  [SyntheticModel.DEEPSEEK_V3_2]: {
    model: SyntheticModel.DEEPSEEK_V3_2,
    provider: LLMProviderName.SYNTHETIC,
    speed: 'capable',
    costTier: 'low',
    contextWindowTokens: 159_000,
    inputCostPer1M: 0.56,
    outputCostPer1M: 1.68,
  },
  [SyntheticModel.LLAMA_3_3_70B_INSTRUCT]: {
    model: SyntheticModel.LLAMA_3_3_70B_INSTRUCT,
    provider: LLMProviderName.SYNTHETIC,
    speed: 'balanced',
    costTier: 'low',
    contextWindowTokens: 128_000,
    inputCostPer1M: 0.9,
    outputCostPer1M: 0.9,
  },
  [SyntheticModel.MINIMAX_M2_1]: {
    model: SyntheticModel.MINIMAX_M2_1,
    provider: LLMProviderName.SYNTHETIC,
    speed: 'fast',
    costTier: 'low',
    contextWindowTokens: 192_000,
    inputCostPer1M: 0.3,
    outputCostPer1M: 1.2,
  },
  [SyntheticModel.KIMI_K2_INSTRUCT_0905]: {
    model: SyntheticModel.KIMI_K2_INSTRUCT_0905,
    provider: LLMProviderName.SYNTHETIC,
    speed: 'capable',
    costTier: 'medium',
    contextWindowTokens: 256_000,
    inputCostPer1M: 1.2,
    outputCostPer1M: 1.2,
  },
  [SyntheticModel.KIMI_K2_THINKING]: {
    model: SyntheticModel.KIMI_K2_THINKING,
    provider: LLMProviderName.SYNTHETIC,
    speed: 'capable',
    costTier: 'medium',
    contextWindowTokens: 256_000,
    inputCostPer1M: 0.6,
    outputCostPer1M: 2.5,
  },
  [SyntheticModel.KIMI_K2_5]: {
    model: SyntheticModel.KIMI_K2_5,
    provider: LLMProviderName.SYNTHETIC,
    speed: 'capable',
    costTier: 'medium',
    contextWindowTokens: 256_000,
    inputCostPer1M: 0.55,
    outputCostPer1M: 2.19,
  },
  [SyntheticModel.KIMI_K2_5_NVFP4]: {
    model: SyntheticModel.KIMI_K2_5_NVFP4,
    provider: LLMProviderName.SYNTHETIC,
    speed: 'fast',
    costTier: 'medium',
    contextWindowTokens: 256_000,
    inputCostPer1M: 0.55,
    outputCostPer1M: 2.19,
  },
  [SyntheticModel.GPT_OSS_120B]: {
    model: SyntheticModel.GPT_OSS_120B,
    provider: LLMProviderName.SYNTHETIC,
    speed: 'fastest',
    costTier: 'lowest',
    contextWindowTokens: 128_000,
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.1,
  },
  [SyntheticModel.QWEN3_235B_A22B_THINKING_2507]: {
    model: SyntheticModel.QWEN3_235B_A22B_THINKING_2507,
    provider: LLMProviderName.SYNTHETIC,
    speed: 'capable',
    costTier: 'high',
    contextWindowTokens: 256_000,
    inputCostPer1M: 0.65,
    outputCostPer1M: 3.0,
  },
  [SyntheticModel.QWEN3_CODER_480B_A35B_INSTRUCT]: {
    model: SyntheticModel.QWEN3_CODER_480B_A35B_INSTRUCT,
    provider: LLMProviderName.SYNTHETIC,
    speed: 'most_capable',
    costTier: 'high',
    contextWindowTokens: 256_000,
    inputCostPer1M: 2.0,
    outputCostPer1M: 2.0,
  },
  [SyntheticModel.GLM_4_7]: {
    model: SyntheticModel.GLM_4_7,
    provider: LLMProviderName.SYNTHETIC,
    speed: 'capable',
    costTier: 'medium',
    contextWindowTokens: 198_000,
    inputCostPer1M: 0.55,
    outputCostPer1M: 2.19,
  },
  [SyntheticModel.GLM_4_7_FLASH]: {
    model: SyntheticModel.GLM_4_7_FLASH,
    provider: LLMProviderName.SYNTHETIC,
    speed: 'fast',
    costTier: 'lowest',
    contextWindowTokens: 198_000,
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.5,
  },
  [SyntheticModel.NEMOTRON_3_SUPER_120B_A12B_NVFP4]: {
    model: SyntheticModel.NEMOTRON_3_SUPER_120B_A12B_NVFP4,
    provider: LLMProviderName.SYNTHETIC,
    speed: 'capable',
    costTier: 'medium',
    contextWindowTokens: 262_000,
    inputCostPer1M: 0.3,
    outputCostPer1M: 1.0,
  },
};

export const ANTHROPIC_TIER_MODELS: Record<AnthropicTier, ClaudeModel> = {
  haiku: ClaudeModel.CLAUDE_4_HAIKU_5,
  sonnet: ClaudeModel.CLAUDE_4_SONNET_6,
  opus: ClaudeModel.CLAUDE_4_OPUS_5,
};

export const OPENAI_TIER_MODELS: Record<OpenAITier, OpenAIModel> = {
  nano: OpenAIModel.GPT_5_NANO,
  mini: OpenAIModel.GPT_5_MINI,
  base: OpenAIModel.GPT_5_1,
  codex: OpenAIModel.GPT_5_1_CODEX,
};

export const ALL_MODEL_TIERS: Record<LLMModel, ModelTier> = {
  ...CLAUDE_MODEL_TIERS,
  ...OPENAI_MODEL_TIERS,
  ...SYNTHETIC_MODEL_TIERS,
};

export const DEFAULT_MAX_TOKENS = 8000;
export const DEFAULT_SYNTHETIC_MODEL = SyntheticModel.DEEPSEEK_V3_2;
