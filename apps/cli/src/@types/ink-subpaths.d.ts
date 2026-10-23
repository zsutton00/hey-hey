// Ink and ink-testing-library publish types only through package `exports`,
// which the repository's Node module resolution does not read.
declare module 'ink' {
  export * from 'ink/build/index';
}

declare module 'ink-testing-library' {
  export * from 'ink-testing-library/build/index';
}
