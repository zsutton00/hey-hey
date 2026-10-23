import { z } from 'zod';
const target = {
  selector: z.string().min(1).max(2000).optional(),
  ref: z
    .string()
    .regex(/^e\d+$/u)
    .optional(),
};
const oneTarget = (value: { selector?: string | undefined; ref?: string | undefined }) =>
  Boolean(value.selector) !== Boolean(value.ref);
export const browserCallSchema = z
  .discriminatedUnion('name', [
    z.object({
      name: z.literal('navigate'),
      arguments: z.object({ url: z.string().url().max(8000) }).strict(),
    }),
    z.object({ name: z.literal('snapshot'), arguments: z.object({}).strict() }),
    z.object({ name: z.literal('click'), arguments: z.object(target).strict() }),
    z.object({
      name: z.literal('type'),
      arguments: z.object({ ...target, text: z.string().max(100_000) }).strict(),
    }),
    z.object({ name: z.literal('screenshot'), arguments: z.object({}).strict() }),
    z.object({
      name: z.literal('evaluate'),
      arguments: z.object({ expression: z.string().min(1).max(20_000) }).strict(),
    }),
    z.object({ name: z.literal('console_messages'), arguments: z.object({}).strict() }),
    z.object({ name: z.literal('list_pages'), arguments: z.object({}).strict() }),
    z.object({
      name: z.literal('select_page'),
      arguments: z.object({ pageId: z.string().uuid() }).strict(),
    }),
  ])
  .superRefine((call, ctx) => {
    if ((call.name === 'click' || call.name === 'type') && !oneTarget(call.arguments))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Supply exactly one selector or snapshot ref',
      });
  });
export type BrowserCall = z.infer<typeof browserCallSchema>;
const stringProperty = { type: 'string' } as const;
export const BROWSER_TOOLS = [
  {
    name: 'navigate',
    description: 'Navigate your selected page.',
    properties: { url: stringProperty },
    required: ['url'],
  },
  {
    name: 'snapshot',
    description: 'Read an accessibility snapshot with current element refs.',
    properties: {},
    required: [],
  },
  {
    name: 'click',
    description: 'Click by selector or current snapshot ref (exactly one).',
    properties: { selector: stringProperty, ref: stringProperty },
    required: [],
  },
  {
    name: 'type',
    description: 'Fill by selector or current snapshot ref (exactly one).',
    properties: { selector: stringProperty, ref: stringProperty, text: stringProperty },
    required: ['text'],
  },
  {
    name: 'screenshot',
    description: 'Capture your selected page viewport.',
    properties: {},
    required: [],
  },
  {
    name: 'evaluate',
    description: 'Evaluate a JavaScript expression on your selected page; returns JSON.',
    properties: { expression: stringProperty },
    required: ['expression'],
  },
  {
    name: 'console_messages',
    description: 'Read the last 100 console messages on your selected page.',
    properties: {},
    required: [],
  },
  {
    name: 'list_pages',
    description: 'List only your Run-owned page and popups.',
    properties: {},
    required: [],
  },
  {
    name: 'select_page',
    description: 'Select one of your Run-owned pages by opaque pageId.',
    properties: { pageId: stringProperty },
    required: ['pageId'],
  },
].map(({ name, description, properties, required }) => ({
  name,
  description,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
}));
