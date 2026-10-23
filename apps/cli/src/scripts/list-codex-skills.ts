#!/usr/bin/env tsx

import { CodexSkillCatalogReader } from '../agents/providers/codex/codex-skill-catalog';

const parseCwd = (argv: string[]): string => {
  let cwd = process.cwd();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--cwd') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --cwd');
      cwd = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument ?? '<missing>'}`);
  }
  return cwd;
};

const main = async (): Promise<void> => {
  const cwd = parseCwd(process.argv.slice(2));
  const result = await new CodexSkillCatalogReader().listSkills(cwd);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[codex:skills] ${message}`);
  process.exitCode = 1;
});
