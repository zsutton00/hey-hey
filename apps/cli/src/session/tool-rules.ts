import fs from 'node:fs';
import path from 'node:path';
import { resolveBaseDir } from './paths';

const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_\-.:]+$/;

const resolveToolRulesPath = (): string => path.join(resolveBaseDir(), 'tool-rules.json');

const isValidToolName = (name: string): boolean =>
  name.length > 0 && name.length <= 256 && TOOL_NAME_PATTERN.test(name);

export class ToolRuleStore {
  private writeLock: Promise<void> = Promise.resolve();

  constructor(private readonly rulesPath: string = resolveToolRulesPath()) {}

  private withWriteLock(operation: () => void): void {
    this.writeLock = this.writeLock.then(operation, operation);
  }

  load(): string[] {
    try {
      const raw = fs.readFileSync(this.rulesPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (value): value is string => typeof value === 'string' && isValidToolName(value),
      );
    } catch {
      return [];
    }
  }

  save(toolName: string): void {
    this.withWriteLock(() => {
      const rules = this.load();
      if (rules.includes(toolName)) return;
      rules.push(toolName);
      fs.writeFileSync(this.rulesPath, `${JSON.stringify(rules, null, 2)}\n`);
    });
  }

  remove(toolName: string): void {
    this.withWriteLock(() => {
      const rules = this.load();
      const filtered = rules.filter((rule) => rule !== toolName);
      fs.writeFileSync(this.rulesPath, `${JSON.stringify(filtered, null, 2)}\n`);
    });
  }
}
