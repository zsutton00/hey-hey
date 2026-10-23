export const PLATFORM_PROMPT_DELIVERY_MODE = {
  APPENDED_SYSTEM_SLOT: 'appended-system-slot',
  MINT_TURN_SYSTEM_FIELD: 'mint-turn-system-field',
  INITIAL_PREFIX: 'initial-prefix',
  BASE_INSTRUCTIONS: 'base-instructions',
  FULL_SYSTEM_PROMPT: 'full-system-prompt',
} as const;

export const PLATFORM_PROMPT_DELIVERY_MODES = [
  PLATFORM_PROMPT_DELIVERY_MODE.APPENDED_SYSTEM_SLOT,
  PLATFORM_PROMPT_DELIVERY_MODE.MINT_TURN_SYSTEM_FIELD,
  PLATFORM_PROMPT_DELIVERY_MODE.INITIAL_PREFIX,
  PLATFORM_PROMPT_DELIVERY_MODE.BASE_INSTRUCTIONS,
  PLATFORM_PROMPT_DELIVERY_MODE.FULL_SYSTEM_PROMPT,
] as const;

export type PlatformPromptDeliveryMode = (typeof PLATFORM_PROMPT_DELIVERY_MODES)[number];

export const PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE = {
  claude: PLATFORM_PROMPT_DELIVERY_MODE.APPENDED_SYSTEM_SLOT,
  opencode: PLATFORM_PROMPT_DELIVERY_MODE.MINT_TURN_SYSTEM_FIELD,
  codex: PLATFORM_PROMPT_DELIVERY_MODE.INITIAL_PREFIX,
} as const satisfies Record<string, PlatformPromptDeliveryMode>;

/** Handler intent selects replacement independently of filesystem permissions. */
export const resolveProviderPlatformPromptDeliveryMode = (
  provider: keyof typeof PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE,
  replaceProviderSystemPrompt = false,
): PlatformPromptDeliveryMode => {
  if (replaceProviderSystemPrompt) {
    if (provider === 'codex') return PLATFORM_PROMPT_DELIVERY_MODE.BASE_INSTRUCTIONS;
    if (provider === 'claude') return PLATFORM_PROMPT_DELIVERY_MODE.FULL_SYSTEM_PROMPT;
  }
  return PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE[provider];
};

interface FreshDeliveryInputBase {
  assembledPlatformPrompt: string;
  resolvedFirstTurnInput: string;
  startupSegments?: {
    readonly stableInstructions: string;
    readonly dynamicContext: string;
    readonly userInput: string;
  };
}

type AppendedSystemSlotFreshDeliveryInput = FreshDeliveryInputBase & {
  mode: typeof PLATFORM_PROMPT_DELIVERY_MODE.APPENDED_SYSTEM_SLOT;
};

type MintTurnSystemFieldFreshDeliveryInput = FreshDeliveryInputBase & {
  mode: typeof PLATFORM_PROMPT_DELIVERY_MODE.MINT_TURN_SYSTEM_FIELD;
};

type InitialPrefixFreshDeliveryInput = FreshDeliveryInputBase & {
  mode: typeof PLATFORM_PROMPT_DELIVERY_MODE.INITIAL_PREFIX;
};

type BaseInstructionsFreshDeliveryInput = FreshDeliveryInputBase & {
  mode: typeof PLATFORM_PROMPT_DELIVERY_MODE.BASE_INSTRUCTIONS;
};

type FullSystemPromptFreshDeliveryInput = FreshDeliveryInputBase & {
  mode: typeof PLATFORM_PROMPT_DELIVERY_MODE.FULL_SYSTEM_PROMPT;
};

export type PlatformPromptFreshDeliveryInput =
  | AppendedSystemSlotFreshDeliveryInput
  | MintTurnSystemFieldFreshDeliveryInput
  | InitialPrefixFreshDeliveryInput
  | BaseInstructionsFreshDeliveryInput
  | FullSystemPromptFreshDeliveryInput;

interface RuntimePlatformPromptFreshDeliveryInput extends FreshDeliveryInputBase {
  mode: string;
}

interface AppendedSystemSlotFreshDelivery {
  mode: typeof PLATFORM_PROMPT_DELIVERY_MODE.APPENDED_SYSTEM_SLOT;
  firstTurnInput: string;
  appendedSystemPrompt: string;
}

interface MintTurnSystemFieldFreshDelivery {
  mode: typeof PLATFORM_PROMPT_DELIVERY_MODE.MINT_TURN_SYSTEM_FIELD;
  firstTurnInput: string;
  mintTurnSystemPrompt: string;
}

interface InitialPrefixFreshDelivery {
  mode: typeof PLATFORM_PROMPT_DELIVERY_MODE.INITIAL_PREFIX;
  firstTurnInput: string;
  initialPrefix: string;
  prefixedFirstTurnInput: string;
  structuredFirstTurnInput: readonly {
    readonly text: string;
    readonly cacheBreakpoint: boolean;
  }[];
}

