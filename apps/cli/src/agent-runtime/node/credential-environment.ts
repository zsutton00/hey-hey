/** Variables `git` and `gh` read to authenticate; none reach a coding eval attempt or its tests. */
const CREDENTIAL_ENVIRONMENT_VARIABLES = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'SSH_AUTH_SOCK',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_CREDENTIAL_HELPER',
] as const;

/** `base` without git or GitHub credentials, with prompts for them disabled. */
export const stripCredentialEnvironment = (base: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const stripped: NodeJS.ProcessEnv = { ...base };
  for (const name of CREDENTIAL_ENVIRONMENT_VARIABLES) {
    delete stripped[name];
  }
  stripped['GIT_TERMINAL_PROMPT'] = '0';

  return stripped;
};
