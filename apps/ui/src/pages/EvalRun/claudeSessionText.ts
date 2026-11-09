/**
 * A terminal-style reading of a Claude session file: what was asked, said,
 * thought, run and returned. Internal bookkeeping (ids, request shapes, cost,
 * hooks) is left out; the raw file stays available beside it.
 */

type Json = Record<string, unknown>;

const isJson = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const indent = (text: string, prefix: string): string =>
  text
    .split("\n")
    .map((line, index) => (index === 0 ? line : `${prefix}${line}`))
    .join("\n");

const stringify = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

const toolInput = (input: unknown): string => {
  if (!isJson(input)) {
    return "";
  }
  return Object.entries(input)
    .map(([key, value]) => `  ${key}: ${indent(stringify(value), "    ")}`)
    .join("\n");
};

const toolResultText = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return stringify(content);
  }
  return content
    .map((block) =>
      isJson(block) && block.type === "text" && typeof block.text === "string"
        ? block.text
        : stringify(block),
    )
    .join("\n");
};

const blockText = (block: Json, role: unknown): string | null => {
  switch (block.type) {
    case "text":
      return typeof block.text === "string"
        ? role === "user"
          ? `> ${indent(block.text.trim(), "  ")}`
          : `● ${indent(block.text.trim(), "  ")}`
        : null;
    case "thinking":
      return typeof block.thinking === "string" && block.thinking.trim()
        ? `✻ Thinking\n  ${indent(block.thinking.trim(), "  ")}`
        : null;
    case "tool_use": {
      const input = toolInput(block.input);
      return `● ${String(block.name)}${input ? `\n${input}` : ""}`;
    }
    case "tool_result": {
      const marker = block.is_error === true ? "⎿ Error" : "⎿";
      return `${marker} ${indent(toolResultText(block.content).trim(), "  ")}`;
    }
    default:
      return null;
  }
};

const recordText = (record: Json): string | null => {
  if (record.type !== "user" && record.type !== "assistant") {
    return null;
  }
  const message = record.message;
  if (!isJson(message)) {
    return null;
  }
  if (typeof message.content === "string") {
    return blockText({ type: "text", text: message.content }, message.role);
  }
  if (!Array.isArray(message.content)) {
    return null;
  }
  const parts = message.content
    .filter(isJson)
    .map((block) => blockText(block, message.role))
    .filter((part): part is string => part !== null);
  return parts.length ? parts.join("\n\n") : null;
};

export const formatClaudeSession = (raw: string): string =>
  raw
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        const parsed: unknown = JSON.parse(line);
        const text = isJson(parsed) ? recordText(parsed) : null;
        return text ? [text] : [];
      } catch {
        // A cut-off or damaged line is skipped here; the raw view still has it.
        return [];
      }
    })
    .join("\n\n");
