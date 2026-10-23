#!/usr/bin/env node
// Brings the staging diagnostic credential set up to a target count by
// creating numbered accounts beside the existing dedicated users.
//
//   node scripts/k6/provision-diagnostic-users.mjs check
//   node scripts/k6/provision-diagnostic-users.mjs apply
//   K6_BASE_URL=... K6_BROWSER_ORIGIN=... node scripts/k6/provision-diagnostic-users.mjs verify
//
// check and apply run SQL through the deploy repo's staging helper, which
// pins the hey-hey-staging compose project; apply is one transaction.
import { execFileSync } from 'node:child_process';
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;
const target = process.env.STAGING_SSH_TARGET || 'zac@192.168.50.212';
const remoteRoot =
  process.env.STAGING_REMOTE_DEPLOY_ROOT || '/home/zac/heyhey/deploy';
const usersFile = resolve(
  process.env.K6_AUTH_USERS_FILE ||
    `${homedir()}/.config/hey-hey/api-diagnostic-users.json`,
);
const manifestPath = resolve(
  process.env.ACTIVITY_FIXTURE_MANIFEST ||
    'artifacts/api-diagnostic/activity-20261010055009/fixture-manifest.json',
);
const targetCount = Number(process.env.DIAGNOSTIC_USER_COUNT || 100);
const SUPPORTED_TARGETS = new Set([50, 100]);
const REQUIRED_COLUMNS = 8;

function log(message) {
  console.error(`[provision-diagnostic-users] ${message}`);
}

function loadState() {
  const users = JSON.parse(readFileSync(usersFile, 'utf8'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!SUPPORTED_TARGETS.has(targetCount) || !users.length) {
    throw new Error('Provisioning targets fifty or one hundred users and requires existing credentials');
  }
  const { organizationId, projectId } = manifest;
  if (users.some((u) => u.organizationId !== organizationId)) {
    throw new Error('Existing diagnostic users must share the fixture organization');
  }
  const passwords = new Set(users.map((u) => u.password));
  if (passwords.size !== 1) {
    throw new Error('Existing diagnostic users must share one password');
  }
  const match = /^(.*\+pj)(\d+)(@.*)$/.exec(users[0].email);
  if (!match) throw new Error('Unexpected diagnostic email pattern');
  const [, prefix, , domain] = match;
  const numbers = new Set();
  for (const user of users) {
    const numbered = /^(.*\+pj)(\d+)(@.*)$/.exec(user.email);
    const number = Number(numbered?.[2]);
    if (!numbered || numbered[1] !== prefix || numbered[3] !== domain ||
        number < 1 || number > targetCount || numbers.has(number)) {
      throw new Error('Diagnostic credentials must contain unique numbered identities in the target range');
    }
    numbers.add(number);
  }
  const missing = [];
  for (let n = 1; n <= targetCount; n += 1) {
    if (numbers.has(n)) continue;
    missing.push({
      email: `${prefix}${n}${domain}`,
      name: `Diagnostic User ${n}`,
      organizationId,
    });
  }
  return { users, organizationId, projectId, password: users[0].password, missing };
}

const literal = (value) => `'${String(value).replace(/'/g, "''")}'`;

function runSql(sql) {
  return execFileSync(
    'ssh',
    ['-o', 'BatchMode=yes', target, `sh ${remoteRoot}/scripts/staging-api-diagnostic.sh diagnostic-sql`],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] },
  ).trim();
}

function checkSql({ users, organizationId, projectId, missing }) {
  const existing = users.map((u) => literal(u.email)).join(',');
  const wanted = missing.map((u) => literal(u.email)).join(',') || 'NULL';
  return `SELECT json_build_object(
  'columns', (SELECT json_agg(table_name || '.' || column_name ORDER BY 1) FROM information_schema.columns
    WHERE table_schema = current_schema() AND (table_name, column_name) IN (
      ('users','must_change_password'),('users','is_dev_admin'),('users','dev_admin_mode'),
      ('users','password_hash'),('users','default_organization_id'),
      ('organization_members','role'),('organization_members','is_active'),('project_members','role'))),
  'project', (SELECT json_build_object('name', name, 'organizationId', organization_id) FROM projects WHERE id = ${literal(projectId)}),
  'existing', (SELECT json_agg(json_build_object('email', u.email, 'active', u.is_active, 'devAdmin', u.is_dev_admin,
      'orgRole', om.role, 'orgActive', om.is_active, 'projectRole', pm.role,
      'mustChangePassword', u.must_change_password, 'devAdminMode', u.dev_admin_mode,
      'orgCount', (SELECT count(*) FROM organization_members x WHERE x.user_id = u.id)) ORDER BY u.email)
    FROM users u
    LEFT JOIN organization_members om ON om.user_id = u.id AND om.organization_id = ${literal(organizationId)}
    LEFT JOIN project_members pm ON pm.user_id = u.id AND pm.project_id = ${literal(projectId)}
    WHERE u.email IN (${existing})),
  'conflicts', (SELECT coalesce(json_agg(email), '[]') FROM users WHERE email IN (${wanted}))
)::text;`;
}

