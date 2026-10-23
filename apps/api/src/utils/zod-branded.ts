import { z } from 'zod';

// Generic helper to create a Zod schema that returns a branded string.
// Usage: const UserIdSchema = branded<UserId>();
// This preserves the compile-time brand (e.g. `UserId`) while keeping runtime
// validation identical to `z.string()`.
export const branded = <T>() =>
  z.string().transform((val): T => val as unknown as T);
