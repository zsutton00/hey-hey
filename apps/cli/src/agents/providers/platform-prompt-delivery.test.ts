import { describe, expect, it } from 'vitest';
import {
  composeFreshPlatformPromptDelivery,
  resolveProviderPlatformPromptDeliveryMode,
  isPlatformPromptDeliveryMode,
  PLATFORM_PROMPT_DELIVERY_MODE,
  PLATFORM_PROMPT_DELIVERY_MODES,
  PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE,
  type PlatformPromptFreshDeliveryInput,
} from './platform-prompt-delivery';

describe('platform-prompt-delivery', () => {
  it('declares the closed provider prompt-delivery vocabulary', () => {
    expect(PLATFORM_PROMPT_DELIVERY_MODES).toEqual([
      'appended-system-slot',
      'mint-turn-system-field',
      'initial-prefix',
      'base-instructions',
      'full-system-prompt',
    ]);
    expect(PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE).toEqual({
      claude: 'appended-system-slot',
      opencode: 'mint-turn-system-field',
      codex: 'initial-prefix',
    });
    expect(isPlatformPromptDeliveryMode('initial-prefix')).toBe(true);
    expect(isPlatformPromptDeliveryMode('provider-local-convention')).toBe(false);
  });

  it('composes a fresh appended-system-slot delivery without changing first-turn input', () => {
    const resolvedFirstTurnInput = '  run the task exactly as written\n';
    const assembledPlatformPrompt = 'platform prompt';

    const delivery = composeFreshPlatformPromptDelivery({
      mode: PLATFORM_PROMPT_DELIVERY_MODE.APPENDED_SYSTEM_SLOT,
      assembledPlatformPrompt,
      resolvedFirstTurnInput,
    });

    expect(delivery).toEqual({
      mode: 'appended-system-slot',
      firstTurnInput: resolvedFirstTurnInput,
      appendedSystemPrompt: assembledPlatformPrompt,
    });
  });

  it('composes a fresh mint-turn-system-field delivery without changing first-turn input', () => {
    const resolvedFirstTurnInput = 'turn input\nwith punctuation.';
    const assembledPlatformPrompt = 'platform prompt for opencode';

    const delivery = composeFreshPlatformPromptDelivery({
      mode: PLATFORM_PROMPT_DELIVERY_MODE.MINT_TURN_SYSTEM_FIELD,
      assembledPlatformPrompt,
      resolvedFirstTurnInput,
    });

    expect(delivery).toEqual({
      mode: 'mint-turn-system-field',
      firstTurnInput: resolvedFirstTurnInput,
      mintTurnSystemPrompt: assembledPlatformPrompt,
    });
  });

  it('composes a fresh initial-prefix delivery with one explicit platform prefix', () => {
    const resolvedFirstTurnInput = 'first codex turn';
    const assembledPlatformPrompt = 'platform prompt for codex';

    const delivery = composeFreshPlatformPromptDelivery({
      mode: PLATFORM_PROMPT_DELIVERY_MODE.INITIAL_PREFIX,
      assembledPlatformPrompt,
      resolvedFirstTurnInput,
    });

    expect(delivery).toEqual({
      mode: 'initial-prefix',
      firstTurnInput: resolvedFirstTurnInput,
      initialPrefix: assembledPlatformPrompt,
      prefixedFirstTurnInput: `${assembledPlatformPrompt}\n\n${resolvedFirstTurnInput}`,
      structuredFirstTurnInput: [
        { text: assembledPlatformPrompt, cacheBreakpoint: true },
        { text: resolvedFirstTurnInput, cacheBreakpoint: false },
      ],
    });
  });

  it('composes Codex base instructions without changing first-turn input', () => {
    expect(
      composeFreshPlatformPromptDelivery({
        mode: PLATFORM_PROMPT_DELIVERY_MODE.BASE_INSTRUCTIONS,
        assembledPlatformPrompt: 'platform prompt for codex',
        resolvedFirstTurnInput: 'first codex turn',
      }),
    ).toEqual({
      mode: 'base-instructions',
      firstTurnInput: 'first codex turn',
      baseInstructions: 'platform prompt for codex',
    });
  });

  it.each([
    PLATFORM_PROMPT_DELIVERY_MODE.APPENDED_SYSTEM_SLOT,
    PLATFORM_PROMPT_DELIVERY_MODE.MINT_TURN_SYSTEM_FIELD,
  ] as const)('places stable entity instructions in the %s cache boundary', (mode) => {
    const delivery = composeFreshPlatformPromptDelivery({
      mode,
      assembledPlatformPrompt: 'PLATFORM',
      resolvedFirstTurnInput: 'legacy input',
      startupSegments: {
        stableInstructions: 'STABLE ENTITY INSTRUCTIONS',
        dynamicContext: 'DYNAMIC ENTITY CONTEXT',
        userInput: 'CURRENT USER INPUT',
      },
    });

    expect(delivery.firstTurnInput).toBe('DYNAMIC ENTITY CONTEXT\n\nCURRENT USER INPUT');
    if (delivery.mode === PLATFORM_PROMPT_DELIVERY_MODE.APPENDED_SYSTEM_SLOT) {
      expect(delivery.appendedSystemPrompt).toBe('PLATFORM\n\nSTABLE ENTITY INSTRUCTIONS');
    } else if (delivery.mode === PLATFORM_PROMPT_DELIVERY_MODE.MINT_TURN_SYSTEM_FIELD) {
      expect(delivery.mintTurnSystemPrompt).toBe('PLATFORM\n\nSTABLE ENTITY INSTRUCTIONS');
    } else {
      throw new Error(`Unexpected delivery mode: ${delivery.mode}`);
    }
  });

  it('keeps Codex input stable-first for automatic prefix caching', () => {
    const delivery = composeFreshPlatformPromptDelivery({
      mode: PLATFORM_PROMPT_DELIVERY_MODE.INITIAL_PREFIX,
      assembledPlatformPrompt: 'PLATFORM',
      resolvedFirstTurnInput: 'legacy input',
      startupSegments: {
        stableInstructions: 'STABLE ENTITY INSTRUCTIONS',
        dynamicContext: 'DYNAMIC ENTITY CONTEXT',
        userInput: 'CURRENT USER INPUT',
      },
    });

    expect(delivery.mode).toBe(PLATFORM_PROMPT_DELIVERY_MODE.INITIAL_PREFIX);
    if (delivery.mode !== PLATFORM_PROMPT_DELIVERY_MODE.INITIAL_PREFIX) {
      throw new Error(`Unexpected delivery mode: ${delivery.mode}`);
    }
    expect(delivery.structuredFirstTurnInput).toEqual([
      { text: 'PLATFORM', cacheBreakpoint: false },
      { text: 'STABLE ENTITY INSTRUCTIONS', cacheBreakpoint: true },
      { text: 'DYNAMIC ENTITY CONTEXT', cacheBreakpoint: false },
      { text: 'CURRENT USER INPUT', cacheBreakpoint: false },
    ]);
  });

  it('fails before composition when the assembled platform prompt is empty', () => {
    expect(() =>
      composeFreshPlatformPromptDelivery({
        mode: PLATFORM_PROMPT_DELIVERY_MODE.APPENDED_SYSTEM_SLOT,
        assembledPlatformPrompt: '  \n\t',
        resolvedFirstTurnInput: 'first turn',
      }),
    ).toThrow('assembledPlatformPrompt must be non-empty');
  });

  it('fails before composition when first-turn input is missing or empty', () => {
    expect(() =>
      composeFreshPlatformPromptDelivery({
        mode: PLATFORM_PROMPT_DELIVERY_MODE.MINT_TURN_SYSTEM_FIELD,
        assembledPlatformPrompt: 'platform prompt',
        resolvedFirstTurnInput: '',
      }),
    ).toThrow('resolvedFirstTurnInput must be non-empty');

    expect(() =>
      composeFreshPlatformPromptDelivery({
        mode: PLATFORM_PROMPT_DELIVERY_MODE.MINT_TURN_SYSTEM_FIELD,
        assembledPlatformPrompt: 'platform prompt',
      } as unknown as PlatformPromptFreshDeliveryInput),
    ).toThrow('resolvedFirstTurnInput must be a string');
  });

  it('fails fast for unsupported delivery modes', () => {
    expect(() =>
      composeFreshPlatformPromptDelivery({
        mode: 'provider-local-convention',
        assembledPlatformPrompt: 'platform prompt',
        resolvedFirstTurnInput: 'first turn',
      } as unknown as PlatformPromptFreshDeliveryInput),
    ).toThrow('Unsupported platform prompt delivery mode: provider-local-convention');
  });
});

describe('handler-selected replacement', () => {
  it.each(['codex', 'claude'] as const)(
    'keeps %s defaults unless explicitly replaced',
    (provider) => {
      expect(resolveProviderPlatformPromptDeliveryMode(provider)).toBe(
        PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE[provider],
      );
      const mode = resolveProviderPlatformPromptDeliveryMode(provider, true);
      expect(mode).toBe(provider === 'codex' ? 'base-instructions' : 'full-system-prompt');
      const delivery = composeFreshPlatformPromptDelivery({
        mode,
        assembledPlatformPrompt: 'PLATFORM',
        resolvedFirstTurnInput: 'INPUT',
        startupSegments: {
          stableInstructions: 'STABLE',
          dynamicContext: 'DYNAMIC',
          userInput: 'USER',
        },
      });
      expect(delivery).toEqual(
        provider === 'codex'
          ? { mode, baseInstructions: 'PLATFORM\n\nSTABLE', firstTurnInput: 'DYNAMIC\n\nUSER' }
          : { mode, systemPrompt: 'PLATFORM\n\nSTABLE', firstTurnInput: 'DYNAMIC\n\nUSER' },
      );
    },
  );
});
