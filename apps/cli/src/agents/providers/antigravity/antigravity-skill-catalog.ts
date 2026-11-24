import { z } from 'zod';
import type { AgentSkillCatalog, AgentSkillCatalogEntry } from '../agent-skills';
import { runAntigravityPrint } from './antigravity-readiness';

const skillListSchema = z.object({
  skills: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string(),
      builtin: z.boolean().optional(),
    }),
  ),
});

/**
 * `agy -p /skills` attaches the structured list to the reply envelope
 * (`command.data.skills`); the prose `response` is only a rendering of it.
 * Skills `agy` ships with report `builtin: true` and are `system` scoped; the
 * rest are the user's. `agy` reports no enabled flag for a listed skill, so a
 * listed skill is enabled.
 */
export const parseAntigravitySkills = (commandData: unknown): AgentSkillCatalog => {
  const parsed = skillListSchema.safeParse(commandData);
  if (!parsed.success) {
    return {
      provider: 'antigravity',
      skills: [],
      errors: [
        {
          provider: 'antigravity',
          message: `agy /skills returned no structured skill list (${parsed.error.issues
            .map((issue) => issue.path.join('.') || issue.code)
            .join(', ')})`,
        },
      ],
    };
  }

  const skills: AgentSkillCatalogEntry[] = parsed.data.skills.map((skill) => ({
    provider: 'antigravity',
    name: skill.name,
    catalogScope: skill.builtin === true ? 'system' : 'user',
    description: skill.description,
    enabled: true,
  }));
  return { provider: 'antigravity', skills, errors: [] };
};

/**
 * Skills a run can use. `agy -p` cannot take the run's `--agent` and
 * `--include-default-customizations=false` launch flags, so its list is every
 * skill `agy` could load by default. A live session advertises what it actually
 * loaded under the run's configuration, so a skill is offered only when the
 * session advertises it. Before a session exists nothing is known to be enabled
 * for the run, so only the skills `agy` ships with are offered.
 */
export const selectRunSkills = (
  catalog: AgentSkillCatalog,
  advertised: ReadonlySet<string> | undefined,
): AgentSkillCatalog => ({
  ...catalog,
  skills: catalog.skills.filter((skill) =>
    advertised ? advertised.has(skill.name) : skill.catalogScope === 'system',
  ),
});

export const listAntigravitySkills = async (
  advertised?: ReadonlySet<string>,
): Promise<AgentSkillCatalog> =>
  selectRunSkills(
    parseAntigravitySkills((await runAntigravityPrint('/skills')).commandData),
    advertised,
  );
