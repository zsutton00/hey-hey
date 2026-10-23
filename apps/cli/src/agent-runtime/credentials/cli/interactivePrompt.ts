import { createInterface } from 'node:readline/promises';

export interface CredentialPrompter {
  prompt(question: string): Promise<string>;
  promptSecret(question: string): Promise<string>;
  confirm(question: string, defaultValue?: boolean): Promise<boolean>;
}

export interface InteractivePrompterOptions {
  input?: NodeJS.ReadStream | undefined;
  output?: NodeJS.WriteStream | undefined;
}

const normalizeAnswer = (value: string): string => value.trim().toLowerCase();

const readVisibleLine = async (
  question: string,
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
): Promise<string> => {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
};

const readSecretLine = async (
  question: string,
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
): Promise<string> => {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    return readVisibleLine(question, input, output);
  }

  output.write(question);

  const originalRawMode = input.isRaw;
  input.setRawMode(true);
  input.resume();

  return new Promise<string>((resolve, reject) => {
    let value = '';

    const cleanup = () => {
      input.removeListener('data', onData);
      input.setRawMode(originalRawMode);
      output.write('\n');
    };

    const onData = (chunk: string | Buffer) => {
      const inputChunk = typeof chunk === 'string' ? chunk : chunk.toString('utf8');

      for (const character of inputChunk) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Credential input interrupted by user'));
          return;
        }

        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(value.trim());
          return;
        }

        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, Math.max(0, value.length - 1));
          continue;
        }

        if (character >= ' ') {
          value += character;
        }
      }
    };

    input.on('data', onData);
  });
};

export const createInteractivePrompter = (
  options: InteractivePrompterOptions = {},
): CredentialPrompter => {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  return {
    prompt: (question: string) => readVisibleLine(question, input, output),
    promptSecret: (question: string) => readSecretLine(question, input, output),
    confirm: async (question: string, defaultValue = false) => {
      const suffix = defaultValue ? ' [Y/n] ' : ' [y/N] ';
      const answer = normalizeAnswer(await readVisibleLine(`${question}${suffix}`, input, output));
      if (answer.length === 0) {
        return defaultValue;
      }

      return answer === 'y' || answer === 'yes';
    },
  };
};