function applySql({ organizationId, projectId, missing }, hashes, referenceEmail) {
  const reference = literal(referenceEmail);
  const rows = missing
    .map((u, i) => `(${literal(u.email)}, ${literal(u.name)}, ${literal(hashes[i])})`)
    .join(',\n  ');
  // Copy an existing ordinary diagnostic member, never the fixture owner.
  return `CREATE TEMP TABLE diag_new (email text, name text, password_hash text) ON COMMIT DROP;
INSERT INTO diag_new VALUES
  ${rows};
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = ${literal(projectId)} AND organization_id = ${literal(organizationId)}) THEN
    RAISE EXCEPTION 'fixture project is not in the diagnostic organization';
  END IF;
  IF EXISTS (SELECT 1 FROM users u JOIN diag_new n ON n.email = u.email) THEN
    RAISE EXCEPTION 'a target diagnostic email already exists; refusing to overwrite';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users u
      JOIN organization_members om ON om.user_id = u.id AND om.organization_id = ${literal(organizationId)} AND om.is_active
      JOIN project_members pm ON pm.user_id = u.id AND pm.project_id = ${literal(projectId)}
      WHERE u.email = ${reference} AND u.is_active AND NOT u.is_dev_admin
        AND NOT u.dev_admin_mode AND NOT u.must_change_password
        AND om.role = 'MEMBER' AND pm.role = 'MEMBER') THEN
    RAISE EXCEPTION 'reference diagnostic user lacks active organization/project membership';
  END IF;
END $$;
INSERT INTO users (id, email, name, password_hash, is_active, must_change_password, is_dev_admin, dev_admin_mode, default_organization_id, created_at, updated_at)
SELECT gen_random_uuid(), n.email, n.name, n.password_hash, true, false, false, false, r.default_organization_id, now(), now()
FROM diag_new n CROSS JOIN (SELECT default_organization_id FROM users WHERE email = ${reference}) r;
INSERT INTO organization_members (id, user_id, organization_id, role, is_active, joined_at, created_at)
SELECT gen_random_uuid(), u.id, ${literal(organizationId)}, r.role, true, now(), now()
FROM users u JOIN diag_new n ON n.email = u.email
CROSS JOIN (SELECT om.role FROM organization_members om JOIN users x ON x.id = om.user_id
  WHERE x.email = ${reference} AND om.organization_id = ${literal(organizationId)}) r;
INSERT INTO project_members (id, project_id, user_id, role, created_at, updated_at)
SELECT gen_random_uuid(), ${literal(projectId)}, u.id, r.role, now(), now()
FROM users u JOIN diag_new n ON n.email = u.email
CROSS JOIN (SELECT pm.role FROM project_members pm JOIN users x ON x.id = pm.user_id
  WHERE x.email = ${reference} AND pm.project_id = ${literal(projectId)}) r;
SELECT json_build_object('created', (SELECT count(*) FROM users u JOIN diag_new n ON n.email = u.email))::text;`;
}

async function verify({ users, organizationId, projectId }) {
  const baseUrl = process.env.K6_BASE_URL?.replace(/\/+$/, '');
  const origin = process.env.K6_BROWSER_ORIGIN;
  if (!baseUrl || !origin) throw new Error('K6_BASE_URL and K6_BROWSER_ORIGIN are required');
  const failures = [];
  for (const user of users) {
    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    const auth = (await login.json().catch(() => undefined))?.data;
    if (login.status !== 200 || !auth?.accessToken) {
      failures.push(`${user.email}: login HTTP ${login.status}`);
      continue;
    }
    if (auth.user?.currentOrganizationId !== organizationId) {
      failures.push(`${user.email}: selected organization differs`);
      continue;
    }
    const project = await fetch(
      `${baseUrl}/api/v1/organizations/${organizationId}/projects/${projectId}`,
      { headers: { Authorization: `Bearer ${auth.accessToken}` } },
    );
    if (project.status !== 200) failures.push(`${user.email}: fixture HTTP ${project.status}`);
  }
  log(`verified ${users.length - failures.length}/${users.length} users`);
  for (const failure of failures) log(`FAIL ${failure}`);
  if (failures.length) process.exit(1);
}

const mode = process.argv[2];
const state = loadState();
log(`${state.users.length} existing users, ${state.missing.length} to create, project ${state.projectId}`);

if (mode === 'check') {
  console.log(JSON.stringify(JSON.parse(runSql(checkSql(state))), null, 2));
} else if (mode === 'apply') {
  if (!state.missing.length) {
    log('credential set already at target; nothing to create');
  } else {
    const prerequisite = JSON.parse(runSql(checkSql(state)));
    if (prerequisite.columns?.length !== REQUIRED_COLUMNS ||
        prerequisite.project?.organizationId !== state.organizationId ||
        prerequisite.conflicts.length || prerequisite.existing?.length !== state.users.length ||
        !prerequisite.existing.every((u) => u.active && u.orgActive && u.projectRole &&
          !u.devAdmin && !u.devAdminMode && !u.mustChangePassword)) {
      throw new Error('Staging schema, fixture ownership, identity access or email conflict check failed');
    }
    const reference = prerequisite.existing.find((u) =>
      u.orgRole === 'MEMBER' && u.projectRole === 'MEMBER');
    if (!reference) throw new Error('No ordinary diagnostic member is available as role reference');
    const hashes = state.missing.map((u) => {
      log(`hashing ${u.email}`);
      return bcrypt.hashSync(state.password, BCRYPT_ROUNDS);
    });
    // Credentials are staged before the write so a successful transaction can
    // never leave accounts whose password is unrecorded.
    const merged = [
      ...state.users,
      ...state.missing.map((u) => ({ email: u.email, password: state.password, organizationId: u.organizationId })),
    ];
    const pending = `${usersFile}.pending`;
    const descriptor = openSync(pending, 'wx', 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(merged, null, 2)}\n`);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    log(runSql(applySql(state, hashes, reference.email)));
    renameSync(pending, usersFile);
    log(`credential file now holds ${merged.length} users`);
  }
} else if (mode === 'verify') {
  await verify(state);
} else {
  console.error('Usage: provision-diagnostic-users.mjs check|apply|verify');
  process.exit(2);
}
