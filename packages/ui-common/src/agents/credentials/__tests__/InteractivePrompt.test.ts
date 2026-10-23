/** @vitest-environment node */

import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createInteractivePrompter } from "../cli/interactivePrompt";

type MockTtyInput = PassThrough &
  NodeJS.ReadStream & {
    isTTY: boolean;
    isRaw: boolean;
    setRawMode: (mode: boolean) => void;
  };

type MockTtyOutput = PassThrough &
  NodeJS.WriteStream & {
    isTTY: boolean;
  };

const createMockTtyInput = (): MockTtyInput => {
  const input = new PassThrough() as MockTtyInput;
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (mode: boolean) => {
    input.isRaw = mode;
  };
  return input;
};

const createMockTtyOutput = (): MockTtyOutput => {
  const output = new PassThrough() as MockTtyOutput;
  output.isTTY = true;
  return output;
};

describe("interactive credential prompts", () => {
  it("reads secret input in raw mode without mutating stream encoding", async () => {
    const input = createMockTtyInput();
    const output = createMockTtyOutput();
    const prompter = createInteractivePrompter({
      input,
      output,
    });

    const rawModeHistory: boolean[] = [];
    input.setRawMode = (mode: boolean) => {
      rawModeHistory.push(mode);
      input.isRaw = mode;
    };

    let setEncodingCalls = 0;
    const originalSetEncoding = input.setEncoding.bind(input);
    input.setEncoding = ((encoding: BufferEncoding) => {
      setEncodingCalls += 1;
      return originalSetEncoding(encoding);
    }) as typeof input.setEncoding;

    let outputText = "";
    output.on("data", (chunk: Buffer | string) => {
      outputText += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });

    const secretPromise = prompter.promptSecret("Access token: ");

    input.write(Buffer.from("sec"));
    input.write(Buffer.from("ret"));
    input.write(Buffer.from("\r"));

    await expect(secretPromise).resolves.toBe("secret");
    expect(rawModeHistory).toEqual([true, false]);
    expect(setEncodingCalls).toBe(0);
    expect(outputText).toContain("Access token: ");
  });

  it("handles backspace while reading secret input", async () => {
    const input = createMockTtyInput();
    const output = createMockTtyOutput();
    const prompter = createInteractivePrompter({
      input,
      output,
    });

    const secretPromise = prompter.promptSecret("Access token: ");

    input.write(Buffer.from("ab"));
    input.write(Buffer.from("\u007f"));
    input.write(Buffer.from("c\r"));

    await expect(secretPromise).resolves.toBe("ac");
  });
});
