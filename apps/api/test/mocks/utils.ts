export type Mocked<T> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof T]?: T[K] extends (...args: any[]) => any
    ? jest.Mock<ReturnType<T[K]>, Parameters<T[K]>>
    : T[K];
};

export function createMock<T>(a: Partial<Mocked<T>>): Mocked<T> {
  return a as Mocked<T>;
}