interface BaseInstructionsFreshDelivery {
  mode: typeof PLATFORM_PROMPT_DELIVERY_MODE.BASE_INSTRUCTIONS;
  firstTurnInput: string;
  baseInstructions: string;
}

interface FullSystemPromptFreshDelivery {
  mode: typeof PLATFORM_PROMPT_DELIVERY_MODE.FULL_SYSTEM_PROMPT;
  firstTurnInput: string;
  systemPrompt: string;
}

export type PlatformPromptFreshDelivery =
  | AppendedSystemSlotFreshDelivery
  | MintTurnSystemFieldFreshDelivery
  | InitialPrefixFreshDelivery
  | BaseInstructionsFreshDelivery
  | FullSystemPromptFreshDelivery;

const requireNonBlankString = (value: string, fieldName: string): string => {
  if (typeof value !== 'string') {
    throw new TypeError(`${fieldName} must be a string`);
  }
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must be non-empty`);
  }
  return value;
};

const requirePresentString = (value: string, fieldName: string): string => {
  if (typeof value !== 'string') {
    throw new TypeError(`${fieldName} must be a string`);
  }
  if (value.length === 0) {
    throw new Error(`${fieldName} must be non-empty`);
  }
  return value;
};

const rejectUnsupportedMode = (mode: string): never => {
  throw new Error(`Unsupported platform prompt delivery mode: ${String(mode)}`);
};

export const isPlatformPromptDeliveryMode = (value: string): value is PlatformPromptDeliveryMode =>
  PLATFORM_PROMPT_DELIVERY_MODES.some((mode) => mode === value);

export function composeFreshPlatformPromptDelivery(
  input: PlatformPromptFreshDeliveryInput,
): PlatformPromptFreshDelivery;
export function composeFreshPlatformPromptDelivery(
  input: RuntimePlatformPromptFreshDeliveryInput,
): PlatformPromptFreshDelivery {
  const assembledPlatformPrompt = requireNonBlankString(
    input.assembledPlatformPrompt,
    'assembledPlatformPrompt',
  );
  const firstTurnInput = requirePresentString(
    input.resolvedFirstTurnInput,
    'resolvedFirstTurnInput',
  );
  const stablePrompt = input.startupSegments
    ? [assembledPlatformPrompt, input.startupSegments.stableInstructions]
        .filter((value) => value.length > 0)
        .join('\n\n')
    : assembledPlatformPrompt;
  const dynamicFirstTurnInput = input.startupSegments
    ? [input.startupSegments.dynamicContext, input.startupSegments.userInput]
        .filter((value) => value.length > 0)
        .join('\n\n')
    : firstTurnInput;

  switch (input.mode) {
    case PLATFORM_PROMPT_DELIVERY_MODE.APPENDED_SYSTEM_SLOT:
      return {
        mode: input.mode,
        firstTurnInput: dynamicFirstTurnInput,
        appendedSystemPrompt: stablePrompt,
      };
    case PLATFORM_PROMPT_DELIVERY_MODE.MINT_TURN_SYSTEM_FIELD:
      return {
        mode: input.mode,
        firstTurnInput: dynamicFirstTurnInput,
        mintTurnSystemPrompt: stablePrompt,
      };
    case PLATFORM_PROMPT_DELIVERY_MODE.INITIAL_PREFIX:
      return {
        mode: input.mode,
        firstTurnInput: dynamicFirstTurnInput,
        initialPrefix: stablePrompt,
        prefixedFirstTurnInput: `${stablePrompt}\n\n${dynamicFirstTurnInput}`,
        structuredFirstTurnInput: input.startupSegments
          ? [
              { text: assembledPlatformPrompt, cacheBreakpoint: false },
              { text: input.startupSegments.stableInstructions, cacheBreakpoint: true },
              { text: input.startupSegments.dynamicContext, cacheBreakpoint: false },
              ...(input.startupSegments.userInput
                ? [{ text: input.startupSegments.userInput, cacheBreakpoint: false }]
                : []),
            ]
          : [
              { text: assembledPlatformPrompt, cacheBreakpoint: true },
              { text: firstTurnInput, cacheBreakpoint: false },
            ],
      };
    case PLATFORM_PROMPT_DELIVERY_MODE.FULL_SYSTEM_PROMPT:
      return {
        mode: input.mode,
        firstTurnInput: dynamicFirstTurnInput,
        systemPrompt: stablePrompt,
      };
    case PLATFORM_PROMPT_DELIVERY_MODE.BASE_INSTRUCTIONS:
      return {
        mode: input.mode,
        firstTurnInput: dynamicFirstTurnInput,
        baseInstructions: stablePrompt,
      };
    default:
      return rejectUnsupportedMode(input.mode);
  }
}
