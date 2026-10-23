type NonEmptyArray<T> = readonly [T, ...T[]];

function pick<T>(arr: NonEmptyArray<T>): T {
  const i = Math.floor(Math.random() * arr.length);
  const v = arr[i]; // with noUncheckedIndexedAccess this is T | undefined
  if (v === undefined) {
    // Should be impossible, but keeps TS + runtime honest.
    throw new Error('pick(): unexpectedly out of bounds');
  }
  return v;
}

export function randomThreeWordName(): string {
  const adjectives: NonEmptyArray<string> = [
    'quiet',
    'loud',
    'ancient',
    'curious',
    'brave',
    'fuzzy',
    'elegant',
    'restless',
    'hidden',
    'gentle',
    'wild',
    'electric',
    'cosmic',
    'fragile',
    'burning',
    'silent',
    'nimble',
    'glacial',
    'radiant',
    'twisted',
    'hollow',
    'bright',
    'stormy',
    'lucid',
  ];

  const colors: NonEmptyArray<string> = [
    'green',
    'blue',
    'crimson',
    'amber',
    'violet',
    'indigo',
    'silver',
    'golden',
    'ashen',
    'ivory',
    'obsidian',
    'teal',
    'scarlet',
    'cobalt',
    'saffron',
    'emerald',
  ];

  const animals: NonEmptyArray<string> = [
    'monkey',
    'fox',
    'raven',
    'tiger',
    'otter',
    'whale',
    'lizard',
    'owl',
    'wolf',
    'beetle',
    'moth',
    'eel',
    'cat',
    'badger',
    'crow',
    'lynx',
    'panther',
  ];

  const objects: NonEmptyArray<string> = [
    'ship',
    'engine',
    'tower',
    'key',
    'bridge',
    'compass',
    'mirror',
    'gate',
    'machine',
    'artifact',
    'satellite',
    'vault',
    'lantern',
    'harbor',
    'circuit',
    'map',
  ];

  const abstractNouns: NonEmptyArray<string> = [
    'dream',
    'echo',
    'shadow',
    'memory',
    'pulse',
    'myth',
    'signal',
    'flux',
    'horizon',
    'thread',
    'spark',
    'void',
    'drift',
    'gravity',
    'chance',
    'silence',
  ];

  // Multiple patterns = more variety.
  const patterns: NonEmptyArray<() => string> = [
    () => `${pick(colors)} ${pick(animals)} ${pick(objects)}`,
    () => `${pick(adjectives)} ${pick(animals)} ${pick(abstractNouns)}`,
    () => `${pick(adjectives)} ${pick(objects)} ${pick(abstractNouns)}`,
    () => `${pick(colors)} ${pick(objects)} ${pick(abstractNouns)}`,
    () => `${pick(adjectives)} ${pick(colors)} ${pick(objects)}`,
    () => `${pick(adjectives)} ${pick(animals)} ${pick(objects)}`,
    () => `${pick(colors)} ${pick(animals)} ${pick(abstractNouns)}`,
  ];

  return pick(patterns)();
}

// Examples:
// "obsidian raven signal"
// "curious fox memory"
// "electric tower echo"
// "golden compass dream"

export function buildDefaultConversationTitle(flowId: string): string {
  return `${flowId} - ${randomThreeWordName()}`;
}

export function isDefaultConversationTitle(
  title: string | null | undefined,
  flowId: string,
): boolean {
  if (!title) {
    return false;
  }
  return new RegExp(`^${flowId} \\w+ \\w+ \\w+$`).test(title);
}
